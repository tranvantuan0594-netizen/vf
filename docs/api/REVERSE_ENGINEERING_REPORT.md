# VinFast X-HASH Reverse Engineering Report

**Date:** January 24, 2026
**Target:** VinFast Companion App v2.16.16 (iOS/Android)
**Objective:** Reverse engineer X-HASH authentication so VFDashboard can operate independently

---

## Part 1: Methods and Process for Finding the Secret Key

### Phase 1: Traffic Analysis (MITM Proxy)

**Tools:** mitmproxy

**Steps:**

1. Setup mitmproxy on port 8080
2. Install certificate on iOS device
3. Capture traffic from VinFast app

**Results:**

- Discovery of headers: `X-HASH`, `X-TIMESTAMP`, `X-VIN-CODE`
- Hash format: Base64, 44 characters (256-bit = HMAC-SHA256)
- Hash changes with timestamp → time-based
- Hash differs per endpoint → path is part of input

**Limitations:** Can only capture hashes, cannot determine how they are generated

---

### Phase 2: APK Decompilation

**Tools:** jadx (Android decompiler)

**Steps:**

```bash
brew install jadx
jadx -d docs/jadx_output/ com.vinfast.companion_app/*.dex
```

**Important files found:**

1. `TokenInterceptor.java` - OkHttp interceptor that adds X-HASH header
2. `SecurityUtils.java` - Cryptographic utilities
3. `HMACInterceptor.java` - HMAC signing logic

**Findings from code:**

```java
// TokenInterceptor.java - method c() (secret key generation)
byte[] bytes = String.valueOf(
    LocalDate.of(1993, 8, 8)
        .atStartOfDay(ZoneId.of("UTC"))
        .toInstant()
        .toEpochMilli()
).getBytes(Charsets.UTF_8);

// Repeat until >= 32 bytes
byte[] bArrD = new byte[0];
while (bArrD.length < 32) {
    bArrD = ArraysKt.D(bArrD, bytes);
}

// AES decrypt
byte[] secretKey = SecurityUtils.i(
    CollectionsKt.d1(ArraysKt.k1(bArrD, 32)),  // key = first 32 bytes
    "AHYhIZONK8ZR58s76Y/LEg==",                 // encrypted secret
    CollectionsKt.d1(ArraysKt.l1(bArrD, 16))   // iv = last 16 bytes
);
```

**Discovery of message format:**

```java
// Build message parts
ArrayList arrayList = new ArrayList();
arrayList.add(request.method());           // HTTP method
arrayList.add(request.url().encodedPath()); // Path
if (vin != null) arrayList.add(vin);       // VIN (optional)
arrayList.add(secretKey);                   // Secret key
arrayList.add(timestamp);                   // Timestamp

// Join and lowercase
String message = CollectionsKt.A0(arrayList, "_", ...).toLowerCase();

// HMAC-SHA256 + Base64
String xHash = securityUtils.j(securityUtils.n(keyBytes, messageBytes));
```

---

### Phase 3: Secret Key Decryption

**Problem:** Python decryption failed with padding errors

**Root cause:**

- Incorrect birth date milliseconds (timezone issue)
- Python: 744768000000 vs APK logs: 744854400000 (24h difference)

**Solution:** Write Java code to decrypt exactly as the APK does

```java
// DecryptSecret.java
LocalDate birthDate = LocalDate.of(1993, 8, 8);
long birthDateMs = birthDate.atStartOfDay(ZoneId.of("UTC"))
    .toInstant().toEpochMilli();
// Result: 744768000000

String genKeyStr = String.valueOf(birthDateMs); // "744768000000"
while (genKeyStr.length() < 32) {
    genKeyStr += String.valueOf(birthDateMs);
}
// Result: "744768000000744768000000744768000000" (36 chars)

byte[] password = genKeyStr.substring(0, 32).getBytes(); // first 32
byte[] iv = genKeyStr.substring(genKeyStr.length() - 16).getBytes(); // last 16

// AES-CBC decrypt
Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
cipher.init(Cipher.DECRYPT_MODE,
    new SecretKeySpec(password, "AES"),
    new IvParameterSpec(iv));

byte[] decrypted = cipher.doFinal(Base64.getDecoder().decode("AHYhIZONK8ZR58s76Y/LEg=="));
// Result: "Vinfast@2025"
```

