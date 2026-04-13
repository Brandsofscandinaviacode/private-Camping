import { getServiceStatus, getLaundryGroups, getGlobalSettings } from "@/lib/actions";
import { ServicesDashboard } from "@/components/admin/services-dashboard";
import { LaundryGroupManager } from "@/components/admin/laundry-group-manager";
import { ServicesSubnav } from "@/components/admin/services-subnav";
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
    <div className="p-4 sm:p-6 lg:p-10 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Services</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Administrer bade, vaskemaskiner, tørretumblere og andre tidsbaserede services.
        </p>
      </div>
      <ServicesSubnav />
      <div className="space-y-8 pt-2">
        <ServicesDashboard initialMachines={machines} />
        <LaundryGroupManager
          initialGroups={groups}
          allMachines={allMachines}
          baseUrl={baseUrl}
        />
      </div>
    </div>
  );
}
