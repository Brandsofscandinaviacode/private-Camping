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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { togglePower, toggleLock, setTemperature } from "@/lib/actions";

interface CabinControlsProps {
  cabinId: number;
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
  cabinId,
  hardware,
  haStates,
}: CabinControlsProps) {
  const [isPending, startTransition] = useTransition();
  const [tempValue, setTempValue] = useState(
    haStates?.temperature?.toString() ?? "21"
  );

  if (!haStates?.haReachable) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center gap-2 text-orange-500">
            <WifiOff className="h-5 w-5" />
            <span>Home Assistant er utilgængelig</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Hardware kan ikke styres lige nu. Prøv igen senere.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Hardware kontrol</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hardware.hasElectricity && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {haStates.powerOn ? (
                <Zap className="h-5 w-5 text-yellow-500" />
              ) : (
                <ZapOff className="h-5 w-5 text-gray-400" />
              )}
              <span>Strøm</span>
            </div>
            <Button
              variant={haStates.powerOn ? "destructive" : "default"}
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(() => togglePower(cabinId, !haStates.powerOn))
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
                <Lock className="h-5 w-5 text-red-500" />
              ) : (
                <Unlock className="h-5 w-5 text-green-500" />
              )}
              <span>Lås</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(() => toggleLock(cabinId, !haStates.locked))
              }
            >
              {haStates.locked ? "Lås op" : "Lås"}
            </Button>
          </div>
        )}

        {hardware.hasClimate && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Thermometer className="h-5 w-5 text-blue-500" />
              <span>
                Temperatur:{" "}
                {haStates.temperature !== null
                  ? `${haStates.temperature}°C`
                  : "—"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="15"
                max="25"
                value={tempValue}
                onChange={(e) => setTempValue(e.target.value)}
                className="w-16 h-8 text-sm border rounded px-2"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  startTransition(() =>
                    setTemperature(cabinId, parseFloat(tempValue))
                  )
                }
              >
                Sæt
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
