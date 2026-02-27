import { map } from "nanostores";
import { api } from "../services/api";

// --- Types (from Charles capture of real API response) ---

export interface ChargingItem {
  cost: number;
  name: string;
  price: number; // per kWh
  from: number; // epoch ms
  to: number; // epoch ms
  unit: string; // "/Kwh"
  energy: number; // kWh
}

export interface ChargingPromotion {
  name: string;
  description: string;
  discount: number;
}

export interface ChargingSession {
  id: string;
  vehicleId: string;
  pluggedTime: number; // epoch ms
  startChargeTime: number; // epoch ms
  endChargeTime: number; // epoch ms
  unpluggedTime: number; // epoch ms
  chargingStationName: string;
  chargingStationAddress: string;
  province: string;
  district: string;
  locationId: string;
  connectorId?: string;
  evseId?: string;
  customerId: string;
  items: ChargingItem[];
  totalKWCharged: string; // e.g. "42.95"
  amount: number; // original cost (VND)
  finalAmount: number; // after discount
  discount: number;
  promotions: ChargingPromotion[];
  orderStatus: number; // 3=completed, 5=?, 7=?
  originStatus: number;
  status: string; // "COMPLETED"
  createdDate: number;
}

// Filter mode: "all" | "year" | "month"
export type FilterMode = "all" | "year" | "month";

interface MonthEntry {
  year: number;
  month: number; // 1-12
  label: string; // "T1/2025"
}

interface ChargingHistoryState {
  /** Sessions filtered by current selection */
  sessions: ChargingSession[];
  /** Total sessions loaded for current VIN (all data) */
  totalLoaded: number;
  totalRecords: number;
  isLoading: boolean;
  /** True while loading remaining pages after first batch */
  isLoadingMore: boolean;
  error: string | null;
  warning: string | null;
  /** Available years from data (newest first) */
  availableYears: number[];
  /** Available months from data (newest first) */
  availableMonths: MonthEntry[];
  /** Current filter mode */
  filterMode: FilterMode;
  /** Selected year (when filterMode = "year" or "month") */
  selectedYear: number;
  /** Selected month 1-12 (when filterMode = "month") */
  selectedMonth: number;
  /** VIN currently loaded */
  loadedVin: string | null;
}

// --- Per-VIN persistent cache ---
// Key = VIN, value = { sessions, totalRecords, fetchedAt }
interface VinCache {
  sessions: ChargingSession[];
  totalRecords: number;
  fetchedAt: number;
}

const vinCacheMap = new Map<string, VinCache>();
const persistedCache: Record<string, VinCache> = {};
let cacheHydrated = false;

const PAGE_SIZE = 500;

const CHARGING_HISTORY_CACHE_KEY = "vf_charging_sessions_cache_v1";
// Cache 24h — charging history is basically immutable for past sessions
const CACHE_TTL = 24 * 60 * 60 * 1000;
const MAX_CACHED_VINS = 6;
const chargingHistoryFetchInFlight = new Map<string, Promise<void>>();

export const chargingHistoryStore = map<ChargingHistoryState>({
  sessions: [],
  totalLoaded: 0,
  totalRecords: 0,
  isLoading: false,
  isLoadingMore: false,
  error: null,
  warning: null,
  availableYears: [],
  availableMonths: [],
  filterMode: "all",
  selectedYear: 0,
  selectedMonth: 0,
  loadedVin: null,
});

// --- Internal helpers ---

function getSessionTime(s: ChargingSession): number {
  return s.startChargeTime || s.pluggedTime || s.createdDate || 0;
}

function extractYears(sessions: ChargingSession[]): number[] {
  const set = new Set<number>();
  for (const s of sessions) {
    const t = getSessionTime(s);
    if (t) set.add(new Date(t).getFullYear());
  }
  return Array.from(set).sort((a, b) => b - a);
}

function extractMonths(
  sessions: ChargingSession[],
  year: number,
): MonthEntry[] {
  const set = new Set<number>();
  for (const s of sessions) {
    const t = getSessionTime(s);
    if (!t) continue;
    const d = new Date(t);
    if (d.getFullYear() === year) set.add(d.getMonth() + 1);
  }
  return Array.from(set)
    .sort((a, b) => b - a)
    .map((m) => ({ year, month: m, label: `T${m}/${year}` }));
}

