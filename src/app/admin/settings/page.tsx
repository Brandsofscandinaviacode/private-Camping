import { getGlobalSettings, getUnits } from "@/lib/actions";
import { requireAuth } from "@/lib/auth";
import { SettingsForm } from "@/components/admin/settings-form";
import { CabinHardwareForm } from "@/components/admin/cabin-hardware-form";
import { ChangePasswordForm } from "@/components/admin/change-password-form";
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
  const [settings, units] = await Promise.all([
    getGlobalSettings(),
    getUnits(),
  ]);

  // Sort units by type order, then by name
  const sortedUnits = [...units].sort((a, b) => {
    const typeA = typeOrder.indexOf(a.type);
    const typeB = typeOrder.indexOf(b.type);
    if (typeA !== typeB) return typeA - typeB;
    return a.name.localeCompare(b.name, "da-DK", { numeric: true });
  });

  // Group by type
  const groupedUnits = typeOrder
    .map((type) => ({
      type,
      label: typeLabels[type],
      icon: typeIcons[type],
      units: sortedUnits.filter((u) => u.type === type),
    }))
    .filter((g) => g.units.length > 0);

  return (
    <div className="p-8 lg:p-10 space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Indstillinger</h1>
        <p className="text-muted-foreground mt-1">
          Home Assistant, priser og hardware konfiguration.
        </p>
      </div>

      <SettingsForm settings={settings} />

      <div className="border-t border-border" />

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

      <div className="border-t border-border" />

      <ChangePasswordForm userId={session.userId!} />
    </div>
  );
}
