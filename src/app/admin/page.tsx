import Link from "next/link";
import { getUnits, getUnitHAStates, getActiveSession, getUnpaidCount, getTotalUsage, checkConsumptionAlarms, getEffectiveElPricing } from "@/lib/actions";
import { UnitCard } from "@/components/admin/cabin-card";
import { AddUnitDialog } from "@/components/admin/add-cabin-dialog";
import { Tent, Home, Caravan, MapPin, Anchor, AlertCircle, Zap, Droplets, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

const typeConfig = [
  { type: "CABIN", label: "Hytter", icon: Home },
  { type: "SEASONAL", label: "Fastliggere", icon: Anchor },
  { type: "CARAVAN", label: "Campingvogne", icon: Caravan },
  { type: "PITCH", label: "Pladser", icon: MapPin },
];

export default async function AdminDashboard() {
  const [units, unpaidCount, totalUsage, alarmResult, elPricing] = await Promise.all([
    getUnits(),
    getUnpaidCount(),
    getTotalUsage().catch(() => null),
    checkConsumptionAlarms().catch(() => ({ alerts: [] })),
    getEffectiveElPricing().catch(() => null),
  ]);

  const unitData = await Promise.all(
    units.map(async (unit) => {
      const [haStates, activeSession] = await Promise.allSettled([
        getUnitHAStates(unit.id),
        getActiveSession(unit.id),
      ]);
      return {
        unit,
        haStates: haStates.status === "fulfilled" ? haStates.value : null,
        activeGuestName: activeSession.status === "fulfilled"
          ? activeSession.value?.guestName ?? null : null,
      };
    })
  );

  const occupiedCount = units.filter((u) => u.status === "OCCUPIED").length;
  const vacantCount = units.filter((u) => u.status === "VACANT").length;

  // Group by type
  const grouped = typeConfig
    .map((tc) => ({
      ...tc,
      units: unitData.filter((d) => d.unit.type === tc.type),
    }))
    .filter((g) => g.units.length > 0);

  return (
    <div className="p-4 sm:p-6 lg:p-10 space-y-6 sm:space-y-8 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {units.length} enheder &middot; {occupiedCount} optaget &middot; {vacantCount} ledige
          </p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <AddUnitDialog />
        </div>
      </div>

      {/* Alerts */}
      {unpaidCount > 0 && (
        <Link href="/admin/bookings?filter=unpaid">
          <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 hover:bg-red-100 transition-colors cursor-pointer">
            <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
            <p className="text-sm text-red-700">
              <span className="font-semibold">{unpaidCount}</span>{" "}
              {unpaidCount === 1 ? "booking" : "bookinger"} afventer betaling
            </p>
          </div>
        </Link>
      )}

      {/* Consumption Alarms */}
      {alarmResult.alerts.length > 0 && (
        <div className="space-y-2">
          {alarmResult.alerts.map((alert, i) => (
            <Link key={i} href={`/admin/units/${alert.unitId}`}>
              <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100 transition-colors cursor-pointer">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                <p className="text-sm text-amber-800">
                  <span className="font-semibold">{alert.unitName}</span> bruger{" "}
                  {alert.type === "electricity"
                    ? `${alert.usage.toFixed(1)} kWh (grænse: ${alert.threshold} kWh)`
                    : `${alert.usage.toFixed(0)} liter vand (grænse: ${alert.threshold} L)`
                  }
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Total Usage Summary — current rate per hour + spot price */}
      {(totalUsage?.unitCount ?? 0) > 0 && (
        <div className={`grid gap-3 sm:gap-4 grid-cols-1 ${elPricing && elPricing.mode !== "fixed" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <div className="rounded-xl border bg-card shadow-sm p-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                <Zap className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Nuværende strømforbrug</p>
                <p className="text-2xl font-bold tabular-nums">{totalUsage!.totalKwhPerHour.toFixed(2)} kWh/t</p>
                <p className="text-xs text-muted-foreground">{(totalUsage!.totalKwhPerHour * 1000).toFixed(0)} W — alle enheder</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border bg-card shadow-sm p-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Droplets className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Nuværende vandforbrug</p>
                <p className="text-2xl font-bold tabular-nums">{totalUsage!.totalWaterLitersPerHour.toFixed(1)} L/t</p>
                <p className="text-xs text-muted-foreground">Alle enheder</p>
              </div>
            </div>
          </div>
          {elPricing && elPricing.mode !== "fixed" && (
            <div className="rounded-xl border bg-card shadow-sm p-5">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <Zap className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Effektiv elpris</p>
                  <p className="text-2xl font-bold tabular-nums">{elPricing.pricePerKwh.toFixed(2)} kr/kWh</p>
                  <p className="text-xs text-muted-foreground">
                    {elPricing.spotPrice !== null ? `Spot: ${elPricing.spotPrice.toFixed(2)} kr/kWh` : "Spotpris utilgængelig"}
                    {" — "}
                    {elPricing.mode === "minimum" ? "Minimumspris" : "Spot + tillæg"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Grouped Units */}
      {units.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <Tent className="h-8 w-8" />
          </div>
          <p className="text-lg font-medium">Ingen enheder endnu</p>
          <p className="mt-1">
            Klik &ldquo;Tilføj enhed&rdquo; for at komme i gang
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map((group) => {
            const Icon = group.icon;
            return (
              <section key={group.type}>
                <div className="flex items-center gap-2.5 mb-4">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <h2 className="text-lg font-semibold">{group.label}</h2>
                  <span className="text-sm text-muted-foreground">({group.units.length})</span>
                </div>
                <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                  {group.units.map(({ unit, haStates, activeGuestName }) => (
                    <UnitCard
                      key={unit.id}
                      unit={unit}
                      haStates={haStates}
                      activeGuestName={activeGuestName}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
