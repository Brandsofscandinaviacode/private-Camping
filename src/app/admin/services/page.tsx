import { getServiceStatus, getLaundryGroups, getGlobalSettings } from "@/lib/actions";
import { ServicesDashboard } from "@/components/admin/services-dashboard";
import { LaundryGroupManager } from "@/components/admin/laundry-group-manager";
import { ServicesSubnav } from "@/components/admin/services-subnav";
import { PageShell, PageHeader } from "@/components/admin/admin-ui";
import { WashingMachine } from "lucide-react";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const [machines, groups, settings, allMachines] = await Promise.all([
    getServiceStatus(),
    getLaundryGroups(),
    getGlobalSettings(),
    prisma.laundryMachine.findMany({ select: { id: true, name: true, groupId: true }, orderBy: { id: "asc" } }),
  ]);

  const baseUrl = settings.site_url || "";

  return (
    <PageShell width="5xl">
      <PageHeader
        title="Services"
        icon={WashingMachine}
        iconTint="bg-violet-500/10 text-violet-600"
        subtitle="Administrer bade, vaskemaskiner, tørretumblere og andre tidsbaserede services."
      />
      <ServicesSubnav />
      <div className="space-y-8 pt-2">
        <ServicesDashboard initialMachines={machines} />
        <LaundryGroupManager initialGroups={groups} allMachines={allMachines} baseUrl={baseUrl} />
      </div>
    </PageShell>
  );
}
