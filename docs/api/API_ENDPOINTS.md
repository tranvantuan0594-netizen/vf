# VinFast Connected Car API Endpoints

**Source:** Reverse-engineered from VinFast Companion APK v1.10.3 (split APK, arm64)
**Method:** Retrofit service interface analysis via smali decompilation
**Updated:** February 14, 2026

---

## Overview

VinFast Companion app uses **461+ API endpoints** across **26 namespaces**, communicating via OkHttp + Retrofit.

### Interceptor Chain (Request Pipeline)

```
Request → TokenInterceptor → CryptoInterceptor (X-HASH-2) → HMACInterceptor (X-HASH)
        → TimeoutInterceptor → DynamicHostInterceptor → ModifyExceptionInterceptor
        → ModifyPathSegmentInterceptor → [Logging] → Authenticator
```

### Authentication Requirements

| Endpoint Type       | Bearer Token | X-HASH  | X-HASH-2 | X-TIMESTAMP |
| ------------------- | :----------: | :-----: | :------: | :---------: |
| Auth0 login/signup  |      No      |   No    |    No    |     No      |
| User management     |     Yes      |  No\*   |   No\*   |    No\*     |
| Vehicle model/alias |     Yes      |  No\*   |   No\*   |    No\*     |
| **Telemetry**       |   **Yes**    | **Yes** | **Yes**  |   **Yes**   |
| Remote commands     |     Yes      |   Yes   |   Yes    |     Yes     |
| Charging            |     Yes      |   Yes   |   Yes    |     Yes     |

> \*The server currently does not validate hashes for non-telemetry endpoints, but the app still sends them for every request through the VFServiceModule OkHttpClient.

### Platform Header Constraint

| Header              | Required Value | Scope             |
| ------------------- | -------------- | ----------------- |
| `x-device-platform` | `android`      | **All endpoints** |

> **CRITICAL:** The server validates the `x-device-platform` header for **all** API endpoints, not just telemetry. The value `ios` or any custom value will be rejected with HTTP 401, including `user-vehicle` (non-telemetry). Only `android` is accepted.
>
> **Reason:** This documentation is based on reverse-engineering the Android APK — faster and easier compared to iOS. The secret key and signing algorithm for iOS may differ and have not been researched.
>
> Other headers such as `x-device-family`, `x-device-os-version` are not validated — custom values can be used.

---

## Namespaces Used by VFDashboard

Namespaces that the dashboard currently uses or may use:

### 1. ccarusermgnt — User & Vehicle Management

| Method | Path                                                               | Description                |
| ------ | ------------------------------------------------------------------ | -------------------------- |
| GET    | `/ccarusermgnt/api/v1/user-vehicle`                                | Get user's vehicle list    |
| GET    | `/ccarusermgnt/api/v1/auth0/account/profile`                       | Get user profile           |
| PUT    | `/ccarusermgnt/api/v1/auth0/account/profile`                       | Update profile             |
| GET    | `/ccarusermgnt/api/v1/user-vehicle/driver`                         | Driver list                |
| POST   | `/ccarusermgnt/api/v1/auth0/account/alternative-contact/add-phone` | Add phone number           |
| PUT    | `/ccarusermgnt/api/v1/device-trust/fcm-token`                      | Register FCM push token    |
| PUT    | `/ccarusermgnt/api/v1/device-trust/mark-logout`                    | Mark logout                |
| POST   | `/ccarusermgnt/api/v1/user-vehicle/transfer-ownership`             | Transfer vehicle ownership |
| POST   | `/ccarusermgnt/api/v1/consent/save`                                | Save consent               |
| GET    | `/ccarusermgnt/api/v1/consent/latest`                              | Get latest consent         |
| POST   | `/ccarusermgnt/api/v1/auth0/account/delete`                        | Delete account             |

### 2. modelmgmt — Vehicle Model Management

