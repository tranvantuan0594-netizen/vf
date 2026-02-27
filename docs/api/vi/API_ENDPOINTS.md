# VinFast Connected Car API Endpoints

**Source:** Reverse-engineered from VinFast Companion APK v1.10.3 (split APK, arm64)
**Method:** Retrofit service interface analysis via smali decompilation
**Updated:** February 14, 2026

---

## Overview

VinFast Companion app sử dụng **461+ API endpoints** trên **26 namespaces**, giao tiếp qua OkHttp + Retrofit.

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

> \*Server hiện tại không validate hash cho non-telemetry endpoints, nhưng app vẫn gửi cho mọi request qua VFServiceModule OkHttpClient.

### Platform Header Constraint

| Header              | Required Value | Scope                |
| ------------------- | -------------- | -------------------- |
| `x-device-platform` | `android`      | **Tất cả endpoints** |

> **CRITICAL:** Server validate `x-device-platform` header cho **tất cả** API endpoints, không chỉ telemetry. Giá trị `ios` hoặc bất kỳ giá trị tùy chỉnh nào đều bị reject với HTTP 401, kể cả `user-vehicle` (non-telemetry). Chỉ `android` được chấp nhận.
>
> **Lý do:** Tài liệu này dựa trên việc dịch ngược Android APK — nhanh và dễ hơn so với iOS. Secret key và signing algorithm cho iOS có thể khác và chưa được nghiên cứu.
>
> Các header khác như `x-device-family`, `x-device-os-version` không bị validate — có thể đặt giá trị tùy chỉnh.

---

## Namespaces Used by VFDashboard

Các namespace mà dashboard hiện đang sử dụng hoặc có thể sử dụng:

### 1. ccarusermgnt — User & Vehicle Management

| Method | Path                                                               | Description               |
| ------ | ------------------------------------------------------------------ | ------------------------- |
| GET    | `/ccarusermgnt/api/v1/user-vehicle`                                | Lấy danh sách xe của user |
| GET    | `/ccarusermgnt/api/v1/auth0/account/profile`                       | Lấy profile user          |
| PUT    | `/ccarusermgnt/api/v1/auth0/account/profile`                       | Cập nhật profile          |
| GET    | `/ccarusermgnt/api/v1/user-vehicle/driver`                         | Danh sách driver          |
| POST   | `/ccarusermgnt/api/v1/auth0/account/alternative-contact/add-phone` | Thêm SĐT                  |
| PUT    | `/ccarusermgnt/api/v1/device-trust/fcm-token`                      | Đăng ký FCM push token    |
| PUT    | `/ccarusermgnt/api/v1/device-trust/mark-logout`                    | Đánh dấu logout           |
| POST   | `/ccarusermgnt/api/v1/user-vehicle/transfer-ownership`             | Chuyển quyền sở hữu xe    |
| POST   | `/ccarusermgnt/api/v1/consent/save`                                | Lưu consent               |
| GET    | `/ccarusermgnt/api/v1/consent/latest`                              | Lấy consent mới nhất      |
| POST   | `/ccarusermgnt/api/v1/auth0/account/delete`                        | Xóa tài khoản             |

### 2. modelmgmt — Vehicle Model Management

| Method | Path                                                           | Description                                |
| ------ | -------------------------------------------------------------- | ------------------------------------------ |
| GET    | `/modelmgmt/api/v2/vehicle-model/mobile-app/vehicle/get-alias` | Lấy alias mapping (telemetry resource IDs) |

> **Quan trọng**: Endpoint này trả về mapping giữa alias name → objectId/instanceId/resourceId, dùng để build telemetry request body.

### 3. ccaraccessmgmt — Vehicle Access & Telemetry

| Method | Path                                                      | Description                                           |
| ------ | --------------------------------------------------------- | ----------------------------------------------------- |
| POST   | `/ccaraccessmgmt/api/v1/telemetry/app/ping`               | **Telemetry chính** — lấy trạng thái xe real-time     |
| POST   | `/ccaraccessmgmt/api/v1/telemetry/list_resource`          | Liệt kê telemetry resources                           |
| POST   | `/ccaraccessmgmt/api/v2/remote/app/command`               | Gửi remote command (khóa/mở xe, nháy đèn, bấm còi...) |
| GET    | `/ccaraccessmgmt/api/v1/geo_fencing/get`                  | Lấy geofence config                                   |
| POST   | `/ccaraccessmgmt/api/v1/geo_fencing/set`                  | Thiết lập geofence                                    |
| DELETE | `/ccaraccessmgmt/api/v1/geo_fencing/delete`               | Xóa geofence                                          |
| GET    | `/ccaraccessmgmt/api/v1/vehicles/{vinCode}/parked-images` | Ảnh vị trí đỗ xe                                      |
| GET    | `/ccaraccessmgmt/api/v1/time-fencing/get`                 | Lấy time fence                                        |
| POST   | `/ccaraccessmgmt/api/v1/time-fencing/set`                 | Thiết lập time fence                                  |
| DELETE | `/ccaraccessmgmt/api/v1/time-fencing/delete`              | Xóa time fence                                        |

