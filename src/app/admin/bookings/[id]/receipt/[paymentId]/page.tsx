import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPaymentReceipt } from "@/lib/payment-actions";
import { AutoPrint, PrintButton } from "@/components/admin/print-button";
import { bookingRefLabel } from "@/lib/booking-ref";
import { fmtDateTime } from "@/lib/format";
import { fmtMoney } from "@/lib/settlement-shared";
import { methodLabel } from "@/lib/payments-shared";

export const dynamic = "force-dynamic";

// Only the slip is printed — narrow enough for a receipt printer, fine on A4.
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #payment-receipt, #payment-receipt * { visibility: visible !important; }
  #payment-receipt { position: absolute; left: 0; top: 0; width: 80mm; }
}`;

export default async function PaymentReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; paymentId: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const { id, paymentId } = await params;
  const { print } = await searchParams;
  const sessionId = parseInt(id, 10);
  const pid = parseInt(paymentId, 10);
  if (isNaN(sessionId) || isNaN(pid)) notFound();

  const r = await getPaymentReceipt(sessionId, pid);
  if (!r) notFound();
  const p = r.payment;
  const money = (v: number) => fmtMoney(v, r.currency);
  const payout = r.total < 0;
  const title = p.reversesId != null
    ? "Modpost"
    : payout
      ? "Kvittering for udbetaling"
      : p.kind === "BALANCE"
        ? "Kvittering for indbetaling"
        : "Kvittering for betaling";

  return (
    <div className="p-4 sm:p-6 lg:p-10">
      <style>{PRINT_CSS}</style>
      {print === "1" && <AutoPrint />}
      <div className="max-w-sm mx-auto mb-6 flex items-center justify-between print:hidden">
        <Link href={`/admin/bookings/${sessionId}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Tilbage til booking
          </Button>
        </Link>
        <PrintButton />
      </div>

      <div
        id="payment-receipt"
        className="max-w-sm mx-auto bg-white text-black rounded-xl border border-border/60 shadow-sm p-6 space-y-4 text-sm print:shadow-none print:border-0 print:rounded-none print:p-0"
      >
        {(r.camp.name || r.camp.address || r.camp.cvr) && (
          <div className="text-center">
            {r.camp.name && <p className="font-bold text-base">{r.camp.name}</p>}
            {r.camp.address && <p className="text-xs text-gray-700 whitespace-pre-line">{r.camp.address}</p>}
            {r.camp.cvr && <p className="text-xs text-gray-700">CVR {r.camp.cvr}</p>}
          </div>
        )}

        <div className="text-center border-y border-dashed border-gray-400 py-3">
          <h1 className="font-bold text-lg">{title}</h1>
          <p className="text-xs text-gray-600">Nr. {p.id} · {fmtDateTime(p.createdAt)}</p>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-gray-600">Gæst</dt>
          <dd className="text-right font-medium">{r.guestName}</dd>
          <dt className="text-gray-600">Enhed</dt>
          <dd className="text-right">{r.unitName}</dd>
          <dt className="text-gray-600">Booking</dt>
          <dd className="text-right">{bookingRefLabel(r.bookingRef) ?? `#${r.sessionId}`}</dd>
        </dl>

        <div className="border-t border-dashed border-gray-400 pt-3 space-y-1">
          {r.lines.map((l, i) => (
            <div key={i} className="flex justify-between gap-3">
              <span>{l.purpose}</span>
              <span className="tabular-nums">{money(l.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between gap-3 font-bold text-base pt-1">
            <span>{payout ? "Udbetalt" : "Betalt"}</span>
            <span className="tabular-nums">{money(Math.abs(r.total))}</span>
          </div>
          <div className="flex justify-between gap-3 text-gray-700">
            <span>{payout ? "Udbetalt med" : "Betalt med"}</span>
            <span>{methodLabel(p.method)}</span>
          </div>
          {p.createdBy && (
            <div className="flex justify-between gap-3 text-gray-700">
              <span>Ekspedient</span>
              <span>{p.createdBy}</span>
            </div>
          )}
          {p.note && <p className="text-xs text-gray-600 pt-1 break-words">{p.note}</p>}
        </div>

        {p.reversed && p.reversal && (
          <p className="text-center font-bold text-red-700 border border-red-300 rounded py-1">
            FORTRUDT {fmtDateTime(p.reversal.at)}
          </p>
        )}

        {(r.balance || (r.owedNow != null && r.owedNow > 0)) && (
          <div className="border-t border-dashed border-gray-400 pt-3 space-y-1 text-gray-700">
            {r.balance && (
              <>
                <div className="flex justify-between gap-3">
                  <span>Forudbetalt i alt</span>
                  <span className="tabular-nums">{money(r.balance.deposited)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>{r.balance.remaining < 0 ? "Overtræk nu" : "Saldo nu"}</span>
                  <span className="tabular-nums">{money(Math.abs(r.balance.remaining))}</span>
                </div>
              </>
            )}
            {r.owedNow != null && r.owedNow > 0 && (
              <div className="flex justify-between gap-3 font-medium text-black">
                <span>Mangler at betale</span>
                <span className="tabular-nums">{money(r.owedNow)}</span>
              </div>
            )}
          </div>
        )}

        <p className="text-center text-xs text-gray-500 pt-2">Tak!</p>
      </div>
    </div>
  );
}
