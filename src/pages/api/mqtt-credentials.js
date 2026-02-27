export const prerender = false;

import { MQTT_CONFIG, DEFAULT_REGION, REGIONS } from "../../config/vinfast";
import { API_HEADERS } from "../../config/vinfast";

const COGNITO_API_VERSION = "1.1";

async function cognitoRequest(region, target, body) {
  const url = `https://cognito-identity.${region}.amazonaws.com/`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-" + COGNITO_API_VERSION,
      "X-Amz-Target": `AWSCognitoIdentityService.${target}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cognito ${target} failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

export const GET = async ({ cookies }) => {
  const accessToken = cookies.get("access_token")?.value;
  if (!accessToken) {
    return new Response(JSON.stringify({ error: "Not logged in" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const regionKey = cookies.get("vf_region")?.value || DEFAULT_REGION;
  const mqttConfig = MQTT_CONFIG[regionKey] || MQTT_CONFIG.vn;
  const regionConfig = REGIONS[regionKey] || REGIONS[DEFAULT_REGION];

  try {
    // Step 1: GetId — exchange Auth0 token for Cognito Identity ID
    const loginProvider = mqttConfig.cognitoLoginProvider || regionConfig.auth0_domain;
    const logins = { [loginProvider]: accessToken };

    const getIdResult = await cognitoRequest(mqttConfig.region, "GetId", {
      IdentityPoolId: mqttConfig.cognitoPoolId,
      Logins: logins,
    });

    const identityId = getIdResult.IdentityId;
    if (!identityId) {
      throw new Error("No IdentityId returned from Cognito GetId");
    }

    // Step 2: GetCredentialsForIdentity — get temporary AWS credentials
    const credsResult = await cognitoRequest(mqttConfig.region, "GetCredentialsForIdentity", {
      IdentityId: identityId,
      Logins: logins,
    });

    const creds = credsResult.Credentials;
    if (!creds) {
      throw new Error("No Credentials returned from Cognito");
    }

    // Attach policy for the identity so IoT permissions are granted before MQTT connect
    const attachPolicyResult = await attachPolicy(
      regionConfig,
      accessToken,
      identityId,
    );

    if (!attachPolicyResult.attached) {
      return new Response(
        JSON.stringify({
          error: "MQTT policy attachment failed",
          status: 412,
          policyAttached: false,
          policyMessage: attachPolicyResult.message,
          identityId,
          endpoint: mqttConfig.endpoint,
          region: mqttConfig.region,
        }),
        {
          status: 412,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({
      accessKeyId: creds.AccessKeyId,
      secretAccessKey: creds.SecretKey,
      sessionToken: creds.SessionToken,
      expiration: creds.Expiration,
      identityId,
      policyAttached: attachPolicyResult.attached,
      policyMessage: attachPolicyResult.message,
      endpoint: mqttConfig.endpoint,
      region: mqttConfig.region,
    }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, max-age=0",
        "Pragma": "no-cache",
        Expires: "0",
      },
    });
  } catch (e) {
    console.error("[mqtt-credentials] Error:", e.message);

    const status = e.message.includes("401") || e.message.includes("NotAuthorized") ? 401 : 500;
    return new Response(JSON.stringify({ error: e.message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
};

async function attachPolicy(regionConfig, accessToken, identityId) {
  if (!identityId) {
    return { attached: false, message: "identityId missing" };
  }

  const attachPolicyUrl = `${regionConfig.api_base}/ccarusermgnt/api/v1/user-vehicle/attach-policy`;
  const body = { target: identityId };

  try {
    const response = await fetch(attachPolicyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "x-service-name": API_HEADERS["X-SERVICE-NAME"] || "CAPP",
        "x-app-version": API_HEADERS["X-APP-VERSION"] || "2.17.5",
        "x-device-platform": API_HEADERS["X-Device-Platform"] || "android",
        "x-device-identifier": API_HEADERS["X-Device-Identifier"] || "",
        "x-timezone": API_HEADERS["X-Timezone"] || "Asia/Ho_Chi_Minh",
        "x-device-locale": API_HEADERS["X-Device-Locale"] || "vi-VN",
        Accept: API_HEADERS.Accept || "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      return {
        attached: false,
        message: `attach-policy failed (${response.status}): ${text || "no body"}`,
      };
    }

    const code = Number(payload?.code);
    if (Number.isFinite(code) && code !== 200000) {
      return {
        attached: false,
        message: `attach-policy returned code ${code}: ${payload?.message || "unrecognized response"}`,
      };
    }

    return {
      attached: true,
      message: payload?.message || text || "ok",
    };
  } catch (e) {
    return { attached: false, message: `attach-policy error: ${e.message}` };
  }
}
