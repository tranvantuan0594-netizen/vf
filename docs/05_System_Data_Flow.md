# System Data Flow Documentation

This document describes the current implementation flow for Authentication, Vehicle Discovery, and Telemetry in the VinFast Dashboard.

## 1. Authentication Flow (Login)

The authentication process utilizes the **Serverless Proxy** to communicate with VinFast's Auth0, bypassing CORS restrictions.

1.  **User Input**: User enters `email` and `password` on the Dashboard Login page (`/`).
2.  **Proxy Request**: Frontend (`api.js`) sends a POST request to `/api/login`.
3.  **Proxy Forwarding** (`src/pages/api/login.js`):
    - The Astro Server (running locally or on Edge) receives the credentials.
    - It forwards the request to `https://vin3s.au.auth0.com/oauth/token` (or regional equivalent).
4.  **Token Issuance**:
    - Auth0 returns an `access_token` and `refresh_token` to the Proxy.
    - The Proxy sets both tokens as **HttpOnly cookies** (`secure` flag auto-detects localhost for local dev).
5.  **Session Ready**:
    - The Frontend receives a success response (no tokens in JS — they live in HttpOnly cookies).
    - The `AuthStore` is updated, and the UI reveals the dashboard.

## 2. Token Refresh Flow

The system implements automatic token refresh to handle expired Access Tokens.

1.  **Trigger**: An API call (e.g., `getVehicles`) returns a `401 Unauthorized`.
2.  **Refresh Logic**:
    - `api.js` intercepts the 401.
    - Calls `POST /api/refresh` which exchanges the `refresh_token` cookie for a new `access_token`.
    - The Proxy sets the new token as an HttpOnly cookie.
    - The original request is retried automatically.
3.  **Fallback**: If the refresh itself fails (e.g., expired `refresh_token`), the user is logged out.

## 3. Vehicle Discovery Flow

Once authenticated, the system discovers the user's vehicles.

1.  **Frontend Call**: `api.getVehicles()` is called.
2.  **Proxy Request**: It sends a GET request to `/api/proxy/ccarusermgnt/api/v1/user-vehicle`.
    - Headers: `Authorization: Bearer <token>`
3.  **Forwarding**: The Proxy forwards the request to the VinFast API.
4.  **Response**: The list of vehicles is returned to the Frontend.

## 4. MQTT Telemetry Flow (Live Data)

All vehicle telemetry is delivered via **MQTT over WebSocket** through AWS IoT Core. There is no REST polling — MQTT is the sole real-time data source. A one-time core alias registration triggers the T-Box to begin pushing data.

### A. MQTT Connection & Core Registration

1.  **DashboardController** mounts, sets MQTT callbacks, then calls `fetchUser()` and `fetchVehicles()` in parallel.
2.  `fetchVehicles()` → `switchVehicle(vin)` → `mqttClient.connect(vin)`.
3.  The MQTT client authenticates via AWS Cognito (federated with Auth0 token).
4.  Subscribes to `/mobile/{VIN}/push` for live telemetry messages.
5.  **`onConnected` callback** → `api.registerResources(vin)` registers ~46 core aliases via `POST list_resource` (1 API call, ~100ms). This triggers the T-Box to begin pushing telemetry data.

### B. Data Ingestion

1.  **MQTT Message**: VinFast pushes telemetry updates to the subscribed topic.
2.  **Parsing**: `mqttClient._onMessage()` → `parseTelemetry()` maps raw `deviceKey` (e.g., "34183/1/9") to friendly keys (e.g., `battery_level`).
3.  **Store Update**: `updateFromMqtt(vin, parsed, rawMessages)` merges data into `vehicleStore` and `vehicleCache`.
4.  **isRefreshing cleared**: On first MQTT message arrival for the active VIN.
5.  **Reactivity**: UI components re-render automatically via nanostores subscriptions.

### C. Deep Scan (TelemetryDrawer)

When the user opens the Deep Scan drawer:

1.  `getDeepScanData(vin)` reads the MQTT snapshot (0 API calls — instant).
2.  If snapshot is empty, waits up to 5s with exponential backoff for MQTT data to arrive.
3.  Data is grouped and displayed progressively as MQTT data arrives.
4.  `mqttSnapshotVersion` atom triggers re-reads when new data comes in.

### D. KV Known-Good Aliases (Crowdsourced)

After the user discovers aliases with data, the dashboard reports them to Cloudflare KV:

- **POST** `/api/known-aliases` — merges new aliases into KV (additive, deduped).
- **GET** `/api/known-aliases?model=VF9&year=2024` — read cached aliases.
- Future users of the same model benefit from shared alias metadata.

### E. Credential Lifecycle

- **AWS Cognito credentials**: 1-hour TTL (fixed by AWS `GetCredentialsForIdentity`).
- **WebSocket URL**: Signed for 24 hours.
- **Client caching**: Credentials cached with 5-minute buffer before expiry.
- **MQTT reconnect**: Automatic on disconnect; `onConnected` callback fires.
