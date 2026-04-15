import { getShowers, getGlobalSettings } from "@/lib/actions";
import { ShowerSettings } from "@/components/admin/shower-settings";
import { ServicesSubnav } from "@/components/admin/services-subnav";

export const dynamic = "force-dynamic";

export default async function AdminShowersPage() {
  const [showers, settings] = await Promise.all([
    getShowers(),
    getGlobalSettings(),
  ]);

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
    </div>
  );
}
