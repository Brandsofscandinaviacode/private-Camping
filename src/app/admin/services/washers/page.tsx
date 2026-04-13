import { getLaundryMachines } from "@/lib/actions";
import { LaundrySettings } from "@/components/admin/laundry-settings";
import { ServicesSubnav } from "@/components/admin/services-subnav";

export const dynamic = "force-dynamic";

export default async function AdminWashersPage() {
  const laundryMachines = await getLaundryMachines();

  return (
    <div className="p-4 sm:p-6 lg:p-10 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Services</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Administrer bade, vaskemaskiner, tørretumblere og andre tidsbaserede services.
        </p>
      </div>
      <ServicesSubnav />
      <div className="pt-2">
        <LaundrySettings
          kind="WASHER"
          machines={laundryMachines.map((m) => ({
            id: m.id,
            name: m.name,
            kind: m.kind,
            switchEntityId: m.switchEntityId,
            durationMinutes: m.durationMinutes,
            pricePerUse: m.pricePerUse,
            enabled: m.enabled,
            code: m.code,
            location: m.location,
          }))}
        />
      </div>
    </div>
  );
}
