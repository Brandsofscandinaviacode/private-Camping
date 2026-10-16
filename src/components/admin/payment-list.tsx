"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Printer, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { reversePayment } from "@/lib/payment-actions";
import { methodLabel, paymentGroupKey, paymentPurposeLabel, reverseBlock } from "@/lib/payments-shared";
import { fmtMoney } from "@/lib/settlement-shared";
import { fmtDateTime } from "@/lib/format";

/** One ledger row as the lists need it (booking page and "Kasse i dag"). */
export interface PaymentLine {
  id: number;
  createdAt: Date | string;
  amount: number;
  method: string;
  kind: string;
  note: string | null;
  createdBy: string | null;
  reversesId: number | null;
  reversed: boolean;
  sessionId: number | null;
  invoiceId: number | null;
}

/**
 * "Fortryd" for one payment: asks why, then books a counter-entry. A stay
 * payment that was split over invoices is undone as a whole.
 */
export function ReversePaymentButton({
  payment,
  group,
  currency = "DKK",
  onDone,
}: {
  payment: PaymentLine;
  group?: { count: number; total: number } | null;
  currency?: string;
  onDone?: (message: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (loading) return;
    setOpen(next);
    if (next) {
      setReason("");
      setError(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await reversePayment(payment.id, reason.trim());
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setOpen(false);
      onDone?.(res.message);
      router.refresh();
    } catch {
      setError("Betalingen kunne ikke fortrydes. Prøv igen.");
    } finally {
      setLoading(false);
    }
  }

  const isDeposit = payment.kind === "BALANCE" && payment.amount > 0;
  const total = group && group.count > 1 ? group.total : payment.amount;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="ghost" size="xs" className="text-muted-foreground" />}>
        <Undo2 className="h-3.5 w-3.5 mr-1" />
        Fortryd
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fortryd betaling</DialogTitle>
          <DialogDescription>
            {paymentPurposeLabel(payment)} på {fmtMoney(Math.abs(total), currency)} ({methodLabel(payment.method)},{" "}
            {fmtDateTime(payment.createdAt)}{payment.createdBy ? `, ${payment.createdBy}` : ""}).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
            <li>Der bogføres en modpost — intet slettes, og begge står i kassen.</li>
            {group && group.count > 1 && <li>Betalingen blev fordelt på {group.count} poster (ophold og fakturaer). Alle fortrydes.</li>}
            {isDeposit && <li>Beløbet trækkes fra gæstens saldo igen.</li>}
            {payment.amount < 0 && <li>Udbetalingen tæller ikke længere som udbetalt.</li>}
          </ul>
          <div className="space-y-1.5">
            <Label htmlFor={`reverse-reason-${payment.id}`}>Hvorfor? *</Label>
            <Input
              id={`reverse-reason-${payment.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Fx forkert beløb tastet"
              autoFocus
            />
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" disabled={loading || !reason.trim()}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Undo2 className="h-4 w-4 mr-2" />}
              Fortryd betaling
            </Button>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
              Annullér
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The payments of one stay: who took what, when and how — with receipt and "Fortryd". */
export function PaymentList({ payments, currency = "DKK" }: { payments: PaymentLine[]; currency?: string }) {
  const [message, setMessage] = useState<string | null>(null);

  // Rows of one registration are undone together.
  const groups = new Map<string, { count: number; total: number }>();
  for (const p of payments) {
    const key = paymentGroupKey(p);
    if (!key || p.reversed) continue;
    const g = groups.get(key) ?? { count: 0, total: 0 };
    g.count++;
    g.total = Math.round((g.total + p.amount) * 100) / 100;
    groups.set(key, g);
  }
  const rows = [...payments].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id - a.id);

  return (
    <div className="space-y-2">
      {message && <p className="text-xs p-2 rounded-lg bg-emerald-50 text-emerald-700">{message}</p>}
      <ul className="divide-y divide-border">
        {rows.map((p) => {
          const block = reverseBlock(p);
          const key = paymentGroupKey(p);
          const muted = p.reversed || p.reversesId != null;
          return (
            <li key={p.id} className="py-2 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-sm ${muted ? "text-muted-foreground" : "font-medium"}`}>
                    {paymentPurposeLabel(p)}
                    {p.kind === "INVOICE" && p.invoiceId ? ` · faktura nr. ${p.invoiceId}` : ""}
                    {p.reversed && <span className="ml-1.5 text-[11px] font-normal px-1.5 py-0.5 rounded bg-muted">Fortrudt</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDateTime(p.createdAt)} · {methodLabel(p.method)}
                    {p.createdBy ? ` · ${p.createdBy}` : ""}
                  </p>
                  {p.note && <p className="text-xs text-muted-foreground break-words">{p.note}</p>}
                </div>
                <span className={`text-sm tabular-nums shrink-0 ${p.reversed ? "line-through text-muted-foreground" : p.amount < 0 ? "text-red-600" : ""}`}>
                  {fmtMoney(p.amount, currency)}
                </span>
              </div>
              {(!block || (p.sessionId && p.reversesId == null)) && (
                <div className="flex justify-end gap-1 mt-1">
                  {p.sessionId && p.reversesId == null && (
                    <Link href={`/admin/bookings/${p.sessionId}/receipt/${p.id}`}>
                      <Button variant="ghost" size="xs" className="text-muted-foreground">
                        <Printer className="h-3.5 w-3.5 mr-1" />
                        Kvittering
                      </Button>
                    </Link>
                  )}
                  {!block && (
                    <ReversePaymentButton
                      payment={p}
                      group={key ? groups.get(key) : null}
                      currency={currency}
                      onDone={setMessage}
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
