"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  ZapOff,
  Lock,
  Unlock,
  Thermometer,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { togglePower, toggleLock, setTemperature } from "@/lib/actions";

interface UnitControlsProps {
  unitId: number;
  hardware: {
    hasElectricity: boolean;
    hasWater: boolean;
    hasClimate: boolean;
    hasSmartLock: boolean;
  };
  haStates: {
    powerOn: boolean | null;
    temperature: number | null;
    locked: boolean | null;
    haReachable: boolean;
  } | null;
}

export function CabinControls({
  unitId,
  hardware,
  haStates,
}: UnitControlsProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [localPowerOn, setLocalPowerOn] = useState(haStates?.powerOn ?? false);
  const [localLocked, setLocalLocked] = useState(haStates?.locked ?? true);
  const [tempValue, setTempValue] = useState(
    haStates?.temperature?.toString() ?? "21"
  );

  if (!haStates?.haReachable) {
    return (
      <div className="rounded-xl border bg-card shadow-sm p-5">
        <div className="flex items-center gap-2 text-orange-500">
          <WifiOff className="h-5 w-5" />
          <span className="font-medium">Home Assistant utilgængelig</span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Prøv igen senere.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="font-semibold">Hardware kontrol</h2>
      </div>
      <div className="p-5 space-y-4">
        {hardware.hasElectricity && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {localPowerOn ? (
                <Zap className="h-5 w-5 text-yellow-500" />
              ) : (
                <ZapOff className="h-5 w-5 text-muted-foreground/40" />
              )}
              <span>Strøm</span>
            </div>
            <Button
              variant={localPowerOn ? "destructive" : "default"}
              size="sm"
              disabled={isPending}
              onClick={() => {
                const newState = !localPowerOn;
                setLocalPowerOn(newState);
                startTransition(async () => {
                  await togglePower(unitId, newState);
                  router.refresh();
                });
              }}
            >
              {localPowerOn ? "Sluk" : "Tænd"}
            </Button>
          </div>
        )}

        {hardware.hasSmartLock && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {localLocked ? (
                <Lock className="h-5 w-5 text-muted-foreground/50" />
              ) : (
                <Unlock className="h-5 w-5 text-primary" />
              )}
              <span>Lås</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => {
                const newState = !localLocked;
                setLocalLocked(newState);
                startTransition(async () => {
                  await toggleLock(unitId, newState);
                  router.refresh();
                });
              }}
            >
              {localLocked ? "Lås op" : "Lås"}
            </Button>
          </div>
        )}

        {hardware.hasClimate && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Thermometer className="h-5 w-5 text-blue-500" />
              <span>
                {haStates.temperature !== null ? `${haStates.temperature}°C` : "—"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min="15"
                max="25"
                value={tempValue}
                onChange={(e) => setTempValue(e.target.value)}
                className="w-16 h-8 text-sm border rounded-md px-2 bg-background border-border"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    await setTemperature(unitId, parseFloat(tempValue));
                    router.refresh();
                  })
                }
              >
                Sæt
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