---

## Các Namespaces Khác (Tham Khảo)

### 4. ccarcharging — EV Charging

| Method | Path                                                 | Description           |
| ------ | ---------------------------------------------------- | --------------------- |
| POST   | `/ccarcharging/api/v1/stations/search`               | Tìm trạm sạc gần      |
| GET    | `/ccarcharging/api/v1/stations/{stationId}`          | Chi tiết trạm sạc     |
| GET    | `/ccarcharging/api/v1/charging-history`              | Lịch sử sạc           |
| GET    | `/ccarcharging/api/v1/charging-sessions/current`     | Phiên sạc hiện tại    |
| GET    | `/ccarcharging/api/v1/charging-sessions/{sessionId}` | Chi tiết phiên sạc    |
| POST   | `/ccarcharging/api/v1/charging/start`                | Bắt đầu sạc           |
| POST   | `/ccarcharging/api/v1/charging/stop`                 | Dừng sạc              |
| GET    | `/ccarcharging/api/v1/subscription/registered`       | Gói sạc đã đăng ký    |
| POST   | `/ccarcharging/api/v1/subscription/register`         | Đăng ký gói sạc       |
| POST   | `/ccarcharging/api/v1/charging/rfid-cards`           | Thêm thẻ RFID         |
| DELETE | `/ccarcharging/api/v1/charging/rfid-cards/{cardId}`  | Xóa thẻ RFID          |
| GET    | `/ccarcharging/api/v1/charging-settings`             | Cài đặt sạc           |
| PUT    | `/ccarcharging/api/v1/charging-settings`             | Cập nhật cài đặt sạc  |
| POST   | `/ccarcharging/api/v1/reserve-charging`              | Đặt lịch sạc          |
| GET    | `/ccarcharging/api/v1/battery-leasing`               | Thông tin thuê pin    |
| POST   | `/ccarcharging/api/v1/plug-and-charge/register`      | Đăng ký Plug & Charge |
| GET    | `/ccarcharging/api/v1/plug-and-charge/status`        | Trạng thái PnC        |

### 5. ccarpayment — Payment & Billing

| Method | Path                                               | Description              |
| ------ | -------------------------------------------------- | ------------------------ |
| GET    | `/ccarpayment/api/v1/payments/cards`               | Danh sách thẻ thanh toán |
| POST   | `/ccarpayment/api/v1/payments/cards`               | Thêm thẻ                 |
| DELETE | `/ccarpayment/api/v1/payments/cards/{tokenNumber}` | Xóa thẻ                  |
| GET    | `/ccarpayment/api/v2/bills/{billId}`               | Chi tiết hóa đơn         |
| GET    | `/ccarpayment/api/v1/bills/list`                   | Danh sách hóa đơn        |
| POST   | `/ccarpayment/api/v1/payments`                     | Thực hiện thanh toán     |
| POST   | `/ccarpayment/api/v1/payments/auto-payment`        | Thiết lập auto-pay       |
| GET    | `/ccarpayment/api/v1/payments/auto-payment/status` | Trạng thái auto-pay      |
| POST   | `/ccarpayment/api/v1/deposit`                      | Đặt cọc                  |
| GET    | `/ccarpayment/api/v1/virtual-account`              | Tài khoản ảo             |

### 6. ccar-sota — Software Updates

| Method | Path                                             | Description            |
| ------ | ------------------------------------------------ | ---------------------- |
| GET    | `/ccar-sota/api/v1/capp/package`                 | Danh sách gói phần mềm |
| GET    | `/ccar-sota/api/v1/capp/package/current-package` | Gói hiện tại           |
| POST   | `/ccar-sota/api/v1/capp/package/subscribe`       | Đăng ký gói            |
| GET    | `/ccar-sota/api/v1/capp/voice/list`              | Danh sách voice        |
| POST   | `/ccar-sota/api/v1/capp/voice/create`            | Tạo voice clone        |
| GET    | `/ccar-sota/api/v1/capp/e-contract`              | Hợp đồng điện tử       |
| POST   | `/ccar-sota/api/v1/capp/e-contract/sign`         | Ký hợp đồng            |

### 7. ccarfota_v2 — Firmware Updates (FOTA)