**Secret Key:** `Vinfast@2025`

---

### Phase 4: Verification

**Test with captured data:**

```python
method = "POST"
path = "/ccarcharging/api/v1/stations/search"
vin = "RLLVXXXXXXXXXXXXX"  # Example VIN
timestamp = "1769029742000"
secret = "Vinfast@2025"

message = f"{method}_{path}_{vin}_{secret}_{timestamp}".lower()
# "post_/ccarcharging/api/v1/stations/search_rllvxxxxxxxxxxxxx71_vinfast@2025_1769029742000"

xhash = base64(hmac_sha256(secret, message))
# "0ahe0CvpJnSyZH2BU1LxwA9Ytfa1qxW784Xc3Kvr4cU="

# Matches captured hash from proxy ✓
```

---

### Methods Summary

| Phase | Tools     | Purpose         | Results                           |
| ----- | --------- | --------------- | --------------------------------- |
| 1     | mitmproxy | Capture traffic | Identified hash format, headers   |
| 2     | jadx      | Decompile APK   | Found algorithm, encrypted secret |
| 3     | Java      | Decrypt secret  | `Vinfast@2025`                    |
| 4     | Python    | Verify          | 100% match with captured hashes   |

**Key insights:**

1. Birth date `1993-08-08` is used to generate the AES key
2. Encrypted secret is hardcoded in the APK
3. Message format: `method_path_vin_secret_timestamp` (lowercase)
4. HMAC-SHA256 + Base64 encoding

---

## Part 2: Reverse Engineering X-HASH-2 (Native Crypto)

**Date:** February 14, 2026
**Target:** VinFast Companion App v1.10.3 (Android), `libsecure.so` (ARM64)
**Objective:** Reverse engineer X-HASH-2 - the second signing layer from native code

---

### Phase 1: Discovery of X-HASH-2

After VinFast updated the server, the telemetry API started returning `{"code":327681,"message":"Invalid request signature"}` even though X-HASH was correct. APK analysis revealed an additional `X-HASH-2` header generated by `CryptoInterceptor` calling the native method `VFCrypto.signRequest()` in `libsecure.so`.

**OkHttp Interceptor chain:**

```
TokenInterceptor → HMACInterceptor (X-HASH) → CryptoInterceptor (X-HASH-2)
```

---

### Phase 2: APK Decompilation (Android Split APK)

**Tools:** apktool (decompile smali)

**Steps:**

```bash
# Pull APK from device (split APKs)
adb shell pm path com.vinfast.companion.app
adb pull /data/app/~~xxx/base.apk       # 116M
adb pull /data/app/~~xxx/split_config.arm64_v8a.apk  # 20M
adb pull /data/app/~~xxx/split_config.xxhdpi.apk     # 8.5M

# Decompile base APK
apktool d base.apk -o decode/
```

**Important files found:**

1. `smali_classes15/com/vinfast/companion/cryptowrapper/CryptoInterceptor.smali` - Generates X-HASH-2
2. `smali_classes15/com/vinfast/companion/cryptowrapper/Message.smali` - 14-field data class
3. `smali_classes13/com/lxquyen/secure/VFCrypto.smali` - JNI wrapper
4. `lib/arm64-v8a/libsecure.so` - Native library (388K)

**Findings from smali:**

```java
// CryptoInterceptor builds Message object with 14 fields:
Message message = new Message(
    xAppVersion, xImei, xDeviceFamily, xDeviceIdentifier,
    xDeviceLocale, xDeviceOsVersion, xDevicePlatform,
    xMethod, xPath, xServiceName, xTimestamp,
    xTimezone, xUserAgent, xVinCode
);

// Convert to JSON and call native
String json = new Gson().toJson(message);
String hash2 = VFCrypto.signRequest(json); // JNI → libsecure.so
request.header("X-HASH-2", hash2);
```

---

### Phase 3: Native Library Decompilation (Ghidra)