function filterSessions(
  sessions: ChargingSession[],
  mode: FilterMode,
  year: number,
  month: number,
): ChargingSession[] {
  if (mode === "all") return sessions;
  return sessions.filter((s) => {
    const t = getSessionTime(s);
    if (!t) return false;
    const d = new Date(t);
    if (d.getFullYear() !== year) return false;
    if (mode === "month" && d.getMonth() + 1 !== month) return false;
    return true;
  });
}

function applyFilter(
  allSessions: ChargingSession[],
  mode: FilterMode,
  year: number,
  month: number,
) {
  const filtered = filterSessions(allSessions, mode, year, month);
  const years = extractYears(allSessions);
  const months = year > 0 ? extractMonths(allSessions, year) : [];

  chargingHistoryStore.setKey("sessions", filtered);
  chargingHistoryStore.setKey("totalLoaded", allSessions.length);
  chargingHistoryStore.setKey("availableYears", years);
  chargingHistoryStore.setKey("availableMonths", months);
  chargingHistoryStore.setKey("filterMode", mode);
  chargingHistoryStore.setKey("selectedYear", year);
  chargingHistoryStore.setKey("selectedMonth", month);
}

/**
 * Compute a smart default filter based on data characteristics.
 *
 * Decision tree (evaluated on first-batch data):
 *   1. ≤100 total entries → "all" (small dataset, show everything)
 *   2. Data spans >1 calendar year → "year" (pick current year, or latest year if no current-year data)
 *   3. Data is within a single year → "month" (pick current month, or latest month with data)
 *
 * This gives a sensible zoom level: few records = show all, many records spanning
 * years = yearly view, recent-only data = monthly view for quick scanning.
 */
function computeSmartDefault(sessions: ChargingSession[]): {
  mode: FilterMode;
  year: number;
  month: number;
} {
  if (sessions.length === 0) return { mode: "all", year: 0, month: 0 };

  // --- Rule 1: Fits in a single API page → show all ---
  if (sessions.length <= PAGE_SIZE) {
    return { mode: "all", year: 0, month: 0 };
  }

  // Gather distinct years present in data
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const yearSet = new Set<number>();
  for (const s of sessions) {
    const t = getSessionTime(s);
    if (t) yearSet.add(new Date(t).getFullYear());
  }
  const distinctYears = Array.from(yearSet).sort((a, b) => b - a); // newest first

  // --- Rule 2: Data spans more than 1 calendar year → year mode ---
  if (distinctYears.length > 1) {
    // Prefer current year if data exists; otherwise pick latest year
    const targetYear = distinctYears.includes(currentYear)
      ? currentYear
      : distinctYears[0];
    return { mode: "year", year: targetYear, month: 0 };
  }

  // --- Rule 3: All data within a single year → month mode ---
  const singleYear = distinctYears[0] || currentYear;

  // Find months with data within that year
  const monthSet = new Set<number>();
  for (const s of sessions) {
    const t = getSessionTime(s);
    if (!t) continue;
    const d = new Date(t);
    if (d.getFullYear() === singleYear) monthSet.add(d.getMonth() + 1);
  }
  const sortedMonths = Array.from(monthSet).sort((a, b) => b - a); // newest first

  // Prefer current month if available, otherwise latest month with data
  const targetMonth =
    singleYear === currentYear && sortedMonths.includes(currentMonth)
      ? currentMonth
      : sortedMonths[0] || currentMonth;

  return { mode: "month", year: singleYear, month: targetMonth };
}

/**
 * Extract sessions array from various API response formats:
 * - { data: [...sessions] }                    → json.data
 * - { data: { content: [...sessions] } }       → json.data.content
 * - { content: [...sessions] }                 → json.content
 * - [...sessions]                              → json itself
 */
function extractSessions(json: any): ChargingSession[] {
  if (!json) return [];
  // { data: [...] }
  if (Array.isArray(json.data)) return json.data;
  // { data: { content: [...] } }
  if (json.data?.content && Array.isArray(json.data.content))
    return json.data.content;
  // { content: [...] }
  if (Array.isArray(json.content)) return json.content;
  // Direct array
  if (Array.isArray(json)) return json;
  return [];
}

/**
 * Extract total record count from various API response formats:
 * - Spring Page: { data: { totalElements, totalPages, content } }
 * - Custom: { metadata: { totalRecords } }
 * - Nested: { data: { metadata: { totalRecords } } }
 */
