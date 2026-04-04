import {
  getGlobalSettings,
  getCabins,
} from "@/lib/actions";
import { requireAuth } from "@/lib/auth";
import { SettingsForm } from "@/components/admin/settings-form";
import { CabinHardwareForm } from "@/components/admin/cabin-hardware-form";
import { ChangePasswordForm } from "@/components/admin/change-password-form";
import { Separator } from "@/components/ui/separator";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireAuth();
  const [settings, cabins] = await Promise.all([
    getGlobalSettings(),
    getCabins(),
  ]);

  return (
    <div className="p-6 space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Indstillinger</h1>
        <p className="text-muted-foreground">
          Konfigurér Home Assistant, priser og hardware.
        </p>
      </div>

      {/* HA Connection & Pricing */}
      <SettingsForm settings={settings} />

      <Separator />

      {/* Cabin Hardware Mapping */}
      <div>
        <h2 className="text-lg font-semibold mb-4">
          Hardware konfiguration per hytte
        </h2>
        {cabins.length === 0 ? (
          <p className="text-muted-foreground">
            Ingen hytter oprettet endnu. Tilføj hytter fra oversigten.
          </p>
        ) : (
          <div className="space-y-4">
            {cabins.map((cabin) => (
              <CabinHardwareForm
                key={cabin.id}
                cabin={cabin}
                hardware={cabin.hardware}
              />
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* Change Password */}
      <ChangePasswordForm userId={session.userId!} />
    </div>
  );
}
