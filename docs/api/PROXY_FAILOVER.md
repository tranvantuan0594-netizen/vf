# Proxy Failover Architecture

## Overview

The dashboard uses a **multi-proxy failover** system to handle HTTP 429 (Too Many Requests) rate limiting from both **VinFast API** and **Auth0** authentication endpoints.

When the primary Cloudflare Pages proxy receives a 429, it immediately fails over to backup proxies deployed on different platforms/regions, each with a different egress IP.

## Architecture

```
User Request → CF Pages Proxy (direct to VinFast/Auth0)
                    ↓ 429
               Shuffle 6 backup proxies randomly
                    ↓ try each until success
               [Vercel SG] → [CF Worker 1] → [Vercel TK] → ...
                    ↓ all 429
               Return 429 to client
```

## Proxy Inventory

| # | Platform         | Region    | Endpoint Type       |
|---|------------------|-----------|---------------------|
| 0 | CF Pages (main)  | Edge      | VinFast API + Auth0 |
| 1 | Vercel #1        | Singapore | VinFast API + Auth0 |
| 2 | Vercel #2        | Tokyo     | VinFast API + Auth0 |
| 3 | Vercel #3        | Singapore | VinFast API + Auth0 |
| 4 | Vercel #4        | Singapore | VinFast API + Auth0 |
| 5 | CF Worker #1     | Edge      | VinFast API + Auth0 |
| 6 | CF Worker #2     | Edge      | VinFast API + Auth0 |

## Endpoints

Each backup proxy exposes:

- `POST /api/vf-proxy/{path}` — Forward VinFast API requests (with X-HASH/X-HASH-2 signing)
- `POST /api/vf-auth` — Forward Auth0 login/refresh requests
- `GET /health` — Health check

## Configuration

Backup proxy URLs are configured via environment variables on Cloudflare Pages:

```
BACKUP_PROXY_URL    = https://vercel-proxy-1.vercel.app
BACKUP_PROXY_URL_2  = https://vercel-proxy-2.vercel.app
BACKUP_PROXY_URL_3  = https://vercel-proxy-3.vercel.app
BACKUP_PROXY_URL_4  = https://vercel-proxy-4.vercel.app
BACKUP_PROXY_URL_5  = https://cf-worker-1.workers.dev
BACKUP_PROXY_URL_6  = https://cf-worker-2.workers.dev
```

**Local development**: No env vars needed. Without backup URLs, requests go directly to VinFast/Auth0 with no failover.

## Key Design Decisions

### Random Order (Fisher-Yates Shuffle)
Backup proxies are shuffled randomly on each request to distribute load evenly and prevent all users from hitting the same backup first.

### No Retry on Direct
The primary proxy does **not** retry on 429 — it fails over immediately. Retrying the same IP is pointless since Auth0/VinFast rate-limit per IP.

### Server-Side Only
All failover happens server-side in `[...path].js` / `login.js` / `refresh.js`. The client (browser) only sees one request and gets back a response. The `access_token` is in an HttpOnly cookie and cannot be read by client-side JavaScript, so cross-origin backup calls must happen server-side.

### Auth Proxy
Backup proxies also handle Auth0 calls (`/api/vf-auth`) because the 429 rate limiting most commonly hits during login/refresh (Auth0 `oauth/token` endpoint).

## Client-Side Logging

The proxy returns debug headers that the client logs to the browser console:

- `X-Proxy-Route` — Which proxy served the successful response
- `X-Proxy-Log` — JSON array of all attempts with timing

Login responses include `_authLog` in the JSON body.

Console output examples:
```
✓ ccarusermgnt/api/v1/user-vehicle → direct (132ms)

🟡 telemetry/app/ping — 3 attempt(s), final: 200
  ✗ direct → 429 (45ms)
  ✗ vercel-proxy-3 → 429 (180ms)
  ✓ vf-proxy-worker-1 → 200 (95ms)
```

## File Structure

```
src/pages/api/
  login.js          — Auth0 login with backup failover
  refresh.js        — Auth0 refresh with backup failover
  proxy/[...path].js — VinFast API proxy with backup failover

vercel-proxy/       — Vercel backup #1 (sin1)
vercel-proxy-2/     — Vercel backup #2 (hnd1)
vercel-proxy-3/     — Vercel backup #3 (sin1)
vercel-proxy-4/     — Vercel backup #4 (sin1)
cf-worker-proxy-1/  — CF Worker backup #1
cf-worker-proxy-2/  — CF Worker backup #2
```

## Deployment

```bash
# Deploy Vercel proxies
cd vercel-proxy && vercel --prod
cd vercel-proxy-2 && vercel --prod
# ... etc

# Deploy CF Workers
cd cf-worker-proxy-1 && wrangler deploy
cd cf-worker-proxy-2 && wrangler deploy

# Deploy main app
npm run deploy
```

Each Vercel proxy needs the `VINFAST_XHASH_SECRET` env var set via `vercel env add`.
