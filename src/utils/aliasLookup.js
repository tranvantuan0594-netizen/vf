/**
 * Alias Lookup & Humanization Utilities
 *
 * 1. Reverse-map: deviceKey (objectId_instanceId_resourceId) → alias name
 *    using static_alias_map.json
 * 2. humanizeAlias: convert UPPER_SNAKE alias string → readable label
 *    e.g. "ECUS_INFORMATION_HEAD_UNIT_SOFTWARE_VERSION" → "Head Unit Software Version"
 */

import staticAliasMap from "../config/static_alias_map.json";

// ── Reverse Lookup ──────────────────────────────────────────────────
// Build once: { "34180_1_1": "VINFAST_VEHICLE_IDENTIFIER_VIN_NUMBER", ... }
let _reverseMap = null;

function buildReverseMap() {
  if (_reverseMap) return _reverseMap;
  _reverseMap = {};
  for (const [alias, ids] of Object.entries(staticAliasMap)) {
    const key = `${ids.objectId}_${ids.instanceId}_${ids.resourceId}`;
    // First alias wins (no overwrites) — keeps more specific entries
    if (!_reverseMap[key]) {
      _reverseMap[key] = alias;
    }
  }
  return _reverseMap;
}

/**
 * Look up alias name from a deviceKey like "34180_1_1"
 * @param {string} deviceKey - "objectId_instanceId_resourceId"
 * @returns {string|null} alias name or null
 */
export function lookupAliasByDeviceKey(deviceKey) {
  if (!deviceKey) return null;
  const map = buildReverseMap();

  // Try exact match first
  if (map[deviceKey]) return map[deviceKey];

  // Normalize: strip leading zeros, parse ints
  const parts = deviceKey.split("_");
  if (parts.length < 3) return null;
  const normalized = `${parseInt(parts[0], 10)}_${parseInt(parts[1], 10)}_${parseInt(parts[2], 10)}`;
  return map[normalized] || null;
}

// ── Prefix stripping (longest-first order) ──────────────────────────
const STRIP_PREFIXES = [
  // Very specific multi-part prefixes
  "VINFAST_VEHICLE_MASTER_INFO_",
  "VINFAST_VEHICLE_IDENTIFIER_",
  "NETWORK_ACCESS_DEVICE_INFO_",
  "TBOX_MANUAL_SOFTWARE_UPDATE_INFO_",
  "ASSUARANCE_SERVICE_DATA_",
  "TELEMATICS_LOG_RECORD_UPLINK_",
  "TELEMATICS_LOG_RECORD_",
  "REALTIME_BUS_MONITORING_NULL_",
  "REALTIME_BUS_MONITORING_",
  "DRIVING_STATISTICS_REPORT_",
  "VEHICLE_CRASH_STATUS_",
  "TELLTALES_NOTIFICATION_",
  "CYBERSECURITY_INFO_",
  "TBOX_RUNTIME_INFO_",
  "VISION_SNAPSHOT_",
  "SEAT_BELT_STATUS_",
  "TRIPS_INFORMATION_",
  "CLIMATE_INFORMATION_",
  "CLIMATE_SCHEDULE_",
  "CLIMATE_CONTROL_",
  "CHARGING_STATUS_",
  "CHARGE_CONTROL_",
  "FIRMWARE_UPDATE_",
  "ECUS_INFORMATION_",
  "VEHICLE_WARNINGS_",
  "VEHICLE_STATUS_",
  "REMOTE_CONTROL_",
  "REMOTE_DIAGNOCTICS_",
  "DRIVER_ASSISTANCE_",
  "PNC_INFORMATION_",
  "CCARSERVICE_OBJECT_",
  "DATABASE_EXCHANGE_",
  "NETWORK_ACCESS_",
  "VINFAST_ECU_",
  "ADAS_REMOTE_CONTROL_",
  "ADAS_RP_INFORMATION_",
  "ADAS_SUMMON_INFORMATION_",
  "ADAS_USAGE_INFORMATION_",
  "DOOR_AJAR_",
  "DOOR_BONNET_",
  "DOOR_TRUNK_",
  "BMS_STATUS_",
  "BATTERY_LEASING_INFO_",
  "CAMP_MODE_CONTROL_",
  "PET_MODE_CONTROL_",
  "VALET_MODE_CONTROL_",
  "SENTRY_MODE_CONTROL_",
  "IMMOBILIZATION_AWS_",
  "IMMOBILIZATION_",
  "INTRUSION_",
  "DTCS_RECORD_",
  "ISA_MAP_",
  "MHU_ACCESS_",
  "CAPP_PAIRING_INFO_",
  "CAPP_PAIRING_",
  "FOTA_COMMAND_",
  "ECALL_INFO_",
  "ESYNC_PROVISION_",
  "DATA_PRIVACY_",
  "VERSION_INFO_",
  "WINDOW_AJAR_",
  "WINDOW_SUNROOF_",
  "WINDOW_SUNSHADE_",
  "WINDOW_",
  "LIGHT_",
  "LOCATION_",
  "REALTIME_BUS_",
];

// ── Abbreviations to keep uppercase ─────────────────────────────────
const KEEP_UPPER = new Set([
  "SOC", "SOH", "HV", "LV", "BMS", "TPMS", "GPS", "VCU", "BCM",
  "ECU", "MHU", "ACM", "XGW", "ETG", "ABS", "ESP", "EBD", "DRL",
  "VIN", "ADAS", "OTA", "USB", "AC", "DC", "HVAC", "LED", "OBD",
  "PNC", "DTC", "DTCS", "ICCID", "IMEI", "RSA", "MSD", "GNSS",
  "JSON", "PKG", "SW", "HW", "ID", "UID", "IP", "URL", "API",
  "AWS", "SUL", "ISO", "CAN", "LIN", "MCU", "SPI", "UART",
  "PWM", "ADC", "DAC", "ROM", "RAM", "CPU", "DSM", "EPB",
  "ESC", "TCS", "ACC", "AEB", "LKA", "LDW", "BSM", "RPA",
  "NFC", "OBC", "PDC", "USS", "ISA", "TBOX", "EV", "RP",
]);

/**
 * Convert a VinFast telemetry alias string to a human-readable label.
 *
 * @example
 *   humanizeAlias("ECUS_INFORMATION_HEAD_UNIT_SOFTWARE_VERSION")
 *   // → "Head Unit Software Version"
 *
 *   humanizeAlias("BMS_STATUS_PACK_TEMPERATURE")
 *   // → "Pack Temperature"
 *
 *   humanizeAlias("VEHICLE_STATUS_HV_BATTERY_SOC")
 *   // → "HV Battery SOC"
 *
 * @param {string} alias - Raw telemetry alias string
 * @returns {string|null} human-readable label or null
 */
export function humanizeAlias(alias) {
  if (!alias) return null;

  let remainder = alias;

  // Strip known prefix (longest match first)
  for (const prefix of STRIP_PREFIXES) {
    if (remainder.startsWith(prefix)) {
      remainder = remainder.slice(prefix.length);
      break;
    }
  }

  // If stripping left nothing meaningful, use original
  if (!remainder || remainder.length < 2) {
    remainder = alias;
  }

  // Split by underscore, title-case each word
  const words = remainder
    .split("_")
    .filter(Boolean)
    .map((word) => {
      const upper = word.toUpperCase();
      if (KEEP_UPPER.has(upper)) return upper;
      // NON_VFE34 → Non VFE34
      if (/^\d+$/.test(word)) return word; // Pure numbers stay as-is
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });

  return words.join(" ");
}
