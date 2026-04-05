"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Tent,
  Zap,
  Droplets,
  Thermometer,
  DoorOpen,
  CreditCard,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  getLiveConsumption,
  guestSetTemperature,
  guestUnlockDoor,
  createSessionPayment,
  createInvoicePayment,
} from "@/lib/actions";

interface InvoiceData {
  id: number;
  periodStart: string;
  periodEnd: string;
  electricityCost: number;
  waterCost: number;
  totalAmount: number;
  status: string;
  paymentToken: string | null;
}

interface GuestPortalClientProps {
  token: string;
  sessionId: number | null;
  guestName: string;
  unitName: string;
  status: string;
  checkInTime: string;
  checkOutTime: string | null;
  hasClimate: boolean;
  hasSmartLock: boolean;
  hasElectricity: boolean;
  hasWater: boolean;
  totalElectricityCost: number | null;
  totalWaterCost: number | null;
  totalCost: number | null;
  externalPrice: number | null;
  externalDescription: string | null;
  paymentStatus: string;
  isLongTerm: boolean;
  invoices: InvoiceData[];
  quickpayEnabled: boolean;
}

interface ConsumptionData {
  usedKwh: number | null;
  electricityCost: number | null;
  usedWaterLiters: number | null;
  waterCost: number | null;
  totalLiveCost: number | null;
  currency: string;
}

