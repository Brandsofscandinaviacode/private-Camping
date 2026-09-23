"use client";

import { useState, useTransition } from "react";
import { CreditCard, Undo2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markSessionPaid, markSessionUnpaid } from "@/lib/actions";

interface SessionActionsProps {
  sessionId: number;
  paymentStatus: string;
  isPaid: boolean;
  paidAt: string | null;
}

export function SessionActions({ sessionId, paymentStatus, isPaid, paidAt }: SessionActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="font-semibold flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          Betaling
        </h2>
      </div>
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Status</span>
          <span className={`font-medium ${isPaid ? "text-green-600" : paymentStatus === "UNPAID" ? "text-red-500" : ""}`}>
            {isPaid ? "Betalt" : paymentStatus === "UNPAID" ? "Ubetalt" : paymentStatus}
          </span>
        </div>
        {paidAt && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Betalt</span>
            <span>{new Date(paidAt).toLocaleString("da-DK", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        )}

        {!isPaid ? (
          <Button
            className="w-full"
            disabled={isPending}
            onClick={() => startTransition(async () => {
              try { setError(null); await markSessionPaid(sessionId); }
              catch (e) { setError(e instanceof Error ? e.message : "Kunne ikke markere som betalt"); }
            })}
          >
            <Check className="h-4 w-4 mr-2" />
            {isPending ? "Markerer..." : "Markér som betalt"}
          </Button>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            disabled={isPending}
            onClick={() => {
              if (!window.confirm("Fortryd betalingen? Opholdet markeres som ubetalt igen.")) return;
              startTransition(async () => {
                try { setError(null); await markSessionUnpaid(sessionId); }
                catch (e) { setError(e instanceof Error ? e.message : "Kunne ikke fortryde betaling"); }
              });
            }}
          >
            <Undo2 className="h-4 w-4 mr-2" />
            {isPending ? "Fortryder..." : "Fortryd betaling"}
          </Button>
        )}
        {error && <p className="text-sm p-2 rounded-lg bg-red-50 text-red-600">{error}</p>}
      </div>
    </div>
  );
}
