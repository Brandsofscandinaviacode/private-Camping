import { requireAuth } from "@/lib/auth";
import { getEconomySummary } from "@/lib/actions";
import { EconomyDashboard } from "@/components/admin/economy-dashboard";

export const dynamic = "force-dynamic";

export default async function EconomyPage() {
  await requireAuth();
  const data = await getEconomySummary();

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Økonomi</h1>
        <p className="text-muted-foreground mt-1">
          Overblik over omsætning, forbrug og udestående betalinger.
        </p>
      </div>
      <EconomyDashboard data={data} />
    </div>
  );
}
