import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Zap, Droplets, Calendar, Mail, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getSessionById, getPricing } from "@/lib/actions";
import { CopyButton } from "@/components/admin/copy-button";
import { SessionActions } from "@/components/admin/session-actions";
import { SessionEditForm } from "@/components/admin/session-edit-form";

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
  const isActive = session.status === "ACTIVE";
  const isUnpaid = session.status === "COMPLETED" && session.paymentStatus === "UNPAID";
  const isPaid = session.paymentStatus === "PAID";

  // Calculate consumption
  const usedKwh = (session.endKwh != null && session.startKwh != null)
    ? Math.max(0, session.endKwh - session.startKwh) : null;
  const usedWater = (session.endWaterLiters != null && session.startWaterLiters != null)
    ? Math.max(0, session.endWaterLiters - session.startWaterLiters) : null;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/bookings">
          <Button variant="ghost" size="sm" className="h-8 px-2">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-semibold">{session.guestName}</h1>
            {isActive && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">Aktiv</span>
            )}
            {isUnpaid && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">Ubetalt</span>
            )}
            {isPaid && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">Betalt</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {session.unit.name} &middot; {session.bookingRef || `#${session.id}`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: Booking info */}
        <div className="space-y-4">
          {/* Guest info */}
          <div className="rounded-lg border bg-card">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-medium">Booking detaljer</h2>
            </div>
            <div className="px-4 py-3 space-y-2.5 text-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Hash className="h-3.5 w-3.5" />
                  <span className="text-xs">Booking nr.</span>
                </div>
                <span className="text-xs">{session.bookingRef || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" />
                  <span className="text-xs">Email</span>
                </div>
                <span className="text-xs">{session.guestEmail || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  <span className="text-xs">Check-in</span>
                </div>
                <span className="text-xs">{new Date(session.checkInTime).toLocaleString("da-DK")}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  <span className="text-xs">Check-out</span>
                </div>
                <span className="text-xs">{session.checkOutTime ? new Date(session.checkOutTime).toLocaleString("da-DK") : "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Gæsteportal</span>
                <CopyButton text={`/guest/${session.guestPortalToken}`} label="Kopiér link" />
              </div>
              {session.notes && (
                <>
                  <Separator />
                  <div>
                    <span className="text-xs text-muted-foreground">Bemærkninger</span>
                    <p className="text-xs mt-1">{session.notes}</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Edit form */}
          <SessionEditForm
            sessionId={session.id}
            guestName={session.guestName}
            guestEmail={session.guestEmail || ""}
            bookingRef={session.bookingRef || ""}
            notes={session.notes || ""}
          />
        </div>

        {/* Right: Consumption & Payment */}
        <div className="space-y-4">
          {/* Consumption breakdown */}
          <div className="rounded-lg border bg-card">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-medium">Forbrugsfordeling</h2>
            </div>
            <div className="p-4 space-y-3">
              {/* Electricity */}
              <div className="rounded-md bg-muted/40 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-6 w-6 rounded bg-yellow-500/10 flex items-center justify-center">
                    <Zap className="h-3 w-3 text-yellow-400/80" />
                  </div>
                  <span className="text-xs font-medium">Elektricitet</span>
                </div>
                {session.startKwh != null ? (
                  <div className="space-y-1 text-xs">
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
                        <div className="border-t border-border/50 my-1.5" />
                        <div className="flex justify-between font-medium">
                          <span>{usedKwh?.toFixed(2)} kWh</span>
                          <span>{session.totalElectricityCost?.toFixed(2)} DKK</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {pricing.pricePerKwh.toFixed(2)} DKK/kWh
                        </div>
                      </>
                    )}
                    {session.endKwh == null && (
                      <p className="text-[11px] text-muted-foreground">Måling aktiv</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Ingen elmåler</p>
                )}
              </div>

              {/* Water */}
              <div className="rounded-md bg-muted/40 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-6 w-6 rounded bg-blue-500/10 flex items-center justify-center">
                    <Droplets className="h-3 w-3 text-blue-400/80" />
                  </div>
                  <span className="text-xs font-medium">Vand</span>
                </div>
                {session.startWaterLiters != null ? (
                  <div className="space-y-1 text-xs">
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
                        <div className="border-t border-border/50 my-1.5" />
                        <div className="flex justify-between font-medium">
                          <span>{usedWater?.toFixed(0)} L</span>
                          <span>{session.totalWaterCost?.toFixed(2)} DKK</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {pricing.pricePerLiterWater.toFixed(2)} DKK/L
                        </div>
                      </>
                    )}
                    {session.endWaterLiters == null && (
                      <p className="text-[11px] text-muted-foreground">Måling aktiv</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Ingen vandmåler</p>
                )}
              </div>

              {/* Total */}
              {session.totalCost != null && (
                <div className="flex items-center justify-between p-3 rounded-md bg-primary/5 border border-primary/10">
                  <span className="text-sm font-medium">Total</span>
                  <span className="text-lg font-semibold tabular-nums">{session.totalCost.toFixed(2)} <span className="text-xs text-muted-foreground">DKK</span></span>
                </div>
              )}
            </div>
          </div>

          {/* Payment actions */}
          <SessionActions
            sessionId={session.id}
            paymentStatus={session.paymentStatus}
            isPaid={isPaid}
            paidAt={session.paidAt?.toISOString() ?? null}
          />
        </div>
      </div>
    </div>
  );
}
