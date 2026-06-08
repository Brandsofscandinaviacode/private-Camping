import Link from "next/link";
import {
  getUnits, getResourceTypes, getUnitHAStates, getActiveSession, getPendingSession,
  getUnpaidCount, getTotalUsage, checkConsumptionAlarms, getEffectiveElPricing, getGlobalSettings,
} from "@/lib/actions";
import { getDashboardMovements } from "@/lib/dashboard-actions";
import { AddUnitDialog } from "@/components/admin/add-cabin-dialog";
import { DashboardUnitsGrid } from "@/components/admin/dashboard-units-grid";
import { DashboardKpis } from "@/components/admin/dashboard-kpis";
import { Tent, AlertCircle, AlertTriangle, WifiOff } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const [units, resourceTypes, unpaidCount, totalUsage, alarmResult, elPricing, movements, settings] = await Promise.all([
    getUnits(),
    getResourceTypes(),
    getUnpaidCount(),
    getTotalUsage().catch(() => null),
    checkConsumptionAlarms().catch(() => ({ alerts: [] })),
    getEffectiveElPricing().catch(() => null),
    getDashboardMovements().catch(() => ({ arrivals: 0, departures: 0, nextCheckIn: null })),
    getGlobalSettings(),
  ]);
  const haConfigured = !!settings.ha_url;

  const unitData = await Promise.all(
    units.map(async (unit) => {
      const [haStates, activeSession, pendingSession] = await Promise.allSettled([
        getUnitHAStates(unit.id),
        getActiveSession(unit.id),
        getPendingSession(unit.id),
      ]);
      const active = activeSession.status === "fulfilled" ? activeSession.value : null;
      const pending = pendingSession.status === "fulfilled" ? pendingSession.value : null;
      return {
        unit: {
          id: unit.id, name: unit.name, type: unit.type, status: unit.status,
          isLongTerm: unit.isLongTerm, longTermGuestName: unit.longTermGuestName,
          resourceTypeId: unit.resourceTypeId, sortOrder: unit.sortOrder,
          hardware: unit.hardware ? {
            hasElectricity: unit.hardware.hasElectricity,
            hasWater: unit.hardware.hasWater,
            hasClimate: unit.hardware.hasClimate,
            hasSmartLock: unit.hardware.hasSmartLock,
          } : null,
        },
        haStates: haStates.status === "fulfilled" ? haStates.value : null,
        activeGuestName: active?.guestName ?? null,
        pendingGuestName: !active && pending ? pending.guestName : null,
        activeCheckOut: active?.expectedCheckOut ? active.expectedCheckOut.toISOString() : null,
        pendingCheckIn: !active && pending ? pending.checkInTime.toISOString() : null,
      };
    })
  );

  const occupiedCount = units.filter((u) => u.status === "OCCUPIED").length;
  const reservedCount = unitData.filter((d) => d.unit.status !== "OCCUPIED" && !!d.pendingGuestName).length;
  const vacantCount = units.length - occupiedCount - reservedCount;

  // Consolidated HA status — one banner instead of a label on every card.
  // Only show when HA is actually configured (ha_url is set).
  const haTracked = haConfigured ? unitData.filter((d) => d.haStates !== null).length : 0;
  const haOffline = haConfigured ? unitData.filter((d) => d.haStates && !d.haStates.haReachable).length : 0;
  const haAllOffline = haTracked > 0 && haOffline === haTracked;

  return (
    <div className="p-4 sm:p-6 lg:p-10 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            <b className="text-foreground font-semibold">{units.length}</b> enheder ·{" "}
            <span className="text-blue-600 font-medium">{occupiedCount} optaget</span> ·{" "}
            {reservedCount > 0 && <><span className="text-amber-600 font-medium">{reservedCount} reserveret</span> · </>}
            <span className="font-medium">{vacantCount} ledige</span>
          </p>
        </div>
        <AddUnitDialog />
      </div>

      {/* Attention zone */}
      <DashboardKpis
        total={units.length}
        occupied={occupiedCount}
        reserved={reservedCount}
        vacant={vacantCount}
        totalUsage={totalUsage}
        elPricing={elPricing}
        movements={movements}
      />

      {/* Consolidated alerts */}
      {(unpaidCount > 0 || haOffline > 0 || alarmResult.alerts.length > 0) && (
        <div className="space-y-2.5">
          {unpaidCount > 0 && (
            <Link href="/admin/bookings?filter=unpaid">
              <div className="flex items-center gap-3.5 rounded-xl border border-red-200/80 bg-red-50/80 px-4 py-3 hover:bg-red-100/80 transition-all cursor-pointer">
                <div className="h-9 w-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                  <AlertCircle className="h-[18px] w-[18px] text-red-500" />
                </div>
                <p className="text-sm text-red-700 flex-1">
                  <span className="font-bold">{unpaidCount}</span> {unpaidCount === 1 ? "booking" : "bookinger"} afventer betaling
                </p>
                <span className="text-xs font-semibold text-red-600 border border-red-200 rounded-lg px-3 py-1.5">Se bookinger</span>
              </div>
            </Link>
          )}

          {haOffline > 0 && (
            <Link href="/admin/settings">
              <div className="flex items-center gap-3.5 rounded-xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 hover:bg-amber-100/80 transition-all cursor-pointer">
                <div className="h-9 w-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                  <WifiOff className="h-[18px] w-[18px] text-amber-600" />
                </div>
                <p className="text-sm text-amber-800 flex-1">
                  <span className="font-bold">Home Assistant er offline.</span>{" "}
                  {haAllOffline
                    ? "Live styring og forbrugsmålinger er utilgængelige for alle enheder."
                    : `Live data mangler for ${haOffline} af ${haTracked} enheder.`}
                </p>
                <span className="text-xs font-semibold text-amber-700 border border-amber-300 rounded-lg px-3 py-1.5">Genopret forbindelse</span>
              </div>
            </Link>
          )}

          {alarmResult.alerts.map((alert, i) => (
            <Link key={i} href={`/admin/units/${alert.unitId}`}>
              <div className="flex items-center gap-3.5 rounded-xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 hover:bg-amber-100/80 transition-all cursor-pointer">
                <div className="h-9 w-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-[18px] w-[18px] text-amber-600" />
                </div>
                <p className="text-sm text-amber-800">
                  <span className="font-bold">{alert.unitName}</span> bruger{" "}
                  {alert.type === "electricity"
                    ? `${alert.usage.toFixed(1)} kWh (grænse: ${alert.threshold} kWh)`
                    : `${alert.usage.toFixed(0)} liter vand (grænse: ${alert.threshold} L)`}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Inventory */}
      {units.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <Tent className="h-8 w-8" />
          </div>
          <p className="text-lg font-medium">Ingen enheder endnu</p>
          <p className="mt-1">Klik &ldquo;Tilføj enhed&rdquo; for at komme i gang</p>
        </div>
      ) : (
        <DashboardUnitsGrid
          unitData={unitData}
          resourceTypes={resourceTypes.map((rt) => ({ id: rt.id, name: rt.name, icon: rt.icon }))}
        />
      )}
    </div>
  );
}
