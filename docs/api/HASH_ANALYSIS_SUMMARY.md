# VinFast X-HASH Technical Documentation

**Version:** 5.0
**Updated:** February 14, 2026
**Status:** Resolved

---

## Overview

The VinFast Connected Car API uses the X-HASH authentication header to protect telemetry endpoints. This document records the algorithm that was reverse engineered.

---

## X-HASH Specification

### Required Headers

| Header          | Description                    | Example                                        |
| --------------- | ------------------------------ | ---------------------------------------------- |
| `X-HASH`        | HMAC-SHA256 signature (Base64) | `Xit6wzaC0Bpcsi6QTTT/dBY2hcN+jvHiKkEJu3EwNRI=` |
| `X-TIMESTAMP`   | Unix timestamp (milliseconds)  | `1769189217462`                                |
| `X-VIN-CODE`    | Vehicle Identification Number  | `RLLVXXXXXXXXXXXXX`                          |
| `Authorization` | Bearer token from Auth0 login  | `Bearer eyJhbG...`                             |

### Algorithm

```
message = lowercase(method + "_" + path + "_" + vin + "_" + secretKey + "_" + timestamp)
X-HASH = Base64(HMAC-SHA256(secretKey, message))
```

**Components:**

- `method`: HTTP method (GET, POST, etc.)
- `path`: API path without query string (e.g., `/ccaraccessmgmt/api/v1/telemetry/list_resource`)
- `vin`: Vehicle VIN code
- `secretKey`: Static secret key
- `timestamp`: X-TIMESTAMP value

**Example:**

```
Input:
  method = "POST"
  path = "/ccarcharging/api/v1/stations/search"
  vin = "RLLVXXXXXXXXXXXXX"
  timestamp = "1769029742000"

Message (lowercase):
  "post_/ccarcharging/api/v1/stations/search_rllvxxxxxxxxxxxxx71_<secretKey>_1769029742000"

Output:
  X-HASH = "0ahe0CvpJnSyZH2BU1LxwA9Ytfa1qxW784Xc3Kvr4cU="
```

---

## Implementation

### JavaScript (Node.js)

```javascript
import crypto from "crypto";

const SECRET_KEY = "<secret_key>";

function generateXHash(method, path, vin, timestamp) {
  // Remove query string
  const pathOnly = path.split("?")[0];

  // Ensure path starts with /
  const normalizedPath = pathOnly.startsWith("/") ? pathOnly : "/" + pathOnly;

  // Build message
  const parts = [method, normalizedPath];
  if (vin) parts.push(vin);
  parts.push(SECRET_KEY);
  parts.push(String(timestamp));

  const message = parts.join("_").toLowerCase();

  // HMAC-SHA256 + Base64
  const hmac = crypto.createHmac("sha256", SECRET_KEY);
  hmac.update(message);
  return hmac.digest("base64");
}

// Usage
const timestamp = Date.now();
const xHash = generateXHash(
  "POST",
  "/api/v1/telemetry/list_resource",
  "RLLVXXXXXXXXXXXXX",
  timestamp,
);
```

### Python

```python
import hmac
import hashlib
import base64
import time

SECRET_KEY = '<secret_key>'

def generate_xhash(method: str, path: str, vin: str = None) -> tuple[str, str]:
    timestamp = str(int(time.time() * 1000))

    # Remove query string
    path_only = path.split('?')[0]
    if not path_only.startswith('/'):
        path_only = '/' + path_only

    # Build message
    parts = [method, path_only]
    if vin:
        parts.append(vin)
    parts.append(SECRET_KEY)
    parts.append(timestamp)

    message = '_'.join(parts).lower()

    # HMAC-SHA256 + Base64
    signature = hmac.new(
        SECRET_KEY.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).digest()

    x_hash = base64.b64encode(signature).decode('utf-8')
    return x_hash, timestamp
```

---

## API Endpoints

### Telemetry Data

