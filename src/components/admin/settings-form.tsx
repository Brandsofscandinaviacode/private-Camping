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
    // Save first, then test
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
    <div className="space-y-4">
      {/* Home Assistant Connection */}
      <div className="rounded-lg border bg-card">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium">Home Assistant</h2>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <Label htmlFor="ha_url" className="text-xs text-muted-foreground">HA URL</Label>
            <Input
              id="ha_url"
              value={values.ha_url}
              onChange={(e) => handleChange("ha_url", e.target.value)}
              placeholder="http://192.168.1.13:8123"
              className="mt-1 h-8 text-sm"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Skal starte med http:// eller https://
            </p>
          </div>
          <div>
            <Label htmlFor="ha_token" className="text-xs text-muted-foreground">Long-Lived Access Token</Label>
            <Input
              id="ha_token"
              type="password"
              value={values.ha_token}
              onChange={(e) => handleChange("ha_token", e.target.value)}
              placeholder="Indsæt dit HA access token"
              className="mt-1 h-8 text-sm"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              HA &rarr; Profil &rarr; Langvarige adgangstokener
            </p>
          </div>

          {/* Test connection */}
          <div className="pt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? (
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
              ) : (
                <Wifi className="h-3 w-3 mr-1.5" />
              )}
              {testing ? "Tester..." : "Test forbindelse"}
            </Button>

            {testResult && (
              <div className={`mt-2 flex items-start gap-2 text-xs p-2.5 rounded-md ${
                testResult.ok
                  ? "bg-primary/10 text-primary"
                  : "bg-destructive/10 text-destructive"
              }`}>
                {testResult.ok ? (
                  <Wifi className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pricing */}
      <div className="rounded-lg border bg-card">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium">Priser</h2>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="price_per_kwh" className="text-xs text-muted-foreground">Pris per kWh</Label>
              <Input
                id="price_per_kwh"
                type="number"
                step="0.01"
                value={values.price_per_kwh}
                onChange={(e) => handleChange("price_per_kwh", e.target.value)}
                className="mt-1 h-8 text-sm"
              />
            </div>
            <div>
              <Label htmlFor="price_per_liter_water" className="text-xs text-muted-foreground">Pris per liter vand</Label>
              <Input
                id="price_per_liter_water"
                type="number"
                step="0.01"
                value={values.price_per_liter_water}
                onChange={(e) => handleChange("price_per_liter_water", e.target.value)}
                className="mt-1 h-8 text-sm"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="currency" className="text-xs text-muted-foreground">Valuta</Label>
            <Input
              id="currency"
              value={values.currency}
              onChange={(e) => handleChange("currency", e.target.value)}
              className="mt-1 h-8 text-sm w-20"
            />
          </div>
        </div>
      </div>

      {/* Default Temperatures */}
      <div className="rounded-lg border bg-card">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium">Standard temperaturer</h2>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="default_occupied_temp" className="text-xs text-muted-foreground">Optaget (°C)</Label>
              <Input
                id="default_occupied_temp"
                type="number"
                value={values.default_occupied_temp}
                onChange={(e) => handleChange("default_occupied_temp", e.target.value)}
                className="mt-1 h-8 text-sm"
              />
            </div>
            <div>
              <Label htmlFor="default_vacant_temp" className="text-xs text-muted-foreground">Ledig (°C)</Label>
              <Input
                id="default_vacant_temp"
                type="number"
                value={values.default_vacant_temp}
                onChange={(e) => handleChange("default_vacant_temp", e.target.value)}
                className="mt-1 h-8 text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      <Button onClick={handleSave} disabled={isPending} size="sm" className="h-8 text-xs">
        <Save className="h-3 w-3 mr-1.5" />
        {isPending ? "Gemmer..." : saved ? "Gemt!" : "Gem indstillinger"}
      </Button>
    </div>
  );
}
