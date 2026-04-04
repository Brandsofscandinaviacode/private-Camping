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
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Oversigt</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {units.length} enheder i alt
          </p>
        </div>
        <AddUnitDialog />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
            <div className="h-2 w-2 rounded-full bg-primary" />
            Optaget
          </div>
          <p className="text-2xl font-bold">{occupiedCount}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
            <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
            Ledige
          </div>
          <p className="text-2xl font-bold">{vacantCount}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
            <Home className="h-3 w-3" /> Hytter
          </div>
          <p className="text-2xl font-bold">{cabinCount}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
            <Caravan className="h-3 w-3" /> Campingvogne
          </div>
          <p className="text-2xl font-bold">{caravanCount}</p>
        </div>
      </div>

      {/* Unpaid Alert */}
      {unpaidCount > 0 && (
        <Link href="/admin/bookings?filter=unpaid">
          <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 hover:bg-destructive/15 transition-colors cursor-pointer">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">
                {unpaidCount} {unpaidCount === 1 ? "booking" : "bookinger"} mangler betaling
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Klik for at se ubetalte bookinger</p>
            </div>
          </div>
        </Link>
      )}

      {/* Unit Grid */}
      {units.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <Tent className="h-8 w-8" />
          </div>
          <p className="text-lg font-medium">Ingen enheder endnu</p>
          <p className="text-sm mt-1">
            Klik &ldquo;Tilføj enhed&rdquo; for at komme i gang
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