**Tools:** Ghidra 12 (headless mode)

**Steps:**

```bash
# Extract native library
mkdir -p /tmp/vinfast_apk/extracted_libs
cd decode && find . -name "libsecure.so" -exec cp {} /tmp/vinfast_apk/extracted_libs/ \;

# Ghidra headless decompile (Java script, not Python)
$GHIDRA_HOME/support/analyzeHeadless /tmp ghidra_project \
    -import /tmp/vinfast_apk/extracted_libs/lib/arm64-v8a/libsecure.so \
    -postScript DecompileAll.java \
    -scriptPath /tmp/ghidra_scripts
```

**Output:** 51114 lines of decompiled C code

**Key functions:**

| Function                                       | Address    | Purpose                                |
| ---------------------------------------------- | ---------- | -------------------------------------- |
| `Java_com_lxquyen_secure_VFCrypto_signRequest` | 0x00128310 | JNI entry point                        |
| `FUN_00127a64`                                 | 0x00127a64 | Message string construction            |
| `FUN_00127914`                                 | 0x00127914 | HMAC-SHA256 signing                    |
| `FUN_0012758c`                                 | 0x0012758c | Secret key construction (byte-by-byte) |
| `FUN_0012826c`                                 | 0x0012826c | tolower() (char OR 0x20)               |
| `FUN_001270b4`                                 | 0x001270b4 | Anti-tamper: APK signature check       |
| `FUN_001271f4`                                 | 0x001271f4 | Anti-tamper: Frida/Xposed detection    |

---

### Phase 4: Message Format Analysis

**Decompiled logic (`FUN_00127a64`):**

```c
// Parse JSON input
cJSON_Parse(json);

// Extract 6 fields
platform   = cJSON_GetField("X-Device-Platform");
vinCode    = cJSON_GetField("X-Vin-Code");       // nullable
identifier = cJSON_GetField("X-Device-Identifier");
timestamp  = cJSON_GetField("X-TIMESTAMP");
method     = cJSON_GetField("X-METHOD");
path       = cJSON_GetField("X-PATH");

// Process path: strip leading "/", replace "/" with "_"
if (path[0] == '/') erase(path, 0, 1);
replace_all(path, '/', '_');

// Concatenate: platform_[vinCode_]identifier_path_method_timestamp
result = platform;
append(result, "_");
if (vinCode != NULL) { append(result, vinCode); append(result, "_"); }
append(result, identifier);
append(result, "_");
append(result, path);
append(result, "_");
append(result, method);
append(result, "_");
append(result, timestamp);

// Lowercase entire string
transform(result, tolower);  // FUN_0012826c: char | 0x20
```

---

### Phase 5: Secret Key Extraction

**Initial problem:** Assumed X-HASH-2 was just Base64 encoding of the concatenated string (no crypto). But the server still rejected it.

**Discovery:** The `signRequest` function, after constructing the message string, calls `FUN_00127914` to **HMAC-SHA256 sign** before returning.

**Secret key construction (`FUN_0012758c`):**

```c
// Key built byte-by-byte to avoid string search detection
param[0]  = 0x43; // C
param[1]  = 0x6f; // o
param[2]  = 0x6e; // n
param[3]  = 0x6e; // n
param[4]  = 0x65; // e
param[5]  = 0x63; // c
param[6]  = 0x74; // t
param[7]  = 0x65; // e
param[8]  = 0x64; // d
param[9]  = 0x43; // C
param[10] = 0x61; // a
param[11] = 0x72; // r
param[12] = 0x40; // @
param[13] = 0x36; // 6
param[14] = 0x35; // 5
param[15] = 0x32; // 2
param[16] = 0x31; // 1
// = "ConnectedCar@6521"
```

**Anti-detection measures in libsecure.so:**

- Key built byte-by-byte, not as a string literal → grep/strings cannot find it
- Includes `clock()` and `time()` checks between bytes (anti-debug timing)
- APK signature verification (reject re-signed APKs)
- Frida/Xposed/Substrate detection via `/proc/self/maps`
- Package name check: `com.vinfast.companion.app` or `.qa`

---

