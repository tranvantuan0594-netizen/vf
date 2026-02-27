# MQTT Real-Time Telemetry - Technical Documentation

**Date**: February 2026
**Status**: Implemented & Operational

---

## Overview

VFDashboard now supports **real-time telemetry** via MQTT over WebSocket, connecting directly to VinFast's AWS IoT Core broker. This replaces the previous REST-only polling approach (which returned limited static data from `app/ping`) with a live streaming connection that mirrors the official Android app's behavior.

### Why MQTT?

The REST endpoint `ccaraccessmgmt/api/v1/telemetry/app/ping` only returns a small subset of metadata (battery leasing information). All real-time vehicle telemetry (battery SOC, location, doors, speed, tire pressure, etc.) flows through MQTT via AWS IoT Core -- the same mechanism used by the official VinFast Connected Car Android app.

---

## Architecture

```
Browser (VFDashboard)              Astro SSR (CF Pages)             AWS / VinFast
       |                                   |                              |
       |-- GET /api/mqtt-credentials ----->|                              |
       |                                   |-- Read access_token cookie   |
       |                                   |-- POST GetId -------------->| Cognito
       |                                   |<--- IdentityId -------------|
       |                                   |-- POST GetCredentials ----->| Cognito/STS
       |   <-- {AccessKey,Secret,Token} ---|<--- Temp AWS Creds ---------|
       |                                   |-- POST attach-policy ------>| VinFast API
       |                                   |<--- Policy attached --------|
       |                                   |                              |
       |-- SigV4 sign WSS URL             |                              |
       |-- mqtt.connect(signedUrl) ----------------------------------->| IoT Core
       |-- subscribe /mobile/{VIN}/push    |                              |
       |-- subscribe monitoring/server/... |                              |
       |-- subscribe /server/{VIN}/remctrl |                              |
       |                                   |                              |
       |-- POST list_resource (via proxy)->|----------------------------->| VinFast API
       |   (triggers T-Box data push)      |                              |
       |                                   |                              |
       |<------------- MQTT messages -----------------------------------|  IoT -> T-Box
       |-- Parse deviceKey -> alias -> store                              |
       |-- UI updates reactively           |                              |
```

### Why Browser-Side MQTT?

Cloudflare Pages Functions have a **30-second execution timeout** and cannot maintain persistent server-side connections. The browser connects directly to the MQTT broker via WebSocket, which is both architecturally simpler and more reliable for real-time data.

---

## Components

### 1. Server Endpoint: `/api/mqtt-credentials`

**File**: `src/pages/api/mqtt-credentials.js`

Exchanges the user's Auth0 access token for temporary AWS credentials:

1. **GetId**: Calls AWS Cognito Identity `GetId` with the Auth0 token as a login provider
2. **GetCredentialsForIdentity**: Obtains temporary AWS credentials (AccessKeyId, SecretAccessKey, SessionToken)
3. **attach-policy**: Calls VinFast's `ccarusermgnt/api/v1/user-vehicle/attach-policy` to grant IoT permissions to the Cognito identity

**Key Details**:
- No AWS SDK required -- uses raw HTTP POST to Cognito Identity endpoints
- Cognito API version: `1.1` (via `X-Amz-Target` header)
- Identity Pool: `ap-southeast-1:c6537cdf-92dd-4b1f-99a8-9826f153142a`
- Login Provider: `vin3s.au.auth0.com`
- Credentials are valid for ~1 hour (determined by Cognito)
- Response includes `policyAttached` status for debugging

### 2. Browser MQTT Client

**File**: `src/services/mqttClient.js`

The `MqttTelemetryClient` class handles:

- **SigV4 URL Signing**: Signs the WebSocket URL using Web Crypto API (zero dependencies)
- **Connection Management**: Connect, disconnect, auto-reconnect with fresh signed URLs
- **Connection Reuse**: On vehicle switch, reuses existing connection (topic swap only, no reconnect)
- **Subscription Tracking**: `subscribedVins` / `subscribedTopics` Sets for restore after reconnect
- **Heartbeat**: Publishes to `/vehicles/{VIN}/push/connected/heartbeat` every 120 seconds
- **Message Parsing**: Converts incoming MQTT messages to telemetry data via `parseTelemetry()`

#### SigV4 Signing - Critical Implementation Note

AWS IoT Core has a specific quirk for WebSocket connections: the `X-Amz-Security-Token` parameter must **NOT** be included in the canonical query string used for SigV4 signature calculation. It must be appended to the URL **after** the signature:

