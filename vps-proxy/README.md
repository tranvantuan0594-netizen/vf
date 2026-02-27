# VPS Proxy — IP Rotation for Auth0 & VinFast API

Proxy server chạy trên VPS với ~100 outbound IPs, tự động rotate IP khi gọi Auth0/VinFast API để tránh rate limit (429). Thay thế toàn bộ 6 Vercel backup proxies bằng 1 endpoint duy nhất.

---

## Architecture

```
┌────────────────────┐
│   User (Browser)   │
└─────────┬──────────┘
          │
┌─────────▼──────────┐
│   Cloudflare Pages  │  Astro SSR — auth, signing, frontend
│                     │
│  /api/login         │─── Direct Auth0 (/oauth/token)
│  /api/refresh       │         │
│  /api/proxy/*       │─── Direct VinFast API
│                     │         │
│  On 429 ────────────│────┐    │ 429?
└─────────────────────┘    │    │
                           │    │
                    ┌──────▼────▼──────┐
                    │   VPS Proxy       │  Node.js + Express
                    │   ~100 IPs        │  Port 3100 (behind Nginx)
                    │                   │
                    │  IP Pool Manager  │  Smart rotation + cooldown
                    │  ┌──┬──┬──┬──┐   │
                    │  │IP│IP│IP│..│   │  Up to 3 retries per request
                    │  │1 │2 │3 │  │   │  with different IPs
                    │  └──┴──┴──┴──┘   │
                    └──────┬───────────┘
                           │
              ┌────────────┼────────────┐
              │                         │
     ┌────────▼─────────┐    ┌─────────▼──────────┐
     │   Auth0           │    │   VinFast API        │
     │   /oauth/token    │    │   connected-car.     │
     │   /userinfo       │    │   vinfast.vn          │
     └──────────────────┘    └────────────────────┘
```

### Request Flow

1. User → CF Pages: login/refresh/API request
2. CF Pages gọi Auth0/VinFast trực tiếp (IP của Cloudflare)
3. Nếu 429 → forward request sang VPS Proxy
4. VPS Proxy chọn IP từ pool → gọi Auth0/VinFast từ IP đó
5. Nếu vẫn 429 → retry với IP khác (tối đa 3 lần)
6. Trả response về CF Pages → User

---

## Prerequisites

### VPS Requirements

| Item | Minimum | Recommended |
|------|---------|-------------|
| OS | Ubuntu 22.04+ / Debian 12+ | Ubuntu 24.04 LTS |
| CPU | 1 vCPU | 2 vCPU |
| RAM | 512MB | 1GB |
| Outbound IPs | 10+ | 50-100+ |
| Network | IPv4 public | IPv4 + stable bandwidth |
| Domain | Required (for SSL) | Subdomain: `proxy.yourdomain.com` |

### Software

- **Node.js** 22+ (LTS)
- **PM2** — process manager
- **Nginx** — reverse proxy + SSL termination
- **Certbot** — Let's Encrypt SSL

### IP Setup

IPs phải được bind vào network interface trước khi chạy proxy.

Verify IPs đã available:
```bash
# List tất cả IPv4 addresses (non-loopback)
ip -4 addr show | grep "inet " | grep -v "127.0.0.1"

# Hoặc chi tiết hơn
ip -4 addr show scope global | awk '/inet / {print $2}' | cut -d/ -f1
```

Nếu IPs cần thêm vào interface (ví dụ `eth0`):
```bash
# Thêm IP (ephemeral, mất khi reboot)
sudo ip addr add 203.0.113.5/32 dev eth0

# Thêm vĩnh viễn (Netplan - Ubuntu 18.04+)
# Edit /etc/netplan/01-netcfg.yaml
# Hoặc theo hướng dẫn của VPS provider
```

---

## Directory Structure

