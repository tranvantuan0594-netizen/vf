/**
 * VFDashboard CF Worker Backup Proxy
 * Cloudflare Worker format (Fetch API) for IP rotation.
 */

const API_BASE = "https://mobile.connected-car.vinfast.vn";

const API_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "X-SERVICE-NAME": "CAPP",
  "X-APP-VERSION": "2.17.5",
  "X-Device-Platform": "android",
  "X-Device-Family": "SM-F946B",
  "X-Device-OS-Version": "android 14",
  "X-Device-Locale": "vi-VN",
  "X-Timezone": "Asia/Ho_Chi_Minh",
  "X-Device-Identifier": "vfdashboard-community-edition",
  "X-IMEI": "",
  "User-Agent": "android - vfdashboard-community-edition - 2.17.5",
};

const ALLOWED_PATH_PREFIXES = [
  "ccarusermgnt/api/v1/user-vehicle",
  "ccarusermgnt/api/v1/service-history",
  "ccarusermgnt/api/v1/service-appointments",
  "ccarbookingservice/api/v1/c-app/appointment/",
  "ccarbookingservice/api/v1/c-app/showroom/",
  "modelmgmt/api/v2/vehicle-model/",
  "ccaraccessmgmt/api/v1/telemetry/",
  "ccarcharging/api/v1/stations/",
  "ccarcharging/api/v1/charging-sessions/search",
];

const SIGNED_PATH_PREFIXES = ["ccaraccessmgmt/", "ccarcharging/"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-vin-code, x-player-identifier",
  "Access-Control-Max-Age": "86400",
};

async function hmacSHA256(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function generateXHash(method, apiPath, vin, timestamp, secretKey) {
  const pathWithoutQuery = apiPath.split("?")[0];
  const normalizedPath = pathWithoutQuery.startsWith("/") ? pathWithoutQuery : "/" + pathWithoutQuery;
  const parts = [method, normalizedPath];
  if (vin) parts.push(vin);
  parts.push(secretKey);
  parts.push(String(timestamp));
  const message = parts.join("_").toLowerCase();
  return hmacSHA256(secretKey, message);
}

async function generateXHash2({ platform, vinCode, identifier, path, method, timestamp }) {
  let normalizedPath = path;
  if (normalizedPath.startsWith("/")) normalizedPath = normalizedPath.substring(1);
  normalizedPath = normalizedPath.replace(/\//g, "_");
  const parts = [platform];
  if (vinCode) parts.push(vinCode);
  parts.push(identifier);
  parts.push(normalizedPath);
  parts.push(method);
  parts.push(String(timestamp));
  const message = parts.join("_").toLowerCase();
  return hmacSHA256("ConnectedCar@6521", message);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      const url = new URL(request.url);

      // Health check
      if (url.pathname === "/health") {
        return jsonResponse({ status: "ok", platform: "cloudflare-worker", timestamp: Date.now() });
      }

      // Auth proxy: forward Auth0 login/refresh from different IP
      if (url.pathname === "/api/vf-auth" && request.method === "POST") {
        return handleAuth(request);
      }

      // Extract API path: /api/vf-proxy/ccarusermgnt/... → ccarusermgnt/...
      const apiPath = url.pathname.replace(/^\/api\/vf-proxy\//, "");
      if (!apiPath || apiPath === url.pathname) {
        return jsonResponse({ error: "Missing API path" }, 400);
      }

      // Security: only allow known paths
      const isAllowed = ALLOWED_PATH_PREFIXES.some((p) => apiPath.startsWith(p));
      if (!isAllowed) {
        return jsonResponse({ error: "Proxy path not allowed" }, 403);
      }

      // Auth
      const authHeader = request.headers.get("authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const vinHeader = request.headers.get("x-vin-code") || null;
      const playerHeader = request.headers.get("x-player-identifier") || null;

      // Body
      let requestBody = null;
      if (request.method !== "GET" && request.method !== "HEAD") {
        requestBody = await request.text();
      }

      // Build upstream headers
      const proxyHeaders = { ...API_HEADERS, Authorization: authHeader };

      const requiresSigning = SIGNED_PATH_PREFIXES.some((p) => apiPath.startsWith(p));
      if (requiresSigning) {
        const secretKey = env.VINFAST_XHASH_SECRET || "Vinfast@2025";
        const timestamp = Date.now();
        const xTimestamp = String(timestamp);

        proxyHeaders["X-HASH"] = await generateXHash(request.method, apiPath, vinHeader, timestamp, secretKey);
        proxyHeaders["X-HASH-2"] = await generateXHash2({
          platform: "android",
          vinCode: vinHeader,
          identifier: API_HEADERS["X-Device-Identifier"],
          path: "/" + apiPath,
          method: request.method,
          timestamp: xTimestamp,
        });
        proxyHeaders["X-TIMESTAMP"] = xTimestamp;
      }

      if (vinHeader) proxyHeaders["X-Vin-Code"] = vinHeader;
      if (playerHeader) proxyHeaders["X-Player-Identifier"] = playerHeader;

      const searchStr = url.search || "";
      const targetUrl = `${API_BASE}/${apiPath}${searchStr}`;

      console.log(`[CF Worker Proxy] → ${request.method} ${targetUrl}`);

      const fetchInit = { method: request.method, headers: proxyHeaders };
      if (requestBody) fetchInit.body = requestBody;

      const upstream = await fetch(targetUrl, fetchInit);
      const data = await upstream.text();

      console.log(`[CF Worker Proxy] ← ${upstream.status} (${data.length} bytes)`);

      return new Response(data, {
        status: upstream.status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    } catch (e) {
      console.error("[CF Worker Proxy Error]", e);
      return jsonResponse({ error: "Internal Proxy Error" }, 500);
    }
  },
};

const AUTH_REGIONS = {
  vn: {
    auth0_domain: "vin3s.au.auth0.com",
    auth0_client_id: "jE5xt50qC7oIh1f32qMzA6hGznIU5mgH",
    auth0_audience: "https://mobile.connected-car.vinfast.vn",
  },
};

async function handleAuth(request) {
  try {
    const body = await request.json();
    const { action, email, password, region, refreshToken } = body;
    const rc = AUTH_REGIONS[region || "vn"] || AUTH_REGIONS["vn"];

    if (!action || !["login", "refresh"].includes(action)) {
      return jsonResponse({ error: "Invalid action" }, 400);
    }

    const url = `https://${rc.auth0_domain}/oauth/token`;
    let payload;

    if (action === "login") {
      if (!email || !password) return jsonResponse({ error: "Missing credentials" }, 400);
      payload = {
        client_id: rc.auth0_client_id,
        audience: rc.auth0_audience,
        grant_type: "password",
        scope: "offline_access openid profile email",
        username: email,
        password,
      };
    } else {
      if (!refreshToken) return jsonResponse({ error: "Missing refreshToken" }, 400);
      payload = {
        client_id: rc.auth0_client_id,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      };
    }

    console.log(`[CF Worker Auth] → ${action} via ${rc.auth0_domain}`);
    const auth0Res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await auth0Res.text();
    console.log(`[CF Worker Auth] ← ${auth0Res.status} (${data.length} bytes)`);

    return new Response(data, {
      status: auth0Res.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[CF Worker Auth Error]", e);
    return jsonResponse({ error: "Internal Auth Proxy Error" }, 500);
  }
}
