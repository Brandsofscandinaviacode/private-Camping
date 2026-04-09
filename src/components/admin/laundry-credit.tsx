"use client";

import { useState } from "react";
import { WashingMachine, Plus, Minus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addLaundryCredit, removeLaundryCredit } from "@/lib/actions";
import { useRouter } from "next/navigation";

interface Props {
  sessionId: number;
  currentCredit: number;
}

export function LaundryCreditSection({ sessionId, currentCredit }: Props) {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [credit, setCredit] = useState(currentCredit);
  const router = useRouter();

  const presets = [10, 25, 50, 100];

  async function handleAdd() {
    const val = parseFloat(amount);
    if (!val || val <= 0) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await addLaundryCredit(sessionId, val);
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        setCredit((c) => c + val);
        setAmount("");
        router.refresh();
      }
    } catch {
      setMessage({ ok: false, text: "Fejl" });
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove() {
    const val = parseFloat(amount);
    if (!val || val <= 0) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await removeLaundryCredit(sessionId, val);
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        setCredit((c) => Math.max(0, c - val));
        setAmount("");
        router.refresh();
      }
    } catch {
      setMessage({ ok: false, text: "Fejl" });
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    if (credit <= 0) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await removeLaundryCredit(sessionId, credit);
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        setCredit(0);
        setAmount("");
        router.refresh();
      }
    } catch {
      setMessage({ ok: false, text: "Fejl" });
    } finally {
      setLoading(false);
    }
  }

  const parsedAmount = parseFloat(amount);
  const hasValidAmount = parsedAmount > 0;

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <WashingMachine className="h-4 w-4" />
          Vaskekredit
        </h2>
        <span className={`text-sm font-bold ${credit > 0 ? "text-green-600" : "text-muted-foreground"}`}>
          {credit.toFixed(2)} DKK
        </span>
      </div>
      <div className="p-5 space-y-3">
        <p className="text-sm text-muted-foreground">
          Tilføj eller fjern kredit som gæsten kan bruge til vask/tørring.
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => setAmount(String(p))}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                amount === String(p)
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {p} DKK
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Beløb"
              className="pr-12"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">DKK</span>
          </div>
          <Button
            size="sm"
            disabled={loading || !hasValidAmount}
            onClick={handleAdd}
            title="Tilføj kredit"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
            Tilføj
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={loading || !hasValidAmount || credit <= 0}
            onClick={handleRemove}
            title="Fjern kredit"
          >
            <Minus className="h-4 w-4 mr-1" />
            Fjern
          </Button>
        </div>
        {credit > 0 && (
          <button
            onClick={handleReset}
            disabled={loading}
            className="text-xs text-destructive hover:underline disabled:opacity-50"
          >
            Nulstil al kredit
          </button>
        )}
        {message && (
          <div className={`text-sm p-2 rounded-lg ${message.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
}