```
vps-proxy/
│
├── README.md                       # ← file này
├── package.json                    # Dependencies: express, axios, pino, dotenv
├── .env.example                    # Template env vars
├── .gitignore                      # node_modules, .env, logs
├── ecosystem.config.cjs            # PM2 configuration
│
├── src/
│   ├── server.js                   # Express app entry point (port 3100)
│   │
│   ├── middleware/
│   │   ├── auth.js                 # X-Proxy-Secret validation (timing-safe)
│   │   └── cors.js                 # CORS headers for cross-origin
│   │
│   ├── routes/
│   │   ├── auth.js                 # POST /api/vf-auth     (Auth0 proxy)
│   │   ├── proxy.js                # ANY  /api/vf-proxy/*  (VinFast API proxy)
│   │   ├── health.js               # GET  /health          (public)
│   │   └── stats.js                # GET  /stats           (admin-protected)
│   │
│   ├── lib/
│   │   ├── ipPool.js               # IP pool manager (core)
│   │   ├── httpClient.js           # Axios + https.Agent per IP
│   │   ├── signing.js              # X-HASH + X-HASH-2 generation
│   │   └── config.js               # Regions, API headers, allowed paths
│   │
│   └── scripts/
│       └── detect-ips.js           # Auto-detect outbound IPs on startup
│
└── nginx/
    └── proxy.conf                  # Nginx config template
```

---

## IP Pool Manager

### Data Model

Mỗi IP trong pool có state:

```js
{
  address: "203.0.113.5",           // Outbound IP address
  state: "available",               // "available" | "cooldown"
  lastUsed: 0,                      // Timestamp lần cuối sử dụng
  cooldownUntil: 0,                 // Timestamp hết cooldown (0 = không cooldown)
  totalRequests: 0,                 // Tổng requests lifetime
  total429s: 0,                     // Tổng 429 responses lifetime
  consecutiveFails: 0,              // 429 liên tiếp (reset khi success)
}
```

### IP Selection Algorithm

```
1. Lọc IPs có state !== "cooldown" HOẶC cooldownUntil < Date.now()
2. Sort theo lastUsed ascending (Least Recently Used)
3. Từ top 10 LRU → random pick 1  (tránh deterministic pattern)
4. Nếu tất cả đang cooldown → chọn IP có cooldownUntil nhỏ nhất (sắp hết cooldown)
```

**Tại sao LRU + random?**
- LRU đảm bảo phân tán đều requests
- Random trong top 10 tránh bị Auth0 detect pattern (cùng thứ tự IP)

### Cooldown Strategy

Khi IP nhận 429 từ Auth0/VinFast:

| Lần 429 liên tiếp | Cooldown | Giải thích |
|---|---|---|
| 1 | 60s | IP mới bị limit |
| 2 | 120s | Vẫn đang bị limit |
| 3 | 300s (5 min) | Rate limit window chưa reset |
| 4+ | 600s (10 min) | Max cooldown |

**Formula**: `min(60 * 2^(consecutiveFails - 1), 600)` seconds

Khi IP nhận response OK (non-429):
- `consecutiveFails` reset về 0
- `state` chuyển về "available"

### Internal Retry

Mỗi request đến VPS proxy được retry tối đa **3 lần** với IPs khác nhau:

```
Request đến → chọn IP #1 → gọi Auth0
                                 ↓
                              429? → mark cooldown IP #1 → chọn IP #2 → gọi Auth0
                                                                              ↓
                                                                           429? → mark cooldown IP #2 → chọn IP #3 → gọi Auth0
                                                                                                                           ↓
                                                                                                                        429? → return 429 to caller
```

CF Pages chỉ cần gọi VPS **1 lần**. VPS tự xử lý retry nội bộ.

---

## API Endpoints

### POST `/api/vf-auth` — Auth0 Proxy

Forward Auth0 login/refresh requests. Tương thích API contract của `vercel-proxy/api/auth.js`.

**Headers:**
```
Content-Type: application/json
X-Proxy-Secret: <shared_secret>          # Required
```

**Request Body:**
```json
// Login
{
  "action": "login",
  "email": "user@example.com",
  "password": "xxx",
  "region": "vn"                         // "vn" | "us" | "eu"
}

// Refresh
{
  "action": "refresh",
  "region": "vn",
  "refreshToken": "eyJ..."
}
```

**Response:**
- Success: Auth0 response as-is (access_token, refresh_token, expires_in, ...)
- Error: `{ "error": "..." }` with appropriate status code

**Response Headers:**
```
X-Proxy-IP: 203.0.113.* (masked)        # IP used for this request
X-Proxy-Retries: 0                       # Number of retries needed
```

