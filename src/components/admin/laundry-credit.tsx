"use client";

import { useEffect, useState } from "react";
import { WashingMachine, Plus, Minus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addServiceCredit, removeServiceCredit, getServiceCreditHistory } from "@/lib/service-actions";
import { PAY_METHOD_LABELS, type CreditSource } from "@/lib/service-billing";
import { fmtShortDate, fmtTime } from "@/lib/format";
import { useRouter } from "next/navigation";

interface Props {
  sessionId: number;
  currentCredit: number;
}

type Entry = Awaited<ReturnType<typeof getServiceCreditHistory>>[number];

const SOURCES: { value: CreditSource; label: string }[] = [
  { value: "CASH", label: PAY_METHOD_LABELS.CASH },
  { value: "MOBILEPAY", label: PAY_METHOD_LABELS.MOBILEPAY },
  { value: "CARD_TERMINAL", label: PAY_METHOD_LABELS.CARD_TERMINAL },
  { value: "COMPENSATION", label: "Kompensation" },
];

/**
 * Service credit on a stay — the guest spends it on laundry and showers from
 * the portal. Every change says who, when and why: sold credit is registered
 * as a desk payment, compensation needs a reason.
 */
export function LaundryCreditSection({ sessionId, currentCredit }: Props) {
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<CreditSource>("CASH");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const router = useRouter();
  // router.refresh() brings the new balance in as currentCredit
  const credit = currentCredit;

  useEffect(() => {
    getServiceCreditHistory(sessionId).then(setEntries).catch(() => setEntries([]));
  }, [sessionId, currentCredit]);

  const presets = [10, 25, 50, 100];

  async function act(fn: () => Promise<{ ok: boolean; message: string }>) {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fn();
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        setAmount("");
        setNote("");
        router.refresh();
      }
    } catch {
      setMessage({ ok: false, text: "Fejl" });
    } finally {
      setLoading(false);
    }
  }

  function handleAdd() {
    const val = parseFloat(amount);
    if (!val || val <= 0) return;
    act(() => addServiceCredit(sessionId, val, source, note));
  }

  function handleRemove() {
    const val = parseFloat(amount);
    if (!val || val <= 0) return;
    act(() => removeServiceCredit(sessionId, val, note));
  }

  function handleReset() {
    if (credit <= 0) return;
    act(() => removeServiceCredit(sessionId, credit, note || "Nulstillet"));
  }

  const parsedAmount = parseFloat(amount);
  const hasValidAmount = parsedAmount > 0;
  const needsReason = source === "COMPENSATION" && !note.trim();
  const shown = showAll ? entries ?? [] : (entries ?? []).slice(0, 5);

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <WashingMachine className="h-4 w-4" />
          Servicekredit
        </h2>
        <span className={`text-sm font-bold ${credit > 0 ? "text-green-600" : "text-muted-foreground"}`}>
          {credit.toFixed(2)} DKK
        </span>
      </div>
      <div className="p-5 space-y-3">
        <p className="text-sm text-muted-foreground">
          Kredit gæsten selv kan bruge til vask, tørring og bad i gæsteportalen.
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
        <div className="relative">
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
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Ved tilføjelse: betalt med</p>
          <div className="flex gap-1.5 flex-wrap">
            {SOURCES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setSource(s.value)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                  source === s.value ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={source === "COMPENSATION" ? "Årsag til kompensation (krævet)" : "Note (valgfri)"}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            disabled={loading || !hasValidAmount || needsReason}
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
            title="Fjern kredit (rettelse — ingen udbetaling registreres)"
          >
            <Minus className="h-4 w-4 mr-1" />
            Fjern
          </Button>
        </div>
        {credit > 0 && (
          <button
            onClick={() => { if (window.confirm(`Nulstil al servicekredit (${credit.toFixed(0)} DKK)?`)) handleReset(); }}
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

        {entries && entries.length > 0 && (
          <div className="pt-2 border-t border-border">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Historik</p>
            <ul className="space-y-1">
              {shown.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-2 text-xs">
                  <span className="min-w-0">
                    <span className="text-muted-foreground">{fmtShortDate(e.at)} {fmtTime(e.at)}</span>{" "}
                    {e.reason}{e.method && ` (${e.method.toLowerCase()})`}
                    {e.note && <span className="text-muted-foreground"> · {e.note}</span>}
                    {e.by && <span className="text-muted-foreground"> · {e.by}</span>}
                  </span>
                  <span className={`tabular-nums shrink-0 ${e.amount >= 0 ? "text-green-600" : "text-muted-foreground"}`}>
                    {e.amount >= 0 ? "+" : "−"}{Math.abs(e.amount).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
            {entries.length > 5 && (
              <button onClick={() => setShowAll((v) => !v)} className="text-xs text-primary hover:underline mt-1.5">
                {showAll ? "Vis færre" : `Vis alle (${entries.length})`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
