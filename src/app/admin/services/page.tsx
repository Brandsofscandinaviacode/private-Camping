import { getServiceStatus } from "@/lib/actions";
import { ServicesDashboard } from "@/components/admin/services-dashboard";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const machines = await getServiceStatus();

  return (
    <div className="p-4 sm:p-6 lg:p-10 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Services</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Administrer vaskemaskiner, tørretumblere og andre tidsbaserede services.
        </p>
      </div>
      <ServicesDashboard initialMachines={machines} />
    </div>
  );
}
