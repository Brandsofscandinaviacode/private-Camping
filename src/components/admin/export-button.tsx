"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportSessionsCSV, exportInvoicesCSV } from "@/lib/actions";

export function ExportButton() {
  const [loading, setLoading] = useState(false);

  async function handleExport(type: "sessions" | "invoices") {
    setLoading(true);
    try {
      const csv = type === "sessions"
        ? await exportSessionsCSV("all")
        : await exportInvoicesCSV();

      const BOM = "\uFEFF";
      const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `campsense-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export fejl:", e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleExport("sessions")}
        disabled={loading}
      >
        <Download className="h-4 w-4 mr-1.5" />
        Eksportér ophold (CSV)
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleExport("invoices")}
        disabled={loading}
      >
        <Download className="h-4 w-4 mr-1.5" />
        Eksportér fakturaer (CSV)
      </Button>
    </div>
  );
}
