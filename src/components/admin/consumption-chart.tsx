"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
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
  const [loading, setLoading] = useState(true);
  const [hasMeters, setHasMeters] = useState(true);
  const [firstLoggedAt, setFirstLoggedAt] = useState<Date | null>(null);
  const [selectedDays, setSelectedDays] = useState(days);

  useEffect(() => {
    setLoading(true);
    getConsumptionChartData(unitId, selectedDays)
      .then((res) => {
        setHasMeters(res.hasMeters);
        setFirstLoggedAt(res.firstLoggedAt ? new Date(res.firstLoggedAt) : null);

        const logs = res.logs;
        if (logs.length < 2) {
          setData([]);
          setLoading(false);
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
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [unitId, selectedDays]);

  if (loading) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
        Indlæser graf...
      </div>
    );
  }

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
      <div className="h-48 flex flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
        <p>Ingen forbrugsgraf endnu</p>
        <p className="text-xs">{message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 justify-end">
        {[1, 7, 30].map((d) => (
          <button
            key={d}
            onClick={() => setSelectedDays(d)}
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
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 11 }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} width={45} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 13,
            }}
          />
          <Line
            type="monotone"
            dataKey="el"
            name="El (kWh)"
            stroke="#eab308"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="vand"
            name="Vand (L)"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