function extractTotalRecords(json: any, fallback: number): number {
  // Top-level metadata
  const m = json.metadata || json.data?.metadata;
  if (m?.totalRecords) return m.totalRecords;
  if (m?.totalElements) return m.totalElements;
  // Spring Boot Page object
  if (json.data?.totalElements) return json.data.totalElements;
  if (json.totalElements) return json.totalElements;
  // Custom
  if (json.data?.totalRecords) return json.data.totalRecords;
  if (json.totalRecords) return json.totalRecords;
  return fallback;
}

function hydrateCacheFromStorage() {
  if (cacheHydrated) return;
  cacheHydrated = true;

  if (typeof window === "undefined") return;

  try {
    const raw = window.localStorage.getItem(CHARGING_HISTORY_CACHE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.items !== "object") return;

    const now = Date.now();
    const rawItems = parsed.items as Record<string, VinCache>;
    Object.entries(rawItems).forEach(([vin, item]) => {
      if (!item || !Array.isArray(item.sessions)) return;
      if (
        !Number.isFinite(item.fetchedAt) ||
        !Number.isFinite(item.totalRecords)
      )
        return;
      if (now - item.fetchedAt > CACHE_TTL) return;

      vinCacheMap.set(vin, item);
      persistedCache[vin] = item;
    });

    // Remove expired/stale records on app start and persist compacted cache.
    cleanupPersistedCache(persistedCache);
    persistChargingCache();
  } catch {
    // ignore invalid cache data, continue with memory-only mode
  }
}

function persistChargingCache() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      CHARGING_HISTORY_CACHE_KEY,
      JSON.stringify({ items: persistedCache }),
    );
  } catch {
    // localStorage quota exceeded or blocked, continue without persistence
  }
}

function cleanupPersistedCache(target: Record<string, VinCache>) {
  const now = Date.now();
  const cleaned: Record<string, VinCache> = {};
  Object.entries(target).forEach(([vin, item]) => {
    if (!item || !Array.isArray(item.sessions)) return;
    if (now - item.fetchedAt > CACHE_TTL) return;
    cleaned[vin] = item;
  });

  // Keep only latest N VIN entries to reduce storage growth.
  const ordered = Object.entries(cleaned).sort(
    (a, b) => b[1].fetchedAt - a[1].fetchedAt,
  );
  const pruned = ordered.slice(0, MAX_CACHED_VINS);

  Object.keys(target).forEach((vin) => delete target[vin]);
  for (const [vin, item] of pruned) {
    target[vin] = item;
  }

  // Keep in-memory map aligned with persisted cache to avoid unbounded growth.
  vinCacheMap.clear();
  for (const [vin, item] of Object.entries(target)) {
    vinCacheMap.set(vin, item);
  }
}

function setCachedData(
  vin: string,
  sessions: ChargingSession[],
  totalRecords: number,
) {
  const payload: VinCache = {
    sessions,
    totalRecords,
    fetchedAt: Date.now(),
  };
  vinCacheMap.set(vin, payload);
  persistedCache[vin] = payload;
  cleanupPersistedCache(persistedCache);
  persistChargingCache();
}

function normalizeIdSet(
  sessions: ChargingSession[] | null | undefined,
): ChargingSession[] {
  if (!Array.isArray(sessions)) return [];
  const map = new Map<string, ChargingSession>();
  for (const s of sessions) {
    if (!s) continue;

    const key = s.id
      ? `id:${s.id}`
      : `noid:${s.pluggedTime || s.startChargeTime || s.createdDate || 0}:${
          s.chargingStationName || ""
        }:${s.createdDate || 0}`;
    map.set(key, s);
  }
  return Array.from(map.values());
}

function hydrateOrGetCached(vin: string): VinCache | null {
  if (!vin) return null;
  hydrateCacheFromStorage();
  return vinCacheMap.get(vin) || persistedCache[vin] || null;
}

function getCachedSessions(): ChargingSession[] | null {
  const vin = chargingHistoryStore.get().loadedVin;
  if (!vin) return null;
  return hydrateOrGetCached(vin)?.sessions || null;
}

// --- Public API ---

/**
 * Switch filter mode: "all" shows everything, "year" filters by year, "month" by year+month.
 */
export function setFilter(mode: FilterMode, year = 0, month = 0) {
  const all = getCachedSessions();
  if (!all) return;
  applyFilter(all, mode, year, month);
}

