import staticAliasMap from "./static_alias_map.json";

export const DEFAULT_REGION = "vn";

export const REGIONS = {
  us: {
    name: "United States",
    auth0_domain: "vinfast-us-prod.us.auth0.com",
    auth0_client_id: "xhGY7XKDFSk1Q22rxidvwujfz0EPAbUP",
    auth0_audience: "https://vinfast-us-prod.us.auth0.com/api/v2/",
    api_base: "https://mobile.connected-car.vinfastauto.us",
  },
  eu: {
    name: "Europe",
    auth0_domain: "vinfast-eu-prod.eu.auth0.com",
    auth0_client_id: "dxxtNkkhsPWW78x6s1BWQlmuCfLQrkze",
    auth0_audience: "https://vinfast-eu-prod.eu.auth0.com/api/v2/",
    api_base: "https://mobile.connected-car.vinfastauto.eu",
  },
  vn: {
    name: "Vietnam",
    auth0_domain: "vin3s.au.auth0.com",
    auth0_client_id: "jE5xt50qC7oIh1f32qMzA6hGznIU5mgH",
    auth0_audience: "https://vin3s.au.auth0.com/api/v2/",
    api_base: "https://mobile.connected-car.vinfast.vn",
  },
};

export const API_HEADERS = {
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

/**
 * Core telemetry aliases — registered once on MQTT connect to trigger
 * T-Box data push for dashboard essentials (battery, doors, speed, location).
 * Single API call (~40 aliases). Heavy tiered registration removed.
 */
export const CORE_TELEMETRY_ALIASES = [
  "VEHICLE_STATUS_HV_BATTERY_SOC",
  "VEHICLE_STATUS_LV_BATTERY_SOC",
  "VEHICLE_STATUS_REMAINING_DISTANCE",
  "VEHICLE_STATUS_ODOMETER",
  "CHARGING_STATUS_CHARGING_STATUS",
  "CHARGING_STATUS_CHARGING_REMAINING_TIME",
  "CHARGE_CONTROL_CURRENT_TARGET_SOC",
  "VEHICLE_STATUS_IGNITION_STATUS",
  "VEHICLE_STATUS_GEAR_POSITION",
  "VEHICLE_STATUS_VEHICLE_SPEED",
  "VEHICLE_STATUS_HANDBRAKE_STATUS",
  "VEHICLE_STATUS_AMBIENT_TEMPERATURE",
  "CLIMATE_INFORMATION_DRIVER_TEMPERATURE",
  "VEHICLE_STATUS_FRONT_LEFT_TIRE_PRESSURE",
  "VEHICLE_STATUS_FRONT_RIGHT_TIRE_PRESSURE",
  "VEHICLE_STATUS_REAR_LEFT_TIRE_PRESSURE",
  "VEHICLE_STATUS_REAR_RIGHT_TIRE_PRESSURE",
  "DOOR_AJAR_FRONT_LEFT_DOOR_STATUS",
  "DOOR_AJAR_FRONT_RIGHT_DOOR_STATUS",
  "DOOR_AJAR_REAR_LEFT_DOOR_STATUS",
  "DOOR_AJAR_REAR_RIGHT_DOOR_STATUS",
  "DOOR_TRUNK_DOOR_STATUS",
  "REMOTE_CONTROL_DOOR_STATUS",
  "REMOTE_CONTROL_BONNET_CONTROL_STATUS",
  "REMOTE_CONTROL_WINDOW_STATUS",
  "REMOTE_CONTROL_CHARGE_PORT_STATUS",
  "VEHICLE_STATUS_FRONT_LEFT_TIRE_TEMPERATURE",
  "VEHICLE_STATUS_FRONT_RIGHT_TIRE_TEMPERATURE",
  "VEHICLE_STATUS_REAR_LEFT_TIRE_TEMPERATURE",
  "VEHICLE_STATUS_REAR_RIGHT_TIRE_TEMPERATURE",
  "PET_MODE_CONTROL_STATUS",
  "CAMP_MODE_CONTROL_STATUS",
  "VEHICLE_STATUS_LOCK_STATUS",
  "CLIMATE_INFORMATION_PASSENGER_TEMPERATURE",
  "CLIMATE_INFORMATION_DRIVER_AIR_BLOW_LEVEL",
  "LOCATION_LATITUDE",
  "LOCATION_LONGITUDE",
  "VEHICLE_BEARING_DEGREE",
  "BMS_STATUS_STATE_OF_HEALTH",
  "BMS_STATUS_NOMINAL_CAPACITY_OF_THE_BATTERY_PACK",
  "BMS_STATUS_BATTERY_TYPE",
  "BMS_STATUS_BATTERY_SERIAL_NUMBER",
  "BMS_STATUS_BATTERY_DECODED_MANUFACTURE_DATE",
  "VINFAST_VEHICLE_IDENTIFIER_VEHICLE_MANUFACTURER",
  "FIRMWARE_UPDATE_CURRENT_PKG_VERSION",
  "VERSION_INFO_TBOX_SOFTWARE_VERSION",
  "BMS_STATUS_THERMAL_RUNAWAY_WARNING",
  "CCARSERVICE_OBJECT_BOOKING_SERVICE_STATUS",
];

// MQTT Configuration (from APK local-configuration.json)
export const MQTT_CONFIG = {
  vn: {
    endpoint: "prod.iot.connected-car.vinfast.vn",
    region: "ap-southeast-1",
    cognitoPoolId: "ap-southeast-1:c6537cdf-92dd-4b1f-99a8-9826f153142a",
    cognitoLoginProvider: "vin3s.au.auth0.com",
    heartbeatInterval: 120000, // 2 minutes
    keepAlive: 300, // seconds
  },
};

// DEEP_SCAN_CONFIG removed — list_resource registration no longer used.
// MQTT delivers telemetry data without explicit resource registration.

/**
 * Backup proxy endpoints for IP rotation / failover.
 * When the primary Cloudflare proxy gets 429 from VinFast,
 * the client falls back to these alternative proxies (different egress IPs).
 *
 * Each entry: { baseUrl, pathPrefix }
 * - baseUrl: The proxy host URL
 * - pathPrefix: Path prefix for the proxy endpoint
 *
 * To deploy a Vercel backup proxy, see /vercel-proxy/README.md
 * Set VITE_BACKUP_PROXY_URL env var to enable.
 */
export const BACKUP_PROXIES = (() => {
  const proxies = [];
  // Support VITE_BACKUP_PROXY_URL env var (set at build time or in .env)
  const vercelUrl =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_BACKUP_PROXY_URL;
  if (vercelUrl) {
    proxies.push({
      baseUrl: vercelUrl.replace(/\/$/, ""),
      pathPrefix: "/api/vf-proxy",
    });
  }
  return proxies;
})();

export const STATIC_ALIAS_MAP_EXPORT = staticAliasMap;
