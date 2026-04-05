"use client";

import { useState, useTransition } from "react";
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
  const [tempValue, setTempValue] = useState(
    haStates?.temperature?.toString() ?? "21"
  );

  if (!haStates?.haReachable) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 text-orange-400/80">
          <WifiOff className="h-4 w-4" />
          <span className="text-sm">Home Assistant utilgængelig</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Prøv igen senere.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium">Hardware kontrol</h2>
      </div>
      <div className="p-4 space-y-3">
        {hardware.hasElectricity && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {haStates.powerOn ? (
                <Zap className="h-4 w-4 text-yellow-400/80" />
              ) : (
                <ZapOff className="h-4 w-4 text-muted-foreground/40" />
              )}
              <span className="text-sm">Strøm</span>
            </div>
            <Button
              variant={haStates.powerOn ? "destructive" : "default"}
              size="sm"
              className="h-7 text-xs"
              disabled={isPending}
              onClick={() =>
                startTransition(() => togglePower(unitId, !haStates.powerOn))
              }
            >
              {haStates.powerOn ? "Sluk" : "Tænd"}
            </Button>
          </div>
        )}

        {hardware.hasSmartLock && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {haStates.locked ? (
                <Lock className="h-4 w-4 text-muted-foreground/60" />
              ) : (
                <Unlock className="h-4 w-4 text-primary/70" />
              )}
              <span className="text-sm">Lås</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={isPending}
              onClick={() =>
                startTransition(() => toggleLock(unitId, !haStates.locked))
              }
            >
              {haStates.locked ? "Lås op" : "Lås"}
            </Button>
          </div>
        )}

        {hardware.hasClimate && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-blue-400/80" />
              <span className="text-sm">
                {haStates.temperature !== null ? `${haStates.temperature}°C` : "—"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="15"
                max="25"
                value={tempValue}
                onChange={(e) => setTempValue(e.target.value)}
                className="w-14 h-7 text-xs border rounded-md px-2 bg-input border-border"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={isPending}
                onClick={() =>
                  startTransition(() =>
                    setTemperature(unitId, parseFloat(tempValue))
                  )
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
