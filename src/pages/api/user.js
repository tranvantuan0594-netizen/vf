export const prerender = false;

import { REGIONS, DEFAULT_REGION } from "../../config/vinfast";

export const GET = async ({ request, cookies }) => {
  try {
    const urlObj = new URL(request.url);
    const region = urlObj.searchParams.get("region") || DEFAULT_REGION;
    const regionConfig = REGIONS[region] || REGIONS[DEFAULT_REGION];

    const accessToken = cookies.get("access_token")?.value;

    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = `https://${regionConfig.auth0_domain}/userinfo`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    // If Auth0 returns non-OK (expired token, etc.), pass through the status code
    // so client-side _fetchWithRetry can detect 401 and trigger token refresh.
    if (!response.ok) {
      let errorBody;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = { error: `Auth0 returned ${response.status}` };
      }
      return new Response(JSON.stringify(errorBody), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const filtered = {
      name: data.name,
      nickname: data.nickname,
      picture: data.picture,
      email: data.email,
      sub: data.sub,
    };

    return new Response(JSON.stringify(filtered), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || "Internal Server Error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
