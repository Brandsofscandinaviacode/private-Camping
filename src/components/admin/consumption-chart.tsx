"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { getConsumptionChartData } from "@/lib/actions";

interface ConsumptionChartProps {
  unitId: number;
  days?: number;
}

export function ConsumptionChart({ unitId, days = 7 }: ConsumptionChartProps) {
  const [data, setData] = useState<
    { time: string; el: number | null; vand: number | null }[]
  >([]);
  const [hasMeters, setHasMeters] = useState(true);
  const [firstLoggedAt, setFirstLoggedAt] = useState<Date | null>(null);
  const [selectedDays, setSelectedDays] = useState(days);
  // Loading is derived: the chart is loading until data for the current
  // unit/range key has arrived. Avoids a synchronous setState in the effect.
  const requestKey = `${unitId}:${selectedDays}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    getConsumptionChartData(unitId, selectedDays)
      .then((res) => {
        if (cancelled) return;
        setHasMeters(res.hasMeters);
        setFirstLoggedAt(res.firstLoggedAt ? new Date(res.firstLoggedAt) : null);

        const logs = res.logs;
        if (logs.length < 2) {
          setData([]);
          setLoadedKey(requestKey);
          return;
        }

        const baseEl = logs[0].electricityKwh;
        const baseWater = logs[0].waterLiters;

        const chartData = logs.map((log) => ({
          time: new Date(log.recordedAt).toLocaleString("da-DK", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          }),
          el:
            log.electricityKwh !== null && baseEl !== null
              ? parseFloat((log.electricityKwh - baseEl).toFixed(2))
              : null,
          vand:
            log.waterLiters !== null && baseWater !== null
              ? parseFloat((log.waterLiters - baseWater).toFixed(0))
              : null,
        }));

        setData(chartData);
        setLoadedKey(requestKey);
      })
      .catch(() => { if (!cancelled) setLoadedKey(requestKey); });
    return () => { cancelled = true; };
  }, [unitId, selectedDays, requestKey]);

  // Range selector is rendered in every state so a user can widen the window
  // when the current one has too little data to draw.
  const rangeSelector = (
    <div className="flex gap-2 justify-end">
      {[1, 7, 30].map((d) => (
        <button
          key={d}
          onClick={() => setSelectedDays(d)}
          aria-pressed={selectedDays === d}
          className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
            selectedDays === d
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {d === 1 ? "24t" : `${d}d`}
        </button>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-3">
        {rangeSelector}
        <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
          Indlæser graf...
        </div>
      </div>
    );
  }

  const hasWaterSeries = data.some((d) => d.vand != null);
  const hasElSeries = data.some((d) => d.el != null);

  if (data.length < 2) {
    // Distinguish the three reasons a chart can be empty so the message is
    // actionable rather than just "no data".
    let message: string;
    if (!hasMeters) {
      message = "Denne enhed har ingen el- eller vandmåler tilknyttet.";
    } else if (!firstLoggedAt) {
      message = "Måleraflæsninger er ikke startet endnu — grafen vises inden for en time.";
    } else {
      message = "Der er kun én måling indtil videre — grafen vises efter næste aflæsning.";
    }

    return (
      <div className="space-y-3">
        {rangeSelector}
        <div className="h-48 flex flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
          <p>Ingen forbrugsgraf endnu</p>
          <p className="text-xs">{message}</p>
        </div>
      </div>
    );
  }

  const fmtNum = (v: number) => v.toLocaleString("da-DK", { maximumFractionDigits: 2 });

  return (
    <div className="space-y-3">
      {rangeSelector}
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 11 }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          {/* kWh and litres live on separate axes — hundreds of litres would
              otherwise flatten the electricity line to zero. */}
          {hasElSeries && (
            <YAxis yAxisId="el" tick={{ fontSize: 11 }} tickLine={false} width={45} tickFormatter={fmtNum} />
          )}
          {hasWaterSeries && (
            <YAxis yAxisId="vand" orientation="right" tick={{ fontSize: 11 }} tickLine={false} width={45} tickFormatter={fmtNum} />
          )}
          <Tooltip
            formatter={(value, name) => [typeof value === "number" ? fmtNum(value) : value, name]}
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 13,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {hasElSeries && (
            <Line
              yAxisId="el"
              type="monotone"
              dataKey="el"
              name="El (kWh)"
              stroke="#eab308"
              strokeWidth={2}
              dot={false}
            />
          )}
          {hasWaterSeries && (
            <Line
              yAxisId="vand"
              type="monotone"
              dataKey="vand"
              name="Vand (L)"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