export function GuestPortalClient({
  token,
  sessionId,
  guestName,
  unitName,
  status,
  checkInTime,
  checkOutTime,
  hasClimate,
  hasSmartLock,
  hasElectricity,
  hasWater,
  totalElectricityCost,
  totalWaterCost,
  totalCost,
  externalPrice,
  externalDescription,
  paymentStatus,
  isLongTerm,
  invoices,
  quickpayEnabled,
}: GuestPortalClientProps) {
  const [consumption, setConsumption] = useState<ConsumptionData | null>(null);
  const [tempValue, setTempValue] = useState("21");
  const [isPending, startTransition] = useTransition();
  const [unlockMsg, setUnlockMsg] = useState("");
  const [payingSession, setPayingSession] = useState(false);
  const [payingInvoiceId, setPayingInvoiceId] = useState<number | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  const isActive = status === "ACTIVE";

  useEffect(() => {
    if (!isActive || !sessionId) return;
    let mounted = true;

    async function fetchConsumption() {
      try {
        const data = await getLiveConsumption(sessionId!);
        if (mounted && data) setConsumption(data);
      } catch {}
    }

    fetchConsumption();
    const interval = setInterval(fetchConsumption, 30000);
    return () => { mounted = false; clearInterval(interval); };
  }, [sessionId, isActive]);

  function handleSetTemp() {
    startTransition(async () => {
      await guestSetTemperature(token, parseFloat(tempValue));
    });
  }

  function handleUnlock() {
    startTransition(async () => {
      await guestUnlockDoor(token);
      setUnlockMsg("Døren er låst op!");
      setTimeout(() => setUnlockMsg(""), 5000);
    });
  }

  async function handlePaySession() {
    if (!sessionId) return;
    setPayingSession(true);
    setPayError(null);
    try {
      const result = await createSessionPayment(sessionId, token);
      window.location.href = result.paymentLink;
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Betaling kunne ikke oprettes");
      setPayingSession(false);
    }
  }

  async function handlePayInvoice(invoiceId: number) {
    setPayingInvoiceId(invoiceId);
    setPayError(null);
    try {
      const result = await createInvoicePayment(invoiceId);
      window.location.href = result.paymentLink;
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Betaling kunne ikke oprettes");
      setPayingInvoiceId(null);
    }
  }

  const formatDKK = (v: number | null) => v !== null ? `${v.toFixed(2)} DKK` : "—";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-gradient-to-br from-primary/20 via-primary/10 to-background px-4 py-10 text-center">
        <div className="h-12 w-12 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
          <Tent className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-2xl font-bold">Velkommen, {guestName}!</h1>
        <p className="text-muted-foreground mt-1">{unitName}</p>
        <p className="text-muted-foreground/70 text-sm mt-1">
          {isLongTerm ? "Langtidsleje" : `Ankomst: ${new Date(checkInTime).toLocaleDateString("da-DK", {
            weekday: "long", day: "numeric", month: "long",
          })}`}
        </p>
      </div>

      <div className="max-w-md mx-auto px-4 py-6 space-y-4 -mt-2">
        {/* Completed session */}
        {!isActive && !isLongTerm && (
          <Card>
            <CardContent className="py-6 text-center space-y-4">
              <div>
                <p className="font-medium">Dit ophold er afsluttet</p>
                {checkOutTime && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Afrejse: {new Date(checkOutTime).toLocaleDateString("da-DK", {
                      weekday: "long", day: "numeric", month: "long",
                    })}
                  </p>
                )}
              </div>
              {totalCost !== null && (
                <div className="space-y-1 text-sm">
                  {totalElectricityCost !== null && totalElectricityCost > 0 && <p>El: {formatDKK(totalElectricityCost)}</p>}
                  {totalWaterCost !== null && totalWaterCost > 0 && <p>Vand: {formatDKK(totalWaterCost)}</p>}
                  {externalPrice !== null && externalPrice > 0 && (
                    <p>{externalDescription || "Ophold"}: {formatDKK(externalPrice)}</p>
                  )}
                  <Separator className="my-2" />
                  <p className="text-xl font-bold">
                    Total: {formatDKK((totalCost || 0) + (externalPrice || 0))}
                  </p>
                </div>
              )}

              {/* Payment status */}
              {paymentStatus === "PAID" ? (
                <div className="bg-green-50 text-green-700 rounded-lg p-3 text-sm font-medium">
                  Betalt — tak for dit ophold!
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="bg-amber-50 text-amber-700 rounded-lg p-3 text-sm">
                    Afventer betaling
                  </div>
                  {quickpayEnabled ? (
                    <Button onClick={handlePaySession} disabled={payingSession} className="w-full">
                      <CreditCard className="h-4 w-4 mr-2" />
                      {payingSession ? "Opretter betaling..." : "Betal online"}
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center">Kontakt campingpladsen for betaling</p>
                  )}
                  {payError && <p className="text-xs text-red-600 text-center">{payError}</p>}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Live Consumption */}
        {isActive && sessionId && (hasElectricity || hasWater) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Dit forbrug</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {hasElectricity && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                      <Zap className="h-4 w-4 text-yellow-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Elektricitet</p>
                      <p className="text-xs text-muted-foreground">
                        {consumption?.usedKwh != null
                          ? `${consumption.usedKwh.toFixed(2)} kWh` : "Afventer data..."}
                      </p>
                    </div>
                  </div>
                  <span className="font-semibold">{formatDKK(consumption?.electricityCost ?? null)}</span>
                </div>
              )}
              {hasWater && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <Droplets className="h-4 w-4 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Vand</p>
                      <p className="text-xs text-muted-foreground">
                        {consumption?.usedWaterLiters != null
                          ? `${consumption.usedWaterLiters.toFixed(0)} liter` : "Afventer data..."}
                      </p>
                    </div>
                  </div>
                  <span className="font-semibold">{formatDKK(consumption?.waterCost ?? null)}</span>
                </div>
              )}
              <Separator />
              <div className="flex items-center justify-between">
                <span className="font-bold">Total</span>
                <span className="text-xl font-bold text-primary">
                  {formatDKK(consumption?.totalLiveCost ?? null)}
                </span>
              </div>
              <p className="text-xs text-center text-muted-foreground">Opdateres hvert 30. sekund</p>
            </CardContent>
          </Card>
        )}

        {/* Climate Control */}
        {isActive && hasClimate && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Thermometer className="h-4 w-4 text-blue-400" />
                Temperatur
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <input type="range" min="16" max="25" step="0.5"
                  value={tempValue} onChange={(e) => setTempValue(e.target.value)}
                  className="flex-1 accent-primary" />
                <span className="text-lg font-semibold w-14 text-center">{tempValue}°C</span>
              </div>
              <Button onClick={handleSetTemp} disabled={isPending}
                className="w-full mt-3" variant="outline">
                {isPending ? "Indstiller..." : "Sæt temperatur"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Smart Lock */}
        {isActive && hasSmartLock && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <DoorOpen className="h-4 w-4 text-primary" />
                Dør
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button onClick={handleUnlock} disabled={isPending} className="w-full">
                {isPending ? "Åbner..." : "Lås op"}
              </Button>
              {unlockMsg && <p className="text-sm text-primary text-center mt-2">{unlockMsg}</p>}
            </CardContent>
          </Card>
        )}

        {/* Invoices for long-term renters */}
        {isLongTerm && invoices.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="h-4 w-4" />
                Dine fakturaer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {invoices.map((inv) => (
                <div key={inv.id} className="p-3 rounded-lg bg-muted/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {new Date(inv.periodStart).toLocaleDateString("da-DK", { month: "long", year: "numeric" })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        El: {inv.electricityCost.toFixed(2)} · Vand: {inv.waterCost.toFixed(2)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{inv.totalAmount.toFixed(2)} DKK</span>
                      <Badge variant={inv.status === "PAID" ? "default" : "secondary"}
                        className={inv.status === "PAID" ? "bg-primary/20 text-primary" :
                          inv.status === "OVERDUE" ? "bg-destructive/20 text-destructive" : ""}>
                        {inv.status === "PENDING" ? "Afventer" :
                         inv.status === "PAID" ? "Betalt" :
                         inv.status === "OVERDUE" ? "Forfalden" : "Kladde"}
                      </Badge>
                    </div>
                  </div>
                  {(inv.status === "PENDING" || inv.status === "OVERDUE") && quickpayEnabled && (
                    <Button
                      variant="outline" size="sm"
                      disabled={payingInvoiceId === inv.id}
                      onClick={() => handlePayInvoice(inv.id)}
                      className="w-full text-xs"
                    >
                      <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                      {payingInvoiceId === inv.id ? "Opretter betaling..." : "Betal faktura"}
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Payment info — only for short-term stays */}
        {isActive && !isLongTerm && quickpayEnabled && (
          <Card className="border-dashed border-border/50">
            <CardContent className="py-6 text-center">
              <CreditCard className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Betaling sker ved check-ud</p>
            </CardContent>
          </Card>
        )}

        <p className="text-[11px] text-center text-muted-foreground/50 pt-4">Drevet af CampSense</p>
      </div>
    </div>
  );
}
