"use client";

import { useEffect, useState } from "react";
import { Zap, Droplets } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { getLiveConsumption } from "@/lib/actions";

interface LiveConsumptionProps {
  sessionId: number;
  hasElectricity: boolean;
  hasWater: boolean;
}

interface ConsumptionData {
  usedKwh: number | null;
  electricityCost: number | null;
  usedWaterLiters: number | null;
  waterCost: number | null;
  totalLiveCost: number | null;
  currency: string;
}

const formatDKK = (v: number | null) => v !== null ? `${v.toFixed(2)} DKK` : "—";

export function LiveConsumption({ sessionId, hasElectricity, hasWater }: LiveConsumptionProps) {
  const [data, setData] = useState<ConsumptionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      try {
        const result = await getLiveConsumption(sessionId);
        if (!mounted) return;
        if (result) {
          setData({
            usedKwh: result.usedKwh,
            electricityCost: result.electricityCost,
            usedWaterLiters: result.usedWaterLiters,
            waterCost: result.waterCost,
            totalLiveCost: result.totalLiveCost,
            currency: result.currency,
          });
        }
      } catch {
        // HA might be unavailable — keep showing last value
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [sessionId]);

  if (!hasElectricity && !hasWater) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="font-semibold">Dit forbrug</h2>
      </div>
      <div className="p-5 space-y-3">
        {loading && !data ? (
          <p className="text-sm text-muted-foreground text-center py-2">Henter forbrug…</p>
        ) : (
          <>
            {hasElectricity && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
                    <Zap className="h-4 w-4 text-amber-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Elektricitet</p>
                    <p className="text-xs text-muted-foreground">
                      {data?.usedKwh != null ? `${data.usedKwh.toFixed(2)} kWh` : "Afventer data"}
                    </p>
                  </div>
                </div>
                <span className="font-semibold tabular-nums">{formatDKK(data?.electricityCost ?? null)}</span>
              </div>
            )}
            {hasWater && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <Droplets className="h-4 w-4 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Vand</p>
                    <p className="text-xs text-muted-foreground">
                      {data?.usedWaterLiters != null ? `${data.usedWaterLiters.toFixed(0)} liter` : "Afventer data"}
                    </p>
                  </div>
                </div>
                <span className="font-semibold tabular-nums">{formatDKK(data?.waterCost ?? null)}</span>
              </div>
            )}
            <Separator />
            <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5">
              <span className="font-bold">Total</span>
              <span className="text-lg font-bold text-primary tracking-tight tabular-nums">
                {formatDKK(data?.totalLiveCost ?? null)}
              </span>
            </div>
            <p className="text-[11px] text-center text-muted-foreground">Opdateres hvert 30. sekund</p>
          </>
        )}
      </div>
    </div>
  );
}
