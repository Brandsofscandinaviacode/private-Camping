"use client";

import { useEffect, useState } from "react";
import { Zap, Droplets, Flame } from "lucide-react";
import { getLiveConsumption } from "@/lib/actions";

interface LiveConsumptionProps {
  sessionId: number;
  refreshInterval?: number;
}

interface ConsumptionData {
  usedKwh: number | null;
  usedKwhMain: number | null;
  usedKwhHeating: number | null;
  hasHeatingMeter: boolean;
  electricityCost: number | null;
  usedWaterLiters: number | null;
  waterCost: number | null;
  totalLiveCost: number | null;
  currency: string;
  pricePerKwh?: number;
  spotPrice?: number | null;
  pricingMode?: string;
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
      <div className="rounded-xl border border-border/60 bg-card shadow-sm p-5 text-center">
        <p className="text-sm text-muted-foreground">Henter forbrugsdata...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-border/60 bg-card shadow-sm p-5 text-center">
        <p className="text-sm text-muted-foreground">Ingen forbrugsdata</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="font-semibold">Live forbrug</h2>
      </div>
      <div className="p-5 space-y-3">
        {data.hasHeatingMeter ? (
          <>
            {data.usedKwhMain !== null && (
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2.5">
                  <Zap className="h-4 w-4 text-yellow-500" />
                  <span>Hovedmåler: {formatNum(data.usedKwhMain)} kWh</span>
                </div>
              </div>
            )}
            {data.usedKwhHeating !== null && (
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2.5">
                  <Flame className="h-4 w-4 text-orange-500" />
                  <span>Varme: {formatNum(data.usedKwhHeating)} kWh</span>
                </div>
              </div>
            )}
            {data.usedKwh !== null && (
              <div className="flex items-center justify-between text-sm pt-1 border-t border-dashed border-border/60">
                <span className="text-muted-foreground">Samlet el</span>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">{formatNum(data.usedKwh)} kWh</span>
                  <span className="tabular-nums font-medium">
                    {formatNum(data.electricityCost)} {data.currency}
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          data.usedKwh !== null && (
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2.5">
                <Zap className="h-4 w-4 text-yellow-500" />
                <span>El: {formatNum(data.usedKwh)} kWh</span>
              </div>
              <span className="tabular-nums font-medium">
                {formatNum(data.electricityCost)} {data.currency}
              </span>
            </div>
          )
        )}

        {data.usedWaterLiters !== null && (
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2.5">
              <Droplets className="h-4 w-4 text-blue-500" />
              <span>Vand: {formatNum(data.usedWaterLiters, 0)} L</span>
            </div>
            <span className="tabular-nums font-medium">
              {formatNum(data.waterCost)} {data.currency}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="font-semibold">Total</span>
          <span className="font-semibold tabular-nums">
            {formatNum(data.totalLiveCost)} {data.currency}
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          Opdateres hvert {refreshInterval}s
          {data.pricePerKwh != null && (
            <span className="ml-1">
              · {data.pricePerKwh.toFixed(2)} DKK/kWh
              {data.pricingMode && data.pricingMode !== "fixed" && (
                <span> ({data.pricingMode}{data.spotPrice != null ? `, spot: ${data.spotPrice.toFixed(2)}` : ", spot: n/a"})</span>
              )}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
