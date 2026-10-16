"use client";

import { useEffect, useState } from "react";
import { Zap, Droplets, WifiOff } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { getLiveConsumption } from "@/lib/actions";
import { fmtShortDate, fmtTime, siteDayKey } from "@/lib/format";
import { fmtAge, METER_FRESH_MS } from "@/lib/unit-state";

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
  hasMeters: boolean;
  meterOnline: boolean | null;
  lastReadingAt: string | null;
  offlineReason: string | null;
}

const formatDKK = (v: number | null) => v !== null ? `${v.toFixed(2)} DKK` : "—";

/** "i dag kl. 09.44" / "13. sep. kl. 11.26" */
function readingTime(iso: string): string {
  const sameDay = siteDayKey(iso) === siteDayKey(new Date());
  return `${sameDay ? "i dag" : fmtShortDate(iso)} kl. ${fmtTime(iso)}`;
}

export function LiveConsumption({ sessionId, hasElectricity, hasWater }: LiveConsumptionProps) {
  const [data, setData] = useState<ConsumptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      try {
        const result = await getLiveConsumption(sessionId);
        if (!mounted) return;
        setFailed(false);
        setNow(Date.now());
        if (result) {
          setData({
            usedKwh: result.usedKwh,
            electricityCost: result.electricityCost,
            usedWaterLiters: result.usedWaterLiters,
            waterCost: result.waterCost,
            totalLiveCost: result.totalLiveCost,
            currency: result.currency,
            hasMeters: result.hasMeters,
            meterOnline: result.meterOnline,
            lastReadingAt: result.lastReadingAt,
            offlineReason: result.offlineReason,
          });
        }
      } catch {
        // HA/MQTT might be unavailable — keep showing the last value, but say so
        if (mounted) setFailed(true);
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

  // The figures are only as new as the last successful reading. When that is
  // old, or a meter isn't answering now, say so instead of looking live.
  const age = data?.lastReadingAt ? now - new Date(data.lastReadingAt).getTime() : null;
  const stale = !!data?.hasMeters && (data.meterOnline === false || (age !== null && age > METER_FRESH_MS));
  const valueClass = stale ? "text-muted-foreground" : "";

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="font-semibold">Live forbrug</h2>
      </div>
      <div className="p-5 space-y-3">
        {loading && !data ? (
          <p className="text-sm text-muted-foreground text-center py-2">Henter forbrug…</p>
        ) : failed && !data ? (
          <p className="text-sm text-red-600 text-center py-2">Kunne ikke hente måleraflæsning — tjek forbindelsen til Home Assistant/MQTT.</p>
        ) : (
          <>
            {stale && data && (
              <div className="rounded-lg border border-amber-200/80 bg-amber-50/80 dark:bg-amber-500/10 dark:border-amber-500/30 px-3.5 py-2.5">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300 flex items-start gap-2">
                  <WifiOff className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    {data.lastReadingAt && age !== null
                      ? <>Sidst aflæst {readingTime(data.lastReadingAt)} ({fmtAge(age)} siden) – måler offline</>
                      : "Ingen aflæsning endnu – måler offline"}
                  </span>
                </p>
                <p className="text-xs text-amber-700/90 dark:text-amber-300/80 mt-1">
                  Beløbene herunder er ikke opdateret siden da. Forbrug efter sidste aflæsning kommer ikke med, hvis gæsten tjekkes ud nu.
                </p>
                {data.offlineReason && (
                  <p className="text-xs text-amber-700/80 dark:text-amber-300/70 mt-1 break-words">{data.offlineReason}</p>
                )}
              </div>
            )}
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
                <span className={`font-semibold tabular-nums ${valueClass}`}>{formatDKK(data?.electricityCost ?? null)}</span>
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
                <span className={`font-semibold tabular-nums ${valueClass}`}>{formatDKK(data?.waterCost ?? null)}</span>
              </div>
            )}
            <Separator />
            <div className={`flex items-center justify-between p-3 rounded-xl ${stale ? "bg-muted/50" : "bg-primary/5"}`}>
              <span className="font-bold">{stale ? "Total (ikke opdateret)" : "Total"}</span>
              <span className={`text-lg font-bold tracking-tight tabular-nums ${stale ? "text-muted-foreground" : "text-primary"}`}>
                {formatDKK(data?.totalLiveCost ?? null)}
              </span>
            </div>
            {!stale && (
              <p className="text-[11px] text-center text-muted-foreground">
                {data?.lastReadingAt ? `Sidst aflæst ${readingTime(data.lastReadingAt)} · ` : ""}Opdateres hvert 30. sekund
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
