import React, { useState, Suspense } from "react";
import { useStore } from "@nanostores/react";
import { vehicleStore } from "../stores/vehicleStore";
import DashboardController from "./DashboardController";
import AuthGate from "./AuthGate";
import VehicleHeader from "./VehicleHeader";
import CarStatus from "./CarStatus";
import ChargingHistory from "./ChargingHistory";
import { EnvironmentCard, MapCard } from "./ControlGrid";
import DigitalTwin from "./DigitalTwin";
import SystemHealth from "./SystemHealth";
import MobileNav from "./MobileNav";
import ErrorBoundary from "./ErrorBoundary";

// Lazy load heavy drawers — only fetched when opened
const ChargingHistoryDrawer = React.lazy(
  () => import("./ChargingHistoryDrawer"),
);
const TelemetryDrawer = React.lazy(() => import("./TelemetryDrawer"));

export default function DashboardApp({ vin: initialVin }) {
  const { isInitialized, vin } = useStore(vehicleStore);
  const [activeTab, setActiveTab] = useState("vehicle");
  const [isChargingDrawerOpen, setIsChargingDrawerOpen] = useState(false);
  const [isTelemetryDrawerOpen, setIsTelemetryDrawerOpen] = useState(false);

  const handleOpenCharging = () => {
    setIsChargingDrawerOpen(true);
  };

  const handleOpenTelemetry = () => {
    setIsTelemetryDrawerOpen(true);
  };

  return (
    <>
      {/* Render DashboardController once — persists across loading→initialized transition.
          This prevents the double data-fetch that caused the loading flash. */}
      <DashboardController vin={initialVin} />

      {!isInitialized || !vin ? (
        <AuthGate />
      ) : (
        <div className="fixed inset-0 w-full h-[100dvh] z-0 md:static md:min-h-[100dvh] md:h-auto md:max-w-7xl md:min-w-[1280px] md:mx-auto p-4 md:pt-2 pb-28 md:pb-2 animate-in fade-in duration-700 flex flex-col md:grid md:grid-rows-[auto_1fr] md:gap-2 overflow-hidden md:overflow-visible">
          <header className="flex-shrink-0 relative z-[60]">
            <VehicleHeader
              onOpenCharging={handleOpenCharging}
              onOpenTelemetry={handleOpenTelemetry}
            />
          </header>

          <main className="flex-1 flex flex-col md:grid md:grid-cols-12 md:grid-rows-[1fr] gap-4 md:gap-3 min-h-0">
            {/* LEFT COLUMN: Energy (Top) + Vehicle Status (Bottom) */}
            <div
              className={`md:col-span-3 flex flex-col gap-4 md:gap-2 ${activeTab === "energy_env" || activeTab === "status" ? "flex-1 min-h-0" : "hidden md:flex"}`}
            >
              {/* Tab 2: Energy — scrollable on mobile (CarStatus + ChargingHistory) */}
              <div
                className={`${activeTab === "energy_env" ? "flex-1 flex flex-col min-h-0 overflow-y-auto md:overflow-visible scrollbar-none" : "hidden md:block"}`}
              >
                <div className="flex-shrink-0">
                  <ErrorBoundary>
                    <CarStatus />
                  </ErrorBoundary>
                </div>
                {/* Mobile only: inline charging history below energy */}
                {activeTab === "energy_env" && (
                  <div className="md:hidden mt-4 bg-white rounded-3xl p-4 shadow-sm border border-gray-100">
                    <ErrorBoundary>
                      <ChargingHistory inline />
                    </ErrorBoundary>
                  </div>
                )}
              </div>
              {/* Tab 3: Vehicle Status */}
              <div
                className={`${activeTab === "status" ? "flex-1 block" : "hidden md:flex md:flex-1 md:flex-col"}`}
              >
                <ErrorBoundary>
                  <SystemHealth onOpenTelemetry={handleOpenTelemetry} />
                </ErrorBoundary>
              </div>
            </div>

            {/* CENTER COLUMN: Digital Twin */}
            <div
              className={`md:col-span-6 relative bg-gray-800/10 rounded-3xl border border-white/5 shadow-2xl backdrop-blur-sm overflow-hidden md:block flex-1 ${activeTab === "vehicle" ? "flex flex-col" : "hidden md:block"}`}
            >
              <ErrorBoundary>
                <DigitalTwin />
              </ErrorBoundary>
            </div>

            {/* RIGHT COLUMN: Environment (Top) + Location (Bottom) */}
            <div
              className={`md:col-span-3 flex flex-col ${activeTab === "location" ? "gap-0 md:gap-2 flex-1" : "gap-2 hidden md:flex"}`}
            >
              {/* Environment - PC Only */}
              <div className="hidden md:block">
                <ErrorBoundary>
                  <EnvironmentCard />
                </ErrorBoundary>
              </div>
              {/* Tab 4: Location */}
              <div
                className={`${activeTab === "location" ? "flex-1 block" : "hidden md:flex md:flex-1 md:flex-col"}`}
              >
                <ErrorBoundary>
                  <MapCard />
                </ErrorBoundary>
              </div>
            </div>
          </main>

          <MobileNav
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onScan={handleOpenTelemetry}
          />

          <Suspense fallback={null}>
            {isChargingDrawerOpen && (
              <ChargingHistoryDrawer
                isOpen={isChargingDrawerOpen}
                onClose={() => setIsChargingDrawerOpen(false)}
              />
            )}
            {isTelemetryDrawerOpen && (
              <TelemetryDrawer
                isOpen={isTelemetryDrawerOpen}
                onClose={() => setIsTelemetryDrawerOpen(false)}
              />
            )}
          </Suspense>
        </div>
      )}
    </>
  );
}
