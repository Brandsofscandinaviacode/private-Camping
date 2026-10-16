"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, LogIn, Printer, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { activateBookingSessions } from "@/lib/today-actions";
import { prepaidAmountError, todayKey } from "@/lib/check-in";
import { parseAmount, type DeskPaymentMethod } from "@/lib/payments-shared";
import { fmtMoney } from "@/lib/settlement-shared";
import type { BulkCheckInRow, TodayRow } from "@/lib/today";
import { BillingModeField, ReceiptLines, TECHNICAL_ERROR } from "./check-in-fields";

function Option({
  checked,
  onChange,
  title,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
      <span>
        <span className="text-sm font-medium block">{title}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

/**
 * "Tjek valgte ind": one confirmation for many reservations (the winter
 * guests), then a result per row — a failure never stops the rest.
 */
export function BulkCheckInDialog({
  open,
  onOpenChange,
  rows: selectedRows,
  notify,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: TodayRow[];
  notify: { email: boolean; sms: boolean };
  /** Called with the ids that were checked in. */
  onDone: (checkedIn: number[]) => void;
}) {
  // What was selected when the dialog opened; the list behind it refreshes.
  const [rows] = useState(selectedRows);
  const router = useRouter();
  const [billingMode, setBillingMode] = useState<"PREPAID" | "POSTPAID">("POSTPAID");
  const [prepaidAmount, setPrepaidAmount] = useState("");
  const [prepaidMethod, setPrepaidMethod] = useState<DeskPaymentMethod>("CASH");
  const [keepArrival, setKeepArrival] = useState(true);
  const [sendWelcome, setSendWelcome] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BulkCheckInRow[] | null>(null);
  const [pending, startTransition] = useTransition();

  const today = todayKey();
  const earlier = rows.filter((r) => r.arrivalKey < today);
  const meteredEarlier = earlier.filter((r) => r.hasMeters).length;
  const anyMeters = rows.some((r) => r.hasMeters);
  const notifyOn = notify.email || notify.sms;
  const names = rows.map((r) => r.unitName);
  const amount = parseAmount(prepaidAmount);

  // The parent mounts a fresh dialog (new key) each time it opens.
  function handleOpenChange(next: boolean) {
    if (pending) return;
    onOpenChange(next);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || rows.length === 0) return;
    if (billingMode === "PREPAID") {
      const amountError = prepaidAmountError(amount);
      if (amountError) {
        setError(amountError);
        return;
      }
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await activateBookingSessions(
          rows.map((r) => r.sessionId),
          {
            billingMode,
            prepaidAmount: billingMode === "PREPAID" ? amount ?? undefined : undefined,
            prepaidMethod: billingMode === "PREPAID" ? prepaidMethod : undefined,
            keepArrivalDate: keepArrival,
            sendWelcome,
          },
        );
        if (!res.ok) {
          setError(res.message);
          return;
        }
        setResults(res.results);
        onDone(res.results.filter((r) => r.ok).map((r) => r.sessionId));
        router.refresh();
      } catch {
        setError(TECHNICAL_ERROR);
      }
    });
  }

  const okCount = results?.filter((r) => r.ok).length ?? 0;
  const failed = results?.filter((r) => !r.ok) ?? [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{results ? "Resultat af check-in" : `Tjek ${rows.length === 1 ? "1 gæst" : `${rows.length} gæster`} ind`}</DialogTitle>
        </DialogHeader>

        {results ? (
          <div className="space-y-4">
            <div
              className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${
                failed.length > 0 ? "border-amber-200 bg-amber-50 text-amber-800" : "border-primary/20 bg-primary/10 text-primary"
              }`}
            >
              {failed.length > 0 ? <XCircle className="h-4 w-4 shrink-0 mt-0.5" /> : <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />}
              <p>
                {okCount === 1 ? "1 gæst" : `${okCount} gæster`} tjekket ind
                {failed.length > 0 && <> · <b>{failed.length}</b> ikke tjekket ind – se herunder</>}
              </p>
            </div>
            <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
              {/* Failures first: they need the desk's attention */}
              {[...failed, ...results.filter((r) => r.ok)].map((r) => {
                const problems = r.receipt?.lines.filter((l) => l.tone === "error" || l.tone === "warn") ?? [];
                return (
                  <li key={r.sessionId} className="px-3 py-2.5 text-sm space-y-1.5">
                    <div className="flex items-start gap-2">
                      {r.ok
                        ? <CheckCircle2 className={`h-4 w-4 shrink-0 mt-0.5 ${problems.length ? "text-amber-600" : "text-green-600"}`} aria-label="Tjekket ind" />
                        : <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" aria-label="Ikke tjekket ind" />}
                      <div className="min-w-0 flex-1">
                        <p>
                          <span className="font-medium">{r.unitName}</span> · {r.guestName}
                        </p>
                        {!r.ok && <p className="text-red-600">{r.message}</p>}
                      </div>
                      <Link href={`/admin/bookings/${r.sessionId}`} className="text-xs text-muted-foreground hover:text-foreground shrink-0">
                        Åbn
                      </Link>
                    </div>
                    {r.receipt && (
                      <details className="pl-6" open={problems.length > 0}>
                        <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                          {problems.length > 0 ? `Kvittering – ${problems.length === 1 ? "1 punkt" : `${problems.length} punkter`} at se på` : "Kvittering"}
                        </summary>
                        <div className="mt-2 space-y-2">
                          <ReceiptLines lines={r.receipt.lines} />
                          {r.receipt.deposit && (
                            <a
                              href={`/admin/bookings/${r.sessionId}/receipt/${r.receipt.deposit.paymentId}?print=1`}
                              target="_blank"
                              rel="noopener"
                              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                            >
                              <Printer className="h-3.5 w-3.5" />
                              Kvittering for forudbetaling ({fmtMoney(r.receipt.deposit.amount)})
                            </a>
                          )}
                        </div>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">Gæsteportal-link og QR-kode findes på hver booking.</p>
            <Button type="button" className="w-full" onClick={() => handleOpenChange(false)}>
              Luk
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {names.slice(0, 6).join(", ")}
              {names.length > 6 && ` og ${names.length - 6} til`}
            </p>

            <BillingModeField
              idPrefix="bulk"
              mode={billingMode}
              onModeChange={setBillingMode}
              amount={prepaidAmount}
              onAmountChange={setPrepaidAmount}
              method={prepaidMethod}
              onMethodChange={setPrepaidMethod}
              hasMeters={anyMeters}
            />
            {billingMode === "PREPAID" && rows.length > 1 && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                Beløbet registreres som betalt i kassen for hver gæst
                {amount != null && amount > 0 && <> – i alt <b>{fmtMoney(amount * rows.length)}</b></>}.
              </p>
            )}

            {earlier.length > 0 && (
              <Option
                checked={keepArrival}
                onChange={setKeepArrival}
                title="Behold bookingens ankomstdato"
                hint={
                  `${earlier.length === rows.length ? "Gæsterne" : `${earlier.length} af gæsterne`} kom før i dag og beholder ankomstdatoen som check-in-tid i stedet for nu.` +
                  (meteredEarlier > 0 ? ` Enheder med målere (${meteredEarlier}) starter nu, ved startaflæsningen.` : "")
                }
              />
            )}
            <Option
              checked={sendWelcome}
              onChange={setSendWelcome}
              title="Send velkomstbesked"
              hint={
                notifyOn
                  ? "Portal-linket på e-mail/SMS til hver gæst med kontaktoplysninger."
                  : "E-mail og SMS er slået fra i indstillingerne, så intet sendes lige nu."
              }
            />

            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={pending || rows.length === 0}>
                {pending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LogIn className="h-4 w-4 mr-2" />}
                {pending ? "Tjekker ind…" : `Tjek ${rows.length === 1 ? "1 gæst" : `${rows.length} gæster`} ind`}
              </Button>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
                Annullér
              </Button>
            </div>
            {pending && rows.length > 5 && (
              <p className="text-xs text-muted-foreground">Gæsterne tjekkes ind én ad gangen – det kan tage lidt tid.</p>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
