"use client";

import { useEffect, useState } from "react";
import { Zap, Flame } from "lucide-react";
import { getLivePowerDraw } from "@/lib/actions";

interface LivePowerDrawProps {
  unitId: number;
  refreshInterval?: number;
}

interface PowerData {
  electricityW: number | null;
  heatingW: number | null;
  totalW: number | null;
  hasElectricityPower: boolean;
  hasHeatingPower: boolean;
}

function formatPower(w: number | null): string {
  if (w === null) return "—";
  if (w >= 1000) return `${(w / 1000).toFixed(2)} kW`;
  return `${Math.round(w)} W`;
}

export function LivePowerDraw({ unitId, refreshInterval = 5 }: LivePowerDrawProps) {
  const [data, setData] = useState<PowerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notConfigured, setNotConfigured] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      try {
        const result = await getLivePowerDraw(unitId);
        if (!mounted) return;
        if (result === null) {
          setNotConfigured(true);
        } else {
          setData(result);
          setNotConfigured(false);
        }
      } catch {
        // HA might be unavailable — keep showing last value
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
  }, [unitId, refreshInterval]);

  if (notConfigured) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold">Live effekt</h2>
        {data?.totalW !== null && data?.totalW !== undefined && (
          <span className="text-xs text-muted-foreground">
            Opdateres hvert {refreshInterval}s
          </span>
        )}
      </div>
      <div className="p-5 space-y-3">
        {loading && !data ? (
          <p className="text-sm text-muted-foreground text-center py-2">Henter effekt...</p>
        ) : (
          <>
            {data?.hasElectricityPower && (
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2.5">
                  <Zap className="h-4 w-4 text-yellow-500" />
                  <span>Strøm</span>
                </div>
                <span className="tabular-nums font-medium">{formatPower(data.electricityW)}</span>
              </div>
            )}
            {data?.hasHeatingPower && (
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2.5">
                  <Flame className="h-4 w-4 text-orange-500" />
                  <span>Varme</span>
                </div>
                <span className="tabular-nums font-medium">{formatPower(data.heatingW)}</span>
              </div>
            )}
            {data && data.hasElectricityPower && data.hasHeatingPower && (
              <div className="flex items-center justify-between border-t border-border pt-3">
                <span className="font-semibold">Samlet</span>
                <span className="font-semibold tabular-nums">{formatPower(data.totalW)}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