```
POST /ccaraccessmgmt/api/v1/telemetry/list_resource
Body: [{"resourceId":"10","instanceId":"1","objectId":"34180"}, ...]
```

### Charging Stations

```
POST /ccarcharging/api/v1/stations/search
Body: {"latitude":21.209747,"longitude":105.793358,"excludeFavorite":false}
```

### User Vehicles

```
GET /ccarusermgnt/api/v1/user-vehicle
```

### Vehicle Ping

```
POST /api/v3.2/connected_car/app/ping
```

---

## Telemetry Object IDs

| Object ID | Resource ID | Description           |
| --------- | ----------- | --------------------- |
| 34180     | 10          | State of Charge (SOC) |
| 34181     | 7           | Estimated Range       |
| 34183     | 1           | Charging Status       |
| 34190     | \*          | Tire Pressure         |
| 34191     | \*          | Door Status           |

---

## Authentication Flow

1. User login via Auth0 (`vin3s.au.auth0.com`)
2. Receive `access_token` (JWT, ~24h expiry)
3. For each API request:
   - Generate timestamp
   - Generate X-HASH using algorithm above
   - Include headers: `Authorization`, `X-HASH`, `X-TIMESTAMP`, `X-VIN-CODE`

---

## Summary

| Item           | Status                                      |
| -------------- | ------------------------------------------- |
| Algorithm      | HMAC-SHA256(key, message) → Base64          |
| Message format | `method_path_vin_key_timestamp` (lowercase) |
| Hash validity  | ~10-30 seconds window                       |
| Implementation | VFDashboard proxy auto-generates            |

---

## X-HASH-2 Specification (Added Feb 2026)

### Overview

X-HASH-2 is the second signing layer, implemented in native code (`libsecure.so`). The server began requiring this header around February 2026 for telemetry endpoints.

### Required Headers (Updated)

| Header              | Description                           | Example                                        |
| ------------------- | ------------------------------------- | ---------------------------------------------- |
| `X-HASH`            | HMAC-SHA256 signature (Base64)        | `u5B0xgcHtqNpGNST5Sw53ds5PvMhb/ApCUgZQ1glAh0=` |
| `X-HASH-2`          | Native HMAC-SHA256 signature (Base64) | `j6M6tf1Tpr+jldxYN5QHNIKXFe5X3vD6yrr+rTbAcVI=` |
| `X-TIMESTAMP`       | Unix timestamp (milliseconds)         | `1771033156922`                                |
| `X-VIN-CODE`        | Vehicle Identification Number         | `RLLVXXXXXXXXXXXXX`                          |
| `Authorization`     | Bearer token from Auth0 login         | `Bearer eyJhbG...`                             |
| `x-device-platform` | **Must be `android`** (see notes)     | `android`                                      |

### Algorithm

```
// Step 1: Build path
normalizedPath = path.stripLeadingSlash().replace("/", "_")

// Step 2: Build message
parts = [platform]
if (vinCode) parts.push(vinCode)
parts.push(identifier, normalizedPath, method, timestamp)
message = parts.join("_").toLowerCase()

// Step 3: Sign
X-HASH-2 = Base64(HMAC-SHA256("ConnectedCar@6521", message))
```

**Components:**

- `platform`: Value of `x-device-platform` header (must be `android`)
- `vinCode`: Vehicle VIN code (optional, included when x-vin-code header present)
- `identifier`: Value of `x-device-identifier` header
- `normalizedPath`: API path with leading `/` stripped and `/` replaced by `_`
- `method`: HTTP method (GET, POST, etc.)
- `timestamp`: X-TIMESTAMP value (milliseconds)

**Example:**

```
Input:
  platform = "android"
  vinCode = "RLLVXXXXXXXXXXXXX"
  identifier = "vfdashboard-community-edition"
  path = "/ccaraccessmgmt/api/v1/telemetry/app/ping"
  method = "POST"
  timestamp = "1771033156922"

Normalized path:
  "ccaraccessmgmt_api_v1_telemetry_app_ping"

Message (lowercase):
  "android_rllvxxxxxxxxxxxxx71_vfdashboard-community-edition_ccaraccessmgmt_api_v1_telemetry_app_ping_post_1771033156922"

Output:
  X-HASH-2 = "j6M6tf1Tpr+jldxYN5QHNIKXFe5X3vD6yrr+rTbAcVI="
```

