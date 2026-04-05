"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ComposedChart,
  Legend,
} from "recharts";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSpotPricesForDate, getHourlyConsumptionForDate, getLatestSpotPriceDate, testEdsApi } from "@/lib/actions";

interface ChartEntry {
  hour: string;
  label: string;
  spotPris: number | null;
  effektivPris: number | null;
  forbrug: number | null;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDanishDate(date: Date): string {
  return date.toLocaleDateString("da-DK", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function SpotPriceChart() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [latestDate, setLatestDate] = useState<string | null>(null);
  const [data, setData] = useState<ChartEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [pricingInfo, setPricingInfo] = useState<{
    mode: string;
    fixedPrice: number;
    surcharge: number;
    area: string;
  } | null>(null);

  const loadData = useCallback(async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const [priceData, consumptionData] = await Promise.all([
        getSpotPricesForDate(date),
        getHourlyConsumptionForDate(date),
      ]);

      setPricingInfo({
        mode: priceData.pricingMode,
        fixedPrice: priceData.fixedPrice,
        surcharge: priceData.surcharge,
        area: priceData.area,
      });

      // Build consumption lookup by hour
      const consumptionMap = new Map<string, number>();
      for (const c of consumptionData) {
        // Normalize hour key to match
        const hourKey = c.hour.slice(11, 13);
        consumptionMap.set(hourKey, c.kwhPerHour);
      }

      // Build 24 hour slots
      const entries: ChartEntry[] = [];
      for (let h = 0; h < 24; h++) {
        const hourStr = h.toString().padStart(2, "0");
        const fullHour = `${date}T${hourStr}:00:00`;

        // Find matching price — parse hour directly from HourDK string (Danish local time)
        const priceEntry = priceData.prices.find((p) => {
          // HourDK format: "2025-09-30T17:00:00"
          const pHour = parseInt(p.hour.slice(11, 13), 10);
          return pHour === h;
        });

        const spotPrice = priceEntry?.pricePerKwh ?? null;

        // Calculate effective price based on mode
        let effectivePrice: number | null = null;
        if (spotPrice !== null) {
          if (priceData.pricingMode === "fixed") {
            effectivePrice = priceData.fixedPrice;
          } else if (priceData.pricingMode === "minimum") {
            effectivePrice = Math.max(priceData.fixedPrice, spotPrice);
          } else if (priceData.pricingMode === "spot") {
            effectivePrice = spotPrice + priceData.surcharge;
          }
        }

        entries.push({
          hour: fullHour,
          label: `${hourStr}:00`,
          spotPris: spotPrice !== null ? parseFloat(spotPrice.toFixed(4)) : null,
          effektivPris: effectivePrice !== null ? parseFloat(effectivePrice.toFixed(4)) : null,
          forbrug: consumptionMap.get(hourStr) ?? null,
        });
      }

      setData(entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunne ikke hente data");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // On mount: fetch latest available date from EDS
  useEffect(() => {
    getLatestSpotPriceDate().then((range) => {
      setLatestDate(range.latest);
      setSelectedDate(range.latest);
      setInitializing(false);
    }).catch(() => {
      setSelectedDate(formatDate(new Date()));
      setInitializing(false);
    });
  }, []);

  useEffect(() => {
    if (selectedDate) loadData(selectedDate);
  }, [selectedDate, loadData]);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testEdsApi();
      setTestResult({ ok: result.ok, message: result.message });
      if (result.ok && result.latestDate) {
        setLatestDate(result.latestDate);
      }
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : "Uventet fejl" });
    } finally {
      setTesting(false);
    }
  }

  function changeDate(delta: number) {
    if (!selectedDate) return;
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(formatDate(d));
  }

  if (initializing) {
    return (
      <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Finder tilgængelige elpriser...
      </div>
    );
  }

  const displayDate = selectedDate || formatDate(new Date());
  const isToday = displayDate === formatDate(new Date());
  const isTomorrow = displayDate === formatDate(new Date(Date.now() + 86400000));

  const modeLabels: Record<string, string> = {
    fixed: "Fast pris",
    minimum: "Minimumspris",
    spot: "Spotpris + tillæg",
  };

  // Stats for the day
  const validPrices = data.filter((d) => d.spotPris !== null);
  const avgSpot = validPrices.length
    ? validPrices.reduce((sum, d) => sum + (d.spotPris ?? 0), 0) / validPrices.length
    : null;
  const minSpot = validPrices.length
    ? Math.min(...validPrices.map((d) => d.spotPris!))
    : null;
  const maxSpot = validPrices.length
    ? Math.max(...validPrices.map((d) => d.spotPris!))
    : null;
  const totalConsumption = data.reduce((sum, d) => sum + (d.forbrug ?? 0), 0);