| Method | Path                                                           | Description                                |
| ------ | -------------------------------------------------------------- | ------------------------------------------ |
| GET    | `/modelmgmt/api/v2/vehicle-model/mobile-app/vehicle/get-alias` | Get alias mapping (telemetry resource IDs) |

> **Important**: This endpoint returns the mapping between alias name → objectId/instanceId/resourceId, used to build the telemetry request body.

### 3. ccaraccessmgmt — Vehicle Access & Telemetry

| Method | Path                                                      | Description                                                   |
| ------ | --------------------------------------------------------- | ------------------------------------------------------------- |
| POST   | `/ccaraccessmgmt/api/v1/telemetry/app/ping`               | Legacy REST telemetry (battery leasing metadata only)         |
| POST   | `/ccaraccessmgmt/api/v1/telemetry/list_resource`          | **Register core aliases** — triggers T-Box to push MQTT data  |
| POST   | `/ccaraccessmgmt/api/v2/remote/app/command`               | Send remote command (lock/unlock, flash lights, honk horn...) |
| GET    | `/ccaraccessmgmt/api/v1/geo_fencing/get`                  | Get geofence config                                           |
| POST   | `/ccaraccessmgmt/api/v1/geo_fencing/set`                  | Set geofence                                                  |
| DELETE | `/ccaraccessmgmt/api/v1/geo_fencing/delete`               | Delete geofence                                               |
| GET    | `/ccaraccessmgmt/api/v1/vehicles/{vinCode}/parked-images` | Parked location photos                                        |
| GET    | `/ccaraccessmgmt/api/v1/time-fencing/get`                 | Get time fence                                                |
| POST   | `/ccaraccessmgmt/api/v1/time-fencing/set`                 | Set time fence                                                |
| DELETE | `/ccaraccessmgmt/api/v1/time-fencing/delete`              | Delete time fence                                             |

---

## Other Namespaces (Reference)

### 4. ccarcharging — EV Charging

| Method | Path                                                 | Description                     |
| ------ | ---------------------------------------------------- | ------------------------------- |
| POST   | `/ccarcharging/api/v1/stations/search`               | Search nearby charging stations |
| GET    | `/ccarcharging/api/v1/stations/{stationId}`          | Charging station details        |
| GET    | `/ccarcharging/api/v1/charging-history`              | Charging history                |
| GET    | `/ccarcharging/api/v1/charging-sessions/current`     | Current charging session        |
| GET    | `/ccarcharging/api/v1/charging-sessions/{sessionId}` | Charging session details        |
| POST   | `/ccarcharging/api/v1/charging/start`                | Start charging                  |
| POST   | `/ccarcharging/api/v1/charging/stop`                 | Stop charging                   |
| GET    | `/ccarcharging/api/v1/subscription/registered`       | Registered charging plans       |
| POST   | `/ccarcharging/api/v1/subscription/register`         | Register charging plan          |
| POST   | `/ccarcharging/api/v1/charging/rfid-cards`           | Add RFID card                   |
| DELETE | `/ccarcharging/api/v1/charging/rfid-cards/{cardId}`  | Delete RFID card                |
| GET    | `/ccarcharging/api/v1/charging-settings`             | Charging settings               |
| PUT    | `/ccarcharging/api/v1/charging-settings`             | Update charging settings        |
| POST   | `/ccarcharging/api/v1/reserve-charging`              | Schedule charging               |
| GET    | `/ccarcharging/api/v1/battery-leasing`               | Battery leasing info            |
| POST   | `/ccarcharging/api/v1/plug-and-charge/register`      | Register Plug & Charge          |
| GET    | `/ccarcharging/api/v1/plug-and-charge/status`        | PnC status                      |

### 5. ccarpayment — Payment & Billing