**Auth0 Regions:**

| Region | Auth0 Domain | Client ID |
|--------|---|---|
| vn | `vin3s.au.auth0.com` | `jE5xt50qC7oIh1f32qMzA6hGznIU5mgH` |
| us | `vinfast-us-prod.us.auth0.com` | `xhGY7XKDFSk1Q22rxidvwujfz0EPAbUP` |
| eu | `vinfast-eu-prod.eu.auth0.com` | `dxxtNkkhsPWW78x6s1BWQlmuCfLQrkze` |

---

### ANY `/api/vf-proxy/{apiPath}` — VinFast API Proxy

Forward requests đến VinFast API. Tương thích API contract của `vercel-proxy/api/proxy.js`.

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <access_token>     # Required — forwarded to VinFast
X-Proxy-Secret: <shared_secret>          # Required
x-vin-code: <VIN>                        # Optional — for vehicle-specific endpoints
x-player-identifier: <id>               # Optional
```

**URL Pattern:**
```
POST /api/vf-proxy/ccaraccessmgmt/api/v1/telemetry/app/ping
GET  /api/vf-proxy/ccarusermgnt/api/v1/user-vehicle
...
```

**Allowed Path Prefixes** (requests outside these bị reject 403):
```
ccarusermgnt/api/v1/user-vehicle
ccarusermgnt/api/v1/service-history
ccarusermgnt/api/v1/service-appointments
ccarbookingservice/api/v1/c-app/appointment/
ccarbookingservice/api/v1/c-app/showroom/
modelmgmt/api/v2/vehicle-model/
ccaraccessmgmt/api/v1/telemetry/
ccarcharging/api/v1/stations/
ccarcharging/api/v1/charging-sessions/search
```

**Signed Paths** (cần X-HASH + X-HASH-2):
```
ccaraccessmgmt/*
ccarcharging/*
```

Xem phần [HMAC Signing](#hmac-signing) bên dưới.

**Target Base URL:**
```
https://mobile.connected-car.vinfast.vn/
```

**API Headers** (mimic Android app, thêm vào mọi request):
```
X-SERVICE-NAME: CAPP
X-APP-VERSION: 2.17.5
X-Device-Platform: android
X-Device-Family: SM-F946B
X-Device-OS-Version: android 14
X-Device-Locale: vi-VN
X-Timezone: Asia/Ho_Chi_Minh
X-Device-Identifier: vfdashboard-community-edition
User-Agent: android - vfdashboard-community-edition - 2.17.5
```

---

### GET `/health` — Health Check

Public endpoint, không cần auth.

**Response:**
```json
{
  "status": "ok",
  "platform": "vps",
  "uptime": 86400,
  "ips": {
    "total": 100,
    "available": 95,
    "cooldown": 5
  },
  "timestamp": 1709000000000
}
```

---

### GET `/stats` — Pool Statistics

Protected bởi admin secret.

**Headers:**
```
X-Admin-Secret: <admin_secret>
```

**Response:**
```json
{
  "uptime": 86400,
  "totals": {
    "requests": 15234,
    "successes": 15100,
    "rate429": 134,
    "rate429Pct": "0.88%",
    "avgLatencyMs": 142
  },
  "pool": [
    {
      "address": "203.0.113.***",
      "state": "available",
      "cooldownUntil": 0,
      "lastUsed": 1709000000000,
      "totalRequests": 152,
      "total429s": 1,
      "consecutiveFails": 0
    },
    {
      "address": "203.0.113.***",
      "state": "cooldown",
      "cooldownUntil": 1709000060000,
      "lastUsed": 1709000000000,
      "totalRequests": 148,
      "total429s": 3,
      "consecutiveFails": 1
    }
  ]
}
```

IP addresses được mask (chỉ hiện 3 octet đầu) để tránh leak.

---

## HMAC Signing

VinFast API yêu cầu 2 HMAC signatures cho một số endpoints (telemetry, charging).

### X-HASH

```
Algorithm:  HMAC-SHA256 → Base64
Key:        env VINFAST_XHASH_SECRET (default: "Vinfast@2025")
Message:    method_/path_[vin_]key_timestamp (all lowercase)

Ví dụ:
  Method: POST
  Path:   /ccaraccessmgmt/api/v1/telemetry/app/ping
  VIN:    VF8ABC123XYZ
  Key:    Vinfast@2025
  Time:   1709000000000

  Message: "post_/ccaraccessmgmt/api/v1/telemetry/app/ping_vf8abc123xyz_vinfast@2025_1709000000000"
```

### X-HASH-2

```
Algorithm:  HMAC-SHA256 → Base64
Key:        "ConnectedCar@6521" (hardcoded, from libsecure.so)
Message:    platform_[vinCode_]identifier_path_method_timestamp (all lowercase)

Path processing:
  1. Strip leading "/"
  2. Replace "/" with "_"

Ví dụ:
  Platform:   android
  VIN:        VF8ABC123XYZ
  Identifier: vfdashboard-community-edition
  Path:       ccaraccessmgmt_api_v1_telemetry_app_ping  (sau khi xử lý)
  Method:     POST
  Timestamp:  1709000000000

  Message: "android_vf8abc123xyz_vfdashboard-community-edition_ccaraccessmgmt_api_v1_telemetry_app_ping_post_1709000000000"
```

### Headers gửi kèm

```
X-HASH:      <base64 hash>
X-HASH-2:    <base64 hash2>
X-TIMESTAMP: <timestamp as string>
```

---

## Security

### 1. Shared Secret (CF Pages ↔ VPS)

Mọi request từ CF Pages đến VPS phải có header `X-Proxy-Secret`.

```bash
# Generate secret
openssl rand -hex 32
# → e.g. a1b2c3d4e5f6...

# Set trên cả 2 sides:
# VPS: .env → VPS_PROXY_SECRET=a1b2c3d4e5f6...
# CF:  Cloudflare Dashboard → Settings → Environment Variables → VPS_PROXY_SECRET=a1b2c3d4e5f6...
```

Validation phải dùng **timing-safe comparison** (`crypto.timingSafeEqual`) để tránh timing attacks.

### 2. Admin Secret (cho /stats endpoint)

Secret riêng cho monitoring endpoint.

```bash
# .env → ADMIN_SECRET=<different_secret>
```

### 3. Nginx IP Whitelist (Optional)

Restrict VPS chỉ nhận request từ Cloudflare IPs:

```nginx
# Cloudflare IP ranges: https://www.cloudflare.com/ips/
allow 173.245.48.0/20;
allow 103.21.244.0/22;
allow 103.22.200.0/22;
allow 103.31.4.0/22;
allow 141.101.64.0/18;
allow 108.162.192.0/18;
allow 190.93.240.0/20;
allow 188.114.96.0/20;
allow 197.234.240.0/22;
allow 198.41.128.0/17;
allow 162.158.0.0/15;
allow 104.16.0.0/13;
allow 104.24.0.0/14;
allow 172.64.0.0/13;
allow 131.0.72.0/22;

# Allow localhost (for health checks)
allow 127.0.0.1;

deny all;
```

### 4. Inbound Rate Limiting (Nginx)

Bảo vệ VPS khỏi bị abuse:

```nginx
limit_req_zone $binary_remote_addr zone=proxy:10m rate=30r/s;

location / {
    limit_req zone=proxy burst=50 nodelay;
    # ...
}
```

---

## CF Pages Integration

### Environment Variables

**Thêm trên Cloudflare Dashboard:**

| Key | Value | Scope |
|-----|-------|-------|
| `VPS_PROXY_URL` | `https://proxy.yourdomain.com` | Production + Preview |
| `VPS_PROXY_SECRET` | `<shared_secret>` | Production + Preview (encrypted) |

**Xóa (sau khi VPS ổn định):**

| Key | Lý do |
|-----|-------|
| `BACKUP_PROXY_URL` | Thay bằng VPS |
| `BACKUP_PROXY_URL_2` | Thay bằng VPS |
| `BACKUP_PROXY_URL_3` | Thay bằng VPS |
| `BACKUP_PROXY_URL_4` | Thay bằng VPS |
| `BACKUP_PROXY_URL_5` | Thay bằng VPS |
| `BACKUP_PROXY_URL_6` | Thay bằng VPS |

### Code Changes Required

#### `src/pages/api/login.js`

**Before (6 Vercel shuffle):**
```js
// Phase 2: If 429, failover through backup proxies
if (response.status === 429) {
  const backupUrls = getShuffledBackups(locals);
  for (const backupUrl of backupUrls) { ... }
}
```

**After (single VPS call):**
```js
// Phase 2: If 429, failover to VPS proxy (100 IPs, internal retry)
if (response.status === 429) {
  const runtimeEnv = locals?.runtime?.env || import.meta.env || {};
  const vpsUrl = runtimeEnv.VPS_PROXY_URL;
  const vpsSecret = runtimeEnv.VPS_PROXY_SECRET;

  if (vpsUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const vpsTarget = `${vpsUrl.replace(/\/$/, "")}/api/vf-auth`;
      console.log(`[Login] 429 — failover to VPS`);
      t0 = Date.now();

      const vpsResponse = await fetch(vpsTarget, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Proxy-Secret": vpsSecret || "",
        },
        body: JSON.stringify({ action: "login", email, password, region }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const vpsData = await vpsResponse.json();
      elapsed = Date.now() - t0;
      authLog.push({ via: "vps", status: vpsResponse.status, ms: elapsed });
      console.log(`[Login] ← vps ${vpsResponse.status} (${elapsed}ms)`);

      response = vpsResponse;
      data = vpsData;
    } catch (e) {
      authLog.push({ via: "vps", status: "error", error: e.message });
      console.warn(`[Login] VPS failover failed:`, e.message);
    }
  }
}
```

**Xóa:**
- `getShuffledBackups()` function
- `labelFromUrl()` function

#### `src/pages/api/refresh.js`

Áp dụng **cùng pattern** như login.js:
- Xóa `getShuffledBackups()`, `labelFromUrl()`
- Thay Vercel loop bằng single VPS call
- Body: `{ action: "refresh", region, refreshToken }`

#### `src/pages/api/proxy/[...path].js`

**Before:**
```js
if (lastResponse.status === 429) {
  // Loop through 6 backup URLs...
  for (const backupUrl of backupUrls) { ... }
}
```

**After:**
```js
if (lastResponse.status === 429) {
  const runtimeEnv = locals?.runtime?.env || import.meta.env || {};
  const vpsUrl = runtimeEnv.VPS_PROXY_URL;
  const vpsSecret = runtimeEnv.VPS_PROXY_SECRET;

  if (vpsUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const vpsTarget = `${vpsUrl.replace(/\/$/, "")}/api/vf-proxy/${apiPath}${searchStr ? "?" + searchStr : ""}`;
      console.log(`[Proxy] 429 — failover to VPS`);

      const t0 = Date.now();
      const vpsResponse = await fetch(vpsTarget, {
        method: request.method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-Proxy-Secret": vpsSecret || "",
          ...(vinHeader && { "x-vin-code": vinHeader }),
          ...(playerHeader && { "x-player-identifier": playerHeader }),
        },
        body: requestBody || undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const vpsData = await vpsResponse.text();
      const elapsed = Date.now() - t0;
      proxyLog.push({ via: "vps", status: vpsResponse.status, ms: elapsed });
      console.log(`[Proxy] ← vps ${vpsResponse.status} (${elapsed}ms)`);

      return new Response(vpsData, {
        status: vpsResponse.status,
        headers: {
          "Content-Type": "application/json",
          "X-Proxy-Route": "vps",
          "X-Proxy-Log": JSON.stringify(proxyLog),
        },
      });
    } catch (e) {
      proxyLog.push({ via: "vps", status: "error", error: e.message });
      console.warn(`[Proxy] VPS failover failed:`, e.message);
    }
  }
}
```

#### `src/config/vinfast.js`

Xóa `BACKUP_PROXIES` export (lines 127-149) — không còn cần thiết.

---

## Deployment Steps

### Step 1: Install Dependencies (VPS)

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs

# Verify
node -v  # v22.x.x
npm -v   # 10.x.x

# Install PM2 globally
sudo npm install -g pm2

# Install Nginx + Certbot
sudo apt install -y nginx certbot python3-certbot-nginx
```

### Step 2: Deploy Proxy Code

```bash
# Clone repo (hoặc scp)
cd /opt
git clone <repo-url> vfdashboard
cd vfdashboard/vps-proxy

# Install dependencies
npm install

# Create .env from template
cp .env.example .env
```

Edit `.env`:
```bash
# Required
VPS_PROXY_SECRET=<generate: openssl rand -hex 32>
VINFAST_XHASH_SECRET=Vinfast@2025
ADMIN_SECRET=<generate: openssl rand -hex 32>

# Optional
PORT=3100
NODE_ENV=production
LOG_LEVEL=info

# IP config (optional — auto-detect if not set)
# IP_LIST=/opt/vfdashboard/vps-proxy/ips.json
```

### Step 3: Verify IPs

```bash
# Auto-detect available outbound IPs
node src/scripts/detect-ips.js

# Expected output:
# Detected 97 outbound IPv4 addresses:
#   203.0.113.1
#   203.0.113.2
#   ...
#   203.0.113.100
# Excluded (internal): 10.0.0.1, 127.0.0.1
```

### Step 4: Test Locally

```bash
# Start in foreground
node src/server.js

# In another terminal:
curl http://localhost:3100/health
# → {"status":"ok","platform":"vps","ips":{"total":97,"available":97,"cooldown":0},...}
```

### Step 5: Start with PM2

```bash
# Start
pm2 start ecosystem.config.cjs

# Verify
pm2 status
pm2 logs vps-proxy --lines 20

# Save process list (auto-start on reboot)
pm2 save

# Enable startup script
pm2 startup
# → Copy/paste the command it outputs
```

### Step 6: Configure Nginx

```bash
# Create config
sudo nano /etc/nginx/sites-available/vps-proxy
```

```nginx
server {
    listen 80;
    server_name proxy.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name proxy.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/proxy.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/proxy.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=proxy:10m rate=30r/s;

    location / {
        limit_req zone=proxy burst=50 nodelay;

        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 10s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }

    location = /health {
        proxy_pass http://127.0.0.1:3100/health;
        proxy_http_version 1.1;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/vps-proxy /etc/nginx/sites-enabled/

# Test config
sudo nginx -t

# Get SSL certificate
sudo certbot --nginx -d proxy.yourdomain.com

# Reload
sudo systemctl reload nginx
```

### Step 7: Verify Production

```bash
# Health check
curl https://proxy.yourdomain.com/health

# Stats (with admin auth)
curl -H "X-Admin-Secret: <admin_secret>" https://proxy.yourdomain.com/stats

# Test auth proxy (should fail auth but confirms endpoint works)
curl -X POST https://proxy.yourdomain.com/api/vf-auth \
  -H "Content-Type: application/json" \
  -H "X-Proxy-Secret: <secret>" \
  -d '{"action":"login","email":"test@test.com","password":"test","region":"vn"}'
```

### Step 8: Configure CF Pages

1. Cloudflare Dashboard → VFDashboard → Settings → Environment Variables
2. Add `VPS_PROXY_URL` = `https://proxy.yourdomain.com`
3. Add `VPS_PROXY_SECRET` = `<shared_secret>` (same as VPS .env)
4. Remove `BACKUP_PROXY_URL` through `BACKUP_PROXY_URL_6`
5. Deploy new CF Pages code (with VPS failover changes)

---

## Monitoring

### PM2 Logs

```bash
# Real-time logs
pm2 logs vps-proxy

# Last 100 lines
pm2 logs vps-proxy --lines 100

# Filter errors only
pm2 logs vps-proxy --err
```

### Log Format (Structured JSON via Pino)

```json
{
  "level": "info",
  "time": 1709000000000,
  "msg": "Auth0 request completed",
  "endpoint": "/api/vf-auth",
  "action": "login",
  "ipUsed": "203.0.113.5",
  "upstreamStatus": 200,
  "latencyMs": 142,
  "retries": 0,
  "poolAvailable": 95,
  "poolCooldown": 5
}
```

### /stats Endpoint

Poll định kỳ để monitor:

```bash
# Cron job: check mỗi 5 phút, alert nếu available IPs < 10
*/5 * * * * curl -s -H "X-Admin-Secret: $ADMIN_SECRET" https://proxy.yourdomain.com/stats | jq '.pool | map(select(.state == "available")) | length' | xargs -I{} test {} -lt 10 && echo "LOW IP POOL: {} available" | mail -s "VPS Proxy Alert" admin@example.com
```

### External Monitoring

- **UptimeRobot / Better Stack**: Monitor `https://proxy.yourdomain.com/health`
- Alert on downtime or response time > 5s

