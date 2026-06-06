import { requireAuth } from "@/lib/auth";
import { getEconomySummary, getGlobalSettings } from "@/lib/actions";
import { EconomyDashboard } from "@/components/admin/economy-dashboard";
import { PageShell, PageHeader } from "@/components/admin/admin-ui";
import { Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function EconomyPage() {
  await requireAuth();
  const [data, settings] = await Promise.all([getEconomySummary(), getGlobalSettings()]);
  const accountingEnabled = settings.accounting_provider && settings.accounting_provider !== "none";

  return (
    <PageShell width="5xl">
      <PageHeader
        title="Økonomi"
        icon={Wallet}
        subtitle="Overblik over omsætning, forbrug og udestående betalinger."
      />
      <EconomyDashboard data={data} accountingEnabled={!!accountingEnabled} />
    </PageShell>
  );
}
