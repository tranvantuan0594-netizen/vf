import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStore } from "@nanostores/react";
import { vehicleStore } from "../stores/vehicleStore";
import {
  chargingHistoryStore,
  fetchChargingSessions,
  setFilterAll,
  setFilterYear,
  setFilterMonth,
} from "../stores/chargingHistoryStore";

function safeNumber(val, fallback = 0) {
  if (val === null || val === undefined) return fallback;
  const n = typeof val === "string" ? parseFloat(val) : Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function formatDuration(startMs, endMs) {
  const s = safeNumber(startMs);
  const e = safeNumber(endMs);
  if (!s || !e) return "--";
  const diff = Math.abs(e - s);
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatDate(epochMs) {
  const ms = safeNumber(epochMs);
  if (!ms) return "--";
  try {
    return new Date(ms).toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "--";
  }
}

function formatTime(epochMs) {
  const ms = safeNumber(epochMs);
  if (!ms) return "--";
  try {
    return new Date(ms).toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "--";
  }
}

function formatCurrency(amount) {
  const n = safeNumber(amount);
  if (!n) return "Free";
  try {
    return new Intl.NumberFormat("vi-VN").format(n) + "đ";
  } catch {
    return `${n}đ`;
  }
}

function formatEnergy(value, decimals = 1) {
  const n = safeNumber(value);
  if (Number.isNaN(n)) return "0";
  try {
    return new Intl.NumberFormat("vi-VN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n);
  } catch {
    return decimals === 0 ? Math.round(n).toLocaleString() : n.toFixed(decimals);
  }
}

function formatTotalTime(ms) {
  const val = safeNumber(ms);
  if (val <= 0) return "0h";
  const totalHours = val / 3600000;
  if (totalHours < 1) return `${Math.round(val / 60000)}m`;
  const days = Math.floor(totalHours / 24);
  const hours = Math.round(totalHours % 24);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

function EnergyBar({ kWh, maxKWh }) {
  const k = safeNumber(kWh);
  const m = safeNumber(maxKWh, 1);
  const pct = m > 0 ? Math.min((k / m) * 100, 100) : 0;
  return (
    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-green-400 to-green-600 rounded-full transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function getIdleFeeInfo(session) {
  try {
    if (!session || !Array.isArray(session.items)) return null;
    const idleItem = session.items.find(
      (i) => i && typeof i.name === "string" && i.name === "IDLE_FEE",
    );
    if (!idleItem) return null;
    const from = safeNumber(idleItem.from);
    const to = safeNumber(idleItem.to);
    const mins = from && to ? Math.round(Math.abs(to - from) / 60000) : 0;
    return {
      cost: safeNumber(idleItem.cost),
      price: safeNumber(idleItem.price),
      minutes: mins,
      from: from || null,
      to: to || null,
    };
  } catch {
    return null;
  }
}

function getChargingFeeInfo(session) {
  try {
    if (!session || !Array.isArray(session.items)) return null;
    return (
      session.items.find(
        (i) => i && typeof i.name === "string" && i.name === "CHARGING FEE",
      ) || null
    );
  } catch {
    return null;
  }
}

function SessionCard({ session, maxEnergy, index }) {
  // Guard: skip rendering if session is completely invalid
  if (!session || typeof session !== "object") return null;

  const kWh = safeNumber(session.totalKWCharged);
  const chargeFee = getChargingFeeInfo(session);
  const idleFee = getIdleFeeInfo(session);
  const finalAmount = safeNumber(session.finalAmount);
  const amount = safeNumber(session.amount);
  const isFree = finalAmount === 0;
  const hasPromo =
    Array.isArray(session.promotions) && session.promotions.length > 0;
  const hasIdleFee = idleFee && idleFee.cost > 0;

  // Charging cost = total finalAmount minus idle fee (idle fee is always charged)
  const chargingCost = hasIdleFee ? finalAmount - idleFee.cost : finalAmount;

  return (
    <div
      className={`bg-white rounded-2xl border p-4 shadow-sm hover:shadow-md transition-all duration-300 ${
        index < 24 ? "animate-in fade-in slide-in-from-bottom-2" : ""
      } ${hasIdleFee ? "border-orange-200" : "border-gray-100"}`}
      style={
        index < 24
          ? { animationDelay: `${Math.min(index * 30, 300)}ms` }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-bold text-gray-900 truncate">
            {session.chargingStationName || "Unknown Station"}
          </h4>
          <p className="text-[10px] text-gray-400 truncate mt-0.5">
            {session.district || ""}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs font-bold text-gray-700">
            {formatDate(
              session.startChargeTime ||
                session.pluggedTime ||
                session.createdDate,
            )}
          </p>
          <p className="text-[10px] text-gray-400">
            {formatTime(session.startChargeTime)} →{" "}
            {formatTime(session.endChargeTime)}
          </p>
        </div>
      </div>

      <EnergyBar kWh={kWh} maxKWh={maxEnergy} />

      <div className="flex items-center justify-between mt-3 gap-2">
        <div className="flex items-center gap-1.5">
          <svg
            className="w-3.5 h-3.5 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
          <span className="text-sm font-bold text-gray-800">
            {formatEnergy(kWh, 1)} kWh
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <svg
            className="w-3.5 h-3.5 text-blue-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-xs text-gray-600">
            {formatDuration(session.startChargeTime, session.endChargeTime)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {isFree && hasPromo && !hasIdleFee ? (
            <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
              Free
            </span>
          ) : (
            <span className="text-xs font-bold text-gray-700">
              {formatCurrency(finalAmount)}
            </span>
          )}
          {isFree && !hasIdleFee && amount > 0 && (
            <span className="text-[10px] text-gray-400 line-through">
              {formatCurrency(amount)}
            </span>
          )}
        </div>
      </div>

      {/* Pricing details row */}
      <div className="flex items-center justify-between mt-1.5 gap-2">
        {chargeFee && safeNumber(chargeFee.price) > 0 && (
          <p className="text-[10px] text-gray-400">
            {formatCurrency(chargeFee.price)}/kWh
            {hasPromo && chargingCost <= 0 && (
              <span className="ml-1 text-green-500 font-bold">Free</span>
            )}
          </p>
        )}
      </div>

      {/* Idle fee warning row */}
      {hasIdleFee && (
        <div className="flex items-center gap-1.5 mt-2 bg-orange-50 rounded-lg px-2.5 py-1.5">
          <svg
            className="w-3.5 h-3.5 text-orange-500 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.27 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
          <span className="text-[10px] font-bold text-orange-700">
            Idle fee: {formatCurrency(idleFee.cost)}
          </span>
          {idleFee.minutes > 0 && (
            <span className="text-[10px] text-orange-500">
              ({idleFee.minutes}m)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
const MemoSessionCard = React.memo(SessionCard);

// --- Inline filter bar: single-row with year → month drill-down ---
function FilterBar({ store }) {
  const {
    filterMode,
    selectedYear,
    selectedMonth,
    availableYears,
    availableMonths,
  } = store;

  if (availableYears.length === 0) return null;

  const isYearActive = (y) =>
    (filterMode === "year" || filterMode === "month") && selectedYear === y;

  return (
    <div className="shrink-0 mb-3 flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none">
      {/* All */}
      <button
        onClick={setFilterAll}
        className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
          filterMode === "all"
            ? "bg-blue-600 text-white"
            : "text-gray-400 hover:text-gray-600"
        }`}
      >
        All
      </button>

      {availableYears.map((year) => (
        <React.Fragment key={year}>
          {/* Separator dot */}
          <span className="text-gray-200 text-[8px] shrink-0">●</span>

          {/* Year button */}
          <button
            onClick={() => setFilterYear(year)}
            className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
              isYearActive(year)
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {year}
          </button>

          {/* Inline month chips when this year is selected */}
          {isYearActive(year) && availableMonths.length > 1 && (
            <>
              {availableMonths.map((m) => (
                <button
                  key={m.month}
                  onClick={() =>
                    filterMode === "month" && selectedMonth === m.month
                      ? setFilterYear(year)
                      : setFilterMonth(m.year, m.month)
                  }
                  className={`shrink-0 px-2 py-1 rounded-md text-[11px] font-semibold transition-all ${
                    filterMode === "month" && selectedMonth === m.month
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-400 hover:text-blue-500"
                  }`}
                >
                  T{m.month}
                </button>
              ))}
            </>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// --- Filter summary label ---
function filterLabel(store) {
  if (store.filterMode === "month")
    return `T${store.selectedMonth}/${store.selectedYear}`;
  if (store.filterMode === "year") return `${store.selectedYear}`;
  return "all time";
}

// --- Animated stat value ---
function AnimatedStat({ label, value, colorClass, bgClass, isLoading }) {
  return (
    <div
      className={`${bgClass} rounded-xl p-2.5 text-center transition-all duration-500 min-h-[52px] flex flex-col justify-center`}
    >
      <p
        className={`text-[10px] font-bold ${colorClass.replace("800", "600")} uppercase`}
      >
        {label}
      </p>
      {isLoading ? (
        <div className="h-4 w-16 bg-gray-200/50 animate-pulse rounded mx-auto mt-1"></div>
      ) : (
        <p
          className={`text-sm font-extrabold ${colorClass} transition-all duration-300`}
        >
          {value}
        </p>
      )}
    </div>
  );
}

// Batch size for infinite scroll — render this many more when sentinel enters viewport
const SCROLL_BATCH = 60;

export default function ChargingHistory({ inline = false }) {
  const store = useStore(chargingHistoryStore);
  const { vin } = useStore(vehicleStore);
  const [visibleCount, setVisibleCount] = useState(SCROLL_BATCH);
  const sentinelRef = useRef(null);

  // Fetch whenever VIN changes (including mount)
  // VIN is passed explicitly so the store doesn't depend on api.vin timing
  useEffect(() => {
    if (vin) {
      fetchChargingSessions(vin);
    }
  }, [vin]);

  // Reset visible window when filter/VIN changes
  useEffect(() => {
    setVisibleCount(SCROLL_BATCH);
  }, [vin, store.filterMode, store.selectedYear, store.selectedMonth]);

  const safeSessions = Array.isArray(store.sessions) ? store.sessions : [];

  // --- Infinite scroll via IntersectionObserver ---
  const loadMore = useCallback(() => {
    setVisibleCount((v) => {
      const next = v + SCROLL_BATCH;
      return next >= safeSessions.length ? safeSessions.length : next;
    });
  }, [safeSessions.length]);

  useEffect(() => {
    if (inline) return; // inline mode renders everything, no scroll paging
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "300px" }, // trigger 300px before sentinel is visible
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [inline, loadMore]);

  const maxEnergy = useMemo(
    () =>
      Math.max(...safeSessions.map((s) => safeNumber(s?.totalKWCharged)), 1),
    [safeSessions],
  );

  const {
    totalKWh,
    totalCost,
    totalSaved,
    totalPluggedMs,
    totalIdleFee,
    totalIdleMins,
  } = useMemo(() => {
    let kwh = 0,
      cost = 0,
      saved = 0,
      plugged = 0,
      idleFee = 0,
      idleMins = 0;
    for (const s of safeSessions) {
      if (!s || typeof s !== "object") continue;
      kwh += safeNumber(s.totalKWCharged);
      cost += safeNumber(s.amount);
      saved += safeNumber(s.discount);
      const pt = safeNumber(s.pluggedTime);
      const ut = safeNumber(s.unpluggedTime);
      const st = safeNumber(s.startChargeTime);
      const et = safeNumber(s.endChargeTime);
      if (pt && ut && ut > pt) {
        plugged += ut - pt;
      } else if (st && et && et > st) {
        plugged += et - st;
      }
      const idle = getIdleFeeInfo(s);
      if (idle && idle.cost > 0) {
        idleFee += idle.cost;
        idleMins += idle.minutes;
      }
    }
    return {
      totalKWh: kwh,
      totalCost: cost,
      totalSaved: saved,
      totalPluggedMs: plugged,
      totalIdleFee: idleFee,
      totalIdleMins: idleMins,
    };
  }, [safeSessions]);

  const isAnyLoading = store.isLoading || store.isLoadingMore;
  const renderedSessions = inline
    ? safeSessions
    : safeSessions.slice(0, Math.min(visibleCount, safeSessions.length));
  const hasMoreToRender =
    !inline && renderedSessions.length < safeSessions.length;

  return (
    <div className={inline ? "flex flex-col" : "flex flex-col h-full min-h-0"}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div>
          <h3 className="text-lg font-extrabold text-gray-900">
            Charging History
          </h3>
          <p className="text-xs text-gray-400 mt-0.5 transition-all duration-300">
            {store.isLoading && store.totalLoaded === 0
              ? "Loading..."
              : store.isLoadingMore
                ? `Loading more... (${store.totalLoaded}/${store.totalRecords})`
                : store.totalLoaded > 0
                  ? `${store.sessions.length} of ${store.totalLoaded} sessions · ${filterLabel(store)}`
                  : "No data"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {store.isLoadingMore && (
            <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          )}
          <button
            onClick={() => fetchChargingSessions(vin, true)}
            disabled={isAnyLoading}
            className="text-xs text-blue-600 hover:text-blue-800 font-bold disabled:opacity-50 transition-opacity"
          >
            {store.isLoading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Filter chips (year → month) */}
      <FilterBar store={store} />

      {/* Summary bar */}
      {(safeSessions.length > 0 || store.isLoading) && (
        <div
          className={`grid gap-2 mb-4 shrink-0 animate-in fade-in duration-500 ${totalIdleFee > 0 ? "grid-cols-3" : "grid-cols-2"}`}
        >
          <AnimatedStat
            label="Energy"
            value={`${formatEnergy(totalKWh, 0)} kWh`}
            colorClass="text-green-800"
            bgClass="bg-green-50"
            isLoading={store.isLoading}
          />
          <AnimatedStat
            label="Plugged"
            value={formatTotalTime(totalPluggedMs)}
            colorClass="text-purple-800"
            bgClass="bg-purple-50"
            isLoading={store.isLoading}
          />
          <AnimatedStat
            label="Cost"
            value={formatCurrency(totalCost)}
            colorClass="text-blue-800"
            bgClass="bg-blue-50"
            isLoading={store.isLoading}
          />
          <AnimatedStat
            label="Saved"
            value={formatCurrency(totalSaved)}
            colorClass="text-amber-800"
            bgClass="bg-amber-50"
            isLoading={store.isLoading}
          />
          {totalIdleFee > 0 && (
            <AnimatedStat
              label="Idle Fee"
              value={formatCurrency(totalIdleFee)}
              colorClass="text-orange-800"
              bgClass="bg-orange-50"
              isLoading={store.isLoading}
            />
          )}
          {totalIdleFee > 0 && (
            <AnimatedStat
              label="Idle Time"
              value={`${totalIdleMins}m`}
              colorClass="text-red-800"
              bgClass="bg-red-50"
              isLoading={store.isLoading}
            />
          )}
        </div>
      )}

      {/* Error */}
      {store.error && (
        <div className="bg-red-50 text-red-700 text-sm p-3 rounded-xl mb-3 shrink-0">
          {store.error}
        </div>
      )}
      {store.warning && !store.error && (
        <div className="bg-amber-50 text-amber-800 text-sm p-3 rounded-xl mb-3 shrink-0">
          {store.warning}
        </div>
      )}

      {/* Session list */}
      <div
        className={
          inline ? "space-y-3" : "flex-1 overflow-y-auto space-y-3 min-h-0 pr-1"
        }
      >
        {renderedSessions.map((session, index) => (
          <MemoSessionCard
            key={session?.id || `session-${index}`}
            session={session}
            maxEnergy={maxEnergy}
            index={index}
          />
        ))}
        {/* Infinite scroll sentinel — observed by IntersectionObserver */}
        {hasMoreToRender && (
          <div
            ref={sentinelRef}
            className="flex items-center justify-center py-4"
            aria-hidden="true"
          >
            <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
            <span className="ml-2 text-xs text-gray-400">
              {safeSessions.length - renderedSessions.length} more
            </span>
          </div>
        )}

        {/* Empty */}
        {!isAnyLoading && safeSessions.length === 0 && !store.error && (
          <div className="text-center py-12 text-gray-400 animate-in fade-in duration-500">
            <svg
              className="w-12 h-12 mx-auto mb-3 text-gray-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            <p className="text-sm font-bold">
              {store.filterMode !== "all"
                ? `No sessions for ${filterLabel(store)}`
                : "No charging sessions"}
            </p>
          </div>
        )}

        {/* Loading skeleton */}
        {store.isLoading && store.sessions.length === 0 && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <div className="flex justify-between mb-3">
                  <div className="h-4 bg-gray-200 rounded w-3/5"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/4"></div>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full mb-3"></div>
                <div className="flex justify-between">
                  <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/5"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/6"></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