  return (
    <div className="space-y-5">
      {/* Date navigation */}
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => changeDate(-1)} className="shrink-0">
          <ChevronLeft className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">Forrige dag</span>
        </Button>
        <div className="text-center min-w-0">
          <p className="font-semibold capitalize text-sm sm:text-base truncate">{formatDanishDate(new Date(displayDate))}</p>
          {isToday && <span className="text-xs text-primary font-medium">I dag</span>}
          {isTomorrow && <span className="text-xs text-blue-600 font-medium">I morgen</span>}
          {latestDate && displayDate === latestDate && !isToday && !isTomorrow && (
            <span className="text-xs text-green-600 font-medium">Nyeste data</span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => changeDate(1)} className="shrink-0">
          <span className="hidden sm:inline">Næste dag</span> <ChevronRight className="h-4 w-4 sm:ml-1" />
        </Button>
      </div>

      {/* Quick date buttons */}
      <div className="flex flex-wrap gap-2 justify-center">
        {latestDate && (
          <button
            onClick={() => setSelectedDate(latestDate)}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
              displayDate === latestDate
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            Nyeste data ({latestDate})
          </button>
        )}
        <button
          onClick={() => setSelectedDate(formatDate(new Date()))}
          className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
            isToday
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          I dag
        </button>
        <div className="ml-2">
          <input
            type="date"
            value={displayDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-7 text-xs rounded-md border border-input bg-background px-2"
          />
        </div>
      </div>

      {/* Pricing mode badge */}
      {pricingInfo && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="px-2 py-0.5 rounded-full bg-muted font-medium">
            {modeLabels[pricingInfo.mode] || pricingInfo.mode}
          </span>
          <span>Prisområde: {pricingInfo.area}</span>
        </div>
      )}

      {/* Chart */}
      {loading ? (
        <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Henter elpriser...
        </div>
      ) : error ? (
        <div className="h-72 flex items-center justify-center text-sm text-red-600">
          {error}
        </div>
      ) : validPrices.length === 0 ? (
        <div className="h-72 flex flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">Ingen prisdata tilgængelig for {displayDate}</p>
          {latestDate && displayDate !== latestDate && (
            <p className="text-xs text-muted-foreground">
              Nyeste data er fra <button onClick={() => setSelectedDate(latestDate)} className="underline text-primary hover:text-primary/80">{latestDate}</button>
            </p>
          )}
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {testing ? "Tester..." : "Test API-forbindelse"}
          </Button>
          {testResult && (
            <div className={`text-xs px-3 py-2 rounded-lg ${testResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {testResult.message}
            </div>
          )}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11 }}
              tickLine={false}
            />
            <YAxis
              yAxisId="price"
              tick={{ fontSize: 11 }}
              tickLine={false}
              width={55}
              label={{ value: "kr/kWh", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
            />
            <YAxis
              yAxisId="consumption"
              orientation="right"
              tick={{ fontSize: 11 }}
              tickLine={false}
              width={55}
              label={{ value: "kWh/t", angle: 90, position: "insideRight", style: { fontSize: 11 } }}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 13,
              }}
              formatter={(value, name) => {
                const v = Number(value);
                if (name === "Forbrug") return [`${v.toFixed(2)} kWh/t`, name];
                return [`${v.toFixed(4)} kr/kWh`, name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar
              yAxisId="price"
              dataKey="spotPris"
              name="Spotpris"
              fill="#3b82f6"
              fillOpacity={0.6}
              radius={[2, 2, 0, 0]}
            />
            {pricingInfo?.mode !== "fixed" && (
              <Line
                yAxisId="price"
                type="stepAfter"
                dataKey="effektivPris"
                name="Gæstepris"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                strokeDasharray="5 3"
              />
            )}
            {pricingInfo?.mode === "fixed" && (
              <Line
                yAxisId="price"
                type="stepAfter"
                dataKey="effektivPris"
                name="Fast pris"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                strokeDasharray="5 3"
              />
            )}
            <Line
              yAxisId="consumption"
              type="monotone"
              dataKey="forbrug"
              name="Forbrug"
              stroke="#22c55e"
              strokeWidth={2.5}
              dot={{ fill: "#22c55e", r: 3 }}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {/* Day stats */}
      {validPrices.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Gns. spotpris</p>
            <p className="text-lg font-bold tabular-nums">{avgSpot?.toFixed(2)} kr/kWh</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Laveste spotpris</p>
            <p className="text-lg font-bold tabular-nums text-green-600">{minSpot?.toFixed(2)} kr/kWh</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Højeste spotpris</p>
            <p className="text-lg font-bold tabular-nums text-red-600">{maxSpot?.toFixed(2)} kr/kWh</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Total forbrug (logget)</p>
            <p className="text-lg font-bold tabular-nums">{totalConsumption.toFixed(2)} kWh</p>
          </div>
        </div>
      )}
    </div>
  );
}
