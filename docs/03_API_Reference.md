# VinFast Dashboard - API Reference

**Version:** 5.0
**Status:** VALIDATED
**Date:** Feb 2026

---

## 1. Overview

This architecture uses a **Serverless Proxy** approach. The Frontend communicates with `localhost/api/*` (or the deployed domain), and the Astro Server functions forward these requests to VinFast.

### Base Configuration

- **Proxy Base URL**: `/api`
- **Auth0 Domain**: Handled by Proxy based on Region.

---

## 2. Proxy Endpoints

These endpoints are served by the Astro Server (Node.js/Cloudflare/Vercel).

### 2.1 Login Proxy

**Endpoint**: `POST /api/login`

- **Purpose**: Authenticate with VinFast Auth0 without triggering CORS errors.
- **Body**: `{ email, password, region }`
- **Response**: Sets `access_token` and `refresh_token` as HttpOnly cookies.
- **Note**: `secure` flag auto-detects localhost for local dev compatibility.

### 2.2 Generic API Proxy

**Endpoint**: `ANY /api/proxy/{...path}`

- **Purpose**: Forward requests to VinFast Connected Car API.
- **Headers**: Requires `Authorization: Bearer <token>` and `x-vin-code`.
- **Signing**: Endpoints under `ccaraccessmgmt/` and `ccarcharging/` require X-HASH + X-HASH-2 (HMAC-SHA256).
- **Usage**:
  - `GET /api/proxy/ccarusermgnt/api/v1/user-vehicle` — Fetch vehicles.
  - `POST /api/proxy/ccaraccessmgmt/api/v1/telemetry/{vin}/list_resource` — Register core aliases.
  - `POST /api/proxy/ccaraccessmgmt/api/v1/telemetry/{vin}/aliases` — Fetch alias definitions.
  - `POST /api/proxy/ccarcharging/api/v1/charging-sessions/search` — Fetch charging history.

### 2.3 MQTT Credentials

**Endpoint**: `POST /api/mqtt-credentials`

- **Purpose**: Exchange Auth0 token for AWS Cognito temporary credentials.
- **Response**: `{ accessKeyId, secretAccessKey, sessionToken, expiration }`
- **TTL**: 1 hour (fixed by AWS), cached client-side with 5-min buffer.

### 2.4 Known-Good Aliases (KV)

**Endpoint**: `GET /api/known-aliases?model=VF9&year=2024`

- **Purpose**: Read crowdsourced known-good telemetry aliases from Cloudflare KV.
- **Response**: `{ aliases: [{objectId, instanceId, resourceId, alias}], source: "kv" }`

**Endpoint**: `POST /api/known-aliases`

- **Purpose**: Merge new known-good aliases into KV (additive, deduped).
- **Auth**: Requires `access_token` cookie.
- **Body**: `{ model, year, aliases: [...], discoveredBy }`

---

## 3. Client Service (`src/services/api.js`)

The application uses the `VinFastAPI` class to encapsulate all logic.

### 3.1 `api.authenticate(email, password, region)`

- Calls `/api/login`.
- Tokens stored as HttpOnly cookies (server-side).

### 3.2 `api.getVehicles()`

- Calls `/api/proxy` to retrieve vehicle list.
- Returns array of vehicle objects.

### 3.3 `api.registerResources(vin, requestObjects)`

- Calls `POST list_resource` to register ~46 core aliases.
- Triggers T-Box to push telemetry data via MQTT.
- Called once on MQTT connect (via `DashboardController.onConnected`).

### 3.4 `api.getKnownAliases(model, year)` / `api.reportKnownAliases(...)`

- Read/write known-good aliases from Cloudflare KV.
- Used by TelemetryDrawer for crowdsourced alias data.

---

## 4. Data Flow

Vehicle telemetry uses a **Register Once, Read Forever** pattern:

1. MQTT connects → `onConnected` registers ~46 core aliases via `list_resource` (1 API call, ~100ms).
2. T-Box begins pushing data → MQTT subscribes to `/mobile/{VIN}/push`.
3. MQTT messages arrive → parsed → `vehicleStore` updated reactively.
4. First MQTT data arrives ~500ms after connect.

> Deep Scan data arrives on the same MQTT stream — no additional registration needed.

---

## 5. Control Limitations

> **IMPORTANT**: Remote Control Commands (Lock/Unlock, Climate Start) are **Read-Only**.

The dashboard can **display** lock status (`is_locked`) and climate status (`fan_speed`, `inside_temp`), but it cannot **change** them. Command signing requires a private key stored in the mobile app's keystore, which is not accessible to this web dashboard.
