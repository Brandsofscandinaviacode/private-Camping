import Link from "next/link";
import { isReservationExpired, isStayOverdue } from "@/lib/booking-status";
import { notFound } from "next/navigation";
import { ArrowLeft, Zap, Droplets, Flame, Mail, Hash, Phone, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getSessionById, getPricing, getSessionSettlement, getGlobalSettings } from "@/lib/actions";
import { SettlementSummary } from "@/components/admin/settlement-summary";
import { fmtMoney, settlementHeadline } from "@/lib/settlement-shared";
import { bookingRefLabel, parseBookingRef } from "@/lib/booking-ref";
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
import { CheckInReceiptHost } from "@/components/admin/check-in-receipt";
import { GuestPortalCard } from "@/components/admin/guest-portal-handover";
import { getBaseUrl, isPlaceholderBaseUrl } from "@/lib/base-url";
import { siteDayKey } from "@/lib/format";
import { unitHardwareSummary } from "@/lib/check-in-hardware";
import { BookingSyncNotice } from "@/components/admin/booking-sync-notice";

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

  const [pricing, settlement, settings] = await Promise.all([
    getPricing(),
    getSessionSettlement(sessionId),
    getGlobalSettings(),
  ]);
  if (!settlement) notFound();
  const notify = {
    email: settings.notifications_email_enabled === "true",
    sms: settings.notifications_sms_enabled === "true",
  };
  const siteBase = getBaseUrl(settings);
  const siteUrl = isPlaceholderBaseUrl(siteBase) ? "" : siteBase;
  const hwSummary = unitHardwareSummary(session.unit.hardware);
  // A reservation whose stay ended without a check-in is shown as expired
  // and can no longer be activated.
  const isExpiredReservation = isReservationExpired(session);
  const isPendingSession = session.status === "PENDING" && !isExpiredReservation;
  const isActive = session.status === "ACTIVE";
  const isCompleted = session.status === "COMPLETED";
  // Payment badges follow the settlement — a 0-kr stay is not "Ubetalt".
  const isUnpaid = isCompleted && (settlement.state === "OWED" || settlement.state === "PARTIAL");
  const isPaid = isCompleted && settlement.state === "PAID";
  const isNothingDue = isCompleted && settlement.state === "NOTHING_DUE";
  const headline = settlementHeadline(settlement);
  const refLabel = bookingRefLabel(session.bookingRef);

  const usedKwhMain = (session.endKwh != null && session.startKwh != null)
    ? Math.max(0, session.endKwh - session.startKwh) : null;
  const usedKwhHeating = (session.endHeatingKwh != null && session.startHeatingKwh != null)
    ? Math.max(0, session.endHeatingKwh - session.startHeatingKwh) : null;
  const usedKwh = (usedKwhMain !== null || usedKwhHeating !== null)
    ? (usedKwhMain ?? 0) + (usedKwhHeating ?? 0) : null;
  const hasHeatingMeter = !!(session.unit.hardware?.hasHeating && session.unit.hardware?.heatingMeterEntityId);
  const usedWater = (session.endWaterLiters != null && session.startWaterLiters != null)
    ? Math.max(0, session.endWaterLiters - session.startWaterLiters) : null;
  // Units without meters (most pitches) have no consumption chart or readings
  // to show — unless an earlier setup left readings on this stay.
  const meterHw = session.unit.hardware;
  const showMeters = !!(meterHw?.hasElectricity || meterHw?.hasHeating || meterHw?.hasWater)
    || session.startKwh != null || session.startHeatingKwh != null || session.startWaterLiters != null;
  // Deposit total for prepaid stays (prepaidAmount is the live balance, not the deposit)
  const prepaidDeposited = session.billingMode === "PREPAID" ? await resolvePrepaidDeposited(session) : null;

  return (
    <div className="p-4 sm:p-6 lg:p-10 space-y-6 max-w-7xl">
      <Breadcrumbs
        items={[
          { label: "Bookinger", href: "/admin/bookings" },
          { label: session.guestName },
        ]}
      />
      <CheckInReceiptHost sessionId={session.id} siteUrl={siteUrl} />
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
            {isExpiredReservation && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                Udløbet
              </span>
            )}
            {isActive && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                Aktiv
              </span>
            )}
            {isStayOverdue(session) && (
              <span
                className="text-xs px-2.5 py-1 rounded-full bg-red-50 text-red-600 font-medium inline-flex items-center gap-1.5"
                title="Planlagt udtjek er passeret, men opholdet er ikke tjekket ud"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                Overskredet
              </span>
            )}
            {isUnpaid && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-red-50 text-red-600 font-medium inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                {settlement.state === "PARTIAL" ? "Delvist betalt" : "Ubetalt"}
              </span>
            )}
            {isPaid && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-green-50 text-green-600 font-medium inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                Betalt
              </span>
            )}
            {isNothingDue && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                Intet at betale
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {unitDisplayName(session.unit.type, session.unit.name)} &middot; {refLabel || `#${session.id}`}
          </p>
        </div>
      </div>

      <BookingSyncNotice session={session} />

      {/* ═══ TOP: booking details + statement actions ═══ */}
      <div className="space-y-5">
        <div className="rounded-xl border border-border/60 bg-card shadow-sm">
          <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Booking detaljer</h2>
            <CopyButton text={`/guest/${session.guestPortalToken}`} label="Kopiér gæstelink" baseUrl={siteUrl} />
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
                  <span className="truncate">{refLabel || "—"}</span>
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
                      Forudbetalt {prepaidDeposited != null ? `(${prepaidDeposited.toFixed(2)} DKK)` : ""}
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Bagudbetalt</span>
                  )}
                </div>
                {/* One figure, from the settlement — the same one the
                    statement, the unpaid badge and Økonomi use. */}
                {session.status !== "PENDING" && (
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <span className="text-muted-foreground">{headline.label}</span>
                    {headline.amount != null && (
                      <span className="font-semibold tabular-nums">{fmtMoney(headline.amount, settlement.currency)}</span>
                    )}
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
                {isExpiredReservation
                  ? "Udløbet reservation — gæsten blev aldrig checket ind."
                  : isPendingSession
                  ? "Importeret booking — vælg afregningsform og aktivér."
                  : isActive && !session.unit.isLongTerm
                    ? "Viser afregning og måleraflæsninger før udtjek, derefter opgørelsen."
                    : "Udskriftsvenlig opgørelse — kan bruges som kvittering."}
              </p>
            </div>
            <div className="shrink-0">
              {isExpiredReservation ? null : isPendingSession ? (
                <BookingActivateButton
                  sessionId={session.id}
                  guestName={session.guestName}
                  unitId={session.unit.id}
                  unitName={session.unit.name}
                  arrivalDate={siteDayKey(session.checkInTime)!}
                  isLongTerm={session.unit.isLongTerm}
                  hasHardware={hwSummary.any}
                  hasMeters={hwSummary.meters}
                  notify={notify}
                  initialEmail={session.guestEmail}
                  initialPhone={session.guestPhone}
                  initialBookingRef={session.bookingRef}
                  initialExpectedCheckOut={siteDayKey(session.expectedCheckOut)}
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

        {isActive && (
          <GuestPortalCard
            sessionId={session.id}
            portalPath={`/guest/${session.guestPortalToken}`}
            siteUrl={siteUrl}
            emailEnabled={notify.email}
            smsEnabled={notify.sms}
            hasEmail={!!session.guestEmail}
            hasPhone={!!session.guestPhone}
          />
        )}

        <SessionEditForm
            sessionId={session.id}
            guestName={session.guestName}
            guestEmail={session.guestEmail || ""}
            guestPhone={session.guestPhone || ""}
            bookingRef={session.bookingRef || ""}
            bookingRefLocked={!!session.externalBookingId || !!parseBookingRef(session.bookingRef)}
            status={session.status}
            startLocked={{
              el: session.lastTickKwh != null,
              heat: session.lastTickHeatingKwh != null,
              water: session.lastTickWaterLiters != null,
            }}
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
            hasElectricityMeter={!!session.unit.hardware?.hasElectricity || session.startKwh != null}
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

          {isExpiredReservation && (
            <div className="rounded-xl border border-border/60 bg-muted/40 shadow-sm p-5">
              <p className="text-sm font-medium">Reservationen er udløbet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Opholdet sluttede {session.expectedCheckOut ? new Date(session.expectedCheckOut).toLocaleDateString("da-DK") : "for over en dag siden"}, og gæsten blev aldrig checket ind i CampSense. Bookingen tæller ikke længere som reserveret.
              </p>
            </div>
          )}

          {isPendingSession && (
            <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 shadow-sm p-5">
              <p className="text-sm text-amber-800 font-medium">Afventer check-in</p>
              <p className="text-xs text-amber-600 mt-1">
                Denne booking er importeret fra booking-systemet. Check gæsten ind for at starte forbrugsmåling.
              </p>
            </div>
          )}

          {session.status !== "PENDING" && (<>
          <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="font-semibold">Forbrug og køb</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Alt gæsten har brugt under opholdet — opdateres løbende, uafhængigt af fakturering
              </p>
            </div>
            <SessionCharges sessionId={session.id} />
          </div>

          {showMeters && (<>
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
          </>)}
        </div>

        {/* Right: afregning, saldo, vaskekredit — first on phone/tablet, where the columns stack */}
        <div className="space-y-5 order-first lg:order-none">
          {/* A running prepaid stay keeps its balance card (top-ups); every
              other stay gets the one settlement figure. */}
          {session.billingMode === "PREPAID" && isActive && (
            <PrepaidBalance
              sessionId={session.id}
              prepaidAmount={session.prepaidAmount ?? 0}
              prepaidDeposited={prepaidDeposited ?? 0}
              accumulatedCost={(session.accumulatedElCost ?? 0) + (session.accumulatedWaterCost ?? 0)}
              isActive={isActive}
            />
          )}

          {session.status !== "PENDING" && !(session.billingMode === "PREPAID" && isActive) && (
            <SettlementSummary settlement={settlement}>
              {isCompleted && (
                <SessionActions
                  sessionId={session.id}
                  owed={settlement.owed}
                  currency={settlement.currency}
                  canUndo={
                    settlement.paid > 0.005 ||
                    settlement.paidWithoutRecord ||
                    settlement.payments.some((p) => (p.kind === "SETTLEMENT" || p.kind === "INVOICE") && p.amount > 0 && p.reversesId == null && !p.reversed)
                  }
                  openInvoiceCount={settlement.invoices.filter((i) => i.status !== "PAID").length}
                />
              )}
            </SettlementSummary>
          )}

          {session.billingMode !== "PREPAID" && session.status !== "PENDING" && (() => {
            // For long-term units, show all invoices on the unit.
            // For short-term bookings, scope to invoices that overlap this session's period
            // so previous guests' invoices aren't mixed in.
            const sessionStart = session.checkInTime;
            const sessionEnd = session.checkOutTime ?? new Date(8640000000000000); // max date for active sessions
            const invoices = session.unit.isLongTerm
              ? session.unit.invoices
              : session.unit.invoices.filter((inv) => inv.periodEnd >= sessionStart && inv.periodStart <= sessionEnd);
            // A completed short stay is settled on its statement — a new
            // invoice would bill the unit's meter, not this stay.
            const canInvoice = isActive || session.unit.isLongTerm;
            if (invoices.length === 0 && !canInvoice) return null;
            return (
              <div className="rounded-xl border border-border/60 bg-card shadow-sm">
                <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                  <h2 className="font-semibold">{session.unit.isLongTerm ? "Månedlige fakturaer" : "Fakturaer"}</h2>
                  {canInvoice && <CreateInvoiceButton unitId={session.unit.id} />}
                </div>
                <div className="p-5">
                  {invoices.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Ingen fakturaer. Opholdet afregnes samlet ved udtjek — en faktura er kun nødvendig ved lange ophold.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {invoices.map((inv) => (
                        <InvoiceRow key={inv.id} invoice={inv} unitId={session.unit.id} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

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