| Method | Path                                               | Description        |
| ------ | -------------------------------------------------- | ------------------ |
| GET    | `/ccarpayment/api/v1/payments/cards`               | Payment cards list |
| POST   | `/ccarpayment/api/v1/payments/cards`               | Add card           |
| DELETE | `/ccarpayment/api/v1/payments/cards/{tokenNumber}` | Delete card        |
| GET    | `/ccarpayment/api/v2/bills/{billId}`               | Invoice details    |
| GET    | `/ccarpayment/api/v1/bills/list`                   | Invoice list       |
| POST   | `/ccarpayment/api/v1/payments`                     | Process payment    |
| POST   | `/ccarpayment/api/v1/payments/auto-payment`        | Set up auto-pay    |
| GET    | `/ccarpayment/api/v1/payments/auto-payment/status` | Auto-pay status    |
| POST   | `/ccarpayment/api/v1/deposit`                      | Deposit            |
| GET    | `/ccarpayment/api/v1/virtual-account`              | Virtual account    |

### 6. ccar-sota — Software Updates

| Method | Path                                             | Description           |
| ------ | ------------------------------------------------ | --------------------- |
| GET    | `/ccar-sota/api/v1/capp/package`                 | Software package list |
| GET    | `/ccar-sota/api/v1/capp/package/current-package` | Current package       |
| POST   | `/ccar-sota/api/v1/capp/package/subscribe`       | Subscribe to package  |
| GET    | `/ccar-sota/api/v1/capp/voice/list`              | Voice list            |
| POST   | `/ccar-sota/api/v1/capp/voice/create`            | Create voice clone    |
| GET    | `/ccar-sota/api/v1/capp/e-contract`              | Electronic contract   |
| POST   | `/ccar-sota/api/v1/capp/e-contract/sign`         | Sign contract         |

### 7. ccarfota_v2 — Firmware Updates (FOTA)

| Method | Path                                                            | Description                |
| ------ | --------------------------------------------------------------- | -------------------------- |
| GET    | `/ccarfota_v2/api/v1/campaigns/check-firmware-update/{vinCode}` | Check for firmware updates |
| GET    | `/ccarfota_v2/api/v1/campaigns/{id}/next-action/{vinCode}`      | Next action for update     |
| GET    | `/ccarfota_v2/api/v1/campaigns/{id}/terms-conditions/{key}`     | Update terms & conditions  |
| POST   | `/ccarfota_v2/api/v1/campaigns/install-now`                     | Install now                |
| PUT    | `/ccarfota_v2/api/v1/campaigns/start-download`                  | Start download             |

### 8. notimgmt — Notifications

| Method | Path                                                       | Description                |
| ------ | ---------------------------------------------------------- | -------------------------- |
| GET    | `/notimgmt/api/v1/notimgmt/history/category_list`          | Notification categories    |
| GET    | `/notimgmt/api/v1/notimgmt/users/app/is-unread`            | Check unread notifications |
| POST   | `/notimgmt/api/v2/notimgmt/users/app/mark-notification`    | Mark as read               |
| GET    | `/notimgmt/api/v2/notimgmt/users/mobile-app/noti-settings` | Notification settings      |
| PUT    | `/notimgmt/api/v2/notimgmt/users/mobile-app/noti-settings` | Update settings            |

### 9. ccarbookingservice — Service Booking

| Method | Path                                                               | Description           |
| ------ | ------------------------------------------------------------------ | --------------------- |
| GET    | `/ccarbookingservice/api/v1/c-app/appointment/get-list-upcoming`   | Upcoming appointments |
| GET    | `/ccarbookingservice/api/v1/c-app/showroom/get-list`               | Showroom list         |
| POST   | `/ccarbookingservice/api/v1/c-app/appointment/create`              | Create appointment    |
| PUT    | `/ccarbookingservice/api/v1/c-app/appointment/update/{booking_id}` | Update appointment    |

### 10. personalization — Personalization & Routines

| Method | Path                                             | Description          |
| ------ | ------------------------------------------------ | -------------------- |
| GET    | `/personalization/api/capp/routines?type=CUSTOM` | Custom routines list |
| GET    | `/personalization/api/capp/routines/{id}`        | Routine details      |
| POST   | `/personalization/api/capp/routines`             | Create routine       |
| PUT    | `/personalization/api/capp/routines/{id}`        | Update routine       |
| DELETE | `/personalization/api/capp/routines/{id}`        | Delete routine       |
| GET    | `/personalization/api/capp/settings`             | Personal settings    |
| PUT    | `/personalization/api/capp/settings`             | Update settings      |

