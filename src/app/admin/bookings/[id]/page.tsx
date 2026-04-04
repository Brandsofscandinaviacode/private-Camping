import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Zap, Droplets, Calendar, Mail, Hash, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      <div className="flex items-center gap-4">
        <Link href="/admin/bookings">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Bookinger
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{session.guestName}</h1>
            {isActive && <Badge className="bg-primary/20 text-primary border-primary/30">Aktiv</Badge>}
            {isUnpaid && <Badge variant="destructive" className="bg-destructive/20 text-destructive border-destructive/30">Ubetalt</Badge>}
            {isPaid && <Badge className="bg-primary/20 text-primary border-primary/30">Betalt</Badge>}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {session.unit.name} — {session.bookingRef || `#${session.id}`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Booking info */}
        <div className="space-y-4">
          {/* Guest info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Booking detaljer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Hash className="h-3.5 w-3.5" />
                  Booking nr.
                </div>
                <span className="font-medium">{session.bookingRef || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" />
                  Email
                </div>
                <span className="font-medium">{session.guestEmail || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  Check-in
                </div>
                <span>{new Date(session.checkInTime).toLocaleString("da-DK")}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  Check-out
                </div>
                <span>{session.checkOutTime ? new Date(session.checkOutTime).toLocaleString("da-DK") : "—"}</span>
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
            </CardContent>
          </Card>

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
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Forbrugsfordeling</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Electricity */}
              <div className="rounded-lg bg-muted/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-8 w-8 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                    <Zap className="h-4 w-4 text-yellow-400" />
                  </div>
                  <span className="font-medium">Elektricitet</span>
                </div>
                {session.startKwh != null ? (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Start-aflæsning</span>
                      <span>{session.startKwh.toFixed(2)} kWh</span>
                    </div>
                    {session.endKwh != null && (
                      <>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Slut-aflæsning</span>
                          <span>{session.endKwh.toFixed(2)} kWh</span>
                        </div>
                        <Separator />
                        <div className="flex justify-between font-medium">
                          <span>Forbrug: {usedKwh?.toFixed(2)} kWh</span>
                          <span>{session.totalElectricityCost?.toFixed(2)} DKK</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Pris: {pricing.pricePerKwh.toFixed(2)} DKK/kWh
                        </div>
                      </>
                    )}
                    {session.endKwh == null && (
                      <p className="text-xs text-muted-foreground">Måling i gang — afsluttes ved check-out</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Ingen elmåler konfigureret</p>
                )}
              </div>

              {/* Water */}
              <div className="rounded-lg bg-muted/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <Droplets className="h-4 w-4 text-blue-400" />
                  </div>
                  <span className="font-medium">Vand</span>
                </div>
                {session.startWaterLiters != null ? (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Start-aflæsning</span>
                      <span>{session.startWaterLiters.toFixed(0)} L</span>
                    </div>
                    {session.endWaterLiters != null && (
                      <>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Slut-aflæsning</span>
                          <span>{session.endWaterLiters.toFixed(0)} L</span>
                        </div>
                        <Separator />
                        <div className="flex justify-between font-medium">
                          <span>Forbrug: {usedWater?.toFixed(0)} L</span>
                          <span>{session.totalWaterCost?.toFixed(2)} DKK</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Pris: {pricing.pricePerLiterWater.toFixed(2)} DKK/L
                        </div>
                      </>
                    )}
                    {session.endWaterLiters == null && (
                      <p className="text-xs text-muted-foreground">Måling i gang — afsluttes ved check-out</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Ingen vandmåler konfigureret</p>
                )}
              </div>

              {/* Total */}
              {session.totalCost != null && (
                <div className="flex items-center justify-between p-4 rounded-lg bg-primary/10 border border-primary/20">
                  <span className="text-lg font-bold">Total</span>
                  <span className="text-2xl font-bold text-primary">{session.totalCost.toFixed(2)} DKK</span>
                </div>
              )}
            </CardContent>
          </Card>

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
