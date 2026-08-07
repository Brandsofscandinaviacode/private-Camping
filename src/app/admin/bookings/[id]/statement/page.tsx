import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSessionStatement } from "@/lib/actions";
import { PrintButton } from "@/components/admin/print-button";

import { unitDisplayName } from "@/lib/utils";

export const dynamic = "force-dynamic";

function fmtDKK(v: number) {
  return `${v.toFixed(2)} DKK`;
}

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

  const { session, unit, periods, services, totals, prepaid, generatedAt } = statement;
  const hasOwed = totals.owed > 0;

  return (
    <div className="p-4 sm:p-6 lg:p-10">
      {/* Screen-only toolbar */}
      <div className="max-w-3xl mx-auto mb-6 flex items-center justify-between print:hidden">
        <Link href={`/admin/bookings/${session.id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Tilbage til booking
          </Button>
        </Link>
        <PrintButton />
      </div>

      {/* Printable statement */}
      <div className="max-w-3xl mx-auto bg-white text-black rounded-xl border border-border/60 shadow-sm print:shadow-none print:border-0 print:max-w-none">
        <div className="p-8 print:p-0 space-y-8">
          {/* Header */}
          <div className="flex items-start justify-between pb-6 border-b border-gray-300">
            <div>
              <h1 className="text-2xl font-bold">Opgørelse</h1>
              <p className="text-sm text-gray-600 mt-1">
                Booking {session.bookingRef || `#${session.id}`}
              </p>
            </div>
            <div className="text-right text-sm">
              <p className="text-gray-600">Udskrevet</p>
              <p className="font-medium">
                {generatedAt.toLocaleDateString("da-DK", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </p>
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
              <p className="text-gray-700">
                Check-in: {new Date(session.checkInTime).toLocaleDateString("da-DK")}
              </p>
              <p className="text-gray-700">
                Check-out:{" "}
                {session.checkOutTime
                  ? new Date(session.checkOutTime).toLocaleDateString("da-DK")
                  : "—"}
              </p>
            </div>
          </div>

          {/* Periods table */}
          <div>
            <h2 className="font-semibold mb-3">Forbrug pr. periode</h2>
            {periods.length === 0 ? (
              <p className="text-sm text-gray-600">
                Der er ikke registreret noget forbrug på denne booking.
              </p>
            ) : (
              <div className="overflow-hidden border border-gray-300 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 text-xs uppercase tracking-wide text-gray-600">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Periode</th>
                      <th className="text-right px-3 py-2 font-medium">El (kWh)</th>
                      <th className="text-right px-3 py-2 font-medium">Vand (L)</th>
                      <th className="text-right px-3 py-2 font-medium">Forbrug</th>
                      <th className="text-right px-3 py-2 font-medium">Betalt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((p, idx) => (
                      <tr
                        key={p.invoiceId ?? `rem-${idx}`}
                        className="border-t border-gray-200"
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium capitalize">{p.label}</div>
                          {p.paymentStatus === "UNINVOICED" && (
                            <div className="text-[11px] text-amber-700">
                              Ikke faktureret endnu
                            </div>
                          )}
                          {p.paymentStatus === "PENDING" && (
                            <div className="text-[11px] text-gray-500">Afventer betaling</div>
                          )}
                          {p.paymentStatus === "OVERDUE" && (
                            <div className="text-[11px] text-red-600">Forfalden</div>
                          )}
                          {p.paymentStatus === "PAID" && (
                            <div className="text-[11px] text-green-700">Betalt</div>
                          )}
                        </td>
                        <td className="text-right px-3 py-2 tabular-nums">
                          {p.electricityKwh != null ? p.electricityKwh.toFixed(2) : "—"}
                        </td>
                        <td className="text-right px-3 py-2 tabular-nums">
                          {p.waterLiters != null ? p.waterLiters.toFixed(0) : "—"}
                        </td>
                        <td className="text-right px-3 py-2 tabular-nums font-medium">
                          {fmtDKK(p.totalAmount)}
                        </td>
                        <td className="text-right px-3 py-2 tabular-nums">
                          {p.paidAmount > 0 ? fmtDKK(p.paidAmount) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Services (laundry / showers) */}
          {services.length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3">Services</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-100 text-left text-xs uppercase tracking-wide text-gray-600">
                    <th className="px-3 py-2 font-medium">Dato</th>
                    <th className="px-3 py-2 font-medium">Ydelse</th>
                    <th className="px-3 py-2 font-medium text-right">Beløb</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((sv, i) => (
                    <tr key={i} className="border-b border-gray-200 last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {sv.occurredAt.toLocaleDateString("da-DK", { day: "numeric", month: "short" })}
                      </td>
                      <td className="px-3 py-2">
                        {sv.label}
                        {sv.detail && <span className="text-gray-500"> · {sv.detail}</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtDKK(sv.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Totals */}
          <div className="border-t border-gray-300 pt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Elektricitet i alt</span>
              <span className="tabular-nums">{fmtDKK(totals.electricityCost)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Vand i alt</span>
              <span className="tabular-nums">{fmtDKK(totals.waterCost)}</span>
            </div>
            {totals.servicesCost > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-600">Services i alt</span>
                <span className="tabular-nums">{fmtDKK(totals.servicesCost)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-gray-200">
              <span className="font-semibold">Samlet forbrug</span>
              <span className="font-semibold tabular-nums">{fmtDKK(totals.totalCost)}</span>
            </div>

            {prepaid ? (
              <>
                {/* Prepaid stays settle against the deposit, so there is no
                    amount due — show the balance instead. */}
                <div className="flex justify-between">
                  <span className="text-gray-600">Forudbetalt</span>
                  <span className="tabular-nums">{fmtDKK(prepaid.deposited)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Forbrugt af forudbetaling</span>
                  <span className="tabular-nums">-{fmtDKK(prepaid.used)}</span>
                </div>
                {hasOwed ? (
                  <div className="flex justify-between pt-2 border-t border-gray-300 text-lg text-red-700">
                    <span className="font-bold">Skyldigt beløb</span>
                    <span className="font-bold tabular-nums">{fmtDKK(totals.owed)}</span>
                  </div>
                ) : (
                  <div className="flex justify-between pt-2 border-t border-gray-300 text-lg text-green-700">
                    <span className="font-bold">Resterende saldo</span>
                    <span className="font-bold tabular-nums">{fmtDKK(prepaid.remaining)}</span>
                  </div>
                )}
                <p className="text-[11px] text-gray-500 text-right">
                  {hasOwed
                    ? "Forbruget overstiger den forudbetalte saldo."
                    : "Forbrug er trukket fra forudbetalingen — intet at betale."}
                </p>
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-600">Betalt undervejs</span>
                  <span className="tabular-nums">-{fmtDKK(totals.totalPaid)}</span>
                </div>
                <div
                  className={`flex justify-between pt-2 border-t border-gray-300 text-lg ${
                    hasOwed ? "text-red-700" : "text-green-700"
                  }`}
                >
                  <span className="font-bold">
                    {hasOwed ? "Skyldigt beløb" : "Intet skyldigt beløb"}
                  </span>
                  <span className="font-bold tabular-nums">
                    {hasOwed ? fmtDKK(totals.owed) : fmtDKK(0)}
                  </span>
                </div>
                {!hasOwed && totals.totalCost - totals.totalPaid > 0 && (
                  <p className="text-[11px] text-gray-500 text-right">
                    Rest under 1 DKK ignoreres.
                  </p>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="pt-6 border-t border-gray-300 text-[11px] text-gray-500 text-center">
            Tak for dit besøg.
          </div>
        </div>
      </div>
    </div>
  );
}
