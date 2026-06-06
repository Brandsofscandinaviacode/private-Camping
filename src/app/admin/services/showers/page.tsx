import { getShowers, getGlobalSettings } from "@/lib/actions";
import { ShowerSettings } from "@/components/admin/shower-settings";
import { ServicesSubnav } from "@/components/admin/services-subnav";
import { PageShell, PageHeader } from "@/components/admin/admin-ui";
import { WashingMachine } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminShowersPage() {
  const [showers, settings] = await Promise.all([
    getShowers(),
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
        <ShowerSettings
          baseUrl={settings.site_url || ""}
          showers={showers.map((s) => ({
            id: s.id,
            name: s.name,
            source: (s.source === "MQTT" ? "MQTT" : "HA") as "HA" | "MQTT",
            switchEntityId: s.switchEntityId,
            mqttPrefix: s.mqttPrefix,
            mqttComponent: s.mqttComponent,
            pricePerMinute: s.pricePerMinute,
            minMinutes: s.minMinutes,
            maxMinutes: s.maxMinutes,
            enabled: s.enabled,
            code: s.code,
            location: s.location,
          }))}
        />
      </div>
    </PageShell>
  );
}