---

## Troubleshooting

### VPS proxy returns 403

```
{"error": "Invalid proxy secret"}
```

→ `X-Proxy-Secret` header không khớp giữa CF Pages và VPS `.env`. Verify cả 2 side dùng cùng secret.

### VPS proxy returns 429 (tất cả IPs exhausted)

```bash
# Check pool state
curl -H "X-Admin-Secret: ..." https://proxy.yourdomain.com/stats | jq '.pool | group_by(.state) | map({state: .[0].state, count: length})'
```

→ Nếu tất cả cooldown: Auth0 rate limit rất aggressive. Tăng số IP hoặc giảm request frequency.

### IP binding errors

```
Error: bind EADDRNOTAVAIL 203.0.113.5
```

→ IP chưa được bind vào network interface. Chạy:
```bash
ip addr show | grep "203.0.113.5"
# Nếu không thấy → ip addr add 203.0.113.5/32 dev eth0
```

### Connection timeout to Auth0

```
Error: connect ETIMEDOUT
```

→ Một số IPs có thể bị firewall block outbound HTTPS. Test:
```bash
curl --interface 203.0.113.5 -v https://vin3s.au.auth0.com/.well-known/openid-configuration
```

→ Nếu fail: loại IP đó ra khỏi pool (thêm vào exclude list trong config).

