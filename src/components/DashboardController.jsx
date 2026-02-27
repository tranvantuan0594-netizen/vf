import { useEffect, useRef } from "react";
import { api } from "../services/api";
import {
  fetchUser,
  fetchVehicles,
  vehicleStore,
  updateFromMqtt,
} from "../stores/vehicleStore";
import { fetchChargingSessions } from "../stores/chargingHistoryStore";
import { getMqttClient, destroyMqttClient } from "../services/mqttClient";
import { mqttStore } from "../stores/mqttStore";
import { CORE_TELEMETRY_ALIASES } from "../config/vinfast";
import staticAliasMap from "../config/static_alias_map.json";

export default function DashboardController({ vin: initialVin }) {
  const isMounted = useRef(true);
  const firstMqttMessageAt = useRef(null);

  // Init Effect
  useEffect(() => {
    isMounted.current = true;
    firstMqttMessageAt.current = null;

    // Set MQTT callbacks EARLY — before fetchVehicles which triggers
    // switchVehicle → switchVin → connect(). Without this, MQTT connects
    // but onTelemetryUpdate is null so messages are ignored.
    const mqttClient = getMqttClient();
    mqttClient.onTelemetryUpdate = (mqttVin, parsed, rawMessages) => {
      if (!isMounted.current) return;

      // Measure time-to-first-data for diagnostics
      if (!firstMqttMessageAt.current) {
        firstMqttMessageAt.current = performance.now();
        const connectedAt = mqttClient._connectedAt || 0;
        const delta = connectedAt ? (firstMqttMessageAt.current - connectedAt).toFixed(0) : "?";
        console.log(
          `%c[MQTT Perf] First data for ${mqttVin} in ${delta}ms after connect`,
          "color:#22c55e;font-weight:bold",
        );
      }

      updateFromMqtt(mqttVin, parsed, rawMessages);
    };
    mqttClient.onConnected = (connectedVin) => {
      if (!isMounted.current) return;

      // Record connect time for perf measurement
      mqttClient._connectedAt = performance.now();

      // Register core aliases to trigger T-Box data push (1 API call)
      const coreResources = buildCoreResources();
      const regStart = performance.now();
      api.registerResources(connectedVin, coreResources).then(() => {
        const ms = (performance.now() - regStart).toFixed(0);
        console.log(
          `%c[Register] Done in ${ms}ms (${coreResources.length} aliases)`,
          "color:#3b82f6;font-weight:bold",
        );
      });
    };

    const init = async () => {
      let targetVin = initialVin || vehicleStore.get().vin;

      // Sequential: fetchVehicles handles 401 → token refresh.
      // fetchUser runs after so it uses the refreshed token.
      if (!targetVin) {
        // fetchVehicles calls switchVehicle → switchVin → connect (MQTT starts here)
        targetVin = await fetchVehicles();
        if (!isMounted.current) return;
      }

      // fetchUser after vehicles — token is guaranteed fresh
      await fetchUser();
      if (!isMounted.current) return;

      if (targetVin) {
        // Preload full charging history for dashboard stats.
        void fetchChargingSessions(targetVin);
      }

      // If still no VIN or failed to fetch, redirect to login
      if (!targetVin && isMounted.current) {
        console.warn(
          "No vehicle found or init failed. Clearing session and redirecting.",
        );
        api.clearSession();
        window.location.href = "/login";
        return;
      }

      // Mark as initialized — we have a valid VIN and user.
      // MQTT will fill in live telemetry data progressively.
      if (!vehicleStore.get().isInitialized) {
        vehicleStore.setKey("isInitialized", true);
      }

      // Start MQTT if not already started by switchVehicle
      if (targetVin && isMounted.current) {
        const mqttState = mqttStore.get();

        const shouldStartMqtt =
          mqttClient.vin !== targetVin ||
          (mqttState.status !== "connected" && mqttState.status !== "connecting");

        if (shouldStartMqtt) {
          mqttClient.connect(targetVin);
        }
      }
    };

    init();

    return () => {
      isMounted.current = false;
      destroyMqttClient();
    };
  }, [initialVin]);

  // No REST polling — all telemetry comes from MQTT.

  return null; // Headless
}

/**
 * Build core resource list for list_resource registration.
 * Maps ~40 CORE_TELEMETRY_ALIASES → {objectId, instanceId, resourceId}
 * using static_alias_map.json. Single API call triggers T-Box data push.
 */
function buildCoreResources() {
  const resources = [];
  CORE_TELEMETRY_ALIASES.forEach((alias) => {
    const m = staticAliasMap[alias];
    if (m) {
      resources.push({
        objectId: m.objectId,
        instanceId: m.instanceId,
        resourceId: m.resourceId,
      });
    }
  });
  return resources;
}
