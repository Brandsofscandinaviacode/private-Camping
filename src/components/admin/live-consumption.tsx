"use client";

import { useEffect, useState } from "react";
import { Zap, Droplets, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLiveConsumption } from "@/lib/actions";

interface LiveConsumptionProps {
  sessionId: number;
  refreshInterval?: number; // seconds, default 30
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
      <Card>
        <CardContent className="py-6 text-center text-muted-foreground">
          Henter forbrugsdata...
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-muted-foreground">
          Ingen forbrugsdata tilgængelig
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Live forbrug</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.usedKwh !== null && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-yellow-500" />
              <span>El: {formatNum(data.usedKwh)} kWh</span>
            </div>
            <span className="text-sm font-medium">
              {formatNum(data.electricityCost)} {data.currency}
            </span>
          </div>
        )}

        {data.usedWaterLiters !== null && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Droplets className="h-4 w-4 text-blue-400" />
              <span>Vand: {formatNum(data.usedWaterLiters, 0)} L</span>
            </div>
            <span className="text-sm font-medium">
              {formatNum(data.waterCost)} {data.currency}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between border-t pt-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <DollarSign className="h-4 w-4" />
            <span>Total</span>
          </div>
          <span className="font-bold">
            {formatNum(data.totalLiveCost)} {data.currency}
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          Opdateres hvert {refreshInterval} sekund
        </p>
      </CardContent>
    </Card>
  );
}
