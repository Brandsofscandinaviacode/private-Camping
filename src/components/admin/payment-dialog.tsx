"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, CheckCircle2, Loader2, Printer } from "lucide-react";
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
import { registerPayment } from "@/lib/payment-actions";
import {
  DESK_PAYMENT_METHODS,
  amountInput,
  methodLabel,
  parseAmount,
  type DeskPaymentMethod,
} from "@/lib/payments-shared";
import { fmtMoney, roundOre } from "@/lib/settlement-shared";

/** Kontant / MobilePay / Kortterminal / Bankoverførsel / Andet as buttons. */
export function PaymentMethodPicker({
  value,
  onChange,
  label = "Betalt med",
}: {
  value: DeskPaymentMethod;
  onChange: (m: DeskPaymentMethod) => void;
  label?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {DESK_PAYMENT_METHODS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value === m}
            onClick={() => onChange(m)}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
              value === m ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
            }`}
          >
            {methodLabel(m)}
          </button>
        ))}
      </div>
    </div>
  );
}

export type PaymentPurpose = "DEPOSIT" | "SETTLEMENT" | "REFUND" | "INVOICE";

const PURPOSES: Record<PaymentPurpose, { title: string; kind: string; sign: 1 | -1; methodText: string; hint: string }> = {
  DEPOSIT: {
    title: "Tilføj indbetaling",
    kind: "BALANCE",
    sign: 1,
    methodText: "Betalt med",
    hint: "Beløbet lægges på gæstens forudbetalte saldo.",
  },
  SETTLEMENT: {
    title: "Registrér betaling",
    kind: "SETTLEMENT",
    sign: 1,
    methodText: "Betalt med",
    hint: "Det skyldige beløb er udfyldt. Et mindre beløb registreres som delbetaling.",
  },
  REFUND: {
    title: "Udbetal ubrugt saldo",
    kind: "BALANCE",
    sign: -1,
    methodText: "Udbetalt med",
    hint: "Ubrugt saldo refunderes normalt ikke. Registrér kun, hvad gæsten faktisk får tilbage.",
  },
  INVOICE: {
    title: "Registrér betaling af faktura",
    kind: "INVOICE",
    sign: 1,
    methodText: "Betalt med",
    hint: "Restbeløbet er udfyldt. Et mindre beløb registreres som delbetaling.",
  },
};

/**
 * "Registrér betaling" — one dialog for every desk payment: a top-up of a
 * prepaid balance, paying a checked-out stay (in full or in part), paying an
 * invoice, and paying unused balance back. Amount, method and an optional
 * note; cash shows the change. Afterwards a receipt can be printed.
 */
export function RegisterPaymentDialog({
  purpose,
  sessionId,
  invoiceId,
  suggested = null,
  max = null,
  currency = "DKK",
  context,
  triggerLabel,
  triggerVariant = "default",
  triggerClassName = "w-full",
  hideTrigger = false,
}: {
  purpose: PaymentPurpose;
  sessionId?: number;
  invoiceId?: number;
  /** Prefilled amount: what is owed, left on the invoice or unused. */
  suggested?: number | null;
  /** The most that can be registered (the server checks it too). */
  max?: number | null;
  currency?: string;
  /** One line about whom/what is paid, shown under the title. */
  context?: string;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "secondary" | "ghost";
  triggerClassName?: string;
  /**
   * Nothing (left) to pay: no button. Callers keep the dialog mounted anyway,
   * so the receipt step stays open after the page refreshes with the payment.
   */
  hideTrigger?: boolean;
}) {
  const router = useRouter();
  const p = PURPOSES[purpose];
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<DeskPaymentMethod>("CASH");
  const [received, setReceived] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; receiptPath: string | null } | null>(null);

  function handleOpenChange(next: boolean) {
    if (loading) return;
    setOpen(next);
    if (next) {
      setAmount(amountInput(suggested));
      setMethod("CASH");
      setReceived("");
      setNote("");
      setError(null);
      setDone(null);
    }
  }

  const value = parseAmount(amount);
  const valid = value !== null && value > 0;
  const tooMuch = valid && max != null && value! > max + 0.005;
  const receivedValue = method === "CASH" && purpose !== "REFUND" ? parseAmount(received) : null;
  const change = valid && receivedValue !== null ? roundOre(receivedValue - value!) : null;
  const leftAfter = valid && suggested != null && (purpose === "SETTLEMENT" || purpose === "INVOICE")
    ? roundOre(suggested - value!)
    : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!valid) {
      setError("Skriv et beløb større end 0 kr.");
      return;
    }
    if (tooMuch) {
      setError(
        purpose === "REFUND"
          ? `Der er kun ${fmtMoney(max!, currency)} at udbetale.`
          : `Beløbet er højere end det skyldige (${fmtMoney(max!, currency)}). Skriv det skyldige beløb — byttepenge udregnes under "Modtaget".`,
      );
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await registerPayment({
        sessionId: sessionId ?? null,
        invoiceId: invoiceId ?? null,
        amount: p.sign * value!,
        method,
        kind: p.kind,
        note: note.trim() || null,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setDone({ message: res.message, receiptPath: res.receiptPath });
      router.refresh();
    } catch {
      setError("Betalingen kunne ikke gemmes. Prøv igen.");
    } finally {
      setLoading(false);
    }
  }

  const label = triggerLabel ?? p.title;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!hideTrigger && (
        <DialogTrigger render={<Button variant={triggerVariant} className={triggerClassName} />}>
          <Banknote className="h-4 w-4 mr-2" />
          {label}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{p.title}</DialogTitle>
          <DialogDescription>{context ? `${context}. ${p.hint}` : p.hint}</DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{done.message}</p>
            </div>
            {change !== null && change > 0.005 && (
              <p className="text-sm">Byttepenge: <strong className="tabular-nums">{fmtMoney(change, currency)}</strong></p>
            )}
            <div className="flex gap-2">
              {done.receiptPath && (
                <a href={`${done.receiptPath}?print=1`} target="_blank" rel="noopener" className="flex-1">
                  <Button variant="outline" className="w-full">
                    <Printer className="h-4 w-4 mr-2" />
                    Udskriv kvittering
                  </Button>
                </a>
              )}
              <Button className="flex-1" onClick={() => setOpen(false)}>Luk</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`pay-amount-${purpose}`}>Beløb ({currency}) *</Label>
              <Input
                id={`pay-amount-${purpose}`}
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="F.eks. 500"
                autoFocus={suggested == null}
              />
              {suggested != null && (
                <p className="text-xs text-muted-foreground">
                  {purpose === "REFUND" ? "Ubrugt saldo" : purpose === "INVOICE" ? "Tilbage på fakturaen" : "Skyldigt"}:{" "}
                  <span className="tabular-nums">{fmtMoney(suggested, currency)}</span>
                </p>
              )}
              {leftAfter >= 0.005 && !tooMuch && (
                <p className="text-xs text-amber-700">Delbetaling — {fmtMoney(leftAfter, currency)} mangler bagefter.</p>
              )}
            </div>

            <PaymentMethodPicker value={method} onChange={setMethod} label={p.methodText} />

            {method === "CASH" && purpose !== "REFUND" && (
              <div className="space-y-1.5">
                <Label htmlFor={`pay-received-${purpose}`} className="text-xs text-muted-foreground">Modtaget kontant (valgfrit)</Label>
                <Input
                  id={`pay-received-${purpose}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={received}
                  onChange={(e) => setReceived(e.target.value)}
                  placeholder="Fx 500"
                />
                {change !== null && (
                  change >= 0
                    ? <p className="text-sm">Byttepenge: <strong className="tabular-nums">{fmtMoney(change, currency)}</strong></p>
                    : <p className="text-xs text-red-600">Modtaget er mindre end beløbet.</p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor={`pay-note-${purpose}`} className="text-xs text-muted-foreground">Note / reference (valgfri)</Label>
              <Input
                id={`pay-note-${purpose}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={method === "OTHER" ? "Hvad dækker 'Andet' over?" : "Fx MobilePay-id eller bonnummer"}
              />
            </div>

            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2">
              <Button type="submit" disabled={loading || !valid} className="flex-1">
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Banknote className="h-4 w-4 mr-2" />}
                {valid
                  ? `${purpose === "REFUND" ? "Udbetal" : "Registrér"} ${fmtMoney(value!, currency)} · ${methodLabel(method)}`
                  : purpose === "REFUND" ? "Udbetal" : "Registrér"}
              </Button>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
                Annullér
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