/**
 * Convenience: set to "all"
 */
export function setFilterAll() {
  setFilter("all");
}

/**
 * Convenience: set to a specific year
 */
export function setFilterYear(year: number) {
  setFilter("year", year);
}

/**
 * Convenience: set to a specific month within the currently selected year
 */
export function setFilterMonth(year: number, month: number) {
  setFilter("month", year, month);
}

/** Max new sessions possible within CACHE_TTL (24h) — keeps revalidation lightweight */
const REVALIDATE_SIZE = 50;

/**
 * Stale-while-revalidate: fetch newest sessions in the background.
 * If new ones found, merge into cache. No full refetch needed.
 */
async function backgroundRevalidate(vin: string, cached: VinCache) {
  try {
    const json = await api.getChargingHistory(0, REVALIDATE_SIZE, vin);
    const freshSessions = extractSessions(json);
    const freshTotal = extractTotalRecords(json, freshSessions.length);

    // Fast lookup by session key
    const existingKeys = new Set(
      cached.sessions.map((s) => s.id || `${getSessionTime(s)}`),
    );

    const newSessions = freshSessions.filter(
      (s) => !existingKeys.has(s.id || `${getSessionTime(s)}`),
    );

    if (newSessions.length === 0) {
      setCachedData(vin, cached.sessions, cached.totalRecords);
      return;
    }

    const merged = normalizeIdSet([...newSessions, ...cached.sessions])
      .sort((a, b) => getSessionTime(b) - getSessionTime(a));

    console.log(
      `%c[Charging] +${newSessions.length} new session(s) merged`,
      "color:#f59e0b;font-weight:bold",
    );

    setCachedData(vin, merged, freshTotal);

    const st = chargingHistoryStore.get();
    applyFilter(merged, st.filterMode, st.selectedYear, st.selectedMonth);
  } catch {
    // Silent fail — cached data remains visible
  }
}

/**
 * Fetch ALL charging sessions for a specific VIN.
 * @param vinCode — explicit VIN to fetch for (required; do not rely on api.vin)
 * @param force — bypass cache
 *
 * - Per-VIN in-memory cache with 24h TTL
 * - Fetches page 0 first, then remaining pages in parallel
 * - Applies filter after collecting all pages to keep UI update atomic
 */
