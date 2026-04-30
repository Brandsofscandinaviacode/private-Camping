import { getGlobalSettings, getUnits, getResourceTypes } from "@/lib/actions";
import { requireAuth } from "@/lib/auth";
import { GeneralSettings, HASettings, MQTTSettings, NotificationSettings, PaymentSettings, AccountingSettings, BookingSettings, GuestPortalSettings } from "@/components/admin/settings-form";
import { CabinHardwareForm } from "@/components/admin/cabin-hardware-form";
import { ChangePasswordForm } from "@/components/admin/change-password-form";
import { SystemStatus } from "@/components/admin/system-status";
import { SettingsTabs } from "@/components/admin/settings-tabs";
import { ResourceTypesManager } from "@/components/admin/resource-types-manager";
import { Home } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireAuth();
  const [settings, units, resourceTypes] = await Promise.all([
    getGlobalSettings(),
    getUnits(),
    getResourceTypes(),
  ]);

  const sortedUnits = [...units].sort((a, b) => {
    const rtA = resourceTypes.findIndex((rt) => rt.id === a.resourceTypeId);
    const rtB = resourceTypes.findIndex((rt) => rt.id === b.resourceTypeId);
    if (rtA !== rtB) return rtA - rtB;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name, "da-DK", { numeric: true });
  });

  const groupedUnits = resourceTypes
    .map((rt) => ({
      id: rt.id,
      name: rt.name,
      icon: rt.icon,
      units: sortedUnits.filter((u) => u.resourceTypeId === rt.id),
    }))
    .filter((g) => g.units.length > 0);

  const uncategorized = sortedUnits.filter((u) => !u.resourceTypeId);

  const hardwareContent = (
    <div className="space-y-8">
      <ResourceTypesManager initialTypes={resourceTypes.map((rt) => ({
        id: rt.id,
        name: rt.name,
        icon: rt.icon,
        sortOrder: rt.sortOrder,
        defaultUnitType: rt.defaultUnitType,
        externalId: rt.externalId,
        externalProvider: rt.externalProvider,
        _count: rt._count,
      }))} />

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
            {groupedUnits.map((group) => (
              <div key={group.id}>
                <div className="flex items-center gap-2 mb-2">
                  <Home className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium text-muted-foreground">{group.name}</h3>
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
            ))}
            {uncategorized.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Ukategoriseret</h3>
                </div>
                <div className="space-y-2">
                  {uncategorized.map((unit) => (
                    <CabinHardwareForm
                      key={unit.id}
                      cabin={{ id: unit.id, name: unit.name, type: unit.type }}
                      hardware={unit.hardware}
                    />
                  ))}
                </div>
              </div>
            )}
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
    <div className="p-4 sm:p-6 lg:p-10 max-w-4xl">
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
          mqtt: <MQTTSettings settings={settings} />,
          notifications: <NotificationSettings settings={settings} />,
          payment: <PaymentSettings settings={settings} />,
          accounting: <AccountingSettings settings={settings} />,
          booking: <BookingSettings settings={settings} resourceTypes={resourceTypes.map((rt) => ({ id: rt.id, name: rt.name, externalId: rt.externalId, externalProvider: rt.externalProvider }))} />,
          guest: <GuestPortalSettings settings={settings} />,
          hardware: hardwareContent,
          system: systemContent,
        }}
      </SettingsTabs>
    </div>
  );
}
