"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateUnitHardware, testEntityId } from "@/lib/actions";

const typeLabels: Record<string, string> = {
  CABIN: "Hytte",
  SEASONAL: "Fastligger",
  CARAVAN: "Campingvogn",
  PITCH: "Plads",
};

interface CabinHardwareFormProps {
  cabin: { id: number; name: string; type: string };
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

interface TestResult {
  ok: boolean;
  value: string;
  message: string;
}

function EntityTestButton({ entityId }: { entityId: string }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  async function handleTest() {
    if (!entityId.trim()) {
      setResult({ ok: false, value: "", message: "Udfyld entity ID først" });
      return;
    }
    setTesting(true);
    setResult(null);
    try {
      const res = await testEntityId(entityId.trim());
      setResult(res);
    } catch {
      setResult({ ok: false, value: "", message: "Uventet fejl" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={handleTest}
        disabled={testing}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 flex items-center gap-1"
      >
        {testing ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <span className="inline-block h-3 w-3 text-center">▶</span>
        )}
        {testing ? "Tester..." : "Test sensor"}
      </button>
      {result && (
        <div className={`mt-1.5 text-xs px-3 py-1.5 rounded-md ${
          result.ok
            ? "bg-green-50 text-green-700"
            : "bg-red-50 text-red-600"
        }`}>
          {result.ok ? (
            <span><strong>{result.value}</strong> — {result.message}</span>
          ) : (
            <span>{result.message}</span>
          )}
        </div>
      )}
    </div>
  );
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
    <div className="rounded-xl border bg-card shadow-sm">
      <button
        className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{typeLabels[cabin.type] || cabin.type} {cabin.name}</span>
          {capabilities.length > 0 && (
            <span className="text-xs text-muted-foreground">
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
        <div className="border-t border-border px-5 py-5 space-y-5">
          {/* Electricity */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Elektricitet</Label>
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
                  <Label className="text-xs text-muted-foreground">Switch Entity ID</Label>
                  <Input
                    value={values.electricitySwitchEntityId}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, electricitySwitchEntityId: e.target.value }))
                    }
                    placeholder="switch.cabin_1_power"
                    className="mt-1"
                  />
                  <EntityTestButton entityId={values.electricitySwitchEntityId} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Meter Entity ID (kWh)</Label>
                  <Input
                    value={values.electricityMeterEntityId}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, electricityMeterEntityId: e.target.value }))
                    }
                    placeholder="sensor.cabin_1_energy"
                    className="mt-1"
                  />
                  <EntityTestButton entityId={values.electricityMeterEntityId} />
                </div>
              </div>
            )}
          </div>

          {/* Water */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Vand</Label>
              <Switch
                checked={values.hasWater}
                onCheckedChange={(checked) =>
                  setValues((v) => ({ ...v, hasWater: checked }))
                }
              />
            </div>
            {values.hasWater && (
              <div className="pl-3 border-l-2 border-border">
                <Label className="text-xs text-muted-foreground">Meter Entity ID (liter)</Label>
                <Input
                  value={values.waterMeterEntityId}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, waterMeterEntityId: e.target.value }))
                  }
                  placeholder="sensor.cabin_1_water"
                  className="mt-1"
                />
                <EntityTestButton entityId={values.waterMeterEntityId} />
              </div>
            )}
          </div>

          {/* Climate */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Klima</Label>
              <Switch
                checked={values.hasClimate}
                onCheckedChange={(checked) =>
                  setValues((v) => ({ ...v, hasClimate: checked }))
                }
              />
            </div>
            {values.hasClimate && (
              <div className="pl-3 border-l-2 border-border">
                <Label className="text-xs text-muted-foreground">Climate Entity ID</Label>
                <Input
                  value={values.climateEntityId}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, climateEntityId: e.target.value }))
                  }
                  placeholder="climate.cabin_1_hvac"
                  className="mt-1"
                />
                <EntityTestButton entityId={values.climateEntityId} />
              </div>
            )}
          </div>

          {/* Smart Lock */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Smart lås</Label>
              <Switch
                checked={values.hasSmartLock}
                onCheckedChange={(checked) =>
                  setValues((v) => ({ ...v, hasSmartLock: checked }))
                }
              />
            </div>
            {values.hasSmartLock && (
              <div className="pl-3 border-l-2 border-border">
                <Label className="text-xs text-muted-foreground">Lock Entity ID</Label>
                <Input
                  value={values.lockEntityId}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, lockEntityId: e.target.value }))
                  }
                  placeholder="lock.cabin_1_door"
                  className="mt-1"
                />
                <EntityTestButton entityId={values.lockEntityId} />
              </div>
            )}
          </div>

          <Button onClick={handleSave} disabled={isPending} size="sm">
            <Save className="h-3 w-3 mr-1.5" />
            {isPending ? "Gemmer..." : saved ? "Gemt!" : "Gem hardware"}
          </Button>
        </div>
      )}
    </div>
  );
}
