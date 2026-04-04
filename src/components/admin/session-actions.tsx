"use client";

import { useTransition } from "react";
import { CreditCard, Undo2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CreditCard className="h-4 w-4" />
          Betaling
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Status</span>
          <span className={`font-medium ${isPaid ? "text-primary" : paymentStatus === "UNPAID" ? "text-destructive" : ""}`}>
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
      </CardContent>
    </Card>
  );
}
