"use client";

import { useTransition } from "react";
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

  return (
    <div className="rounded-lg border bg-card">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
          Betaling
        </h2>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Status</span>
          <span className={`font-medium ${isPaid ? "text-primary" : paymentStatus === "UNPAID" ? "text-destructive" : ""}`}>
            {isPaid ? "Betalt" : paymentStatus === "UNPAID" ? "Ubetalt" : paymentStatus}
          </span>
        </div>
        {paidAt && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Betalt</span>
            <span>{new Date(paidAt).toLocaleString("da-DK")}</span>
          </div>
        )}

        {!isPaid ? (
          <Button
            className="w-full h-9 text-sm"
            disabled={isPending}
            onClick={() => startTransition(async () => { await markSessionPaid(sessionId); })}
          >
            <Check className="h-3.5 w-3.5 mr-1.5" />
            {isPending ? "Markerer..." : "Markér som betalt"}
          </Button>
        ) : (
          <Button
            variant="outline"
            className="w-full h-9 text-sm"
            disabled={isPending}
            onClick={() => startTransition(async () => { await markSessionUnpaid(sessionId); })}
          >
            <Undo2 className="h-3.5 w-3.5 mr-1.5" />
            {isPending ? "Fortryder..." : "Fortryd betaling"}
          </Button>
        )}
      </div>
    </div>
  );
}
