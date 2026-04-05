"use client";

import { useState, useTransition } from "react";
import { Save, Wifi, WifiOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateMultipleSettings, testHAConnection } from "@/lib/actions";

interface SettingsFormProps {
  settings: Record<string, string>;
}

export function SettingsForm({ settings }: SettingsFormProps) {
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState({
    site_url: settings.site_url || "http://localhost:3000",
    ha_url: settings.ha_url || "http://homeassistant.local:8123",
    ha_token: settings.ha_token || "",
    price_per_kwh: settings.price_per_kwh || "2.50",
    price_per_liter_water: settings.price_per_liter_water || "0.05",
    currency: settings.currency || "DKK",
    default_occupied_temp: settings.default_occupied_temp || "21",
    default_vacant_temp: settings.default_vacant_temp || "15",
    auto_power_off_on_checkout: settings.auto_power_off_on_checkout || "false",
    invoice_email_enabled: settings.invoice_email_enabled || "false",
    invoice_email_day: settings.invoice_email_day || "1",
    // Twilio
    twilio_account_sid: settings.twilio_account_sid || "",
    twilio_auth_token: settings.twilio_auth_token || "",
    twilio_phone_number: settings.twilio_phone_number || "",
    // SMTP
    smtp_host: settings.smtp_host || "",
    smtp_port: settings.smtp_port || "587",
    smtp_user: settings.smtp_user || "",
    smtp_pass: settings.smtp_pass || "",
    smtp_from: settings.smtp_from || "",
    // Notifications
    notifications_sms_enabled: settings.notifications_sms_enabled || "false",
    notifications_email_enabled: settings.notifications_email_enabled || "false",
    // Alarm
    alarm_enabled: settings.alarm_enabled || "false",
    alarm_kwh_threshold: settings.alarm_kwh_threshold || "10",
    alarm_water_threshold: settings.alarm_water_threshold || "500",
    alarm_hours_window: settings.alarm_hours_window || "24",
  });
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  function handleChange(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    setSaved(false);
  }

  function handleSave() {
    startTransition(async () => {
      await updateMultipleSettings(
        Object.entries(values).map(([key, value]) => ({ key, value }))
      );
      setSaved(true);
      setTestResult(null);
      setTimeout(() => setSaved(false), 3000);
    });
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      await updateMultipleSettings(
        Object.entries(values).map(([key, value]) => ({ key, value }))
      );
      const result = await testHAConnection();
      setTestResult(result);
    } catch {
      setTestResult({ ok: false, message: "Uventet fejl under test" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Site URL */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Generelt</h2>
        </div>
        <div className="p-5">
          <div>
            <Label htmlFor="site_url" className="text-sm text-muted-foreground">Site URL</Label>
            <Input
              id="site_url"
              value={values.site_url}
              onChange={(e) => handleChange("site_url", e.target.value)}
              placeholder="http://192.168.1.100:3000"
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Bruges til links i SMS og email-notifikationer
            </p>
          </div>
        </div>
      </div>

      {/* Home Assistant Connection */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Home Assistant</h2>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <Label htmlFor="ha_url" className="text-sm text-muted-foreground">HA URL</Label>
            <Input
              id="ha_url"
              value={values.ha_url}
              onChange={(e) => handleChange("ha_url", e.target.value)}
              placeholder="http://192.168.1.13:8123"
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Skal starte med http:// eller https://
            </p>
          </div>
          <div>
            <Label htmlFor="ha_token" className="text-sm text-muted-foreground">Long-Lived Access Token</Label>
            <Input
              id="ha_token"
              type="password"
              value={values.ha_token}
              onChange={(e) => handleChange("ha_token", e.target.value)}
              placeholder="Indsæt dit HA access token"
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              HA &rarr; Profil &rarr; Langvarige adgangstokener
            </p>
          </div>

          {/* Test connection */}
          <div className="pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Wifi className="h-4 w-4 mr-2" />
              )}
              {testing ? "Tester..." : "Test forbindelse"}
            </Button>

            {testResult && (
              <div className={`mt-3 flex items-start gap-2.5 text-sm p-3 rounded-lg ${
                testResult.ok
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-600"
              }`}>
                {testResult.ok ? (
                  <Wifi className="h-4 w-4 shrink-0 mt-0.5" />
                ) : (
                  <WifiOff className="h-4 w-4 shrink-0 mt-0.5" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pricing */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Priser</h2>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="price_per_kwh" className="text-sm text-muted-foreground">Pris per kWh</Label>
              <Input
                id="price_per_kwh"
                type="number"
                step="0.01"
                value={values.price_per_kwh}
                onChange={(e) => handleChange("price_per_kwh", e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="price_per_liter_water" className="text-sm text-muted-foreground">Pris per liter vand</Label>
              <Input
                id="price_per_liter_water"
                type="number"
                step="0.01"
                value={values.price_per_liter_water}
                onChange={(e) => handleChange("price_per_liter_water", e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="currency" className="text-sm text-muted-foreground">Valuta</Label>
            <Input
              id="currency"
              value={values.currency}
              onChange={(e) => handleChange("currency", e.target.value)}
              className="mt-1 w-24"
            />
          </div>
        </div>
      </div>

      {/* Default Temperatures */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Standard temperaturer</h2>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="default_occupied_temp" className="text-sm text-muted-foreground">Optaget (°C)</Label>
              <Input
                id="default_occupied_temp"
                type="number"
                value={values.default_occupied_temp}
                onChange={(e) => handleChange("default_occupied_temp", e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="default_vacant_temp" className="text-sm text-muted-foreground">Ledig (°C)</Label>
              <Input
                id="default_vacant_temp"
                type="number"
                value={values.default_vacant_temp}
                onChange={(e) => handleChange("default_vacant_temp", e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Checkout Settings */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Check-out</h2>
        </div>
        <div className="p-5 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={values.auto_power_off_on_checkout === "true"}
              onChange={(e) => handleChange("auto_power_off_on_checkout", e.target.checked ? "true" : "false")}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <div>
              <p className="text-sm font-medium">Sluk strøm automatisk ved check-out</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Når en gæst betaler og checker ud, slukkes strømmen og døren låses automatisk
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Notifications — SMS */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">SMS-notifikationer (Twilio)</h2>
        </div>
        <div className="p-5 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={values.notifications_sms_enabled === "true"}
              onChange={(e) => handleChange("notifications_sms_enabled", e.target.checked ? "true" : "false")}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <div>
              <p className="text-sm font-medium">Aktivér SMS-notifikationer</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Send SMS til gæster ved check-in og faktura til fastliggere
              </p>
            </div>
          </label>

          {values.notifications_sms_enabled === "true" && (
            <div className="space-y-3 pt-1">
              <div>
                <Label className="text-sm text-muted-foreground">Account SID</Label>
                <Input
                  value={values.twilio_account_sid}
                  onChange={(e) => handleChange("twilio_account_sid", e.target.value)}
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Auth Token</Label>
                <Input
                  type="password"
                  value={values.twilio_auth_token}
                  onChange={(e) => handleChange("twilio_auth_token", e.target.value)}
                  placeholder="Dit Twilio auth token"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Telefonnummer (afsender)</Label>
                <Input
                  value={values.twilio_phone_number}
                  onChange={(e) => handleChange("twilio_phone_number", e.target.value)}
                  placeholder="+45XXXXXXXX"
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  Dit Twilio-telefonnummer med landekode
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Notifications — Email */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Email-notifikationer (SMTP)</h2>
        </div>
        <div className="p-5 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={values.notifications_email_enabled === "true"}
              onChange={(e) => handleChange("notifications_email_enabled", e.target.checked ? "true" : "false")}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <div>
              <p className="text-sm font-medium">Aktivér email-notifikationer</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Send email til gæster ved check-in og faktura til fastliggere
              </p>
            </div>
          </label>

          {values.notifications_email_enabled === "true" && (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm text-muted-foreground">SMTP Host</Label>
                  <Input
                    value={values.smtp_host}
                    onChange={(e) => handleChange("smtp_host", e.target.value)}
                    placeholder="smtp.gmail.com"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Port</Label>
                  <Input
                    type="number"
                    value={values.smtp_port}
                    onChange={(e) => handleChange("smtp_port", e.target.value)}
                    placeholder="587"
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Brugernavn</Label>
                <Input
                  value={values.smtp_user}
                  onChange={(e) => handleChange("smtp_user", e.target.value)}
                  placeholder="din@email.dk"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Adgangskode</Label>
                <Input
                  type="password"
                  value={values.smtp_pass}
                  onChange={(e) => handleChange("smtp_pass", e.target.value)}
                  placeholder="App-adgangskode"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Afsender-adresse (valgfri)</Label>
                <Input
                  value={values.smtp_from}
                  onChange={(e) => handleChange("smtp_from", e.target.value)}
                  placeholder="noreply@camping.dk"
                  className="mt-1"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Invoice Email Settings */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Faktura-email (fastliggere)</h2>
        </div>
        <div className="p-5 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={values.invoice_email_enabled === "true"}
              onChange={(e) => handleChange("invoice_email_enabled", e.target.checked ? "true" : "false")}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <div>
              <p className="text-sm font-medium">Send faktura automatisk via email/SMS</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Fastliggere modtager automatisk en faktura med link til deres gæsteportal
              </p>
            </div>
          </label>

          {values.invoice_email_enabled === "true" && (
            <div>
              <Label className="text-sm text-muted-foreground">Send faktura den</Label>
              <div className="flex items-center gap-3 mt-1">
                <select
                  value={values.invoice_email_day}
                  onChange={(e) => handleChange("invoice_email_day", e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="1">1. i måneden</option>
                  <option value="14">14. i måneden</option>
                </select>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Fakturaen dækker forbruget fra den foregående måned
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Consumption Alarm */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Forbrugsalarm</h2>
        </div>
        <div className="p-5 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={values.alarm_enabled === "true"}
              onChange={(e) => handleChange("alarm_enabled", e.target.checked ? "true" : "false")}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <div>
              <p className="text-sm font-medium">Aktivér forbrugsalarm</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Få besked hvis en enhed bruger mere end grænseværdien inden for tidsvinduet
              </p>
            </div>
          </label>

          {values.alarm_enabled === "true" && (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm text-muted-foreground">El-grænse (kWh)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={values.alarm_kwh_threshold}
                    onChange={(e) => handleChange("alarm_kwh_threshold", e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Vand-grænse (liter)</Label>
                  <Input
                    type="number"
                    step="10"
                    value={values.alarm_water_threshold}
                    onChange={(e) => handleChange("alarm_water_threshold", e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Tidsvindue (timer)</Label>
                <Input
                  type="number"
                  value={values.alarm_hours_window}
                  onChange={(e) => handleChange("alarm_hours_window", e.target.value)}
                  className="mt-1 w-24"
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  Alarm udløses hvis grænsen overskrides inden for dette antal timer
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <Button onClick={handleSave} disabled={isPending} size="sm">
        <Save className="h-4 w-4 mr-2" />
        {isPending ? "Gemmer..." : saved ? "Gemt!" : "Gem indstillinger"}
      </Button>
    </div>
  );
}