### 11. ccarcontent — Content Management

| Method | Path                               | Description           |
| ------ | ---------------------------------- | --------------------- |
| GET    | `/ccarcontent/api/v1/car-model`    | Car model list        |
| GET    | `/ccarcontent/api/v1/banner`       | Advertisement banners |
| GET    | `/ccarcontent/api/v1/data-privacy` | Data privacy policy   |
| POST   | `/ccarcontent/api/v1/sync`         | Sync content          |

### 12. ccarreferral — Referrals & Promotions

| Method | Path                                               | Description     |
| ------ | -------------------------------------------------- | --------------- |
| GET    | `/ccarreferral/api/v1/capp/promotions/list`        | Promotions list |
| GET    | `/ccarreferral/api/v1/capp/vouchers/detail/{code}` | Voucher details |
| POST   | `/ccarreferral/api/v1/capp/vouchers/redeem`        | Redeem voucher  |

### 13. vfrsa — Roadside Assistance

| Method | Path                                  | Description                 |
| ------ | ------------------------------------- | --------------------------- |
| GET    | `/vfrsa/api/c-app/rsa/info`           | Roadside assistance info    |
| POST   | `/vfrsa/api/c-app/rsa`                | Request roadside assistance |
| PUT    | `/vfrsa/api/c-app/rsa/cancel/{subId}` | Cancel request              |

### 14. Auth0 — Authentication

| Method | Path                             | Description              |
| ------ | -------------------------------- | ------------------------ |
| POST   | `/oauth/token`                   | Get/refresh access token |
| POST   | `/dbconnections/signup`          | Register account         |
| POST   | `/dbconnections/change_password` | Change password          |

### 15. ccar-order-history — Order Management

| Method | Path                                                        | Description              |
| ------ | ----------------------------------------------------------- | ------------------------ |
| GET    | `/ccar-order-history/api/v1/me/orders`                      | Order list               |
| POST   | `/ccar-order-history/api/v1/orders/confirm-delivery-record` | Confirm vehicle delivery |
| PUT    | `/ccar-order-history/api/v1/orders/{id}/delivery`           | Update delivery          |

---

## Telemetry Object IDs (Details)

Telemetry data is requested via POST body with the format:

```json
[
  {"objectId": "34180", "instanceId": "1", "resourceId": "10"},
  ...
]
```

### Main Groups

| Object ID | Instance | Resource | Alias                | Description                    |
| --------- | -------- | -------- | -------------------- | ------------------------------ |
| 34180     | 1        | 10       | battery_soc          | State of Charge (%)            |
| 34180     | 1        | 7        | estimated_range      | Estimated range (km)           |
| 34183     | 0        | 1        | charging_status      | Charging status                |
| 34183     | 0        | 4        | charging_remain_time | Remaining charging time        |
| 34183     | 0        | 12       | charging_power       | Charging power (kW)            |
| 34190     | 0-3      | \*       | tire*pressure*\*     | Tire pressure (4 wheels)       |
| 34191     | 0-5      | \*       | door*status*\*       | Door status (6 doors)          |
| 34199     | 0        | 0        | odometer             | Distance traveled              |
| 34182     | 0        | \*       | location             | GPS location (lat/lon/heading) |
| 34192     | 0        | 0        | exterior_temp        | Outdoor temperature            |
| 34192     | 0        | 1        | interior_temp        | Interior temperature           |
| 34185     | 0        | 0        | hvac_status          | HVAC status                    |
| 34186     | 0        | \*       | light_status         | Light status                   |
| 34187     | 0        | 0        | gear                 | Gear (P/R/N/D)                 |
| 34188     | 0        | 0        | speed                | Current speed                  |
| 34198     | 0        | \*       | window_status        | Window status                  |

