"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateUnitHardware } from "@/lib/actions";

interface CabinHardwareFormProps {
  cabin: { id: number; name: string };
  hardware: {
    hasElectricity: boolean;
    electricitySwitchEntityId: string | null;
    electricityMeterEntityId: string | null;
    hasWater: boolean;
    waterMeterEntityId: string | null;
    hasClimate: boolean;
    climateEntityId: string | null;
    hasSmartLock: boolean;
    lockEntityId: string | null;
  } | null;
}

export function CabinHardwareForm({ cabin, hardware }: CabinHardwareFormProps) {
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState(false);

  const [values, setValues] = useState({
    hasElectricity: hardware?.hasElectricity ?? false,
    electricitySwitchEntityId: hardware?.electricitySwitchEntityId ?? "",
    electricityMeterEntityId: hardware?.electricityMeterEntityId ?? "",
    hasWater: hardware?.hasWater ?? false,
    waterMeterEntityId: hardware?.waterMeterEntityId ?? "",
    hasClimate: hardware?.hasClimate ?? false,
    climateEntityId: hardware?.climateEntityId ?? "",
    hasSmartLock: hardware?.hasSmartLock ?? false,
    lockEntityId: hardware?.lockEntityId ?? "",
  });

  function handleSave() {
    startTransition(async () => {
      await updateUnitHardware(cabin.id, {
        hasElectricity: values.hasElectricity,
        electricitySwitchEntityId: values.electricitySwitchEntityId || null,
        electricityMeterEntityId: values.electricityMeterEntityId || null,
        hasWater: values.hasWater,
        waterMeterEntityId: values.waterMeterEntityId || null,
        hasClimate: values.hasClimate,
        climateEntityId: values.climateEntityId || null,
        hasSmartLock: values.hasSmartLock,
        lockEntityId: values.lockEntityId || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  }

  const capabilities = [
    hardware?.hasElectricity && "El",
    hardware?.hasWater && "Vand",
    hardware?.hasClimate && "Klima",
    hardware?.hasSmartLock && "Lås",
  ].filter(Boolean);

  return (
    <div className="rounded-lg border bg-card">
      <button
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-accent/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{cabin.name}</span>
          {capabilities.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              ({capabilities.join(", ")})
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-4 space-y-5">
          {/* Electricity */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Elektricitet</Label>
              <Switch
                checked={values.hasElectricity}
                onCheckedChange={(checked) =>
                  setValues((v) => ({ ...v, hasElectricity: checked }))
                }
              />
            </div>
            {values.hasElectricity && (
              <div className="space-y-2 pl-3 border-l-2 border-border">
                <div>
                  <Label className="text-[11px] text-muted-foreground">Switch Entity ID</Label>
                  <Input
                    value={values.electricitySwitchEntityId}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, electricitySwitchEntityId: e.target.value }))
                    }
                    placeholder="switch.cabin_1_power"
                    className="mt-1 h-7 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Meter Entity ID (kWh)</Label>
                  <Input
                    value={values.electricityMeterEntityId}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, electricityMeterEntityId: e.target.value }))
                    }
                    placeholder="sensor.cabin_1_energy"
                    className="mt-1 h-7 text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Water */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Vand</Label>
              <Switch
                checked={values.hasWater}
                onCheckedChange={(checked) =>
                  setValues((v) => ({ ...v, hasWater: checked }))
                }
              />
            </div>
            {values.hasWater && (
              <div className="pl-3 border-l-2 border-border">
                <Label className="text-[11px] text-muted-foreground">Meter Entity ID (liter)</Label>
                <Input
                  value={values.waterMeterEntityId}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, waterMeterEntityId: e.target.value }))
                  }
                  placeholder="sensor.cabin_1_water"
                  className="mt-1 h-7 text-xs"
                />
              </div>
            )}
          </div>

          {/* Climate */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Klima</Label>
              <Switch
                checked={values.hasClimate}
                onCheckedChange={(checked) =>
                  setValues((v) => ({ ...v, hasClimate: checked }))
                }
              />
            </div>
            {values.hasClimate && (
              <div className="pl-3 border-l-2 border-border">
                <Label className="text-[11px] text-muted-foreground">Climate Entity ID</Label>
                <Input
                  value={values.climateEntityId}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, climateEntityId: e.target.value }))
                  }
                  placeholder="climate.cabin_1_hvac"
                  className="mt-1 h-7 text-xs"
                />
              </div>
            )}
          </div>

          {/* Smart Lock */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Smart lås</Label>
              <Switch
                checked={values.hasSmartLock}
                onCheckedChange={(checked) =>
                  setValues((v) => ({ ...v, hasSmartLock: checked }))
                }
              />
            </div>
            {values.hasSmartLock && (
              <div className="pl-3 border-l-2 border-border">
                <Label className="text-[11px] text-muted-foreground">Lock Entity ID</Label>
                <Input
                  value={values.lockEntityId}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, lockEntityId: e.target.value }))
                  }
                  placeholder="lock.cabin_1_door"
                  className="mt-1 h-7 text-xs"
                />
              </div>
            )}
          </div>

          <Button onClick={handleSave} disabled={isPending} size="sm" className="h-8 text-xs">
            <Save className="h-3 w-3 mr-1.5" />
            {isPending ? "Gemmer..." : saved ? "Gemt!" : "Gem hardware"}
          </Button>
        </div>
      )}
    </div>
  );
}
