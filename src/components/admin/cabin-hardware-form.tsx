"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateCabinHardware } from "@/lib/actions";

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
      await updateCabinHardware(cabin.id, {
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
    <Card>
      <button
        className="w-full p-4 flex items-center justify-between text-left hover:bg-accent/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div>
          <span className="font-medium">{cabin.name}</span>
          {capabilities.length > 0 && (
            <span className="text-sm text-muted-foreground ml-2">
              ({capabilities.join(", ")})
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>

      {expanded && (
        <CardContent className="border-t space-y-6 pt-4">
          {/* Electricity */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-medium">Elektricitet</Label>
              <Switch
                checked={values.hasElectricity}
                onCheckedChange={(checked) =>
                  setValues((v) => ({ ...v, hasElectricity: checked }))
                }
              />
            </div>
            {values.hasElectricity && (
              <div className="space-y-2 pl-4 border-l-2">
                <div>
                  <Label className="text-xs">Switch Entity ID</Label>
                  <Input
                    value={values.electricitySwitchEntityId}
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        electricitySwitchEntityId: e.target.value,
                      }))
                    }
                    placeholder="switch.cabin_1_power"
                    className="text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Meter Entity ID (kWh)</Label>
                  <Input
                    value={values.electricityMeterEntityId}
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        electricityMeterEntityId: e.target.value,
                      }))
                    }
                    placeholder="sensor.cabin_1_energy"
                    className="text-sm"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Water */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-medium">Vand</Label>
              <Switch
                checked={values.hasWater}
                onCheckedChange={(checked) =>
                  setValues((v) => ({ ...v, hasWater: checked }))
                }
              />
            </div>
            {values.hasWater && (
              <div className="pl-4 border-l-2">
                <Label className="text-xs">Meter Entity ID (liter)</Label>
                <Input
                  value={values.waterMeterEntityId}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      waterMeterEntityId: e.target.value,
                    }))
                  }
                  placeholder="sensor.cabin_1_water"
                  className="text-sm"
                />
              </div>
            )}
          </div>

          {/* Climate */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-medium">Klima</Label>
              <Switch
                checked={values.hasClimate}
                onCheckedChange={(checked) =>
                  setValues((v) => ({ ...v, hasClimate: checked }))
                }
              />
            </div>
            {values.hasClimate && (
              <div className="pl-4 border-l-2">
                <Label className="text-xs">Climate Entity ID</Label>
                <Input
                  value={values.climateEntityId}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      climateEntityId: e.target.value,
                    }))
                  }
                  placeholder="climate.cabin_1_hvac"
                  className="text-sm"
                />
              </div>
            )}
          </div>

          {/* Smart Lock */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-medium">Smart lås</Label>
              <Switch
                checked={values.hasSmartLock}
                onCheckedChange={(checked) =>
                  setValues((v) => ({ ...v, hasSmartLock: checked }))
                }
              />
            </div>
            {values.hasSmartLock && (
              <div className="pl-4 border-l-2">
                <Label className="text-xs">Lock Entity ID</Label>
                <Input
                  value={values.lockEntityId}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      lockEntityId: e.target.value,
                    }))
                  }
                  placeholder="lock.cabin_1_door"
                  className="text-sm"
                />
              </div>
            )}
          </div>

          <Button onClick={handleSave} disabled={isPending} size="sm">
            <Save className="h-4 w-4 mr-2" />
            {isPending ? "Gemmer..." : saved ? "Gemt!" : "Gem hardware"}
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
