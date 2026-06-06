import { getLaundryMachines, getGlobalSettings } from "@/lib/actions";
import { LaundrySettings } from "@/components/admin/laundry-settings";
import { ServicesSubnav } from "@/components/admin/services-subnav";
import { PageShell, PageHeader } from "@/components/admin/admin-ui";
import { WashingMachine } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminWashersPage() {
  const [laundryMachines, settings] = await Promise.all([
    getLaundryMachines(),
    getGlobalSettings(),
  ]);

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
        <LaundrySettings
          kind="WASHER"
          baseUrl={settings.site_url || ""}
          machines={laundryMachines.map((m) => ({
            id: m.id, name: m.name, kind: m.kind,
            source: (m.source === "MQTT" ? "MQTT" : "HA") as "HA" | "MQTT",
            switchEntityId: m.switchEntityId, mqttPrefix: m.mqttPrefix, mqttComponent: m.mqttComponent,
            durationMinutes: m.durationMinutes, pricePerUse: m.pricePerUse, enabled: m.enabled,
            code: m.code, location: m.location, billingMode: m.billingMode, pricePerMinute: m.pricePerMinute,
            powerThresholdW: m.powerThresholdW, idleTimeoutMinutes: m.idleTimeoutMinutes,
            maxReservationDKK: m.maxReservationDKK, powerEntityId: m.powerEntityId,
            programs: m.programs.map((p) => ({
              id: p.id, name: p.name, durationMinutes: p.durationMinutes, pricePerUse: p.pricePerUse, enabled: p.enabled,
            })),
          }))}
        />
      </div>
    </PageShell>
  );
}
