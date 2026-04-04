import { getGlobalSettings, getUnits } from "@/lib/actions";
import { requireAuth } from "@/lib/auth";
import { SettingsForm } from "@/components/admin/settings-form";
import { CabinHardwareForm } from "@/components/admin/cabin-hardware-form";
import { ChangePasswordForm } from "@/components/admin/change-password-form";
import { Separator } from "@/components/ui/separator";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireAuth();
  const [settings, units] = await Promise.all([
    getGlobalSettings(),
    getUnits(),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Indstillinger</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Konfigurér Home Assistant, priser og hardware.
        </p>
      </div>

      <SettingsForm settings={settings} />

      <Separator />

      <div>
        <h2 className="text-lg font-semibold mb-4">Hardware konfiguration per enhed</h2>
        {units.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Ingen enheder oprettet endnu. Tilføj enheder fra oversigten.
          </p>
        ) : (
          <div className="space-y-3">
            {units.map((unit) => (
              <CabinHardwareForm key={unit.id} cabin={unit} hardware={unit.hardware} />
            ))}
          </div>
        )}
      </div>

      <Separator />

      <ChangePasswordForm userId={session.userId!} />
    </div>
  );
}
