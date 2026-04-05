"use client";

import { useState, useTransition } from "react";
import { Check, Undo2, ChevronDown, ChevronRight, Zap, Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markInvoicePaid } from "@/lib/actions";

interface InvoiceRowProps {
  invoice: {
    id: number;
    periodStart: Date;
    periodEnd: Date;
    startKwh: number | null;
    endKwh: number | null;
    startWaterLiters: number | null;
    endWaterLiters: number | null;
    electricityCost: number;
    waterCost: number;
    totalAmount: number;
    status: string;
    paidAt: Date | null;
  };
}

export function InvoiceRow({ invoice }: InvoiceRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();

  const isPaid = invoice.status === "PAID";
  const usedKwh = (invoice.endKwh != null && invoice.startKwh != null)
    ? Math.max(0, invoice.endKwh - invoice.startKwh) : null;
  const usedWater = (invoice.endWaterLiters != null && invoice.startWaterLiters != null)
    ? Math.max(0, invoice.endWaterLiters - invoice.startWaterLiters) : null;

  const statusLabel = invoice.status === "DRAFT" ? "Kladde" :
    invoice.status === "PENDING" ? "Afventer" :
    invoice.status === "PAID" ? "Betalt" : "Forfalden";

  return (
    <div className="rounded-lg border bg-background">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/30 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <span className="font-medium">
            {new Date(invoice.periodStart).toLocaleDateString("da-DK", { month: "long", year: "numeric" })}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="tabular-nums font-medium">{invoice.totalAmount.toFixed(2)} DKK</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            isPaid ? "bg-green-50 text-green-600" :
            invoice.status === "OVERDUE" ? "bg-red-50 text-red-600" :
            "bg-muted text-muted-foreground"
          }`}>
            {statusLabel}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
          {/* Consumption breakdown */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md bg-muted/40 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-yellow-500" />
                <span className="font-medium text-xs">Elektricitet</span>
              </div>
              {usedKwh !== null ? (
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Forbrug</span>
                    <span>{usedKwh.toFixed(2)} kWh</span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span>Pris</span>
                    <span>{invoice.electricityCost.toFixed(2)} DKK</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Ingen data</p>
              )}
            </div>
            <div className="rounded-md bg-muted/40 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Droplets className="h-4 w-4 text-blue-500" />
                <span className="font-medium text-xs">Vand</span>
              </div>
              {usedWater !== null ? (
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Forbrug</span>
                    <span>{usedWater.toFixed(0)} L</span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span>Pris</span>
                    <span>{invoice.waterCost.toFixed(2)} DKK</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Ingen data</p>
              )}
            </div>
          </div>

          {/* Payment info */}
          {invoice.paidAt && (
            <p className="text-xs text-muted-foreground">
              Betalt {new Date(invoice.paidAt).toLocaleString("da-DK")}
            </p>
          )}

          {/* Payment action */}
          {!isPaid ? (
            <Button
              size="sm"
              className="w-full"
              disabled={isPending}
              onClick={() => startTransition(async () => { await markInvoicePaid(invoice.id); })}
            >
              <Check className="h-4 w-4 mr-2" />
              {isPending ? "Markerer..." : "Markér som betalt"}
            </Button>
          ) : (
            <p className="text-xs text-center text-green-600 font-medium">Faktura er betalt</p>
          )}
        </div>
      )}
    </div>
  );
}