| Method | Path                                                            | Description               |
| ------ | --------------------------------------------------------------- | ------------------------- |
| GET    | `/ccarfota_v2/api/v1/campaigns/check-firmware-update/{vinCode}` | Kiểm tra firmware mới     |
| GET    | `/ccarfota_v2/api/v1/campaigns/{id}/next-action/{vinCode}`      | Bước tiếp theo cho update |
| GET    | `/ccarfota_v2/api/v1/campaigns/{id}/terms-conditions/{key}`     | Điều khoản cập nhật       |
| POST   | `/ccarfota_v2/api/v1/campaigns/install-now`                     | Cài đặt ngay              |
| PUT    | `/ccarfota_v2/api/v1/campaigns/start-download`                  | Bắt đầu tải               |

### 8. notimgmt — Notifications

| Method | Path                                                       | Description                 |
| ------ | ---------------------------------------------------------- | --------------------------- |
| GET    | `/notimgmt/api/v1/notimgmt/history/category_list`          | Danh mục thông báo          |
| GET    | `/notimgmt/api/v1/notimgmt/users/app/is-unread`            | Kiểm tra thông báo chưa đọc |
| POST   | `/notimgmt/api/v2/notimgmt/users/app/mark-notification`    | Đánh dấu đã đọc             |
| GET    | `/notimgmt/api/v2/notimgmt/users/mobile-app/noti-settings` | Cài đặt thông báo           |
| PUT    | `/notimgmt/api/v2/notimgmt/users/mobile-app/noti-settings` | Cập nhật cài đặt            |

### 9. ccarbookingservice — Service Booking

| Method | Path                                                               | Description        |
| ------ | ------------------------------------------------------------------ | ------------------ |
| GET    | `/ccarbookingservice/api/v1/c-app/appointment/get-list-upcoming`   | Lịch hẹn sắp tới   |
| GET    | `/ccarbookingservice/api/v1/c-app/showroom/get-list`               | Danh sách showroom |
| POST   | `/ccarbookingservice/api/v1/c-app/appointment/create`              | Đặt lịch hẹn       |
| PUT    | `/ccarbookingservice/api/v1/c-app/appointment/update/{booking_id}` | Cập nhật lịch hẹn  |

### 10. personalization — Personalization & Routines

| Method | Path                                             | Description                 |
| ------ | ------------------------------------------------ | --------------------------- |
| GET    | `/personalization/api/capp/routines?type=CUSTOM` | Danh sách routine tùy chỉnh |
| GET    | `/personalization/api/capp/routines/{id}`        | Chi tiết routine            |
| POST   | `/personalization/api/capp/routines`             | Tạo routine                 |
| PUT    | `/personalization/api/capp/routines/{id}`        | Cập nhật routine            |
| DELETE | `/personalization/api/capp/routines/{id}`        | Xóa routine                 |
| GET    | `/personalization/api/capp/settings`             | Cài đặt cá nhân             |
| PUT    | `/personalization/api/capp/settings`             | Cập nhật cài đặt            |

### 11. ccarcontent — Content Management

| Method | Path                               | Description        |
| ------ | ---------------------------------- | ------------------ |
| GET    | `/ccarcontent/api/v1/car-model`    | Danh sách mẫu xe   |
| GET    | `/ccarcontent/api/v1/banner`       | Banner quảng cáo   |
| GET    | `/ccarcontent/api/v1/data-privacy` | Chính sách dữ liệu |
| POST   | `/ccarcontent/api/v1/sync`         | Đồng bộ content    |

### 12. ccarreferral — Referrals & Promotions

| Method | Path                                               | Description          |
| ------ | -------------------------------------------------- | -------------------- |
| GET    | `/ccarreferral/api/v1/capp/promotions/list`        | Danh sách khuyến mãi |
| GET    | `/ccarreferral/api/v1/capp/vouchers/detail/{code}` | Chi tiết voucher     |
| POST   | `/ccarreferral/api/v1/capp/vouchers/redeem`        | Đổi voucher          |

### 13. vfrsa — Roadside Assistance

| Method | Path                                  | Description      |
| ------ | ------------------------------------- | ---------------- |
| GET    | `/vfrsa/api/c-app/rsa/info`           | Thông tin cứu hộ |
| POST   | `/vfrsa/api/c-app/rsa`                | Yêu cầu cứu hộ   |
| PUT    | `/vfrsa/api/c-app/rsa/cancel/{subId}` | Hủy yêu cầu      |

### 14. Auth0 — Authentication

| Method | Path                             | Description              |
| ------ | -------------------------------- | ------------------------ |
| POST   | `/oauth/token`                   | Lấy/refresh access token |
| POST   | `/dbconnections/signup`          | Đăng ký tài khoản        |
| POST   | `/dbconnections/change_password` | Đổi mật khẩu             |

