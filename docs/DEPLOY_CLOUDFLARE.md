# Deploying to Cloudflare Pages

**Updated:** Feb 2026

---

## 1. Architecture: Hybrid Model

This project uses a **Hybrid Architecture** for stability and performance:

- **Static Pages**: `index.astro` and `login.astro` are prerendered as static HTML. This prevents SSR errors and ensures instant page loads.
- **Dynamic Worker**: The Cloudflare Worker handles `/api/*` proxy routes and SSR for dynamic paths.
- **Client Hydration**: Dashboard components use `client:only="react"` to guarantee they only run in the browser after authentication.

## 2. Configuration

### `astro.config.mjs`

```javascript
import cloudflare from "@astrojs/cloudflare";
export default defineConfig({
  output: "server",
  adapter: cloudflare({
    imageService: "compile",
  }),
});
```

### `wrangler.toml`

```toml
name = "vfdashboard"
compatibility_date = "2026-01-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "./dist"

[[kv_namespaces]]
binding = "VFDashboard"
id = "<your-kv-namespace-id>"
```

- **`nodejs_compat`**: Required for Node.js APIs (Buffer, crypto) used by the API Proxy.
- **KV binding**: Used for crowdsourced telemetry aliases (`/api/known-aliases`).

## 3. One-Time Setup

### Login to Cloudflare

```bash
npx wrangler login
```

### Create the Pages Project

```bash
npx wrangler pages project create vfdashboard --production-branch main
```

### Create KV Namespace

```bash
npx wrangler kv namespace create VFDashboard
```

Copy the `id` from the output and paste it into `wrangler.toml` under `[[kv_namespaces]]`.

## 4. Deploy

Run the built-in deploy command:

```bash
npm run deploy
```

This command:

1. Cleans `dist/` and `.wrangler/` (fresh build every time).
2. Builds the project via `astro build`.
3. Uploads to Cloudflare Pages via `wrangler pages deploy`.

> **Why clean build?** Cloudflare sometimes caches intermediate files. Deleting `dist` and `.wrangler` ensures every deployment is 100% fresh.

## 5. Local Development

```bash
npm run dev
```

- Runs on `http://localhost:4321`.
- HttpOnly cookies work with `secure: false` auto-detection on localhost.
- KV binding is **not available** locally — `/api/known-aliases` gracefully returns empty data.

## 6. Verification

After deployment:

1. Check the project URL (e.g., `https://dashboard.vf9.club`).
2. Login should set HttpOnly cookies and redirect to the dashboard.
3. MQTT telemetry should connect within ~500ms of login.
