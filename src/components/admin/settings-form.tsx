"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateMultipleSettings } from "@/lib/actions";

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
      setTimeout(() => setSaved(false), 3000);
    });
  }

  return (
    <div className="space-y-6">
      {/* Home Assistant Connection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Home Assistant</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="ha_url">HA URL</Label>
            <Input
              id="ha_url"
              value={values.ha_url}
              onChange={(e) => handleChange("ha_url", e.target.value)}
              placeholder="http://homeassistant.local:8123"
            />
          </div>
          <div>
            <Label htmlFor="ha_token">Long-Lived Access Token</Label>
            <Input
              id="ha_token"
              type="password"
              value={values.ha_token}
              onChange={(e) => handleChange("ha_token", e.target.value)}
              placeholder="Indsæt dit HA access token"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Opret under HA &rarr; Profil &rarr; Langvarige adgangstokener
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Pricing */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Priser</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="price_per_kwh">Pris per kWh</Label>
              <Input
                id="price_per_kwh"
                type="number"
                step="0.01"
                value={values.price_per_kwh}
                onChange={(e) => handleChange("price_per_kwh", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="price_per_liter_water">Pris per liter vand</Label>
              <Input
                id="price_per_liter_water"
                type="number"
                step="0.01"
                value={values.price_per_liter_water}
                onChange={(e) =>
                  handleChange("price_per_liter_water", e.target.value)
                }
              />
            </div>
          </div>
          <div>
            <Label htmlFor="currency">Valuta</Label>
            <Input
              id="currency"
              value={values.currency}
              onChange={(e) => handleChange("currency", e.target.value)}
              className="w-24"
            />
          </div>
        </CardContent>
      </Card>

      {/* Default Temperatures */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Standard temperaturer</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="default_occupied_temp">
                Optaget (°C)
              </Label>
              <Input
                id="default_occupied_temp"
                type="number"
                value={values.default_occupied_temp}
                onChange={(e) =>
                  handleChange("default_occupied_temp", e.target.value)
                }
              />
            </div>
            <div>
              <Label htmlFor="default_vacant_temp">
                Ledig (°C)
              </Label>
              <Input
                id="default_vacant_temp"
                type="number"
                value={values.default_vacant_temp}
                onChange={(e) =>
                  handleChange("default_vacant_temp", e.target.value)
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={isPending}>
        <Save className="h-4 w-4 mr-2" />
        {isPending ? "Gemmer..." : saved ? "Gemt!" : "Gem indstillinger"}
      </Button>
    </div>
  );
}
