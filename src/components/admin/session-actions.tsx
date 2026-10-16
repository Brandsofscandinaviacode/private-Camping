"use client";

import { useState, useTransition } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markSessionUnpaid } from "@/lib/actions";
import { fmtMoney } from "@/lib/settlement-shared";
import { RegisterPaymentDialog } from "./payment-dialog";

interface SessionActionsProps {
  sessionId: number;
  /** What the guest owes per the settlement (0 = nothing to pay). */
  owed: number;
  /** Prepaid: unused balance not paid back yet. */
  refundDue: number;
  currency: string;
  /** Marked paid before payments were recorded — only the flag can be undone. */
  paidWithoutRecord: boolean;
  /** "Plads 12 · Jens Hansen", for the dialog. */
  context?: string;
}

/**
 * Payment buttons under the settlement of a checked-out stay: register what
 * the guest pays (all or part), or pay unused prepaid balance back. Single
 * payments are undone from the list of payments.
 */
export function SessionActions({ sessionId, owed, refundDue, currency, paidWithoutRecord, context }: SessionActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // The dialogs stay mounted when nothing is left, so the receipt step
  // survives the refresh that the payment itself causes.
  return (
    <>
      <RegisterPaymentDialog
        purpose="SETTLEMENT"
        sessionId={sessionId}
        suggested={owed}
        max={owed}
        currency={currency}
        context={context}
        triggerLabel={`Registrér betaling (${fmtMoney(owed, currency)})`}
        hideTrigger={owed <= 0}
      />
      <RegisterPaymentDialog
        purpose="REFUND"
        sessionId={sessionId}
        suggested={refundDue}
        max={refundDue}
        currency={currency}
        context={context}
        triggerLabel={`Udbetal ubrugt saldo (${fmtMoney(refundDue, currency)})`}
        triggerVariant="outline"
        hideTrigger={refundDue <= 0}
      />
      {paidWithoutRecord && (
        <Button
          variant="outline"
          className="w-full"
          disabled={isPending}
          onClick={() => {
            if (!window.confirm("Fortryd markeringen 'betalt'? Opholdet står som ubetalt igen.")) return;
            startTransition(async () => {
              setError(null);
              try {
                const res = await markSessionUnpaid(sessionId);
                if (!res.ok) setError(res.message);
              } catch {
                setError("Kunne ikke fortryde markeringen");
              }
            });
          }}
        >
          <Undo2 className="h-4 w-4 mr-2" />
          {isPending ? "Fortryder..." : "Fortryd markering som betalt"}
        </Button>
      )}
      {error && <p className="text-sm p-2 rounded-lg bg-red-50 text-red-600">{error}</p>}
    </>
  );
}