### 15. ccar-order-history — Order Management

| Method | Path                                                        | Description        |
| ------ | ----------------------------------------------------------- | ------------------ |
| GET    | `/ccar-order-history/api/v1/me/orders`                      | Danh sách đơn hàng |
| POST   | `/ccar-order-history/api/v1/orders/confirm-delivery-record` | Xác nhận giao xe   |
| PUT    | `/ccar-order-history/api/v1/orders/{id}/delivery`           | Cập nhật giao xe   |

---

## Telemetry Object IDs (Chi Tiết)

Telemetry data được request qua POST body với format:

```json
[
  {"objectId": "34180", "instanceId": "1", "resourceId": "10"},
  ...
]
```

### Nhóm Chính

| Object ID | Instance | Resource | Alias                | Description                  |
| --------- | -------- | -------- | -------------------- | ---------------------------- |
| 34180     | 1        | 10       | battery_soc          | State of Charge (%)          |
| 34180     | 1        | 7        | estimated_range      | Phạm vi ước tính (km)        |
| 34183     | 0        | 1        | charging_status      | Trạng thái sạc               |
| 34183     | 0        | 4        | charging_remain_time | Thời gian sạc còn lại        |
| 34183     | 0        | 12       | charging_power       | Công suất sạc (kW)           |
| 34190     | 0-3      | \*       | tire*pressure*\*     | Áp suất lốp (4 bánh)         |
| 34191     | 0-5      | \*       | door*status*\*       | Trạng thái cửa (6 cửa)       |
| 34199     | 0        | 0        | odometer             | Số km đã đi                  |
| 34182     | 0        | \*       | location             | Vị trí GPS (lat/lon/heading) |
| 34192     | 0        | 0        | exterior_temp        | Nhiệt độ ngoài trời          |
| 34192     | 0        | 1        | interior_temp        | Nhiệt độ trong xe            |
| 34185     | 0        | 0        | hvac_status          | Trạng thái điều hòa          |
| 34186     | 0        | \*       | light_status         | Trạng thái đèn               |
| 34187     | 0        | 0        | gear                 | Số (P/R/N/D)                 |
| 34188     | 0        | 0        | speed                | Tốc độ hiện tại              |
| 34198     | 0        | \*       | window_status        | Trạng thái cửa sổ            |

> Danh sách đầy đủ được lấy từ `/modelmgmt/api/v2/vehicle-model/mobile-app/vehicle/get-alias` và lưu tại `src/config/static_alias_map.json`.

---

## Remote Commands

Gửi qua POST `/ccaraccessmgmt/api/v2/remote/app/command`:

```json
{
  "commandType": "LOCK_VEHICLE",
  "vinCode": "RLLV...",
  "params": {}
}
```

### Danh sách Command Types (từ APK)

| Command        | Description  |
| -------------- | ------------ |
| LOCK_VEHICLE   | Khóa xe      |
| UNLOCK_VEHICLE | Mở khóa xe   |
| FLASH_LIGHT    | Nháy đèn     |
| HONK_HORN      | Bấm còi      |
| START_AC       | Bật điều hòa |
| STOP_AC        | Tắt điều hòa |
| OPEN_TRUNK     | Mở cốp       |
| CLOSE_TRUNK    | Đóng cốp     |
| START_CHARGING | Bắt đầu sạc  |
| STOP_CHARGING  | Dừng sạc     |
| FIND_MY_CAR    | Tìm xe       |

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

> Base URL chính có thể thay đổi thông qua Firebase Remote Config key `android_vf_service_base_url`.

---

## Firebase Remote Config Keys (Liên Quan Đến API)

Các config key ảnh hưởng đến kết nối API:

| Key                           | Type    | Description                     |
| ----------------------------- | ------- | ------------------------------- |
| `android_vf_service_base_url` | String  | Base URL cho VF service APIs    |
| `android_vf_auth0_base_url`   | String  | Auth0 base URL                  |
| `android_vf_auto_base_url`    | String  | VF Auto service URL             |
| `android_vf_om_base_url`      | String  | OEM management URL              |
| `auth0_client_id`             | String  | Auth0 client ID                 |
| `auth0_audience`              | String  | Auth0 audience                  |
| `auth0_connection`            | String  | Auth0 connection type           |
| `auth0_scope`                 | String  | OAuth2 scopes                   |
| `notify_app_status_interval`  | Integer | Telemetry polling interval (ms) |

---

**Note:** Tài liệu này được tạo từ phân tích smali decompilation. Số lượng endpoint thực tế có thể thay đổi theo version APK.
