import { getServiceHistory } from "@/lib/service-actions";
import { ServicesHistory } from "@/components/admin/services-history";
import { ServicesSubnav } from "@/components/admin/services-subnav";
import { PageShell, PageHeader } from "@/components/admin/admin-ui";
import { WashingMachine } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ServicesHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; kind?: string }>;
}) {
  const { days, kind } = await searchParams;
  const history = await getServiceHistory({
    days: days ? parseInt(days, 10) : 7,
    kind: kind === "LAUNDRY" || kind === "SHOWER" ? kind : "ALL",
  });

  return (
    <PageShell width="5xl">
      <PageHeader
        title="Services"
        icon={WashingMachine}
        iconTint="bg-violet-500/10 text-violet-600"
        subtitle="Administrer bade, vaskemaskiner, tørretumblere og andre tidsbaserede services."
      />
      <ServicesSubnav />
      <div className="pt-2">
        <ServicesHistory history={history} />
      </div>
    </PageShell>
  );
}
