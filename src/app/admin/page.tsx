import { getCabins, getCabinHAStates, getActiveSession } from "@/lib/actions";
import { CabinCard } from "@/components/admin/cabin-card";
import { AddCabinDialog } from "@/components/admin/add-cabin-dialog";
import { Tent } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const cabins = await getCabins();

  // Fetch HA states and active sessions in parallel for all cabins
  const cabinData = await Promise.all(
    cabins.map(async (cabin) => {
      const [haStates, activeSession] = await Promise.allSettled([
        getCabinHAStates(cabin.id),
        getActiveSession(cabin.id),
      ]);

      return {
        cabin,
        haStates:
          haStates.status === "fulfilled" ? haStates.value : null,
        activeGuestName:
          activeSession.status === "fulfilled"
            ? activeSession.value?.guestName ?? null
            : null,
      };
    })
  );

  const occupiedCount = cabins.filter((c) => c.status === "OCCUPIED").length;
  const vacantCount = cabins.filter((c) => c.status === "VACANT").length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            {cabins.length} hytter &middot; {occupiedCount} optaget &middot;{" "}
            {vacantCount} ledige
          </p>
        </div>
        <AddCabinDialog />
      </div>

      {/* Cabin Grid */}
      {cabins.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Tent className="h-12 w-12 mb-4" />
          <p className="text-lg">Ingen hytter endnu</p>
          <p className="text-sm">
            Klik &ldquo;Tilføj hytte&rdquo; for at komme i gang
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {cabinData.map(({ cabin, haStates, activeGuestName }) => (
            <CabinCard
              key={cabin.id}
              cabin={cabin}
              haStates={haStates}
              activeGuestName={activeGuestName}
            />
          ))}
        </div>
      )}
    </div>
  );
}