> The full list is fetched from `/modelmgmt/api/v2/vehicle-model/mobile-app/vehicle/get-alias` and stored at `src/config/static_alias_map.json`.

---

## Remote Commands

Sent via POST `/ccaraccessmgmt/api/v2/remote/app/command`:

```json
{
  "commandType": "LOCK_VEHICLE",
  "vinCode": "RLLV...",
  "params": {}
}
```

### Command Types (from APK)

| Command        | Description    |
| -------------- | -------------- |
| LOCK_VEHICLE   | Lock vehicle   |
| UNLOCK_VEHICLE | Unlock vehicle |
| FLASH_LIGHT    | Flash lights   |
| HONK_HORN      | Honk horn      |
| START_AC       | Turn on AC     |
| STOP_AC        | Turn off AC    |
| OPEN_TRUNK     | Open trunk     |
| CLOSE_TRUNK    | Close trunk    |
| START_CHARGING | Start charging |
| STOP_CHARGING  | Stop charging  |
| FIND_MY_CAR    | Find my car    |

---

## Service Modules Architecture

```
BaseNetworkModule
├── TokenInterceptor (auth headers, VIN, device info)
├── HMACInterceptor (X-HASH signing)
├── CryptoInterceptor (X-HASH-2 native signing)
├── TimeoutInterceptor
├── DynamicHostInterceptor (Firebase Remote Config base URL)
├── ModifyExceptionInterceptor
├── ModifyPathSegmentInterceptor
├── HttpLoggingInterceptor (debug builds only)
└── AutoAuthenticator (token refresh)

VFServiceModule (extends BaseNetworkModule)
├── Main OkHttpClient (all interceptors)
├── Retrofit instance (with ResponseConverter)
└── HostSelectionInterceptor (dynamic base URL from Remote Config)

Other Modules:
├── Auth0Module — Auth0 authentication client
├── EvServiceModule — EV-specific services
├── VFAutoModule — VinFast Auto services
├── VFOwnerManualModule — Owner manual content
├── W3wServiceModule — What3Words integration
└── GuestServiceModule — Guest mode CDN
```

---

## Base URLs

| Service          | URL                                      | Source             |
| ---------------- | ---------------------------------------- | ------------------ |
| VinFast API (VN) | `https://api-vinfast-vn.vinfast.com`     | vinfast.js config  |
| VinFast API (US) | `https://api-vinfast-us.vinfast.com`     | vinfast.js config  |
| VinFast API (EU) | `https://api-vinfast-eu.vinfast.com`     | vinfast.js config  |
| Auth0 (VN)       | `https://vin3s.au.auth0.com`             | vinfast.js config  |
| What3Words       | `https://api.what3words.com/`            | W3wServiceModule   |
| Guest Mode CDN   | `https://d1aza9v8tzxrkt.cloudfront.net/` | GuestServiceModule |

> The main base URL can be changed via Firebase Remote Config key `android_vf_service_base_url`.

---

## Firebase Remote Config Keys (API-Related)

Config keys that affect API connectivity:

| Key                           | Type    | Description                     |
| ----------------------------- | ------- | ------------------------------- |
| `android_vf_service_base_url` | String  | Base URL for VF service APIs    |
| `android_vf_auth0_base_url`   | String  | Auth0 base URL                  |
| `android_vf_auto_base_url`    | String  | VF Auto service URL             |
| `android_vf_om_base_url`      | String  | OEM management URL              |
| `auth0_client_id`             | String  | Auth0 client ID                 |
| `auth0_audience`              | String  | Auth0 audience                  |
| `auth0_connection`            | String  | Auth0 connection type           |
| `auth0_scope`                 | String  | OAuth2 scopes                   |
| `notify_app_status_interval`  | Integer | Telemetry polling interval (ms) |

---

**Note:** This document was generated from smali decompilation analysis. The actual number of endpoints may vary depending on the APK version.
