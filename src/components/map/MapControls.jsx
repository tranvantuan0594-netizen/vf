import { useStore } from "@nanostores/react";
import {
  chargingStationStore,
  toggleStations,
  setConnectorFilter,
  setAvailabilityFilter,
} from "../../stores/chargingStationStore";

export default function MapControls({ onRecenter }) {
  const { showStations, filterConnectorType, filterOnlyAvailable, isLoading } =
    useStore(chargingStationStore);

  return (
    <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-2">
      {/* Toggle Stations */}
      <button
        onClick={toggleStations}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold shadow-md border transition-all active:scale-95 ${
          showStations
            ? "bg-emerald-500 text-white border-emerald-600 shadow-emerald-200"
            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
        }`}
        title={
          showStations ? "Hide charging stations" : "Show charging stations"
        }
      >
        <svg
          className="w-4 h-4"
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
        {isLoading ? "Loading..." : "Stations"}
      </button>

      {/* Filters - only show when stations are enabled */}
      {showStations && (
        <div className="bg-white rounded-xl shadow-md border border-gray-200 p-2 flex flex-col gap-1.5">
          {/* Connector type filter */}
          <select
            value={filterConnectorType}
            onChange={(e) => setConnectorFilter(e.target.value)}
            className="text-[10px] font-bold text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">All Types</option>
            <option value="CCS2">CCS2</option>
            <option value="CHAdeMO">CHAdeMO</option>
            <option value="Type 2">Type 2</option>
          </select>

          {/* Available only toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer px-1">
            <input
              type="checkbox"
              checked={filterOnlyAvailable}
              onChange={(e) => setAvailabilityFilter(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-[10px] font-bold text-gray-600">
              Available only
            </span>
          </label>
        </div>
      )}

      {/* Recenter button */}
      <button
        onClick={onRecenter}
        className="flex items-center justify-center w-9 h-9 bg-white rounded-xl shadow-md border border-gray-200 hover:bg-gray-50 transition-all active:scale-95 self-end"
        title="Center on vehicle"
      >
        <svg
          className="w-4 h-4 text-blue-600"
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
      </button>
    </div>
  );
}
