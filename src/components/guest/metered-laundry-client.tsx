"use client";

import { useState, useEffect } from "react";
import { WashingMachine, Wind, Zap, Clock, CheckCircle2, Loader2, Tent } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getMeteredLaundryStatus } from "@/lib/actions";

interface MeteredStatus {
  sessionId: number;
  machineName: string;
  machineKind: string;
  machineLocation: string | null;
  phase: "waiting" | "billing" | "idle" | "done";
  billedMinutes: number;
  currentCost: number;
  reservedAmount: number;
  pricePerMinute: number;
  lastPowerW: number | null;
  meterStartedAt: string | null;
  meterEndedAt: string | null;
  pricePaid: number;
}

interface Props {
  accessToken: string;
  initial: MeteredStatus;
}

function formatMinutes(min: number): string {
  if (min < 1) return "< 1 min";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} t` : `${h} t ${m} min`;
}

export function MeteredLaundryClient({ accessToken, initial }: Props) {
  const [status, setStatus] = useState(initial);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await getMeteredLaundryStatus(accessToken);
        if (data) setStatus(data);
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [accessToken]);

  const Icon = status.machineKind === "DRYER" ? Wind : WashingMachine;
  const kindLabel = status.machineKind === "DRYER" ? "Tørretumbler" : "Vaskemaskine";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-background px-4 pt-6 pb-10 text-center relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-primary/5" />
        <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-primary/5" />
        <div className="relative z-10">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-primary/20">
            <Icon className="h-6 w-6 text-white" />
          </div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{kindLabel}</p>
          <h1 className="text-xl font-bold mt-0.5">{status.machineName}</h1>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-4 space-y-3 -mt-4">
        {/* Phase indicator */}
        <Card>
          <CardContent className="p-5">
            {status.phase === "waiting" && (
              <div className="text-center space-y-3">
                <div className="h-16 w-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto">
                  <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
                </div>
                <div>
                  <p className="font-semibold">Maskinen er klar</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Vælg dit program på maskinen og start den.
                    Timeren starter automatisk når strømforbruget registreres.
                  </p>
                </div>
              </div>
            )}

            {status.phase === "billing" && (
              <div className="text-center space-y-3">
                <div className="h-16 w-16 rounded-full bg-green-50 flex items-center justify-center mx-auto">
                  <Zap className="h-8 w-8 text-green-500" />
                </div>
                <div>
                  <p className="font-semibold text-green-700">Vask i gang</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">Tid</p>
                      <p className="text-lg font-bold">{formatMinutes(status.billedMinutes)}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">Pris</p>
                      <p className="text-lg font-bold">{status.currentCost.toFixed(0)} DKK</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {status.phase === "idle" && (
              <div className="text-center space-y-3">
                <div className="h-16 w-16 rounded-full bg-orange-50 flex items-center justify-center mx-auto">
                  <Clock className="h-8 w-8 text-orange-500" />
                </div>
                <div>
                  <p className="font-semibold text-orange-700">Afslutter snart...</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Lavt strømforbrug registreret. Stopper automatisk.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">Tid</p>
                      <p className="text-lg font-bold">{formatMinutes(status.billedMinutes)}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">Pris</p>
                      <p className="text-lg font-bold">{status.currentCost.toFixed(0)} DKK</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {status.phase === "done" && (
              <div className="text-center space-y-3">
                <div className="h-16 w-16 rounded-full bg-green-50 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                </div>
                <div>
                  <p className="font-semibold text-green-700">Vask færdig!</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">Total tid</p>
                      <p className="text-lg font-bold">{formatMinutes(status.billedMinutes)}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">Betalt</p>
                      <p className="text-lg font-bold">{status.pricePaid.toFixed(0)} DKK</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Live power + rate info */}
        {status.phase !== "done" && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Zap className="h-4 w-4" />
                  <span>Strømforbrug</span>
                </div>
                <span className="font-medium">
                  {status.lastPowerW !== null ? `${status.lastPowerW.toFixed(0)} W` : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>Takst</span>
                </div>
                <span className="font-medium">{status.pricePerMinute.toFixed(2)} DKK/min</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-muted-foreground">Maks reservation</span>
                <span className="font-medium">{status.reservedAmount.toFixed(0)} DKK</span>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-[10px] text-center text-muted-foreground/40 pt-2 pb-6 flex items-center justify-center gap-1">
          <Tent className="h-3 w-3" />
          CampSense
        </p>
      </div>
    </div>
  );
}
