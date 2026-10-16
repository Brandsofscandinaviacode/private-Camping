"use client";

import { useState, useTransition } from "react";
import { Undo2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markSessionPaid, markSessionUnpaid } from "@/lib/actions";
import { fmtMoney } from "@/lib/settlement-shared";

interface SessionActionsProps {
  sessionId: number;
  /** What the guest owes per the settlement (0 = nothing to mark). */
  owed: number;
  currency: string;
  /** Payment recorded (or a bare paid flag) that can be undone. */
  canUndo: boolean;
  /** Open invoices on the stay — paid along with it. */
  openInvoiceCount: number;
}

/**
 * Payment buttons under the settlement. Only shown after check-out: while a
 * postpaid stay runs, consumption is still coming.
 */
export function SessionActions({ sessionId, owed, currency, canUndo, openInvoiceCount }: SessionActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>, fallback: string) {
    startTransition(async () => {
      setError(null);
      try {
        const res = await action();
        if (!res.ok) setError(res.message);
      } catch {
        setError(fallback);
      }
    });
  }

  if (owed <= 0 && !canUndo) return null;

  return (
    <div className="space-y-2">
      {owed > 0 && (
        <Button
          className="w-full"
          disabled={isPending}
          onClick={() => {
            const invoices = openInvoiceCount > 0
              ? ` Åbne fakturaer på opholdet (${openInvoiceCount}) markeres også som betalt.`
              : "";
            if (!window.confirm(`Registrér ${fmtMoney(owed, currency)} som betalt i skranken?${invoices}`)) return;
            run(() => markSessionPaid(sessionId), "Kunne ikke markere som betalt");
          }}
        >
          <Check className="h-4 w-4 mr-2" />
          {isPending ? "Markerer..." : `Markér som betalt (${fmtMoney(owed, currency)})`}
        </Button>
      )}
      {canUndo && (
        <Button
          variant="outline"
          className="w-full"
          disabled={isPending}
          onClick={() => {
            if (!window.confirm("Fortryd betalingen? Der bogføres en modpost, og opholdet står som ubetalt igen.")) return;
            run(() => markSessionUnpaid(sessionId), "Kunne ikke fortryde betaling");
          }}
        >
          <Undo2 className="h-4 w-4 mr-2" />
          {isPending ? "Fortryder..." : "Fortryd betaling"}
        </Button>
      )}
      {error && <p className="text-sm p-2 rounded-lg bg-red-50 text-red-600">{error}</p>}
    </div>
  );
}
