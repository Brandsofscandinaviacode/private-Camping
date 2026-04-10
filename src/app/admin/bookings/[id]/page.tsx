import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Zap, Droplets, Calendar, Mail, Hash, Phone, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getSessionById, getPricing } from "@/lib/actions";
import { CopyButton } from "@/components/admin/copy-button";
import { SessionActions } from "@/components/admin/session-actions";
import { SessionEditForm } from "@/components/admin/session-edit-form";
import { LaundryCreditSection } from "@/components/admin/laundry-credit";
import { LiveConsumption } from "@/components/admin/live-consumption";
import { ConsumptionChart } from "@/components/admin/consumption-chart";
import { CreateInvoiceButton } from "@/components/admin/create-invoice-button";
import { InvoiceRow } from "@/components/admin/invoice-row";

export const dynamic = "force-dynamic";

const typeLabels: Record<string, string> = { CABIN: "Hytte", SEASONAL: "Fastligger", CARAVAN: "Campingvogn", PITCH: "Plads" };

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
  const isActive = session.status === "ACTIVE";
  const isUnpaid = session.status === "COMPLETED" && session.paymentStatus === "UNPAID";
  const isPaid = session.paymentStatus === "PAID";

  const usedKwh = (session.endKwh != null && session.startKwh != null)
    ? Math.max(0, session.endKwh - session.startKwh) : null;
  const usedWater = (session.endWaterLiters != null && session.startWaterLiters != null)
    ? Math.max(0, session.endWaterLiters - session.startWaterLiters) : null;

  return (
    <div className="p-4 sm:p-6 lg:p-10 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/bookings">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{session.guestName}</h1>
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
            {typeLabels[session.unit.type] || session.unit.type} {session.unit.name} &middot; {session.bookingRef || `#${session.id}`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Booking info */}
        <div className="space-y-5">
          <div className="rounded-xl border border-border/60 bg-card shadow-sm">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="font-semibold">Booking detaljer</h2>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Hash className="h-4 w-4" />
                  Booking nr.
                </div>
                <span>{session.bookingRef || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  Email
                </div>
                <span>{session.guestEmail || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  Telefon
                </div>
                <span>{session.guestPhone || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  Check-in
                </div>
                <span>{new Date(session.checkInTime).toLocaleString("da-DK")}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  Check-out
                </div>
                <span>{session.checkOutTime ? new Date(session.checkOutTime).toLocaleString("da-DK") : "—"}</span>
              </div>
              {session.expectedCheckOut && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    Forventet checkout
                  </div>
                  <span>{new Date(session.expectedCheckOut).toLocaleDateString("da-DK")}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Afregning</span>
                <span>
                  {session.billingMode === "PREPAID" ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                      Forudbetalt {session.prepaidAmount ? `(${session.prepaidAmount.toFixed(2)} DKK)` : ""}
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Bagudbetalt</span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Gæsteportal</span>
                <CopyButton text={`/guest/${session.guestPortalToken}`} label="Kopiér link" />
              </div>
              {session.notes && (
                <>
                  <Separator />
                  <div>
                    <span className="text-muted-foreground text-xs">Bemærkninger</span>
                    <p className="mt-1">{session.notes}</p>
                  </div>
                </>
              )}
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
            startWaterLiters={session.startWaterLiters}
            endWaterLiters={session.endWaterLiters}
            isActive={isActive}
          />
        </div>

        {/* Right: Consumption & Payment */}
        <div className="space-y-5">
          <div className="rounded-xl border border-border/60 bg-card shadow-sm">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="font-semibold">Forbrugsfordeling</h2>
            </div>
            <div className="p-5 space-y-4">
              {/* Electricity */}
              <div className="rounded-lg bg-muted/50 p-4">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="h-8 w-8 rounded-lg bg-yellow-50 flex items-center justify-center">
                    <Zap className="h-4 w-4 text-yellow-500" />
                  </div>
                  <span className="font-medium">Elektricitet</span>
                </div>
                {session.startKwh != null ? (
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Start</span>
                      <span>{session.startKwh.toFixed(2)} kWh</span>
                    </div>
                    {session.endKwh != null && (
                      <>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Slut</span>
                          <span>{session.endKwh.toFixed(2)} kWh</span>
                        </div>
                        <Separator />
                        <div className="flex justify-between font-medium">
                          <span>{usedKwh?.toFixed(2)} kWh</span>
                          <span>{session.totalElectricityCost?.toFixed(2)} DKK</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {pricing.pricePerKwh.toFixed(2)} DKK/kWh
                        </p>
                      </>
                    )}
                    {session.endKwh == null && (
                      <p className="text-xs text-muted-foreground">Måling aktiv</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Ingen elmåler</p>
                )}
              </div>

              {/* Water */}
              <div className="rounded-lg bg-muted/50 p-4">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center">
                    <Droplets className="h-4 w-4 text-blue-500" />
                  </div>
                  <span className="font-medium">Vand</span>
                </div>
                {session.startWaterLiters != null ? (
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Start</span>
                      <span>{session.startWaterLiters.toFixed(0)} L</span>
                    </div>
                    {session.endWaterLiters != null && (
                      <>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Slut</span>
                          <span>{session.endWaterLiters.toFixed(0)} L</span>
                        </div>
                        <Separator />
                        <div className="flex justify-between font-medium">
                          <span>{usedWater?.toFixed(0)} L</span>
                          <span>{session.totalWaterCost?.toFixed(2)} DKK</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {pricing.pricePerLiterWater.toFixed(2)} DKK/L
                        </p>
                      </>
                    )}
                    {session.endWaterLiters == null && (
                      <p className="text-xs text-muted-foreground">Måling aktiv</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Ingen vandmåler</p>
                )}
              </div>

              {/* Total */}
              {session.totalCost != null && (
                <div className="flex items-center justify-between p-4 rounded-lg bg-primary/5 border border-primary/10">
                  <span className="text-lg font-semibold">Total</span>
                  <span className="text-xl font-bold tabular-nums">{session.totalCost.toFixed(2)} <span className="text-sm text-muted-foreground">DKK</span></span>
                </div>
              )}
            </div>
          </div>

          <SessionActions
            sessionId={session.id}
            paymentStatus={session.paymentStatus}
            isPaid={isPaid}
            paidAt={session.paidAt?.toISOString() ?? null}
          />

          {isActive && (
            <LaundryCreditSection
              sessionId={session.id}
              currentCredit={session.laundryCredit ?? 0}
            />
          )}
        </div>
      </div>

      {/* ═══ Customer consumption & billing ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Live consumption */}
        {isActive && <LiveConsumption sessionId={session.id} />}

        {/* Consumption trend */}
        <div className="rounded-xl border border-border/60 bg-card shadow-sm">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="font-semibold">Forbrugstrend</h2>
          </div>
          <div className="p-5">
            <ConsumptionChart unitId={session.unit.id} />
          </div>
        </div>
      </div>

      {/* Skyldigt beløb — monthly invoices for long-term renters */}
      {session.unit.isLongTerm && (() => {
        const invoices = session.unit.invoices;
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
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Månedlige fakturaer</p>
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
    </div>
  );
}
