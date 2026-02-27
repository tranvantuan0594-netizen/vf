import crypto from "crypto";

/**
 * VFDashboard Vercel Backup Proxy
 *
 * Lightweight mirror of the main Cloudflare proxy for IP rotation.
 * Deployed on Vercel (AWS Lambda) = different egress IP range from Cloudflare.
 *
 * Usage from main app:
 *   fetch("https://vfdashboard-proxy.vercel.app/api/vf-proxy/ccarusermgnt/api/v1/user-vehicle", {
 *     method: "GET",
 *     headers: { Authorization: "Bearer <token>", "x-vin-code": "<VIN>" }
 *   })
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

function generateXHash(method, apiPath, vin, timestamp, secretKey) {
  const pathWithoutQuery = apiPath.split("?")[0];
  const normalizedPath = pathWithoutQuery.startsWith("/")
    ? pathWithoutQuery
    : "/" + pathWithoutQuery;

  const parts = [method, normalizedPath];
  if (vin) parts.push(vin);
  parts.push(secretKey);
  parts.push(String(timestamp));

  const message = parts.join("_").toLowerCase();
  const hmac = crypto.createHmac("sha256", secretKey);
  hmac.update(message);
  return hmac.digest("base64");
}

function generateXHash2({ platform, vinCode, identifier, path, method, timestamp }) {
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
  const hash2Key = "ConnectedCar@6521";
  const hmac = crypto.createHmac("sha256", hash2Key);
  hmac.update(message);
  return hmac.digest("base64");
}

// CORS headers for cross-origin requests from the main dashboard
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-vin-code, x-player-identifier",
  "Access-Control-Max-Age": "86400",
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  try {
    // Extract API path from URL: /api/vf-proxy/ccarusermgnt/... → ccarusermgnt/...
    const url = new URL(req.url, `https://${req.headers.host}`);
    const fullPath = url.pathname;
    const apiPath = fullPath.replace(/^\/api\/vf-proxy\//, "");

    if (!apiPath || apiPath === fullPath) {
      res.writeHead(400, { ...CORS_HEADERS, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing API path" }));
      return;
    }

    // Security: block path traversal and ensure target stays on VinFast domain
    if (apiPath.includes("..") || apiPath.includes("//") || apiPath.startsWith("/")) {
      res.writeHead(400, { ...CORS_HEADERS, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid API path" }));
      return;
    }

    // Security: only allow known VinFast API paths
    const isAllowed = ALLOWED_PATH_PREFIXES.some((p) => apiPath.startsWith(p));
    if (!isAllowed) {
      res.writeHead(403, { ...CORS_HEADERS, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Proxy path not allowed" }));
      return;
    }

    // Auth: require Bearer token from caller
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.writeHead(401, { ...CORS_HEADERS, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const vinHeader = req.headers["x-vin-code"] || null;
    const playerHeader = req.headers["x-player-identifier"] || null;

    // Read request body
    let requestBody = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      requestBody = Buffer.concat(chunks).toString();
    }

    // Build upstream headers
    const proxyHeaders = {
      ...API_HEADERS,
      Authorization: authHeader,
    };

    const requiresSigning = SIGNED_PATH_PREFIXES.some((p) => apiPath.startsWith(p));
    if (requiresSigning) {
      const secretKey = process.env.VINFAST_XHASH_SECRET || "Vinfast@2025";
      const timestamp = Date.now();
      const xTimestamp = String(timestamp);

      proxyHeaders["X-HASH"] = generateXHash(req.method, apiPath, vinHeader, timestamp, secretKey);
      proxyHeaders["X-HASH-2"] = generateXHash2({
        platform: "android",
        vinCode: vinHeader,
        identifier: API_HEADERS["X-Device-Identifier"],
        path: "/" + apiPath,
        method: req.method,
        timestamp: xTimestamp,
      });
      proxyHeaders["X-TIMESTAMP"] = xTimestamp;
    }

    if (vinHeader) proxyHeaders["X-Vin-Code"] = vinHeader;
    if (playerHeader) proxyHeaders["X-Player-Identifier"] = playerHeader;

    // Forward query string
    const searchStr = url.search || "";
    const targetUrl = `${API_BASE}/${apiPath}${searchStr}`;

    console.log(`[Vercel Proxy] → ${req.method} ${targetUrl}`);

    const fetchInit = { method: req.method, headers: proxyHeaders };
    if (requestBody) fetchInit.body = requestBody;

    const upstream = await fetch(targetUrl, fetchInit);
    const data = await upstream.text();

    console.log(`[Vercel Proxy] ← ${upstream.status} (${data.length} bytes)`);

    res.writeHead(upstream.status, {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    });
    res.end(data);
  } catch (e) {
    console.error("[Vercel Proxy Error]", e);
    res.writeHead(500, { ...CORS_HEADERS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal Proxy Error" }));
  }
}