```
Canonical Query (for signing):
  X-Amz-Algorithm, X-Amz-Credential, X-Amz-Date, X-Amz-Expires, X-Amz-SignedHeaders

Final URL:
  wss://endpoint/mqtt?{canonical}&X-Amz-Signature={sig}&X-Amz-Security-Token={token}
```

This differs from standard AWS SigV4 signing where the security token is part of the signed request.

#### Reconnection Strategy

The built-in `mqtt.js` reconnection is **disabled** (`reconnectPeriod: 0`) because:
- The library's `transformWsUrl` callback does not support async/Promise returns
- SigV4 signing requires async Web Crypto API calls
- A fresh signed URL is needed for each reconnection attempt

Instead, `_scheduleReconnect()` handles reconnection manually with **exponential backoff** (5s → 10s → 20s → 40s → ... max 60s), signing a fresh URL each time. The attempt counter resets on successful connect.

### 3. MQTT Store

**File**: `src/stores/mqttStore.ts`

Nanostore tracking connection state:

| Field | Type | Description |
|-------|------|-------------|
| `status` | `'disconnected' \| 'connecting' \| 'connected' \| 'error'` | Current connection state |
| `lastMessageTime` | `number \| null` | Timestamp of last received message |
| `messageCount` | `number` | Total messages received this session |
| `error` | `string \| null` | Last error message |

### 4. Vehicle Store Integration

**File**: `src/stores/vehicleStore.ts`

Added `updateFromMqtt(vin, parsedData)` function that merges incoming MQTT telemetry directly into the vehicle store via the existing `updateVehicleData()` pipeline.

### 5. Dashboard Controller

**File**: `src/components/DashboardController.jsx`

Orchestrates the MQTT lifecycle:
- Starts MQTT connection after vehicle initialization
- Calls `registerResources()` via REST API after MQTT connects (triggers T-Box to push data)
- Routes MQTT messages to `updateFromMqtt()`
- Destroys MQTT client on component unmount

### 6. UI Integration

**File**: `src/components/VehicleHeader.jsx`

Displays MQTT connection status:
- **Connected**: Green pulsing "Live" indicator with "MQTT" label
- **Connecting**: Amber "Connecting" with "MQTT..." label
- **Disconnected**: Shows "Offline" status, no data updates

---

## MQTT Configuration

**File**: `src/config/vinfast.js`

```javascript
MQTT_CONFIG = {
  vn: {
    endpoint: "prod.iot.connected-car.vinfast.vn",
    region: "ap-southeast-1",
    cognitoPoolId: "ap-southeast-1:c6537cdf-92dd-4b1f-99a8-9826f153142a",
    cognitoLoginProvider: "vin3s.au.auth0.com",
    heartbeatInterval: 120000,  // 2 minutes
    keepAlive: 300,             // 5 minutes (seconds)
  },
};
```

**Endpoint**: `prod.iot.connected-car.vinfast.vn` (VinFast custom domain → AWS IoT Core `ap-southeast-1`)

---

## MQTT Topics

### Subscriptions (Incoming)

| Topic | Description |
|-------|-------------|
| `/mobile/{VIN}/push` | Primary telemetry updates (battery, doors, tires, location, etc.) |
| `monitoring/server/{VIN}/push` | Server-side monitoring data |
| `/server/{VIN}/remctrl` | Remote control status updates |

### Publications (Outgoing)

| Topic | Description |
|-------|-------------|
| `/vehicles/{VIN}/push/connected/heartbeat` | Connection heartbeat (every 120s) |

### Message Format

**Incoming telemetry** (on `/mobile/{VIN}/push`):
```json
[
  {"deviceKey": "34183_00001_00009", "value": "85", "lastUpdateTime": 1234567890000},
  {"deviceKey": "34183_00001_00010", "value": "320", "lastUpdateTime": 1234567890000}
]
```

The `deviceKey` format `{objectId}_{instanceId}_{resourceId}` maps to the static alias map for human-readable field names (e.g., `VEHICLE_STATUS_HV_BATTERY_SOC`).

**Outgoing heartbeat**:
```json
{
  "version": "1.2",
  "timestamp": 1234567890000,
  "trans_id": "<uuid>",
  "content": {
    "34183": { "1": { "54": "2" } }
  }
}
```

The heartbeat alternates between state values `1` and `2` to signal active connection to the T-Box.

---

## Credential Flow Details

### Step 1: Cognito GetId
```
POST https://cognito-identity.ap-southeast-1.amazonaws.com/
X-Amz-Target: AWSCognitoIdentityService.GetId
Content-Type: application/x-amz-json-1.1

{
  "IdentityPoolId": "ap-southeast-1:c6537cdf-92dd-4b1f-99a8-9826f153142a",
  "Logins": { "vin3s.au.auth0.com": "<access_token>" }
}
```

