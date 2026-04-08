"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import {
  Download,
  Loader2,
  TrendingUp,
  Zap,
  Droplets,
  AlertCircle,
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
  BarChart3,
  WashingMachine,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  exportSessionsCSV,
  exportInvoicesCSV,
  getTotalConsumptionHistory,
  type MonthlyEconomySummary,
} from "@/lib/actions";

const monthNames: Record<string, string> = {
  "01": "Januar", "02": "Februar", "03": "Marts", "04": "April",
  "05": "Maj", "06": "Juni", "07": "Juli", "08": "August",
  "09": "September", "10": "Oktober", "11": "November", "12": "December",
};

function formatMonth(month: string) {
  const [year, m] = month.split("-");
  return `${monthNames[m] || m} ${year}`;
}

function fmt(n: number) {
  return n.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface EconomyDashboardProps {
  data: {
    months: MonthlyEconomySummary[];
    unpaidSessions: { id: number; unitName: string; guestName: string; total: number; checkOut: string }[];
    unpaidInvoices: { id: number; unitName: string; total: number; periodEnd: string }[];
    laundryTotals: { total: number; count: number; paid: number };
  };
}

export function EconomyDashboard({ data }: EconomyDashboardProps) {
  const { months, unpaidSessions, unpaidInvoices, laundryTotals } = data;
  const [isPending, startTransition] = useTransition();
  const [exportType, setExportType] = useState<string | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(
    months.length > 0 ? months[0].month : null
  );

  // Totals across all months
  const totals = months.reduce(
    (acc, m) => ({
      revenue: acc.revenue + m.totalRevenue,
      paid: acc.paid + m.totalPaid,
      unpaid: acc.unpaid + m.totalUnpaid,
      kwh: acc.kwh + m.totalKwhUsed,
      water: acc.water + m.totalWaterUsed,
    }),
    { revenue: 0, paid: 0, unpaid: 0, kwh: 0, water: 0 }
  );

  function downloadCSV(content: string, filename: string) {
    const bom = "\uFEFF";
    const blob = new Blob([bom + content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExport(type: "sessions" | "sessions_unpaid" | "invoices") {
    setExportType(type);
    startTransition(async () => {
      try {
        if (type === "sessions") {
          const csv = await exportSessionsCSV("all");
          downloadCSV(csv, `ophold_alle_${new Date().toISOString().slice(0, 10)}.csv`);
        } else if (type === "sessions_unpaid") {
          const csv = await exportSessionsCSV("unpaid");
          downloadCSV(csv, `ophold_ubetalte_${new Date().toISOString().slice(0, 10)}.csv`);
        } else {
          const csv = await exportInvoicesCSV();
          downloadCSV(csv, `fakturaer_${new Date().toISOString().slice(0, 10)}.csv`);
        }
      } catch (e) {
        console.error("Export error:", e);
      } finally {
        setExportType(null);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="rounded-xl border border-border/60 bg-card shadow-sm p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-primary" />
            </div>
          </div>
          <p className="text-xs font-medium text-muted-foreground mb-0.5">Total omsætning</p>
          <div className="text-xl font-bold tracking-tight">{fmt(totals.revenue)} <span className="text-sm font-medium text-muted-foreground">DKK</span></div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card shadow-sm p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-red-500/10 flex items-center justify-center">
              <AlertCircle className="h-4 w-4 text-red-500" />
            </div>
          </div>
          <p className="text-xs font-medium text-muted-foreground mb-0.5">Udestående</p>
          <div className="text-xl font-bold text-red-600 tracking-tight">{fmt(totals.unpaid)} <span className="text-sm font-medium">DKK</span></div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card shadow-sm p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Zap className="h-4 w-4 text-amber-500" />
            </div>
          </div>
          <p className="text-xs font-medium text-muted-foreground mb-0.5">Total el-forbrug</p>
          <div className="text-xl font-bold tracking-tight">{fmt(totals.kwh)} <span className="text-sm font-medium text-muted-foreground">kWh</span></div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card shadow-sm p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Droplets className="h-4 w-4 text-blue-500" />
            </div>
          </div>
          <p className="text-xs font-medium text-muted-foreground mb-0.5">Total vandforbrug</p>
          <div className="text-xl font-bold tracking-tight">{totals.water.toFixed(0)} <span className="text-sm font-medium text-muted-foreground">L</span></div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card shadow-sm p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <WashingMachine className="h-4 w-4 text-violet-500" />
            </div>
          </div>
          <p className="text-xs font-medium text-muted-foreground mb-0.5">Vaskerum</p>
          <div className="text-xl font-bold tracking-tight">{fmt(laundryTotals.total)} <span className="text-sm font-medium text-muted-foreground">DKK</span></div>
          <p className="text-xs text-muted-foreground mt-0.5">{laundryTotals.count} vaske</p>
        </div>
      </div>

      {/* Unpaid items */}
      {(unpaidSessions.length > 0 || unpaidInvoices.length > 0) && (
        <div className="rounded-xl border border-border/60 bg-card shadow-sm">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="font-semibold flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              Udestående betalinger
            </h2>
          </div>
          <div className="p-5">
            {unpaidSessions.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Ophold ({unpaidSessions.length})</h3>
                <div className="space-y-1">
                  {unpaidSessions.map((s) => (
                    <Link
                      key={s.id}
                      href={`/admin/bookings/${s.id}`}
                      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors text-sm"
                    >
                      <div>
                        <span className="font-medium">{s.guestName}</span>
                        <span className="text-muted-foreground ml-2">{s.unitName}</span>
                        {s.checkOut && <span className="text-muted-foreground ml-2">({s.checkOut})</span>}
                      </div>
                      <span className="font-medium text-red-600">{fmt(s.total)} DKK</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {unpaidInvoices.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Fakturaer ({unpaidInvoices.length})</h3>
                <div className="space-y-1">
                  {unpaidInvoices.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between py-2 px-3 rounded-lg text-sm"
                    >
                      <div>
                        <span className="font-medium">{inv.unitName}</span>
                        <span className="text-muted-foreground ml-2">Faktura #{inv.id}</span>
                        <span className="text-muted-foreground ml-2">({inv.periodEnd})</span>
                      </div>
                      <span className="font-medium text-red-600">{fmt(inv.total)} DKK</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Monthly breakdown */}
      <div className="rounded-xl border border-border/60 bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Månedsoversigt</h2>
        </div>
        <div>
          {months.length === 0 ? (
            <div className="p-5 text-sm text-muted-foreground">Ingen data endnu</div>
          ) : (
            months.map((m) => {
              const isExpanded = expandedMonth === m.month;
              return (
                <div key={m.month} className="border-b last:border-0">
                  <button
                    className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedMonth(isExpanded ? null : m.month)}
                  >
                    <div className="flex items-center gap-4">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="font-medium">{formatMonth(m.month)}</span>
                      <span className="text-sm text-muted-foreground">
                        {m.sessionsCount} ophold, {m.invoicesCount} fakturaer
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      {m.totalUnpaid > 0 && (
                        <span className="text-red-600">{fmt(m.totalUnpaid)} ubetalt</span>
                      )}
                      <span className="font-medium">{fmt(m.totalRevenue)} DKK</span>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="px-5 pb-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Omsætning</span>
                        <div className="font-medium">{fmt(m.totalRevenue)} DKK</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Betalt</span>
                        <div className="font-medium text-green-600">{fmt(m.totalPaid)} DKK</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Udestående</span>
                        <div className="font-medium text-red-600">{fmt(m.totalUnpaid)} DKK</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">El-forbrug</span>
                        <div className="font-medium">{fmt(m.totalKwhUsed)} kWh</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">El-indtægt</span>
                        <div className="font-medium">{fmt(m.totalElectricity)} DKK</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Vandforbrug</span>
                        <div className="font-medium">{m.totalWaterUsed.toFixed(0)} L</div>
                      </div>
                      {m.laundryCount > 0 && (
                        <div>
                          <span className="text-muted-foreground">Vaskerum</span>
                          <div className="font-medium">{fmt(m.totalLaundry)} DKK ({m.laundryCount} vaske)</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Consumption chart */}
      <TotalConsumptionChart />

      {/* Export buttons */}
      <div className="rounded-xl border border-border/60 bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Eksport
          </h2>
        </div>
        <div className="p-5 flex flex-wrap gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => handleExport("sessions")}
          >
            {exportType === "sessions" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
            Alle ophold (CSV)
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => handleExport("sessions_unpaid")}
          >
            {exportType === "sessions_unpaid" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
            Ubetalte ophold (CSV)
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => handleExport("invoices")}
          >
            {exportType === "invoices" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
            Fakturaer (CSV)
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Total Consumption Chart ──
const weekMonthNames: Record<string, string> = {
  "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr",
  "05": "Maj", "06": "Jun", "07": "Jul", "08": "Aug",
  "09": "Sep", "10": "Okt", "11": "Nov", "12": "Dec",
};

function formatPeriodLabel(key: string, period: "week" | "month") {
  if (period === "month") {
    const [year, m] = key.split("-");
    return `${weekMonthNames[m] || m} ${year.slice(2)}`;
  }
  // Week: key is the Monday date
  const d = new Date(key);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function TotalConsumptionChart() {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [data, setData] = useState<{ period: string; el: number; water: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getTotalConsumptionHistory(period)
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Samlet forbrug
        </h2>
        <div className="flex gap-1">
          {(["week", "month"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                period === p
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {p === "week" ? "Uge" : "Måned"}
            </button>
          ))}
        </div>
      </div>
      <div className="p-5">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
            Ikke nok data til graf endnu.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Electricity */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5" />
                Elforbrug (kWh)
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="period"
                    tickFormatter={(v) => formatPeriodLabel(v, period)}
                    tick={{ fontSize: 11 }}
                    stroke="var(--muted-foreground)"
                  />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <Tooltip
                    formatter={(value) => [`${Number(value).toFixed(1)} kWh`, "El"]}
                    labelFormatter={(v) => formatPeriodLabel(v as string, period)}
                  />
                  <Bar dataKey="el" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Water */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                <Droplets className="h-3.5 w-3.5" />
                Vandforbrug (liter)
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="period"
                    tickFormatter={(v) => formatPeriodLabel(v, period)}
                    tick={{ fontSize: 11 }}
                    stroke="var(--muted-foreground)"
                  />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <Tooltip
                    formatter={(value) => [`${Number(value)} L`, "Vand"]}
                    labelFormatter={(v) => formatPeriodLabel(v as string, period)}
                  />
                  <Bar dataKey="water" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
