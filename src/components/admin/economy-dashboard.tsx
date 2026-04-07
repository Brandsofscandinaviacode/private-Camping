"use client";

import { useState, useTransition } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  exportSessionsCSV,
  exportInvoicesCSV,
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
  };
}

export function EconomyDashboard({ data }: EconomyDashboardProps) {
  const { months, unpaidSessions, unpaidInvoices } = data;
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card shadow-sm p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <TrendingUp className="h-4 w-4" />
            <span className="text-xs font-medium">Total omsætning</span>
          </div>
          <div className="text-xl font-bold">{fmt(totals.revenue)} DKK</div>
        </div>
        <div className="rounded-xl border bg-card shadow-sm p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <AlertCircle className="h-4 w-4" />
            <span className="text-xs font-medium">Udestående</span>
          </div>
          <div className="text-xl font-bold text-red-600">{fmt(totals.unpaid)} DKK</div>
        </div>
        <div className="rounded-xl border bg-card shadow-sm p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Zap className="h-4 w-4" />
            <span className="text-xs font-medium">Total el-forbrug</span>
          </div>
          <div className="text-xl font-bold">{fmt(totals.kwh)} kWh</div>
        </div>
        <div className="rounded-xl border bg-card shadow-sm p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Droplets className="h-4 w-4" />
            <span className="text-xs font-medium">Total vandforbrug</span>
          </div>
          <div className="text-xl font-bold">{totals.water.toFixed(0)} L</div>
        </div>
      </div>

      {/* Unpaid items */}
      {(unpaidSessions.length > 0 || unpaidInvoices.length > 0) && (
        <div className="rounded-xl border bg-card shadow-sm">
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
      <div className="rounded-xl border bg-card shadow-sm">
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
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Export buttons */}
      <div className="rounded-xl border bg-card shadow-sm">
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
