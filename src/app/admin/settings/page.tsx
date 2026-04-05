import { getGlobalSettings, getUnits } from "@/lib/actions";
import { requireAuth } from "@/lib/auth";
import { SettingsForm } from "@/components/admin/settings-form";
import { CabinHardwareForm } from "@/components/admin/cabin-hardware-form";
import { ChangePasswordForm } from "@/components/admin/change-password-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireAuth();
  const [settings, units] = await Promise.all([
    getGlobalSettings(),
    getUnits(),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-lg font-semibold">Indstillinger</h1>
        <p className="text-muted-foreground text-xs mt-0.5">
          Home Assistant, priser og hardware konfiguration.
        </p>
      </div>

      <SettingsForm settings={settings} />

      <div className="border-t border-border" />

      <div>
        <h2 className="text-sm font-medium mb-1">Hardware per enhed</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Konfigurér sensorer og enheder fra Home Assistant for hver enhed. Hver enhed har sine egne entity IDs.
        </p>
        {units.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">
            Ingen enheder oprettet endnu. Tilføj enheder fra dashboard.
          </p>
        ) : (
          <div className="space-y-2">
            {units.map((unit) => (
              <CabinHardwareForm key={unit.id} cabin={unit} hardware={unit.hardware} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border" />

      <ChangePasswordForm userId={session.userId!} />
    </div>
  );
}