### Phase 6: Signing Algorithm

**`FUN_00127914` flow:**

```c
// 1. Get message string and length
data = GetByteArray(message);
length = GetArrayLength(message);

// 2. Build key (FUN_0012758c → "ConnectedCar@6521")
key = buildKey();  // 17 bytes

// 3. Init HMAC-SHA256
ctx = HMAC_CTX_new();
evpMd = EVP_sha256();
HMAC_Init_ex(ctx, key, 17, evpMd, NULL);

// 4. Update with message data
HMAC_Update(ctx, data, length);

// 5. Finalize → 32 bytes output
HMAC_Final(ctx, output, &outputLen);
HMAC_CTX_free(ctx);

// 6. Return as byte array → Java side does Base64.encodeToString(result, Base64.NO_WRAP)
```

**Crypto library:** BoringSSL (Google's fork of OpenSSL, bundled in libsecure.so)

---

### Phase 7: Verification

```javascript
// Node.js verification
const crypto = require("crypto");

const message =
  "android_rllvxxxxxxxxxxxxx71_vfdashboard-community-edition_" +
  "ccaraccessmgmt_api_v1_telemetry_app_ping_post_1771033156922";
const key = "ConnectedCar@6521";

const hmac = crypto.createHmac("sha256", key);
hmac.update(message);
const hash2 = hmac.digest("base64");
// Result matches server-accepted value ✓

// Server response: 200 OK (7835 bytes telemetry data)
```

---

### X-HASH-2 Summary

| Phase | Tools             | Purpose                | Results                                    |
| ----- | ----------------- | ---------------------- | ------------------------------------------ |
| 1     | apktool + smali   | Find interceptor chain | CryptoInterceptor → VFCrypto.signRequest() |
| 2     | Ghidra (headless) | Decompile ARM64 .so    | 51K lines C, found message format          |
| 3     | Ghidra analysis   | Extract secret key     | `ConnectedCar@6521` (byte-by-byte)         |
| 4     | Node.js           | Verify                 | 100% match, server returned 200 OK         |

**Key insights:**

1. X-HASH-2 uses **HMAC-SHA256** (not just Base64 encoding)
2. Secret key `ConnectedCar@6521` is built byte-by-byte in native code to avoid detection
3. Message format differs from X-HASH: `platform_[vin_]identifier_path_method_timestamp`
4. Path processing: strip leading `/`, replace `/` with `_`
5. Only 6 fields (not 14) actually participate in the hash
6. Headers must use `x-device-platform: android` (server validates)

---

## Part 3: API Endpoints Log

### Authentication

```
POST https://vin3s.au.auth0.com/oauth/token
Content-Type: application/json

Request:
{
  "client_id": "jE5xt50qC7oIh1f32qMzA6hGznIU5mgH",
  "grant_type": "password",
  "username": "<email>",
  "password": "<password>",
  "scope": "openid profile email offline_access",
  "audience": "https://mobile.connected-car.vinfast.vn"
}

Response:
{
  "access_token": "eyJhbG...",
  "refresh_token": "v1.M...",
  "id_token": "eyJhbG...",
  "token_type": "Bearer",
  "expires_in": 86400
}

Notes:
- Token expires in 24 hours
- Auth0 tenant: vin3s.au.auth0.com
- Client ID public (mobile app)
```

---

### User Vehicles

```
GET https://mobile.connected-car.vinfast.vn/ccarusermgnt/api/v1/user-vehicle

Headers:
  Authorization: Bearer <token>
  X-HASH: <generated>
  X-TIMESTAMP: <ms>

Response:
{
  "code": 200,
  "data": [
    {
      "vinNumber": "RLLVXXXXXXXXXXXXX",
      "vehicleName": "VF 9",
      "modelCode": "VF9",
      "modelYear": "2024",
      "exteriorColor": "Neptune Blue",
      "interiorColor": "Black",
      "batteryCapacity": 123.0,
      "ownershipType": "OWNER",
      "subscriptionStatus": "ACTIVE"
    }
  ]
}

Notes:
- Returns user's vehicle list
- batteryCapacity = kWh
- subscriptionStatus: ACTIVE/EXPIRED/NONE
```

---

### Telemetry - List Resource (Primary)

```
POST https://mobile.connected-car.vinfast.vn/ccaraccessmgmt/api/v1/telemetry/list_resource

Headers:
  Authorization: Bearer <token>
  X-HASH: <generated>
  X-TIMESTAMP: <ms>
  X-VIN-CODE: <vin>

Request Body:
[
  {"resourceId": "10", "instanceId": "1", "objectId": "34180"},
  {"resourceId": "7", "instanceId": "1", "objectId": "34181"},
  {"resourceId": "1", "instanceId": "1", "objectId": "34183"},
  {"resourceId": "2", "instanceId": "1", "objectId": "34190"},
  {"resourceId": "3", "instanceId": "1", "objectId": "34190"},
  {"resourceId": "4", "instanceId": "1", "objectId": "34190"},
  {"resourceId": "5", "instanceId": "1", "objectId": "34190"}
]

Response:
{
  "code": 200,
  "data": [
    {
      "objectId": "34180",
      "resourceId": "10",
      "instanceId": "1",
      "resourceValue": "85",
      "timestamp": 1769029742000
    },
    {
      "objectId": "34181",
      "resourceId": "7",
      "instanceId": "1",
      "resourceValue": "320",
      "timestamp": 1769029742000
    }
  ]
}
```

**Object/Resource ID Reference:**

| objectId | resourceId | Description               | Unit   |
| -------- | ---------- | ------------------------- | ------ |
| 34180    | 10         | State of Charge (SOC)     | %      |
| 34181    | 7          | Estimated Range           | km     |
| 34183    | 1          | Charging Status           | enum   |
| 34190    | 2          | Front Left Tire Pressure  | kPa    |
| 34190    | 3          | Front Right Tire Pressure | kPa    |
| 34190    | 4          | Rear Left Tire Pressure   | kPa    |
| 34190    | 5          | Rear Right Tire Pressure  | kPa    |
| 34191    | 1-4        | Door Status (FL/FR/RL/RR) | 0/1    |
| 34192    | 1          | Trunk Status              | 0/1    |
| 34193    | 1          | Hood Status               | 0/1    |
| 34194    | 1          | Window Status             | 0/1    |
| 34195    | 1          | Lock Status               | 0/1    |
| 34196    | 1          | Climate Status            | 0/1    |
| 34197    | 1          | Odometer                  | km     |
| 34198    | 1          | Location Latitude         | degree |
| 34198    | 2          | Location Longitude        | degree |

---

### Vehicle Ping

```
POST https://mobile.connected-car.vinfast.vn/api/v3.2/connected_car/app/ping

Headers:
  Authorization: Bearer <token>
  X-HASH: <generated>
  X-TIMESTAMP: <ms>
  X-VIN-CODE: <vin>
  X-SERVICE-NAME: CAPP
  X-APP-VERSION: 2.16.16

Request Body: (empty or {})

Response:
{
  "code": 200,
  "data": {
    "status": "ONLINE",
    "lastSeen": 1769029742000
  }
}

Notes:
- Check vehicle online/offline status
- Wake up vehicle from sleep mode
```

---

### Charging Stations Search

```
POST https://mobile.connected-car.vinfast.vn/ccarcharging/api/v1/stations/search?page=0&size=20

Headers:
  Authorization: Bearer <token>
  X-HASH: <generated>
  X-TIMESTAMP: <ms>
  X-VIN-CODE: <vin>

Request Body:
{
  "latitude": 21.209747,
  "longitude": 105.793358,
  "excludeFavorite": false
}

Response:
{
  "code": 200,
  "data": {
    "content": [
      {
        "stationId": "VN-HN-001",
        "stationName": "VinFast Mỹ Đình",
        "address": "...",
        "latitude": 21.028511,
        "longitude": 105.780833,
        "totalConnectors": 8,
        "availableConnectors": 5,
        "connectorTypes": ["CCS2", "CHAdeMO"],
        "maxPower": 150,
        "distance": 2.5
      }
    ],
    "totalElements": 45,
    "totalPages": 3
  }
}

Notes:
- Search charging stations near location
- maxPower = kW
- distance = km
```

---

### Remote Commands

```
POST https://mobile.connected-car.vinfast.vn/ccaraccessmgmt/api/v1/command/execute

Headers:
  Authorization: Bearer <token>
  X-HASH: <generated>
  X-TIMESTAMP: <ms>
  X-VIN-CODE: <vin>

Request Body:
{
  "commandType": "LOCK",  // or UNLOCK, CLIMATE_ON, CLIMATE_OFF, HORN, FLASH
  "parameters": {}
}

Response:
{
  "code": 200,
  "data": {
    "commandId": "cmd-12345",
    "status": "PENDING"
  }
}

Notes:
- Commands: LOCK, UNLOCK, CLIMATE_ON, CLIMATE_OFF, HORN, FLASH, TRUNK_OPEN
- Status: PENDING → EXECUTING → COMPLETED/FAILED
```

---

### Trip History

```
GET https://mobile.connected-car.vinfast.vn/ccarusermgnt/api/v1/trip-history?from=2026-01-01&to=2026-01-24

Headers:
  Authorization: Bearer <token>
  X-HASH: <generated>
  X-TIMESTAMP: <ms>
  X-VIN-CODE: <vin>

Response:
{
  "code": 200,
  "data": [
    {
      "tripId": "trip-001",
      "startTime": 1769000000000,
      "endTime": 1769003600000,
      "startLocation": {"lat": 21.0, "lng": 105.8},
      "endLocation": {"lat": 21.1, "lng": 105.9},
      "distance": 15.5,
      "duration": 3600,
      "energyConsumed": 3.2,
      "avgSpeed": 45
    }
  ]
}

Notes:
- distance = km
- duration = seconds
- energyConsumed = kWh
- avgSpeed = km/h
```

---

### Charging History

```
GET https://mobile.connected-car.vinfast.vn/ccarcharging/api/v1/sessions?page=0&size=20

Headers:
  Authorization: Bearer <token>
  X-HASH: <generated>
  X-TIMESTAMP: <ms>
  X-VIN-CODE: <vin>

Response:
{
  "code": 200,
  "data": {
    "content": [
      {
        "sessionId": "sess-001",
        "stationName": "VinFast Mỹ Đình",
        "startTime": 1769000000000,
        "endTime": 1769003600000,
        "startSoc": 20,
        "endSoc": 80,
        "energyCharged": 65.5,
        "cost": 150000,
        "currency": "VND"
      }
    ]
  }
}

Notes:
- energyCharged = kWh
- cost = local currency
```

---

## Part 4: Additional Exploration Possibilities

### Confirmed accessible:

1. **Vehicle Info:** VIN, model, year, color, battery capacity
2. **Real-time Telemetry:** SOC, range, tire pressure, door/trunk/hood status
3. **Location:** GPS coordinates (latitude, longitude)
4. **Charging:** Station search, charging history, session details
5. **Trip History:** Routes, distance, energy consumption
6. **Remote Commands:** Lock/unlock, climate, horn, flash

### Needs further exploration:

1. **Notifications API** - Push notification history
2. **Service/Maintenance API** - Service records
3. **OTA Updates API** - Software version info
4. **Energy Statistics** - Monthly/weekly consumption reports
5. **Geofence API** - Location alerts configuration

### Untested endpoints:

```
GET /ccarusermgnt/api/v1/notifications
GET /ccarusermgnt/api/v1/service-history
GET /ccarusermgnt/api/v1/software-version
GET /ccarusermgnt/api/v1/energy-stats
POST /ccarusermgnt/api/v1/geofence
```

---

## Conclusion

**Success:**

- Fully reverse engineered X-HASH algorithm
- VFDashboard can operate independently
- No proxy from official app required

**Secret Key Info:**

- Key: `Vinfast@2025`
- Derived from: Birth date 1993-08-08 → AES key → Decrypt hardcoded value
- Algorithm: HMAC-SHA256 + Base64

**Next Steps:**

1. Test unexplored endpoints
2. Document additional Object/Resource IDs
3. Build complete API client library
