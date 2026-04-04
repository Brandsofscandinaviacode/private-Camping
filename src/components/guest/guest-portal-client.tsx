"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Tent,
  Zap,
  Droplets,
  Thermometer,
  DoorOpen,
  CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  getLiveConsumption,
  guestSetTemperature,
  guestUnlockDoor,
} from "@/lib/actions";

interface GuestPortalClientProps {
  token: string;
  sessionId: number;
  guestName: string;
  cabinName: string;
  status: string;
  checkInTime: string;
  checkOutTime: string | null;
  hasClimate: boolean;
  hasSmartLock: boolean;
  hasElectricity: boolean;
  hasWater: boolean;
  totalElectricityCost: number | null;
  totalWaterCost: number | null;
  totalCost: number | null;
}

interface ConsumptionData {
  usedKwh: number | null;
  electricityCost: number | null;
  usedWaterLiters: number | null;
  waterCost: number | null;
  totalLiveCost: number | null;
  currency: string;
}

export function GuestPortalClient({
  token,
  sessionId,
  guestName,
  cabinName,
  status,
  checkInTime,
  checkOutTime,
  hasClimate,
  hasSmartLock,
  hasElectricity,
  hasWater,
  totalElectricityCost,
  totalWaterCost,
  totalCost,
}: GuestPortalClientProps) {
  const [consumption, setConsumption] = useState<ConsumptionData | null>(null);
  const [tempValue, setTempValue] = useState("21");
  const [isPending, startTransition] = useTransition();
  const [unlockMsg, setUnlockMsg] = useState("");

  const isActive = status === "ACTIVE";

  useEffect(() => {
    if (!isActive) return;

    let mounted = true;

    async function fetchConsumption() {
      try {
        const data = await getLiveConsumption(sessionId);
        if (mounted && data) setConsumption(data);
      } catch {
        // HA unavailable
      }
    }

    fetchConsumption();
    const interval = setInterval(fetchConsumption, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [sessionId, isActive]);

  function handleSetTemp() {
    startTransition(async () => {
      await guestSetTemperature(token, parseFloat(tempValue));
    });
  }

  function handleUnlock() {
    startTransition(async () => {
      await guestUnlockDoor(token);
      setUnlockMsg("Døren er låst op!");
      setTimeout(() => setUnlockMsg(""), 5000);
    });
  }

  const formatDKK = (v: number | null) =>
    v !== null ? `${v.toFixed(2)} DKK` : "—";

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white">
      {/* Header */}
      <div className="bg-green-700 text-white px-4 py-8 text-center">
        <Tent className="h-10 w-10 mx-auto mb-3" />
        <h1 className="text-2xl font-bold">Velkommen, {guestName}!</h1>
        <p className="text-green-100 mt-1">{cabinName}</p>
        <p className="text-green-200 text-sm mt-1">
          Ankomst: {new Date(checkInTime).toLocaleDateString("da-DK", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
      </div>

      <div className="max-w-md mx-auto px-4 py-6 space-y-4">
        {/* Completed session */}
        {!isActive && (
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="py-6 text-center">
              <p className="font-medium text-blue-800">
                Dit ophold er afsluttet
              </p>
              {checkOutTime && (
                <p className="text-sm text-blue-600 mt-1">
                  Afrejse:{" "}
                  {new Date(checkOutTime).toLocaleDateString("da-DK", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </p>
              )}
              {totalCost !== null && (
                <div className="mt-4 space-y-1 text-sm">
                  {totalElectricityCost !== null && (
                    <p>El: {formatDKK(totalElectricityCost)}</p>
                  )}
                  {totalWaterCost !== null && (
                    <p>Vand: {formatDKK(totalWaterCost)}</p>
                  )}
                  <p className="text-lg font-bold mt-2">
                    Total: {formatDKK(totalCost)}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Live Consumption */}
        {isActive && (hasElectricity || hasWater) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Dit forbrug</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {hasElectricity && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-yellow-500" />
                    <div>
                      <p className="text-sm font-medium">Elektricitet</p>
                      <p className="text-xs text-muted-foreground">
                        {consumption?.usedKwh != null
                          ? `${consumption.usedKwh.toFixed(2)} kWh`
                          : "Afventer data..."}
                      </p>
                    </div>
                  </div>
                  <span className="font-semibold">
                    {formatDKK(consumption?.electricityCost ?? null)}
                  </span>
                </div>
              )}

              {hasWater && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Droplets className="h-5 w-5 text-blue-400" />
                    <div>
                      <p className="text-sm font-medium">Vand</p>
                      <p className="text-xs text-muted-foreground">
                        {consumption?.usedWaterLiters != null
                          ? `${consumption.usedWaterLiters.toFixed(0)} liter`
                          : "Afventer data..."}
                      </p>
                    </div>
                  </div>
                  <span className="font-semibold">
                    {formatDKK(consumption?.waterCost ?? null)}
                  </span>
                </div>
              )}

              <Separator />

              <div className="flex items-center justify-between">
                <span className="font-bold">Total</span>
                <span className="text-xl font-bold text-green-700">
                  {formatDKK(consumption?.totalLiveCost ?? null)}
                </span>
              </div>

              <p className="text-xs text-center text-muted-foreground">
                Opdateres automatisk hvert 30. sekund
              </p>
            </CardContent>
          </Card>
        )}

        {/* Climate Control */}
        {isActive && hasClimate && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Thermometer className="h-5 w-5 text-blue-500" />
                Temperatur
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="16"
                  max="25"
                  step="0.5"
                  value={tempValue}
                  onChange={(e) => setTempValue(e.target.value)}
                  className="flex-1"
                />
                <span className="text-lg font-semibold w-14 text-center">
                  {tempValue}°C
                </span>
              </div>
              <Button
                onClick={handleSetTemp}
                disabled={isPending}
                className="w-full mt-3"
                variant="outline"
              >
                {isPending ? "Indstiller..." : "Sæt temperatur"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Smart Lock */}
        {isActive && hasSmartLock && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <DoorOpen className="h-5 w-5 text-green-600" />
                Dør
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button
                onClick={handleUnlock}
                disabled={isPending}
                className="w-full"
              >
                {isPending ? "Åbner..." : "Lås op"}
              </Button>
              {unlockMsg && (
                <p className="text-sm text-green-600 text-center mt-2">
                  {unlockMsg}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Payment placeholder */}
        {isActive && (
          <Card className="border-dashed">
            <CardContent className="py-6 text-center">
              <CreditCard className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Online betaling kommer snart
              </p>
              <Button variant="outline" disabled className="mt-2">
                Betal &amp; check-ud
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <p className="text-xs text-center text-muted-foreground pt-4">
          Drevet af CampFlow
        </p>
      </div>
    </div>
  );
}
