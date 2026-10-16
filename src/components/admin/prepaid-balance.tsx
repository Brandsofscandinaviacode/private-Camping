"use client";

import { Wallet } from "lucide-react";
import { RegisterPaymentDialog } from "./payment-dialog";

interface PrepaidBalanceProps {
  sessionId: number;
  /** Live service balance (prepaidAmount in DB) — laundry/shower draws already deducted. */
  prepaidAmount: number;
  /** Total ever deposited (initial + top-ups) — what "Indbetalt" should show. */
  prepaidDeposited: number;
  /** Accumulated el+water cost, deducted from the balance at display time. */
  accumulatedCost: number;
  isActive: boolean;
  /** "Plads 12 · Jens Hansen", for the payment dialog. */
  context?: string;
}

export function PrepaidBalance({ sessionId, prepaidAmount, prepaidDeposited, accumulatedCost, isActive, context }: PrepaidBalanceProps) {
  const remainingRaw = prepaidAmount - accumulatedCost;
  const remaining = Math.max(0, remainingRaw);
  const isOverdrawn = remainingRaw < 0;
  const overdrawnAmount = isOverdrawn ? -remainingRaw : 0;
  // Used = everything drawn from the deposit: services (already off the
  // balance) plus accumulated el/water.
  const used = prepaidDeposited - remainingRaw;
  const servicesDrawn = Math.max(0, prepaidDeposited - prepaidAmount);
  // The part of el/water that ran past the deposit is shown as "Overtræk",
  // so it must not also be counted in "El & vand" (segments sum to the bar).
  const elWaterDrawn = Math.max(0, accumulatedCost - overdrawnAmount);
  // Same levels as the guest portal: amber under 30 % left, red under 10 %.
  const level = isOverdrawn || remaining < prepaidDeposited * 0.1 ? "red" : remaining < prepaidDeposited * 0.3 ? "amber" : "green";
  const barBase = Math.max(prepaidDeposited, used, 0.01);
  const segments = [
    { label: "Services", value: servicesDrawn, cls: "bg-purple-500" },
    { label: "El & vand", value: elWaterDrawn, cls: "bg-amber-500" },
    { label: "Resterende", value: remaining, cls: "bg-green-500" },
    { label: "Overtræk", value: overdrawnAmount, cls: "bg-red-500" },
  ].filter((x) => x.value > 0);

  return (
    <section className="rounded-xl border border-border/60 bg-card shadow-sm" aria-label="Forudbetalt saldo">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Wallet className="h-4 w-4 text-blue-500" aria-hidden="true" />
        <h2 className="font-semibold">Forudbetalt saldo</h2>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">Indbetalt</p>
            <p className="text-lg font-bold tabular-nums">{prepaidDeposited.toFixed(2)} <span className="text-sm text-muted-foreground font-normal">DKK</span></p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">Forbrugt</p>
            <p className="text-lg font-bold tabular-nums">{used.toFixed(2)} <span className="text-sm text-muted-foreground font-normal">DKK</span></p>
          </div>
        </div>

        {/* Where the deposit went — one bar, one glance */}
        <div className="space-y-1.5">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Fordeling af forudbetaling">
            {segments.map((seg) => (
              <div key={seg.label} className={seg.cls} style={{ width: `${(seg.value / barBase) * 100}%` }} title={`${seg.label}: ${seg.value.toFixed(2)} DKK`} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {segments.map((seg) => (
              <span key={seg.label} className="inline-flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ${seg.cls}`} />
                {seg.label} {seg.value.toFixed(0)}
              </span>
            ))}
          </div>
        </div>

        <div className={`flex items-center justify-between p-4 rounded-lg border ${
          level === "red" ? "bg-red-50 border-red-200" : level === "amber" ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"
        }`}>
          <div>
            <p className="text-xs text-muted-foreground">{isOverdrawn ? "Overtræk" : "Resterende"}</p>
          </div>
          <span className={`text-2xl font-bold tabular-nums ${
            level === "red" ? "text-red-600" : level === "amber" ? "text-amber-600" : "text-green-600"
          }`}>
            {isOverdrawn ? `-${overdrawnAmount.toFixed(2)}` : remaining.toFixed(2)} <span className="text-sm font-medium text-muted-foreground">DKK</span>
          </span>
        </div>

        {isActive && (
          <RegisterPaymentDialog
            purpose="DEPOSIT"
            sessionId={sessionId}
            context={context}
            triggerLabel="Tilføj indbetaling"
            triggerVariant="outline"
          />
        )}
      </div>
    </section>
  );
}
