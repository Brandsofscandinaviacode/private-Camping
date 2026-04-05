"use client";

import { useEffect, useState } from "react";
import { Zap, Droplets } from "lucide-react";
import { getLiveConsumption } from "@/lib/actions";

interface LiveConsumptionProps {
  sessionId: number;
  refreshInterval?: number;
}

interface ConsumptionData {
  usedKwh: number | null;
  electricityCost: number | null;
  usedWaterLiters: number | null;
  waterCost: number | null;
  totalLiveCost: number | null;
  currency: string;
}

export function LiveConsumption({
  sessionId,
  refreshInterval = 30,
}: LiveConsumptionProps) {
  const [data, setData] = useState<ConsumptionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      try {
        const result = await getLiveConsumption(sessionId);
        if (mounted && result) {
          setData(result);
        }
      } catch {
        // HA might be unavailable
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchData();
    const interval = setInterval(fetchData, refreshInterval * 1000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [sessionId, refreshInterval]);

  const formatNum = (v: number | null, decimals = 2) =>
    v !== null ? v.toFixed(decimals) : "—";

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-4 text-center">
        <p className="text-xs text-muted-foreground">Henter forbrugsdata...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border bg-card p-4 text-center">
        <p className="text-xs text-muted-foreground">Ingen forbrugsdata</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium">Live forbrug</h2>
      </div>
      <div className="p-4 space-y-2.5">
        {data.usedKwh !== null && (
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-yellow-400/80" />
              <span>El: {formatNum(data.usedKwh)} kWh</span>
            </div>
            <span className="tabular-nums">
              {formatNum(data.electricityCost)} {data.currency}
            </span>
          </div>
        )}

        {data.usedWaterLiters !== null && (
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Droplets className="h-3.5 w-3.5 text-blue-400/80" />
              <span>Vand: {formatNum(data.usedWaterLiters, 0)} L</span>
            </div>
            <span className="tabular-nums">
              {formatNum(data.waterCost)} {data.currency}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-2 text-xs">
          <span className="font-medium">Total</span>
          <span className="font-medium tabular-nums">
            {formatNum(data.totalLiveCost)} {data.currency}
          </span>
        </div>

        <p className="text-[10px] text-muted-foreground">
          Opdateres hvert {refreshInterval}s
        </p>
      </div>
    </div>
  );
}