export async function fetchChargingSessions(vinCode?: string, force = false) {
  const vin = vinCode?.trim();
  if (!vin) {
    console.warn(
      "fetchChargingSessions called without vinCode; skip to avoid cross-VIN race",
    );
    return;
  }

  // Check if VIN changed from what the store currently shows
  const currentLoadedVin = chargingHistoryStore.get().loadedVin;
  const vinChanged = currentLoadedVin !== vin;

  // Check per-VIN cache — stale-while-revalidate:
  // Show cached data instantly, then background-check for new sessions
  const cached = hydrateOrGetCached(vin);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    const cacheAge = ((Date.now() - cached.fetchedAt) / 1000 / 60).toFixed(1);
    console.log(
      `%c[Charging] Cache hit: ${cached.sessions.length} sessions (age: ${cacheAge}min)`,
      "color:#9ca3af",
    );
    chargingHistoryStore.setKey("loadedVin", vin);
    chargingHistoryStore.setKey("totalRecords", cached.totalRecords);
    chargingHistoryStore.setKey("error", null);
    chargingHistoryStore.setKey("warning", null);
    chargingHistoryStore.setKey("isLoading", false);
    chargingHistoryStore.setKey("isLoadingMore", false);

    // Always re-apply filter with cached data for this VIN
    if (vinChanged) {
      const smart = computeSmartDefault(cached.sessions);
      applyFilter(cached.sessions, smart.mode, smart.year, smart.month);
    } else {
      const st = chargingHistoryStore.get();
      applyFilter(
        cached.sessions,
        st.filterMode,
        st.selectedYear,
        st.selectedMonth,
      );
    }

    // Background revalidation: fetch page 0 to check for new sessions
    backgroundRevalidate(vin, cached);
    return;
  }

  const runningFetch = chargingHistoryFetchInFlight.get(vin);
  if (runningFetch) {
    await runningFetch;
    return;
  }

  // Clear previous data when switching VINs OR forcing refresh for clean transition
  if (vinChanged || force) {
    chargingHistoryStore.setKey("sessions", []);
    chargingHistoryStore.setKey("totalLoaded", 0);
    chargingHistoryStore.setKey("totalRecords", 0);
    chargingHistoryStore.setKey("availableYears", []);
    chargingHistoryStore.setKey("availableMonths", []);
  }

  chargingHistoryStore.setKey("isLoading", true);
  chargingHistoryStore.setKey("isLoadingMore", false);
  chargingHistoryStore.setKey("error", null);
  chargingHistoryStore.setKey("warning", null);
  chargingHistoryStore.setKey("loadedVin", vin);

  const fetchTask = (async () => {
    try {
      const fetchStart = performance.now();

      const firstJson = await api.getChargingHistory(0, PAGE_SIZE, vin);
      const firstSessions: ChargingSession[] = extractSessions(firstJson);
      const totalRecords = extractTotalRecords(firstJson, firstSessions.length);
      const firstMs = (performance.now() - fetchStart).toFixed(0);

      console.log(
        `%c[Charging] Page 0: ${firstSessions.length}/${totalRecords} sessions in ${firstMs}ms (size=${PAGE_SIZE})`,
        "color:#8b5cf6;font-weight:bold",
      );

      let allSessions: ChargingSession[] = [...firstSessions];
      chargingHistoryStore.setKey("totalRecords", totalRecords);

      const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));

      // If there are more pages, fetch them ALL before showing anything
      if (totalPages > 1) {
        chargingHistoryStore.setKey("isLoadingMore", true);

        let failedPages = 0;
        const remaining = Array.from(
          { length: totalPages - 1 },
          (_, i) => i + 1,
        );

        // Fetch remaining pages with concurrency
        const concurrency = 5;
        for (let i = 0; i < remaining.length; i += concurrency) {
          const batch = remaining.slice(i, i + concurrency);
          const batchResults = await Promise.allSettled(
            batch.map((page) => api.getChargingHistory(page, PAGE_SIZE, vin)),
          );

          for (const result of batchResults) {
            if (result.status === "fulfilled") {
              const sessions = extractSessions(result.value);
              if (sessions.length) {
                allSessions.push(...sessions);
              }
            } else {
              failedPages += 1;
            }
          }
        }

        const totalMs = (performance.now() - fetchStart).toFixed(0);
        console.log(
          `%c[Charging] All pages: ${allSessions.length}/${totalRecords} sessions, ${totalPages} pages in ${totalMs}ms` +
          (failedPages > 0 ? ` (${failedPages} failed)` : ""),
          failedPages > 0 ? "color:#ef4444;font-weight:bold" : "color:#8b5cf6;font-weight:bold",
        );

        if (failedPages > 0) {
          chargingHistoryStore.setKey(
            "warning",
            `${failedPages} pages failed to load. Results may be incomplete.`,
          );
        }
      } else {
        console.log(
          `%c[Charging] Complete: ${allSessions.length} sessions in 1 request (${firstMs}ms)`,
          "color:#22c55e;font-weight:bold",
        );
      }

      // Now that we have EVERYTHING (or attempted to), update the UI once
      const uniqueSessions = normalizeIdSet(allSessions);
      
      if (vinChanged) {
        // For new vehicle, use smart default (Year or Month)
        const smart = computeSmartDefault(uniqueSessions);
        applyFilter(uniqueSessions, smart.mode, smart.year, smart.month);
      } else if (force) {
        // For manual refresh on same vehicle, prioritize showing "All" as requested
        applyFilter(uniqueSessions, "all", 0, 0);
      } else {
        // Background refresh or regular fetch, preserve current filter
        const currentState = chargingHistoryStore.get();
        applyFilter(
          uniqueSessions,
          currentState.filterMode,
          currentState.selectedYear,
          currentState.selectedMonth,
        );
      }

      setCachedData(vin, uniqueSessions, totalRecords);
    } catch (e: any) {
      console.error("Failed to fetch charging history:", e);
      chargingHistoryStore.setKey("error", e.message || "Unknown error");
    } finally {
      chargingHistoryStore.setKey("isLoading", false);
      chargingHistoryStore.setKey("isLoadingMore", false);
    }
  })();

  chargingHistoryFetchInFlight.set(vin, fetchTask);
  try {
    await fetchTask;
  } finally {
    if (chargingHistoryFetchInFlight.get(vin) === fetchTask) {
      chargingHistoryFetchInFlight.delete(vin);
    }
  }
}
