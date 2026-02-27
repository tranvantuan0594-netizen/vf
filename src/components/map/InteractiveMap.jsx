import { useEffect, useRef, useCallback } from "react";
import { useStore } from "@nanostores/react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { vehicleStore } from "../../stores/vehicleStore";
import {
  chargingStationStore,
  fetchChargingStations,
  getFilteredStations,
} from "../../stores/chargingStationStore";
import { DEFAULT_LOCATION } from "../../constants/vehicle";
import MapControls from "./MapControls";
import ChargingStationPopup from "./ChargingStationPopup";

// Fix Leaflet default icon issue with bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Vehicle marker icon
function createVehicleIcon(heading) {
  return L.divIcon({
    className: "vehicle-marker",
    html: `<div style="transform: rotate(${heading || 0}deg); display: flex; align-items: center; justify-content: center;">
      <div style="width: 36px; height: 36px; background: #2563eb; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(37,99,235,0.4); display: flex; align-items: center; justify-content: center;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
        </svg>
      </div>
    </div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  });
}

// Station marker icon
function createStationIcon(available) {
  const isAvailable = available > 0;
  const color = isAvailable ? "#10b981" : "#ef4444";
  const bgColor = isAvailable ? "#ecfdf5" : "#fef2f2";

  return L.divIcon({
    className: "station-marker",
    html: `<div style="width: 28px; height: 28px; background: ${bgColor}; border: 2px solid ${color}; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 4px rgba(0,0,0,0.15);">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg">
        <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
      </svg>
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
}

// Component to handle map view updates
function MapUpdater({ center, zoom }) {
  const map = useMap();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (center) {
      map.setView(center, zoom, { animate: true });
    }
  }, [center, zoom, map]);

  return null;
}

export default function InteractiveMap() {
  const vehicle = useStore(vehicleStore);
  const stationState = useStore(chargingStationStore);
  const mapRef = useRef(null);

  const isDefaultLoc =
    Number(vehicle.latitude) === DEFAULT_LOCATION.LATITUDE &&
    Number(vehicle.longitude) === DEFAULT_LOCATION.LONGITUDE;
  const hasValidCoords = vehicle.latitude && vehicle.longitude && !isDefaultLoc;

  const vehicleLat = hasValidCoords
    ? Number(vehicle.latitude)
    : DEFAULT_LOCATION.LATITUDE;
  const vehicleLng = hasValidCoords
    ? Number(vehicle.longitude)
    : DEFAULT_LOCATION.LONGITUDE;

  // Fetch stations when vehicle has valid coords
  useEffect(() => {
    if (hasValidCoords && stationState.showStations) {
      fetchChargingStations(vehicleLat, vehicleLng);
    }
  }, [hasValidCoords, vehicleLat, vehicleLng, stationState.showStations]);

  const filteredStations = getFilteredStations();

  const handleRecenter = useCallback(() => {
    if (mapRef.current) {
      mapRef.current.setView([vehicleLat, vehicleLng], 14, { animate: true });
    }
  }, [vehicleLat, vehicleLng]);

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden">
      <MapContainer
        center={[vehicleLat, vehicleLng]}
        zoom={14}
        className="w-full h-full"
        zoomControl={false}
        attributionControl={false}
        ref={mapRef}
        style={{ minHeight: "250px" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://osm.org/copyright">OSM</a>'
        />

        <MapUpdater center={[vehicleLat, vehicleLng]} zoom={14} />

        {/* Vehicle marker */}
        {hasValidCoords && (
          <Marker
            position={[vehicleLat, vehicleLng]}
            icon={createVehicleIcon(vehicle.heading)}
          >
            <Popup>
              <div className="text-sm font-bold text-gray-900">
                {vehicle.model || "VinFast"} {vehicle.trim || ""}
              </div>
              <div className="text-xs text-gray-500">
                {vehicle.location_address || "Vehicle location"}
              </div>
              {vehicle.battery_level != null && (
                <div className="text-xs text-blue-600 font-bold mt-1">
                  {vehicle.battery_level}% · {vehicle.range || "—"} km
                </div>
              )}
            </Popup>
          </Marker>
        )}

        {/* Charging station markers */}
        {filteredStations.map((station) => (
          <Marker
            key={station.stationId}
            position={[station.latitude, station.longitude]}
            icon={createStationIcon(station.availableConnectors)}
          >
            <Popup maxWidth={280} className="station-popup">
              <ChargingStationPopup station={station} />
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Map controls overlay */}
      <MapControls onRecenter={handleRecenter} />

      {/* No coordinates overlay */}
      {!hasValidCoords && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50/80 backdrop-blur-sm z-[999]">
          <div className="w-10 h-10 rounded-full border-4 border-gray-200 border-t-blue-500 animate-spin mb-3"></div>
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
            Locating vehicle...
          </span>
        </div>
      )}

      {/* Custom styles for Leaflet popups */}
      <style>{`
        .vehicle-marker, .station-marker {
          background: transparent !important;
          border: none !important;
        }
        .leaflet-popup-content-wrapper {
          border-radius: 16px !important;
          padding: 4px !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1) !important;
        }
        .leaflet-popup-content {
          margin: 10px 12px !important;
          font-family: inherit !important;
        }
        .leaflet-popup-tip {
          box-shadow: 0 2px 4px rgba(0,0,0,0.08) !important;
        }
        .leaflet-control-zoom {
          border-radius: 12px !important;
          overflow: hidden;
          border: 1px solid #e5e7eb !important;
        }
        .leaflet-control-zoom a {
          border: none !important;
          width: 32px !important;
          height: 32px !important;
          line-height: 32px !important;
          font-size: 16px !important;
        }
      `}</style>
    </div>
  );
}