### Implementation (JavaScript)

```javascript
import crypto from "crypto";

function generateXHash2({
  platform,
  vinCode,
  identifier,
  path,
  method,
  timestamp,
}) {
  let normalizedPath = path;
  if (normalizedPath.startsWith("/")) {
    normalizedPath = normalizedPath.substring(1);
  }
  normalizedPath = normalizedPath.replace(/\//g, "_");

  const parts = [platform];
  if (vinCode) parts.push(vinCode);
  parts.push(identifier, normalizedPath, method, String(timestamp));

  const message = parts.join("_").toLowerCase();

  const hmac = crypto.createHmac("sha256", "ConnectedCar@6521");
  hmac.update(message);
  return hmac.digest("base64");
}
```

### Key Differences: X-HASH vs X-HASH-2

| Aspect            | X-HASH                                | X-HASH-2                                          |
| ----------------- | ------------------------------------- | ------------------------------------------------- |
| Secret Key        | `Vinfast@2025` (AES-encrypted in APK) | `ConnectedCar@6521` (byte-by-byte in native .so)  |
| Message format    | `method_path_[vin_]secret_timestamp`  | `platform_[vin_]identifier_path_method_timestamp` |
| Path format       | With leading `/`                      | Without leading `/`, `/` replaced by `_`          |
| Secret in message | Yes (included in message)             | No (only used as HMAC key)                        |
| Source            | Java (HMACInterceptor)                | Native C (libsecure.so via JNI)                   |
| Required for      | Telemetry endpoints only              | Telemetry endpoints only                          |

### Important Notes

1. **`x-device-platform` must be `android`** — The server rejects `ios` and other custom values for **all** API endpoints (not just telemetry). Using `ios` will result in a 401 even on the `user-vehicle` endpoint, leading to a redirect loop back to the login page.
2. **Why only Android is supported?** — Reverse engineering an APK (Android) is much faster and easier compared to iOS (IPA requires jailbreak, native frameworks are difficult to extract). The secret keys and algorithms in this document were all extracted from the Android APK (`libsecure.so`, `HMACInterceptor.smali`). iOS may use different secret keys and signing flows — this has not been thoroughly investigated.
3. **`x-device-family` and `x-device-os-version` are not validated** — Custom values can be used (VFDashboard currently uses `VFDashboard` / `Community`).
4. The X-HASH-2 secret key (`ConnectedCar@6521`) is built byte-by-byte in native code to evade string search.
5. The native library also performs anti-tamper checks (APK signature, Frida detection).
6. Both X-HASH and X-HASH-2 must use the **same** timestamp value.

---

## VFDashboard Current Configuration

Headers that VFDashboard currently uses (verified working):

| Header                | Value                           |     Validated by Server?     |
| --------------------- | ------------------------------- | :--------------------------: |
| `x-device-platform`   | `android`                       | **Yes** — required `android` |
| `x-device-family`     | `VFDashboard`                   |    No — custom values OK     |
| `x-device-os-version` | `Community`                     |    No — custom values OK     |
| `x-device-identifier` | `vfdashboard-community-edition` |             No\*             |
| `x-service-name`      | `CAPP`                          |           Unknown            |
| `x-app-version`       | `1.10.3`                        |           Unknown            |
| `x-device-locale`     | `vi-VN`                         |              No              |
| `x-timezone`          | `Asia/Ho_Chi_Minh`              |              No              |

> \*`x-device-identifier` is used in the X-HASH-2 message, but the server accepts custom values.

---

**Note:** Secret keys are kept private in the source code. The dashboard auto-generates both X-HASH and X-HASH-2 for every API request.
