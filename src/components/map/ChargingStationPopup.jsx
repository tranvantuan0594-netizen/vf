export default function ChargingStationPopup({ station }) {
  const available = station.availableConnectors ?? 0;
  const total = station.totalConnectors ?? 0;
  const connectors = station.connectorTypes || [];
  const isAvailable = available > 0;

  return (
    <div className="min-w-[200px] max-w-[260px]">
      <div className="font-bold text-gray-900 text-sm leading-tight mb-1">
        {station.stationName || "Charging Station"}
      </div>

      {station.address && (
        <div className="text-[11px] text-gray-500 mb-2 leading-snug">
          {station.address}
        </div>
      )}

      <div className="flex items-center gap-2 mb-2">
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${isAvailable ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
        >
          {available}/{total} Available
        </span>
        {station.maxPower > 0 && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700">
            {station.maxPower} kW
          </span>
        )}
      </div>

      {connectors.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {connectors.map((type) => (
            <span
              key={type}
              className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 uppercase"
            >
              {type}
            </span>
          ))}
        </div>
      )}

      {station.distance != null && (
        <div className="text-[10px] text-gray-400 font-medium">
          {station.distance < 1
            ? `${Math.round(station.distance * 1000)}m away`
            : `${station.distance.toFixed(1)} km away`}
        </div>
      )}

      <a
        href={`https://www.google.com/maps/dir/?api=1&destination=${station.latitude},${station.longitude}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-800 transition-colors"
      >
        <svg
          className="w-3 h-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
        Navigate
      </a>
    </div>
  );
}
