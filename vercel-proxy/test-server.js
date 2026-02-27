/**
 * Local test server for the Vercel backup proxy.
 * Usage: node test-server.js
 * Mimics Vercel's serverless function interface (req, res) using Node http module.
 */
import http from "http";
import handler from "./api/proxy.js";
import healthHandler from "./api/health.js";

const PORT = 3001;

const server = http.createServer(async (req, res) => {
  // Route matching (mirrors vercel.json)
  if (req.url === "/health") {
    return healthHandler(req, res);
  }

  if (req.url.startsWith("/api/vf-proxy/")) {
    return handler(req, res);
  }

  // 404 for everything else
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(PORT, () => {
  console.log(`[Test Server] Vercel backup proxy running at http://localhost:${PORT}`);
  console.log(`[Test Server] Health: http://localhost:${PORT}/health`);
  console.log(`[Test Server] Proxy:  http://localhost:${PORT}/api/vf-proxy/<path>`);
});
