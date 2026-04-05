import Link from "next/link";
import { getUnits, getUnitHAStates, getActiveSession, getUnpaidCount } from "@/lib/actions";
import { UnitCard } from "@/components/admin/cabin-card";
import { AddUnitDialog } from "@/components/admin/add-cabin-dialog";
import { Tent, Home, Caravan, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const [units, unpaidCount] = await Promise.all([getUnits(), getUnpaidCount()]);

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
  const cabinCount = units.filter((u) => u.type === "CABIN").length;
  const caravanCount = units.filter((u) => u.type === "CARAVAN").length;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <p className="text-muted-foreground text-xs mt-0.5">
            {units.length} enheder i alt
          </p>
        </div>
        <AddUnitDialog />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Optaget</p>
          <p className="text-xl font-semibold">{occupiedCount}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Ledige</p>
          <p className="text-xl font-semibold">{vacantCount}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <Home className="h-3 w-3" /> Hytter
          </div>
          <p className="text-xl font-semibold">{cabinCount}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <Caravan className="h-3 w-3" /> Campingvogne
          </div>
          <p className="text-xl font-semibold">{caravanCount}</p>
        </div>
      </div>

      {/* Unpaid Alert */}
      {unpaidCount > 0 && (
        <Link href="/admin/bookings?filter=unpaid">
          <div className="flex items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 hover:bg-destructive/10 transition-colors cursor-pointer">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-sm">
              <span className="font-medium">{unpaidCount}</span>{" "}
              <span className="text-muted-foreground">
                {unpaidCount === 1 ? "booking" : "bookinger"} afventer betaling
              </span>
            </p>
          </div>
        </Link>
      )}

      {/* Unit Grid */}
      {units.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <div className="h-14 w-14 rounded-xl bg-muted flex items-center justify-center mb-4">
            <Tent className="h-7 w-7" />
          </div>
          <p className="text-sm font-medium">Ingen enheder endnu</p>
          <p className="text-xs mt-1">
            Klik &ldquo;Tilføj enhed&rdquo; for at komme i gang
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {unitData.map(({ unit, haStates, activeGuestName }) => (
            <UnitCard
              key={unit.id}
              unit={unit}
              haStates={haStates}
              activeGuestName={activeGuestName}
            />
          ))}
        </div>
      )}
    </div>
  );
}
