import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSessionStatement } from "@/lib/actions";
import { PrintButton } from "@/components/admin/print-button";
import { fmtDate, fmtDateTime, fmtShortDate } from "@/lib/format";
import { bookingRefReceiptLabel } from "@/lib/booking-ref";
import { fmtMoney, paymentMethodLabel, SERVICE_SETTLEMENT_LABELS } from "@/lib/settlement-shared";
import { paymentPurposeLabel } from "@/lib/payments-shared";
import { RegisterPaymentDialog } from "@/components/admin/payment-dialog";

import { unitDisplayName } from "@/lib/utils";

export const dynamic = "force-dynamic";

const INVOICE_STATUS: Record<string, { label: string; cls: string }> = {
  PAID: { label: "Betalt", cls: "text-green-700" },
  PENDING: { label: "Afventer betaling", cls: "text-gray-500" },
  OVERDUE: { label: "Forfalden", cls: "text-red-600" },
  DRAFT: { label: "Kladde", cls: "text-gray-500" },
};

export default async function BookingStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessionId = parseInt(id, 10);
  if (isNaN(sessionId)) notFound();

  const statement = await getSessionStatement(sessionId);
  if (!statement) notFound();

  const { session, unit, settlement: s, camp, generatedAt } = statement;
  const cur = s.currency;
  const t = s.totals;
  const money = (v: number) => fmtMoney(v, cur);
  const title = s.state === "PAID" ? "Kvittering" : s.state === "RUNNING" ? "Foreløbig opgørelse" : "Opgørelse";

  // Meter periods: invoices raised during the stay, then what the stay
  // itself settles. Units without meters have none — the table is left out.
  const rem = s.remainder;
  const hasRemainder = rem.electricityCost + rem.waterCost > 0.005 || (rem.electricityKwh ?? 0) > 0 || (rem.waterLiters ?? 0) > 0;
  const periods = [
    ...s.invoices.map((inv) => ({
      key: `inv-${inv.id}`,
      label: `${fmtDate(inv.periodStart)} – ${fmtDate(inv.periodEnd)}`,
      status: INVOICE_STATUS[inv.status] ?? { label: inv.status, cls: "text-gray-500" },
      kwh: inv.electricityKwh,
      liters: inv.waterLiters,
      amount: inv.electricityCost + inv.waterCost,
    })),
    ...(hasRemainder
      ? [{
          key: "remainder",
          label: s.sessionStatus === "ACTIVE"
            ? `Siden ${fmtDate(rem.from)} (indtil nu)`
            : `${fmtDate(rem.from)} – ${fmtDate(rem.to)}`,
          status: s.invoices.length > 0 ? { label: "Afregnes med opholdet", cls: "text-gray-500" } : null,
          kwh: rem.electricityKwh,
          liters: rem.waterLiters,
          amount: rem.electricityCost + rem.waterCost,
        }]
      : []),
  ];
  const showWater = t.waterCost > 0.005 || periods.some((p) => p.liters != null);

  // The bottom line, in the same words as the booking page.
  const result =
    s.state === "OWED" || s.state === "PARTIAL"
      ? { label: "Skyldigt beløb", amount: s.owed, cls: "text-red-700" }
      : s.state === "RUNNING"
        ? { label: "Til betaling indtil nu", amount: Math.max(0, s.due - s.paid), cls: "text-black" }
        : s.state === "PAID"
          ? { label: "Betalt — intet skyldigt beløb", amount: 0, cls: "text-green-700" }
          : { label: "Intet at betale", amount: 0, cls: "text-green-700" };

  const visiblePayments = s.payments.filter((p) => p.kind === "SETTLEMENT" || p.kind === "INVOICE" || p.kind === "BALANCE");

  return (
    <div className="p-4 sm:p-6 lg:p-10 print:p-0">
      {/* Screen-only toolbar */}
      <div className="max-w-3xl mx-auto mb-6 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/admin/bookings/${session.id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Tilbage til booking
          </Button>
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {/* The guest is usually at the desk right after check-out: take the
              money here. Mounted while nothing is due too, so the receipt
              step survives the refresh. */}
          {s.sessionStatus === "COMPLETED" && (
            <>
              <RegisterPaymentDialog
                purpose="SETTLEMENT"
                sessionId={session.id}
                suggested={s.owed}
                max={s.owed}
                currency={cur}
                context={`${unitDisplayName(unit.type, unit.name)} · ${session.guestName}`}
                triggerLabel={`Registrér betaling (${money(s.owed)})`}
                triggerClassName=""
                hideTrigger={s.owed <= 0}
              />
              <RegisterPaymentDialog
                purpose="REFUND"
                sessionId={session.id}
                suggested={s.refundDue}
                max={s.refundDue}
                currency={cur}
                context={`${unitDisplayName(unit.type, unit.name)} · ${session.guestName}`}
                triggerLabel="Udbetal ubrugt saldo"
                triggerVariant="outline"
                triggerClassName=""
                hideTrigger={s.refundDue <= 0}
              />
            </>
          )}
          <PrintButton />
        </div>
      </div>

      {/* Printable statement */}
      <div className="max-w-3xl mx-auto bg-white text-black rounded-xl border border-border/60 shadow-sm print:shadow-none print:border-0 print:rounded-none print:max-w-none">
        <div className="p-8 print:p-0 space-y-8">
          {/* Header */}
          <div className="flex items-start justify-between gap-6 pb-6 border-b border-gray-300">
            <div className="min-w-0">
              {camp.name && <p className="text-lg font-bold">{camp.name}</p>}
              {camp.address && <p className="text-sm text-gray-700 whitespace-pre-line">{camp.address}</p>}
              {camp.cvr && <p className="text-sm text-gray-700">CVR {camp.cvr}</p>}
              <h1 className={`${camp.name ? "text-xl mt-4" : "text-2xl"} font-bold`}>{title}</h1>
              <p className="text-sm text-gray-600 mt-1">{bookingRefReceiptLabel(session.bookingRef, session.id)}</p>
            </div>
            <div className="text-right text-sm shrink-0">
              <p className="text-gray-600">Udskrevet</p>
              <p className="font-medium">{fmtDate(generatedAt)}</p>
            </div>
          </div>

          {/* Guest + stay info */}
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                Gæst
              </p>
              <p className="font-medium">{session.guestName}</p>
              {session.guestEmail && <p className="text-gray-700">{session.guestEmail}</p>}
              {session.guestPhone && <p className="text-gray-700">{session.guestPhone}</p>}
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                Enhed
              </p>
              <p className="font-medium">
                {unitDisplayName(unit.type, unit.name)}
              </p>
              <p className="text-gray-700">Check-in: {fmtDate(session.checkInTime)}</p>
              <p className="text-gray-700">Check-out: {session.checkOutTime ? fmtDate(session.checkOutTime) : "—"}</p>
            </div>
          </div>

          {/* Meter periods */}
          {periods.length > 0 && (
            <div>
              <h2 className="font-semibold mb-3">Forbrug af el og vand</h2>
              <div className="overflow-hidden border border-gray-300 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 text-xs uppercase tracking-wide text-gray-600">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Periode</th>
                      <th className="text-right px-3 py-2 font-medium">El (kWh)</th>
                      {showWater && <th className="text-right px-3 py-2 font-medium">Vand (L)</th>}
                      <th className="text-right px-3 py-2 font-medium">Beløb</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((p) => (
                      <tr key={p.key} className="border-t border-gray-200">
                        <td className="px-3 py-2">
                          <div className="font-medium">{p.label}</div>
                          {p.status && <div className={`text-[11px] ${p.status.cls}`}>{p.status.label}</div>}
                        </td>
                        <td className="text-right px-3 py-2 tabular-nums">
                          {p.kwh != null ? p.kwh.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                        </td>
                        {showWater && (
                          <td className="text-right px-3 py-2 tabular-nums">
                            {p.liters != null ? p.liters.toLocaleString("da-DK", { maximumFractionDigits: 0 }) : "—"}
                          </td>
                        )}
                        <td className="text-right px-3 py-2 tabular-nums font-medium">{money(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Services (laundry / showers) */}
          {s.services.length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3">Vask og bad</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-100 text-left text-xs uppercase tracking-wide text-gray-600">
                    <th className="px-3 py-2 font-medium">Dato</th>
                    <th className="px-3 py-2 font-medium">Ydelse</th>
                    <th className="px-3 py-2 font-medium">Betaling</th>
                    <th className="px-3 py-2 font-medium text-right">Beløb</th>
                  </tr>
                </thead>
                <tbody>
                  {s.services.map((sv) => (
                    <tr key={sv.id} className="border-b border-gray-200 last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">{fmtShortDate(sv.occurredAt)}</td>
                      <td className="px-3 py-2">
                        {sv.label}
                        {sv.detail && <span className="text-gray-500"> · {sv.detail}</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{SERVICE_SETTLEMENT_LABELS[sv.settledBy]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(sv.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {periods.length === 0 && s.services.length === 0 && t.stayPrice === 0 && (
            <p className="text-sm text-gray-600">Der er ikke registreret noget forbrug på denne booking.</p>
          )}

          {/* Totals — zero lines are left out */}
          <div className="border-t border-gray-300 pt-4 space-y-2 text-sm">
            {t.electricityCost > 0.005 && <TotalRow label="El i alt" value={money(t.electricityCost)} />}
            {t.waterCost > 0.005 && <TotalRow label="Vand i alt" value={money(t.waterCost)} />}
            {t.servicesCost > 0.005 && <TotalRow label="Vask og bad i alt" value={money(t.servicesCost)} />}
            {t.stayPrice > 0.005 && <TotalRow label="Opholdspris" value={money(t.stayPrice)} />}
            <div className="flex justify-between pt-2 border-t border-gray-200">
              <span className="font-semibold">Samlet forbrug</span>
              <span className="font-semibold tabular-nums">{money(t.totalCost)}</span>
            </div>

            {t.servicesPaidAtPurchase > 0.005 && <TotalRow label="Betalt ved køb" value={`-${money(t.servicesPaidAtPurchase)}`} />}
            {s.prepaid && (
              <TotalRow
                label="Trukket fra forudbetaling"
                value={`-${money(Math.min(s.prepaid.deposited, s.prepaid.usedElWater + s.prepaid.usedServices))}`}
              />
            )}
            {t.invoicesPaid > 0.005 && <TotalRow label="Betalte fakturaer" value={`-${money(t.invoicesPaid)}`} />}
            {Math.abs(s.paid) > 0.005 && <TotalRow label="Betalinger" value={`-${money(s.paid)}`} />}
            {s.paidWithoutRecord && <TotalRow label="Betalt" value={`-${money(s.due)}`} />}

            <div className={`flex justify-between pt-2 border-t border-gray-300 text-lg ${result.cls}`}>
              <span className="font-bold">{result.label}</span>
              <span className="font-bold tabular-nums">{money(result.amount)}</span>
            </div>
            {s.lastPayment && s.state === "PAID" && (
              <p className="text-[11px] text-gray-600 text-right">
                Betalt {fmtDate(s.lastPayment.at)}{s.lastPayment.method ? ` · ${paymentMethodLabel(s.lastPayment.method)}` : ""}
              </p>
            )}
            {s.prepaid && (
              <p className="text-[11px] text-gray-600 text-right">
                Forudbetalt {money(s.prepaid.deposited)}
                {s.prepaid.remaining >= 0 && ` · ubrugt saldo ${money(s.prepaid.remaining)}`}
                {s.prepaid.refunded > 0.005 && ` · udbetalt ${money(s.prepaid.refunded)}`}
              </p>
            )}
            {s.state === "NOTHING_DUE" && !s.prepaid && s.due > 0.005 && (
              <p className="text-[11px] text-gray-500 text-right">Rest under 1 kr. opkræves ikke.</p>
            )}
          </div>

          {/* Payments — what was received, so the page works as a receipt */}
          {visiblePayments.length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3">Betalinger</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-100 text-left text-xs uppercase tracking-wide text-gray-600">
                    <th className="px-3 py-2 font-medium">Dato</th>
                    <th className="px-3 py-2 font-medium">Betaling</th>
                    <th className="px-3 py-2 font-medium text-right">Beløb</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePayments.map((p) => (
                    <tr key={p.id} className={`border-b border-gray-200 last:border-0 ${p.reversed ? "text-gray-400 line-through" : ""}`}>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(p.createdAt)}</td>
                      <td className="px-3 py-2">
                        {paymentMethodLabel(p.method)}
                        <span className="text-gray-500">
                          {" · "}
                          {paymentPurposeLabel(p).toLowerCase()}
                          {p.kind === "INVOICE" && p.invoiceId ? ` nr. ${p.invoiceId}` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          <div className="pt-6 border-t border-gray-300 text-[11px] text-gray-500 text-center space-y-0.5">
            {(camp.name || camp.cvr) && (
              <p>{[camp.name, camp.cvr ? `CVR ${camp.cvr}` : null].filter(Boolean).join(" · ")}</p>
            )}
            <p>Tak for dit besøg.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-600">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