### Step 2: Cognito GetCredentialsForIdentity
```
POST https://cognito-identity.ap-southeast-1.amazonaws.com/
X-Amz-Target: AWSCognitoIdentityService.GetCredentialsForIdentity
Content-Type: application/x-amz-json-1.1

{
  "IdentityId": "<from step 1>",
  "Logins": { "vin3s.au.auth0.com": "<access_token>" }
}
```

### Step 3: VinFast attach-policy
```
POST https://mobile.connected-car.vinfast.vn/ccarusermgnt/api/v1/user-vehicle/attach-policy
Authorization: Bearer <access_token>
Content-Type: application/json

{ "target": "<identity_id>" }
```

This step is essential -- without it, the Cognito identity does not have IoT permissions and MQTT connection will be rejected.

---

## Files Modified/Created

| File | Action | Purpose |
|------|--------|---------|
| `src/pages/api/mqtt-credentials.js` | **Created** | Server-side Cognito credential exchange + policy attachment |
| `src/services/mqttClient.js` | **Created** | Browser-side MQTT client with SigV4 signing |
| `src/stores/mqttStore.ts` | **Created** | Nanostore for MQTT connection state |
| `src/stores/vehicleStore.ts` | **Modified** | Added `updateFromMqtt()` handler |
| `src/components/DashboardController.jsx` | **Modified** | MQTT lifecycle management, resource registration |
| `src/components/VehicleHeader.jsx` | **Modified** | Live MQTT status indicator in header |
| `src/config/vinfast.js` | **Modified** | Added `MQTT_CONFIG` with endpoints and Cognito config |
| `package.json` | **Modified** | Added `mqtt` (v5.x) dependency |

### Deleted (cleanup)
| File | Reason |
|------|--------|
| `src/pages/api/debug-telemetry.js` | Debug-only endpoint, no longer needed |
| `src/pages/api/debug-telemetry2.js` | Debug-only endpoint, no longer needed |

---

## Troubleshooting

### WebSocket connection fails with 403
- **Cause**: SigV4 signature mismatch. Most commonly, `X-Amz-Security-Token` was incorrectly included in the canonical query string.
- **Fix**: Ensure the security token is appended AFTER the signature, not included in the signed canonical query.

### MQTT connects but no messages received
- **Cause**: IoT policy not attached to the Cognito identity.
- **Fix**: Verify `attach-policy` endpoint returns success. Check browser console for `[MQTT] Policy attach warning`.

### Frequent reconnections
- **Cause**: Credentials expired (default ~1 hour) or network instability.
- **Fix**: The client automatically refreshes credentials on reconnect. Check `_ensureCredentials()` logic and credential expiry parsing.

### "Native WS close" with code 1006
- **Cause**: Abnormal WebSocket closure (no close frame). Common with network changes or server-side disconnection.
- **Fix**: Auto-reconnect handles this. If persistent, check endpoint accessibility.

### Debug MQTT key discovery (local cache + live sample)

Use this in browser console after deep scan has run at least once:

```js
// Show current cached keys + live sample keys cho tất cả VIN đã thấy
window.__vfMqttTelemetry.buildMqttTelemetryInspectorReport();

// Show only cho 1 VIN (ví dụ: RLLVXXXXXXXXXXXXX)
window.__vfMqttTelemetry.buildMqttTelemetryInspectorReport(
  "RLLVXXXXXXXXXXXXX",
);

// Xóa cache key của VIN trước khi re-run deep scan
window.__vfMqttTelemetry.clearMqttTelemetryCatalogForVin(
  "RLLVXXXXXXXXXXXXX",
);
```

`__vfMqttTelemetry` trả về:
- `catalogKeys`: danh sách key đã cache cho VIN (key dạng `objectId|instanceId|resourceId`)
- `snapshotKeys`: key đang có trong dữ liệu MQTT live của session hiện tại
- `snapshotCount`: tổng số bản ghi live đang giữ trong bộ nhớ

Sau lần deep scan đầu tiên, các lần gọi tiếp sẽ ưu tiên `catalogKeys` để giảm lần request.

---

## Dependencies

- **mqtt** (v5.x): MQTT.js library for WebSocket MQTT connections
- **Web Crypto API**: Built into all modern browsers, used for HMAC-SHA256 and SHA-256 (SigV4 signing)
- **No AWS SDK**: Cognito Identity API calls are simple unsigned HTTP POST requests
