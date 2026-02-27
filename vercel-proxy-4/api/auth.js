/**
 * Auth proxy endpoint — forwards Auth0 login/refresh from a different IP.
 * Main login.js calls this when Auth0 returns 429 from CF Pages IP.
 *
 * POST /api/vf-auth
 * Body: { action: "login"|"refresh", email, password, region, refreshToken }
 * Returns: Auth0 response (tokens or error)
 */

const REGIONS = {
  vn: {
    auth0_domain: "vin3s.au.auth0.com",
    auth0_client_id: "jE5xt50qC7oIh1f32qMzA6hGznIU5mgH",
    auth0_audience: "https://mobile.connected-car.vinfast.vn",
  },
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { ...CORS_HEADERS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    // Read body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());

    const { action, email, password, region, refreshToken } = body;
    const regionConfig = REGIONS[region || "vn"] || REGIONS["vn"];

    if (!action || !["login", "refresh"].includes(action)) {
      res.writeHead(400, { ...CORS_HEADERS, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid action" }));
      return;
    }

    const url = `https://${regionConfig.auth0_domain}/oauth/token`;
    let payload;

    if (action === "login") {
      if (!email || !password) {
        res.writeHead(400, { ...CORS_HEADERS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing email or password" }));
        return;
      }
      payload = {
        client_id: regionConfig.auth0_client_id,
        audience: regionConfig.auth0_audience,
        grant_type: "password",
        scope: "offline_access openid profile email",
        username: email,
        password,
      };
    } else {
      // refresh
      if (!refreshToken) {
        res.writeHead(400, { ...CORS_HEADERS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing refreshToken" }));
        return;
      }
      payload = {
        client_id: regionConfig.auth0_client_id,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      };
    }

    console.log(`[Auth Proxy] → ${action} via ${regionConfig.auth0_domain}`);

    const auth0Response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await auth0Response.text();
    console.log(`[Auth Proxy] ← ${auth0Response.status} (${data.length} bytes)`);

    res.writeHead(auth0Response.status, {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    });
    res.end(data);
  } catch (e) {
    console.error("[Auth Proxy Error]", e);
    res.writeHead(500, { ...CORS_HEADERS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal Auth Proxy Error" }));
  }
}
