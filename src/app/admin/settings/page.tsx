import { getGlobalSettings, getUnits, getLaundryMachines } from "@/lib/actions";
import { requireAuth } from "@/lib/auth";
import { GeneralSettings, HASettings, NotificationSettings, PaymentSettings, GuestPortalSettings } from "@/components/admin/settings-form";
import { CabinHardwareForm } from "@/components/admin/cabin-hardware-form";
import { ChangePasswordForm } from "@/components/admin/change-password-form";
import { SystemStatus } from "@/components/admin/system-status";
import { SettingsTabs } from "@/components/admin/settings-tabs";
import { LaundrySettings } from "@/components/admin/laundry-settings";
import { Home, Anchor, Caravan, MapPin } from "lucide-react";

export const dynamic = "force-dynamic";

const typeLabels: Record<string, string> = {
  CABIN: "Hytte",
  SEASONAL: "Fastligger",
  CARAVAN: "Campingvogn",
  PITCH: "Plads",
};

const typeOrder = ["CABIN", "SEASONAL", "CARAVAN", "PITCH"];
const typeIcons: Record<string, typeof Home> = {
  CABIN: Home,
  SEASONAL: Anchor,
  CARAVAN: Caravan,
  PITCH: MapPin,
};

export default async function SettingsPage() {
  const session = await requireAuth();
  const [settings, units, laundryMachines] = await Promise.all([
    getGlobalSettings(),
    getUnits(),
    getLaundryMachines(),
  ]);

  const sortedUnits = [...units].sort((a, b) => {
    const typeA = typeOrder.indexOf(a.type);
    const typeB = typeOrder.indexOf(b.type);
    if (typeA !== typeB) return typeA - typeB;
    return a.name.localeCompare(b.name, "da-DK", { numeric: true });
  });

  const groupedUnits = typeOrder
    .map((type) => ({
      type,
      label: typeLabels[type],
      icon: typeIcons[type],
      units: sortedUnits.filter((u) => u.type === type),
    }))
    .filter((g) => g.units.length > 0);

  const hardwareContent = (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Hardware per enhed</h2>
        <p className="text-sm text-muted-foreground mb-5">
          Konfigurér sensorer og enheder fra Home Assistant. Hver enhed har sine egne entity IDs.
        </p>
        {units.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Ingen enheder oprettet endnu. Tilføj enheder fra dashboard.
          </p>
        ) : (
          <div className="space-y-6">
            {groupedUnits.map((group) => {
              const Icon = group.icon;
              return (
                <div key={group.type}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-medium text-muted-foreground">{group.label}</h3>
                  </div>
                  <div className="space-y-2">
                    {group.units.map((unit) => (
                      <CabinHardwareForm
                        key={unit.id}
                        cabin={{ id: unit.id, name: unit.name, type: unit.type }}
                        hardware={unit.hardware}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const systemContent = (
    <div className="space-y-6">
      <SystemStatus />
      <div className="border-t border-border" />
      <ChangePasswordForm userId={session.userId!} />
    </div>
  );

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Indstillinger</h1>
        <p className="text-muted-foreground mt-1">
          Konfigurér priser, Home Assistant, notifikationer og hardware.
        </p>
      </div>

      <SettingsTabs>
        {{
          general: <GeneralSettings settings={settings} />,
          ha: <HASettings settings={settings} />,
          notifications: <NotificationSettings settings={settings} />,
          payment: <PaymentSettings settings={settings} />,
          guest: <GuestPortalSettings settings={settings} />,
          hardware: hardwareContent,
          laundry: <LaundrySettings machines={laundryMachines.map((m) => ({ id: m.id, name: m.name, switchEntityId: m.switchEntityId, durationMinutes: m.durationMinutes, pricePerUse: m.pricePerUse, enabled: m.enabled }))} />,
          system: systemContent,
        }}
      </SettingsTabs>
    </div>
  );
}