### PM2 crash loop

```bash
pm2 logs vps-proxy --err --lines 50
```

→ Check lỗi startup (port conflict, missing .env, permission...).

Fix phổ biến:
```bash
# Port conflict
sudo lsof -i :3100

# Permission
sudo chown -R $USER:$USER /opt/vfdashboard/vps-proxy

# Missing .env
cp .env.example .env && nano .env
```

### Nginx 502 Bad Gateway

→ PM2 process chưa chạy hoặc port mismatch:
```bash
pm2 status
# Verify port matches nginx proxy_pass
```

### SSL certificate expired

```bash
# Renew
sudo certbot renew

# Auto-renew (should be set up by certbot automatically)
sudo systemctl status certbot.timer
```

---

## PM2 Configuration Reference

`ecosystem.config.cjs`:
```js
module.exports = {
  apps: [{
    name: "vps-proxy",
    script: "src/server.js",
    instances: 1,              // MUST be 1 (in-memory IP pool state)
    exec_mode: "fork",         // NOT cluster
    max_memory_restart: "512M",
    env: {
      NODE_ENV: "production",
      PORT: 3100,
    },
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    error_file: "/var/log/vps-proxy/error.log",
    out_file: "/var/log/vps-proxy/out.log",
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 5000,
  }],
};
```

