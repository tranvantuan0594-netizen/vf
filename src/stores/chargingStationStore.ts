import { map } from "nanostores";
import { api } from "../services/api";

export interface ChargingStation {
  stationId: string;
  stationName: string;
  address: string;
  latitude: number;
  longitude: number;
  totalConnectors: number;
  availableConnectors: number;
  connectorTypes: string[];
  maxPower: number;
  distance: number;
}

interface ChargingStationState {
  stations: ChargingStation[];
  isLoading: boolean;
  error: string | null;
  lastFetchLat: number | null;
  lastFetchLng: number | null;
  lastFetchTime: number;
  showStations: boolean;
  filterConnectorType: string; // "" = all, "CCS2", "CHAdeMO", etc.
  filterOnlyAvailable: boolean;
}

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const REFETCH_DISTANCE_KM = 5;

export const chargingStationStore = map<ChargingStationState>({
  stations: [],
  isLoading: false,
  error: null,
  lastFetchLat: null,
  lastFetchLng: null,
  lastFetchTime: 0,
  showStations: true,
  filterConnectorType: "",
  filterOnlyAvailable: false,
});

function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function fetchChargingStations(
  lat: number,
  lng: number,
  force = false,
) {
  const state = chargingStationStore.get();

  // Check cache validity
  if (!force && state.lastFetchTime > 0) {
    const elapsed = Date.now() - state.lastFetchTime;
    if (elapsed < CACHE_TTL) {
      // Check if vehicle moved significantly
      if (state.lastFetchLat && state.lastFetchLng) {
        const dist = haversineDistance(
          lat,
          lng,
          state.lastFetchLat,
          state.lastFetchLng,
        );
        if (dist < REFETCH_DISTANCE_KM) return;
      } else {
        return;
      }
    }
  }

  chargingStationStore.setKey("isLoading", true);
  chargingStationStore.setKey("error", null);

  try {
    const result = await api.searchChargingStations(lat, lng);
    const stations = result.content || result || [];

    chargingStationStore.set({
      ...chargingStationStore.get(),
      stations,
      isLoading: false,
      error: null,
      lastFetchLat: lat,
      lastFetchLng: lng,
      lastFetchTime: Date.now(),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to fetch stations";
    console.error("Charging station fetch failed:", msg);
    chargingStationStore.setKey("isLoading", false);
    chargingStationStore.setKey("error", msg);
  }
}

export function toggleStations() {
  const current = chargingStationStore.get().showStations;
  chargingStationStore.setKey("showStations", !current);
}

export function setConnectorFilter(type: string) {
  chargingStationStore.setKey("filterConnectorType", type);
}

export function setAvailabilityFilter(onlyAvailable: boolean) {
  chargingStationStore.setKey("filterOnlyAvailable", onlyAvailable);
}

export function getFilteredStations(): ChargingStation[] {
  const state = chargingStationStore.get();
  if (!state.showStations) return [];

  let filtered = state.stations;

  if (state.filterConnectorType) {
    filtered = filtered.filter(
      (s) =>
        s.connectorTypes &&
        s.connectorTypes.includes(state.filterConnectorType),
    );
  }

  if (state.filterOnlyAvailable) {
    filtered = filtered.filter((s) => s.availableConnectors > 0);
  }

  return filtered;
}
