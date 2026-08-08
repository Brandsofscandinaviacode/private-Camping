import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Zap, Droplets, Flame, Mail, Hash, Phone, Receipt, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getSessionById, getPricing } from "@/lib/actions";
import { CopyButton } from "@/components/admin/copy-button";
import { SessionActions } from "@/components/admin/session-actions";
import { SessionEditForm } from "@/components/admin/session-edit-form";
import { LaundryCreditSection } from "@/components/admin/laundry-credit";
import { ConsumptionChart } from "@/components/admin/consumption-chart";
import { SessionCharges } from "@/components/admin/session-charges";
import { LiveConsumption } from "@/components/admin/live-consumption";
import { CreateInvoiceButton } from "@/components/admin/create-invoice-button";
import { InvoiceRow } from "@/components/admin/invoice-row";
import { BookingCheckoutButton } from "@/components/admin/booking-checkout-button";
import { BookingActivateButton } from "@/components/admin/booking-activate-button";
import { PrepaidBalance } from "@/components/admin/prepaid-balance";
import { Breadcrumbs } from "@/components/admin/breadcrumbs";

import { unitDisplayName } from "@/lib/utils";
import { resolvePrepaidDeposited } from "@/lib/prepaid";

export const dynamic = "force-dynamic";

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessionId = parseInt(id, 10);
  if (isNaN(sessionId)) notFound();

  const session = await getSessionById(sessionId);
  if (!session) notFound();

  const pricing = await getPricing();
  const isPendingSession = session.status === "PENDING";
  const isActive = session.status === "ACTIVE";
  const isUnpaid = session.status === "COMPLETED" && session.paymentStatus === "UNPAID";
  const isPaid = session.paymentStatus === "PAID";

  const usedKwhMain = (session.endKwh != null && session.startKwh != null)
    ? Math.max(0, session.endKwh - session.startKwh) : null;
  const usedKwhHeating = (session.endHeatingKwh != null && session.startHeatingKwh != null)
    ? Math.max(0, session.endHeatingKwh - session.startHeatingKwh) : null;
  const usedKwh = (usedKwhMain !== null || usedKwhHeating !== null)
    ? (usedKwhMain ?? 0) + (usedKwhHeating ?? 0) : null;
  const hasHeatingMeter = !!(session.unit.hardware?.hasHeating && session.unit.hardware?.heatingMeterEntityId);
  const usedWater = (session.endWaterLiters != null && session.startWaterLiters != null)
    ? Math.max(0, session.endWaterLiters - session.startWaterLiters) : null;

  return (
    <div className="p-4 sm:p-6 lg:p-10 space-y-6 max-w-7xl">
      <Breadcrumbs
        items={[
          { label: "Bookinger", href: "/admin/bookings" },
          { label: session.guestName },
        ]}
      />
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/bookings">
          <Button variant="ghost" size="sm" aria-label="Tilbage til bookinger">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{session.guestName}</h1>
            {isPendingSession && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 font-medium inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Reserveret
              </span>
            )}
            {isActive && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                Aktiv
              </span>
            )}
            {isUnpaid && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-red-50 text-red-600 font-medium inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                Ubetalt
              </span>
            )}
            {isPaid && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-green-50 text-green-600 font-medium inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                Betalt
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {unitDisplayName(session.unit.type, session.unit.name)} &middot; {session.bookingRef || `#${session.id}`}
          </p>
        </div>
      </div>

      {/* ═══ TOP: booking details + statement actions ═══ */}
      <div className="space-y-5">
        <div className="rounded-xl border border-border/60 bg-card shadow-sm">
          <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Booking detaljer</h2>
            <CopyButton text={`/guest/${session.guestPortalToken}`} label="Kopiér gæstelink" />
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5 text-sm">
              {/* Kontakt */}
              <div className="space-y-2.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Kontakt</p>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{session.guestEmail || "—"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{session.guestPhone || "—"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{session.bookingRef || "—"}</span>
                </div>
              </div>

              {/* Ophold */}
              <div className="space-y-2.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ophold</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Check-in</span>
                  <span className="text-right">{new Date(session.checkInTime).toLocaleString("da-DK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Check-out</span>
                  <span className="text-right">{session.checkOutTime ? new Date(session.checkOutTime).toLocaleString("da-DK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                </div>
                {session.expectedCheckOut && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Forventet</span>
                    <span className="text-right">{new Date(session.expectedCheckOut).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </div>
                )}
              </div>

              {/* Afregning */}
              <div className="space-y-2.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Afregning</p>
                <div>
                  {session.billingMode === "PREPAID" ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                      Forudbetalt {session.prepaidAmount ? `(${session.prepaidAmount.toFixed(2)} DKK)` : ""}
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Bagudbetalt</span>
                  )}
                </div>
                {/* Meter settlement only — services are listed separately in
                    "Forbrug og køb", so labelling this a final total made the
                    two figures look contradictory. */}
                {session.totalCost != null && (
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <span className="text-muted-foreground">El og vand ved checkout</span>
                    <span className="font-semibold tabular-nums">{session.totalCost.toFixed(2)} DKK</span>
                  </div>
                )}
              </div>
            </div>

            {session.notes && (
              <>
                <Separator className="my-4" />
                <div className="text-sm">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Bemærkninger</p>
                  <p>{session.notes}</p>
                </div>
              </>
            )}
          </div>

          {/* Statement / checkout actions live with the booking they act on */}
          <div className="px-5 py-4 border-t border-border bg-muted/30 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-4 w-4 text-primary shrink-0" />
              <p className="text-xs text-muted-foreground">
                {isPendingSession
                  ? "Importeret booking — vælg afregningsform og aktivér."
                  : isActive && !session.unit.isLongTerm
                    ? "Checker ud, aflæser målere og opretter afsluttende faktura."
                    : "Udskriftsvenlig opgørelse med forbrug og skyldigt beløb."}
              </p>
            </div>
            <div className="shrink-0">
              {isPendingSession ? (
                <BookingActivateButton
                  sessionId={session.id}
                  guestName={session.guestName}
                  unitName={session.unit.name}
                  initialEmail={session.guestEmail}
                  initialPhone={session.guestPhone}
                  initialBookingRef={session.bookingRef}
                  initialExpectedCheckOut={session.expectedCheckOut ? session.expectedCheckOut.toISOString().slice(0, 10) : null}
                />
              ) : isActive && !session.unit.isLongTerm ? (
                <BookingCheckoutButton
                  sessionId={session.id}
                  guestName={session.guestName}
                  unitName={session.unit.name}
                />
              ) : (
                <Link href={`/admin/bookings/${session.id}/statement`}>
                  <Button variant="outline" size="sm">
                    <FileText className="h-4 w-4 mr-2" />
                    Vis opgørelse
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>

        <SessionEditForm
            sessionId={session.id}
            guestName={session.guestName}
            guestEmail={session.guestEmail || ""}
            guestPhone={session.guestPhone || ""}
            bookingRef={session.bookingRef || ""}
            notes={session.notes || ""}
            expectedCheckOut={session.expectedCheckOut ? session.expectedCheckOut.toISOString().slice(0, 10) : ""}
            startKwh={session.startKwh}
            endKwh={session.endKwh}
            startHeatingKwh={session.startHeatingKwh}
            endHeatingKwh={session.endHeatingKwh}
            hasHeatingMeter={hasHeatingMeter}
            startWaterLiters={session.startWaterLiters}
            endWaterLiters={session.endWaterLiters}
            pricePerKwhOverride={session.pricePerKwhOverride}
            pricePerLiterWaterOverride={session.pricePerLiterWaterOverride}
            defaultPricePerKwh={pricing.pricePerKwh}
            defaultPricePerLiterWater={pricing.pricePerLiterWater}
            hasWaterMeter={!!session.unit.hardware?.hasWater}
            isActive={isActive}
          />
      </div>

      {/* ═══ Forbrug (venstre) + Økonomi (højre) ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left: consumption */}
        <div className="lg:col-span-2 space-y-5">
          {isActive && (
            <LiveConsumption
              sessionId={session.id}
              hasElectricity={!!session.unit.hardware?.hasElectricity}
              hasWater={!!session.unit.hardware?.hasWater}
            />
          )}

          {isPendingSession && (
            <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 shadow-sm p-5">
              <p className="text-sm text-amber-800 font-medium">Afventer check-in</p>
              <p className="text-xs text-amber-600 mt-1">
                Denne booking er importeret fra booking-systemet. Check gæsten ind for at starte forbrugsmåling.
              </p>
            </div>
          )}

          {!isPendingSession && (<>
          <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="font-semibold">Forbrug og køb</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Alt gæsten har brugt under opholdet — opdateres løbende, uafhængigt af fakturering
              </p>
            </div>
            <SessionCharges sessionId={session.id} />
          </div>

          <div className="rounded-xl border border-border/60 bg-card shadow-sm">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="font-semibold">Forbrugstrend</h2>
            </div>
            <div className="p-5">
              <ConsumptionChart unitId={session.unit.id} />
            </div>
          </div>

          {/* Meter readings — compact table instead of one card per meter */}
          <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="font-semibold">Målerstande</h2>
              <p className="text-xs text-muted-foreground mt-1">Start- og slutaflæsning for dette ophold</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border">
                    <th className="text-left font-medium px-5 py-2">Måler</th>
                    <th className="text-right font-medium px-3 py-2">Start</th>
                    <th className="text-right font-medium px-3 py-2">Slut</th>
                    <th className="text-right font-medium px-3 py-2">Forbrug</th>
                    <th className="text-right font-medium px-5 py-2">Beløb</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="px-5 py-2.5">
                      <span className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-yellow-500 shrink-0" />
                        {hasHeatingMeter ? "El (hoved)" : "El"}
                      </span>
                    </td>
                    {session.startKwh != null ? (
                      <>
                        <td className="text-right px-3 py-2.5 tabular-nums text-muted-foreground">{session.startKwh.toFixed(2)}</td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-muted-foreground">
                          {session.endKwh != null ? session.endKwh.toFixed(2) : <span className="text-xs">måler aktiv</span>}
                        </td>
                        <td className="text-right px-3 py-2.5 tabular-nums font-medium">{usedKwhMain != null ? `${usedKwhMain.toFixed(2)} kWh` : "—"}</td>
                        <td className="text-right px-5 py-2.5 tabular-nums">—</td>
                      </>
                    ) : (
                      <td className="px-3 py-2.5 text-muted-foreground text-xs" colSpan={4}>Ingen elmåler</td>
                    )}
                  </tr>

                  {hasHeatingMeter && (
                    <tr>
                      <td className="px-5 py-2.5">
                        <span className="flex items-center gap-2">
                          <Flame className="h-4 w-4 text-orange-500 shrink-0" />
                          Varme
                        </span>
                      </td>
                      {session.startHeatingKwh != null ? (
                        <>
                          <td className="text-right px-3 py-2.5 tabular-nums text-muted-foreground">{session.startHeatingKwh.toFixed(2)}</td>
                          <td className="text-right px-3 py-2.5 tabular-nums text-muted-foreground">
                            {session.endHeatingKwh != null ? session.endHeatingKwh.toFixed(2) : <span className="text-xs">måler aktiv</span>}
                          </td>
                          <td className="text-right px-3 py-2.5 tabular-nums font-medium">{usedKwhHeating != null ? `${usedKwhHeating.toFixed(2)} kWh` : "—"}</td>
                          <td className="text-right px-5 py-2.5 tabular-nums">—</td>
                        </>
                      ) : (
                        <td className="px-3 py-2.5 text-muted-foreground text-xs" colSpan={4}>Ingen varmemåler</td>
                      )}
                    </tr>
                  )}

                  {usedKwh != null && session.totalElectricityCost != null && (
                    <tr className="bg-muted/30">
                      <td className="px-5 py-2.5 font-medium">El i alt</td>
                      <td className="px-3 py-2.5" colSpan={2} />
                      <td className="text-right px-3 py-2.5 tabular-nums font-medium">{usedKwh.toFixed(2)} kWh</td>
                      <td className="text-right px-5 py-2.5 tabular-nums font-medium">{session.totalElectricityCost.toFixed(2)} DKK</td>
                    </tr>
                  )}

                  <tr>
                    <td className="px-5 py-2.5">
                      <span className="flex items-center gap-2">
                        <Droplets className="h-4 w-4 text-blue-500 shrink-0" />
                        Vand
                      </span>
                    </td>
                    {session.startWaterLiters != null ? (
                      <>
                        <td className="text-right px-3 py-2.5 tabular-nums text-muted-foreground">{session.startWaterLiters.toFixed(0)}</td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-muted-foreground">
                          {session.endWaterLiters != null ? session.endWaterLiters.toFixed(0) : <span className="text-xs">måler aktiv</span>}
                        </td>
                        <td className="text-right px-3 py-2.5 tabular-nums font-medium">{usedWater != null ? `${usedWater.toFixed(0)} L` : "—"}</td>
                        <td className="text-right px-5 py-2.5 tabular-nums">{session.totalWaterCost != null ? `${session.totalWaterCost.toFixed(2)} DKK` : "—"}</td>
                      </>
                    ) : (
                      <td className="px-3 py-2.5 text-muted-foreground text-xs" colSpan={4}>Ingen vandmåler</td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
              <span>El: {pricing.pricePerKwh.toFixed(2)} DKK/kWh</span>
              <span>Vand: {pricing.pricePerLiterWater.toFixed(2)} DKK/L</span>
            </div>
          </div>
          </>)}
        </div>

        {/* Right: saldo, vaskekredit, betaling */}
        <div className="space-y-5">
          {session.billingMode === "PREPAID" && (
            <PrepaidBalance
              sessionId={session.id}
              prepaidAmount={session.prepaidAmount ?? 0}
              prepaidDeposited={await resolvePrepaidDeposited(session)}
              accumulatedCost={(session.accumulatedElCost ?? 0) + (session.accumulatedWaterCost ?? 0)}
              isActive={isActive}
            />
          )}

          {session.billingMode !== "PREPAID" && (() => {
            // For long-term units, show all invoices on the unit.
            // For short-term bookings, scope to invoices that overlap this session's period
            // so previous guests' invoices aren't mixed in.
            const sessionStart = session.checkInTime;
            const sessionEnd = session.checkOutTime ?? new Date(8640000000000000); // max date for active sessions
            const invoices = session.unit.isLongTerm
              ? session.unit.invoices
              : session.unit.invoices.filter((inv) => inv.periodEnd >= sessionStart && inv.periodStart <= sessionEnd);
            const unpaid = invoices.filter((inv) => inv.status === "PENDING" || inv.status === "OVERDUE");
            const totalOwed = unpaid.reduce((sum, inv) => sum + inv.totalAmount, 0);
            return (
              <div className="rounded-xl border border-border/60 bg-card shadow-sm">
                <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-primary" />
                    <h2 className="font-semibold">Skyldigt beløb</h2>
                  </div>
                  <CreateInvoiceButton unitId={session.unit.id} />
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between p-4 rounded-lg bg-primary/5 border border-primary/10">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Ubetalt total</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {unpaid.length === 0 ? "Ingen ubetalte fakturaer" : `${unpaid.length} ubetalt${unpaid.length === 1 ? "" : "e"} faktura${unpaid.length === 1 ? "" : "er"}`}
                      </p>
                    </div>
                    <span className={`text-2xl font-bold tabular-nums ${totalOwed > 0 ? "text-primary" : "text-muted-foreground"}`}>
                      {totalOwed.toFixed(2)} <span className="text-sm font-medium text-muted-foreground">DKK</span>
                    </span>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">
                      {session.unit.isLongTerm ? "Månedlige fakturaer" : "Fakturaer"}
                    </p>
                    {invoices.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Ingen fakturaer endnu</p>
                    ) : (
                      <div className="space-y-2">
                        {invoices.map((inv) => (
                          <InvoiceRow key={inv.id} invoice={inv} unitId={session.unit.id} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {session.billingMode !== "PREPAID" && (
            <SessionActions
              sessionId={session.id}
              paymentStatus={session.paymentStatus}
              isPaid={isPaid}
              paidAt={session.paidAt?.toISOString() ?? null}
            />
          )}

          {isActive && (
            <LaundryCreditSection
              sessionId={session.id}
              currentCredit={session.laundryCredit ?? 0}
            />
          )}
        </div>
      </div>
    </div>
  );
}