**Important**: Phải dùng `fork` mode, KHÔNG dùng `cluster`. IP pool state nằm trong memory — cluster mode sẽ tạo pool riêng mỗi worker, gây duplicate request trên cùng IP.

---

## .env.example

```bash
# === Required ===

# Shared secret between CF Pages and VPS proxy
# Generate: openssl rand -hex 32
VPS_PROXY_SECRET=

# VinFast API HMAC signing key (for X-HASH)
VINFAST_XHASH_SECRET=Vinfast@2025

# Admin secret for /stats endpoint
# Generate: openssl rand -hex 32
ADMIN_SECRET=

# === Optional ===

# Server port (default: 3100)
PORT=3100

# Node environment
NODE_ENV=production

# Log level: trace, debug, info, warn, error, fatal (default: info)
LOG_LEVEL=info

# Path to JSON file with IP list (auto-detect if not set)
# Format: ["203.0.113.1", "203.0.113.2", ...]
# IP_LIST=/opt/vps-proxy/ips.json

# IPs to exclude from pool (comma-separated)
# IP_EXCLUDE=203.0.113.50,203.0.113.51

# Max retries per request within VPS (default: 3)
# MAX_RETRIES=3

# Max cooldown seconds (default: 600)
# MAX_COOLDOWN_SECONDS=600
```
