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
              <p className="text-sm font-medium">Send faktura automatisk via email</p>
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

      <Button onClick={handleSave} disabled={isPending} size="sm">
        <Save className="h-4 w-4 mr-2" />
        {isPending ? "Gemmer..." : saved ? "Gemt!" : "Gem indstillinger"}
      </Button>
    </div>
  );
}
