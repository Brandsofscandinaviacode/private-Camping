"use client";

import { useState, useTransition } from "react";
import { Wallet, Plus, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adjustPrepaidAmount } from "@/lib/actions";

interface PrepaidBalanceProps {
  sessionId: number;
  prepaidAmount: number;
  accumulatedCost: number;
  isActive: boolean;
}

export function PrepaidBalance({ sessionId, prepaidAmount, accumulatedCost, isActive }: PrepaidBalanceProps) {
  const [isPending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [addAmount, setAddAmount] = useState("");
  const [saved, setSaved] = useState(false);

  const remaining = Math.max(0, prepaidAmount - accumulatedCost);
  const isOverdrawn = accumulatedCost > prepaidAmount;
  const overdrawnAmount = isOverdrawn ? accumulatedCost - prepaidAmount : 0;

  function handleAdd() {
    const extra = parseFloat(addAmount);
    if (isNaN(extra) || extra <= 0) return;
    startTransition(async () => {
      await adjustPrepaidAmount(sessionId, prepaidAmount + extra);
      setSaved(true);
      setShowAdd(false);
      setAddAmount("");
      setTimeout(() => setSaved(false), 3000);
    });
  }

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
            <p className="text-lg font-bold tabular-nums">{prepaidAmount.toFixed(2)} <span className="text-sm text-muted-foreground font-normal">DKK</span></p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">Forbrugt</p>
            <p className="text-lg font-bold tabular-nums">{accumulatedCost.toFixed(2)} <span className="text-sm text-muted-foreground font-normal">DKK</span></p>
          </div>
        </div>

        <div className={`flex items-center justify-between p-4 rounded-lg border ${
          isOverdrawn
            ? "bg-red-50 border-red-200"
            : remaining < prepaidAmount * 0.2
              ? "bg-amber-50 border-amber-200"
              : "bg-green-50 border-green-200"
        }`}>
          <div>
            <p className="text-xs text-muted-foreground">{isOverdrawn ? "Overtræk" : "Resterende"}</p>
          </div>
          <span className={`text-2xl font-bold tabular-nums ${
            isOverdrawn ? "text-red-600" : remaining < prepaidAmount * 0.2 ? "text-amber-600" : "text-green-600"
          }`}>
            {isOverdrawn ? `-${overdrawnAmount.toFixed(2)}` : remaining.toFixed(2)} <span className="text-sm font-medium text-muted-foreground">DKK</span>
          </span>
        </div>

        {isActive && (
          <>
            {!showAdd ? (
              <Button variant="outline" size="sm" className="w-full" onClick={() => setShowAdd(true)} disabled={isPending}>
                {saved ? (
                  <>
                    <Check className="h-4 w-4 mr-2 text-green-600" />
                    Opdateret!
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Tilføj indbetaling
                  </>
                )}
              </Button>
            ) : (
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Beløb i DKK"
                  value={addAmount}
                  onChange={(e) => setAddAmount(e.target.value)}
                  className="flex-1"
                  autoFocus
                />
                <Button size="sm" onClick={handleAdd} disabled={isPending || !addAmount}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tilføj"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setShowAdd(false); setAddAmount(""); }}>
                  Annullér
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
