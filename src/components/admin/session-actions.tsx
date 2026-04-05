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
    <div className="rounded-xl border bg-card shadow-sm">
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
            <span>{new Date(paidAt).toLocaleString("da-DK")}</span>
          </div>
        )}

        {!isPaid ? (
          <Button
            className="w-full"
            disabled={isPending}
            onClick={() => startTransition(async () => { await markSessionPaid(sessionId); })}
          >
            <Check className="h-4 w-4 mr-2" />
            {isPending ? "Markerer..." : "Markér som betalt"}
          </Button>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            disabled={isPending}
            onClick={() => startTransition(async () => { await markSessionUnpaid(sessionId); })}
          >
            <Undo2 className="h-4 w-4 mr-2" />
            {isPending ? "Fortryder..." : "Fortryd betaling"}
          </Button>
        )}
      </div>
    </div>
  );
}
