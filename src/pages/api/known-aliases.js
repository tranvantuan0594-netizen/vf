export const prerender = false;

/**
 * KV-backed Known-Good Aliases Endpoint
 *
 * GET  /api/known-aliases?model=VF9&year=2024  → Read known-good aliases from KV
 * POST /api/known-aliases                       → Merge new aliases into KV
 *
 * KV key:   known-aliases:{model}:{year} (normalized lowercase, strip spaces)
 * KV value: { aliases: [{objectId, instanceId, resourceId, alias}], discoveredBy, lastUpdated }
 * TTL:      30 days
 */

const KV_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function normalizeKey(model, year) {
  const m = String(model || "unknown").toLowerCase().replace(/\s+/g, "");
  const y = String(year || "unknown").toLowerCase();
  return `known-aliases:${m}:${y}`;
}

function deduplicateAliases(aliases) {
  const seen = new Set();
  return aliases.filter((a) => {
    const key = `${a.objectId}|${a.instanceId}|${a.resourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const GET = async ({ request, locals }) => {
  try {
    const url = new URL(request.url);
    const model = url.searchParams.get("model");
    const year = url.searchParams.get("year");

    if (!model) {
      return new Response(JSON.stringify({ error: "model is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const kv = locals?.runtime?.env?.VFDashboard;
    if (!kv) {
      return new Response(JSON.stringify({ aliases: [], source: "no-kv" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const key = normalizeKey(model, year);
    const raw = await kv.get(key, "json");

    if (!raw || !Array.isArray(raw.aliases)) {
      return new Response(JSON.stringify({ aliases: [], source: "cache-miss" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        aliases: raw.aliases,
        lastUpdated: raw.lastUpdated,
        discoveredBy: raw.discoveredBy,
        source: "kv",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("GET /api/known-aliases error:", e);
    return new Response(JSON.stringify({ aliases: [], error: e.message }), {
      status: 200, // Graceful fallback
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const POST = async ({ request, cookies, locals }) => {
  try {
    // Verify authentication via cookie
    const accessToken = cookies.get("access_token")?.value;
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await request.json();
    const { model, year, aliases } = body;

    if (!model || !Array.isArray(aliases) || aliases.length === 0) {
      return new Response(
        JSON.stringify({ error: "model and aliases[] are required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const kv = locals?.runtime?.env?.VFDashboard;
    if (!kv) {
      return new Response(JSON.stringify({ error: "KV not available" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    const key = normalizeKey(model, year);

    // Read existing
    const existing = (await kv.get(key, "json")) || { aliases: [] };
    const existingAliases = Array.isArray(existing.aliases)
      ? existing.aliases
      : [];

    // Merge: additive only, dedup by objectId|instanceId|resourceId
    const validNew = aliases
      .filter((a) => a.objectId && a.resourceId)
      .map((a) => ({
        objectId: String(a.objectId),
        instanceId: String(a.instanceId || "0"),
        resourceId: String(a.resourceId),
        alias: a.alias || "",
      }));

    const merged = deduplicateAliases([...existingAliases, ...validNew]);

    const payload = {
      aliases: merged,
      discoveredBy: body.discoveredBy || "anonymous",
      lastUpdated: Date.now(),
    };

    await kv.put(key, JSON.stringify(payload), {
      expirationTtl: KV_TTL_SECONDS,
    });

    return new Response(
      JSON.stringify({
        success: true,
        count: merged.length,
        added: merged.length - existingAliases.length,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("POST /api/known-aliases error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
