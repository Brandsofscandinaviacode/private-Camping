"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Tent,
  Zap,
  Power,
  Droplets,
  Thermometer,
  DoorOpen,
  CreditCard,
  Receipt,
  Globe,
  Info,
  Map,
  WashingMachine,
  Wallet,
  Loader2,
  ChevronDown,
  CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  getLiveConsumption,
  guestSetTemperature,
  guestUnlockDoor,
  guestTogglePower,
  guestGetPowerState,
  createSessionPayment,
  createInvoicePayment,
  createLaundryPayment,
  createPrepaidTopUp,
  getGuestLaundryMachines,
} from "@/lib/actions";
import { type Locale, localeLabels, getTranslations } from "@/lib/guest-translations";

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
  expectedCheckOut: string | null;
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
  billingMode: "PREPAID" | "POSTPAID";
  prepaidAmount: number | null;
  isLongTerm: boolean;
  invoices: InvoiceData[];
  quickpayEnabled: boolean;
  unitType: string;
  practicalInfo: Record<string, string | null>;
  siteMapUrl: string | null;
  laundryMachines: { id: number; name: string; durationMinutes: number; pricePerUse: number; available: boolean; minutesLeft: number; endsAt: string | null }[];
  laundryCredit: number;
  nextInvoiceDay: number | null; // 1-31 or null
}

interface ConsumptionData {
  usedKwh: number | null;
  electricityCost: number | null;
  usedWaterLiters: number | null;
  waterCost: number | null;
  totalLiveCost: number | null;
  currency: string;
}

// ── Collapsible Section ──
function Section({
  icon,
  title,
  children,
  defaultOpen = true,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="flex items-center gap-2.5 text-base font-semibold">
          {icon}
          {title}
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <CardContent className="pt-0 pb-4">
          {children}
        </CardContent>
      )}
    </Card>
  );
}

export function GuestPortalClient({
  token,
  sessionId,
  guestName,
  unitName,
  status,
  checkInTime,
  checkOutTime,
  expectedCheckOut,
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
  billingMode,
  prepaidAmount,
  isLongTerm,
  invoices,
  quickpayEnabled,
  unitType,
  practicalInfo,
  siteMapUrl,
  laundryMachines,
  laundryCredit,
  nextInvoiceDay,
}: GuestPortalClientProps) {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("campsense-lang") as Locale;
      if (saved && (saved === "da" || saved === "en" || saved === "de")) return saved;
      const browserLang = navigator.language.slice(0, 2);
      if (browserLang === "de") return "de";
      if (browserLang === "en") return "en";
    }
    return "da";
  });
  const tx = getTranslations(locale);

  function changeLocale(l: Locale) {
    setLocale(l);
    localStorage.setItem("campsense-lang", l);
  }

  const [consumption, setConsumption] = useState<ConsumptionData | null>(null);
  const [tempValue, setTempValue] = useState("21");
  const [isPending, startTransition] = useTransition();
  const [unlockMsg, setUnlockMsg] = useState("");
  const [payingSession, setPayingSession] = useState(false);
  const [payingInvoiceId, setPayingInvoiceId] = useState<number | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);

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

  const hasServices = hasClimate || hasSmartLock || hasElectricity || laundryMachines.length > 0;
  const hasPracticalInfo = !!(practicalInfo[locale] || practicalInfo.da);
  const hasInfoSection = hasPracticalInfo || !!siteMapUrl;

  // Unpaid invoices for long-term
  const unpaidInvoices = invoices.filter((inv) => inv.status === "PENDING" || inv.status === "OVERDUE");

  // Next invoice date for long-term
  const nextInvoiceDateStr = (() => {
    if (!isLongTerm || !nextInvoiceDay) return null;
    const now = new Date();
    let nextDate = new Date(now.getFullYear(), now.getMonth(), nextInvoiceDay);
    if (nextDate <= now) {
      nextDate = new Date(now.getFullYear(), now.getMonth() + 1, nextInvoiceDay);
    }
    const loc = locale === "de" ? "de-DE" : locale === "en" ? "en-GB" : "da-DK";
    return nextDate.toLocaleDateString(loc, { day: "numeric", month: "long" });
  })();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-background px-4 pt-6 pb-10 text-center relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-primary/5" />
        <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-primary/5" />

        {/* Language switcher */}
        <div className="flex justify-end px-2 mb-4 relative z-10">
          <div className="flex items-center gap-0.5 bg-white/80 backdrop-blur-sm rounded-full px-1.5 py-1 text-xs shadow-sm border border-border/40">
            <Globe className="h-3.5 w-3.5 text-muted-foreground mr-0.5" />
            {(["da", "en", "de"] as Locale[]).map((l) => (
              <button
                key={l}
                onClick={() => changeLocale(l)}
                className={`px-2.5 py-1 rounded-full transition-all text-xs font-medium ${
                  locale === l ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {localeLabels[l]}
              </button>
            ))}
          </div>
        </div>
        <div className="relative z-10">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-primary/20">
            <Tent className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-bold">{tx.welcome}, {guestName}!</h1>
          <p className="text-muted-foreground text-sm mt-0.5 font-medium">{unitName}</p>
          <p className="text-muted-foreground/60 text-xs mt-1.5">
            {isLongTerm ? tx.longTermRental : `${tx.arrival}: ${new Date(checkInTime).toLocaleDateString(locale === "de" ? "de-DE" : locale === "en" ? "en-GB" : "da-DK", {
              day: "numeric", month: "short",
            })}`}
            {!isLongTerm && expectedCheckOut && (
              <span>
                {" — "}{tx.departure}: {new Date(expectedCheckOut).toLocaleDateString(locale === "de" ? "de-DE" : locale === "en" ? "en-GB" : "da-DK", {
                  day: "numeric", month: "short",
                })}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-4 space-y-3 -mt-4">
        {/* ═══ Completed session ═══ */}
        {!isActive && !isLongTerm && (
          <Card>
            <CardContent className="py-6 text-center space-y-4">
              <div>
                <p className="font-medium">{tx.stayCompleted}</p>
                {checkOutTime && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {tx.departureDate}: {new Date(checkOutTime).toLocaleDateString(locale === "de" ? "de-DE" : locale === "en" ? "en-GB" : "da-DK", {
                      weekday: "long", day: "numeric", month: "long",
                    })}
                  </p>
                )}
              </div>
              {totalCost !== null && (
                <div className="space-y-1 text-sm">
                  {totalElectricityCost !== null && totalElectricityCost > 0 && <p>{tx.electricity}: {formatDKK(totalElectricityCost)}</p>}
                  {totalWaterCost !== null && totalWaterCost > 0 && <p>{tx.water}: {formatDKK(totalWaterCost)}</p>}
                  {externalPrice !== null && externalPrice > 0 && (
                    <p>{externalDescription || tx.stay}: {formatDKK(externalPrice)}</p>
                  )}
                  <Separator className="my-2" />
                  <p className="text-xl font-bold">
                    {tx.total}: {formatDKK((totalCost || 0) + (externalPrice || 0))}
                  </p>
                </div>
              )}

              {paymentStatus === "PAID" ? (
                <div className="bg-green-50 text-green-700 rounded-lg p-3 text-sm font-medium">
                  {tx.thankYou}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="bg-amber-50 text-amber-700 rounded-lg p-3 text-sm">
                    {tx.awaitingPayment}
                  </div>
                  {quickpayEnabled ? (
                    <Button onClick={handlePaySession} disabled={payingSession} className="w-full">
                      <CreditCard className="h-4 w-4 mr-2" />
                      {payingSession ? tx.creatingPayment : tx.payOnline}
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center">{tx.contactCampsite}</p>
                  )}
                  {payError && <p className="text-xs text-red-600 text-center">{payError}</p>}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ═══ Live Consumption — always visible at top ═══ */}
        {isActive && sessionId && (hasElectricity || hasWater) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{tx.yourConsumption}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {hasElectricity && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
                      <Zap className="h-4 w-4 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{tx.electricity}</p>
                      <p className="text-xs text-muted-foreground">
                        {consumption?.usedKwh != null
                          ? `${consumption.usedKwh.toFixed(2)} kWh` : tx.awaitingData}
                      </p>
                    </div>
                  </div>
                  <span className="font-semibold">{formatDKK(consumption?.electricityCost ?? null)}</span>
                </div>
              )}
              {hasWater && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
                      <Droplets className="h-4 w-4 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{tx.water}</p>
                      <p className="text-xs text-muted-foreground">
                        {consumption?.usedWaterLiters != null
                          ? `${consumption.usedWaterLiters.toFixed(0)} liter` : tx.awaitingData}
                      </p>
                    </div>
                  </div>
                  <span className="font-semibold">{formatDKK(consumption?.waterCost ?? null)}</span>
                </div>
              )}
              <Separator />
              <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5">
                <span className="font-bold">{tx.total}</span>
                <span className="text-lg font-bold text-primary tracking-tight">
                  {formatDKK(consumption?.totalLiveCost ?? null)}
                </span>
              </div>
              <p className="text-[11px] text-center text-muted-foreground">{tx.updatesEvery30s}</p>

              {/* Prepaid balance — compact inline */}
              {billingMode === "PREPAID" && prepaidAmount != null && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Wallet className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">
                        {locale === "en" ? "Prepaid" : locale === "de" ? "Vorauszahlung" : "Forudbetalt"}
                      </span>
                    </div>
                    <span className="font-semibold">{formatDKK(prepaidAmount)}</span>
                  </div>
                  {consumption?.totalLiveCost != null && (
                    <>
                      <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            (consumption.totalLiveCost / prepaidAmount) > 0.9 ? "bg-red-500" :
                            (consumption.totalLiveCost / prepaidAmount) > 0.7 ? "bg-yellow-500" : "bg-green-500"
                          }`}
                          style={{ width: `${Math.min(100, (consumption.totalLiveCost / prepaidAmount) * 100)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          {locale === "en" ? "Remaining" : locale === "de" ? "Verbleibend" : "Resterende"}
                        </span>
                        <span className={`font-bold ${prepaidAmount - consumption.totalLiveCost < 0 ? "text-red-600" : "text-green-600"}`}>
                          {formatDKK(prepaidAmount - consumption.totalLiveCost)}
                        </span>
                      </div>
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* ═══ Prepaid Top-up ═══ */}
        {isActive && billingMode === "PREPAID" && sessionId && quickpayEnabled && (
          <TopUpSection sessionId={sessionId} token={token} locale={locale} />
        )}

        {/* ═══ Services: Laundry + Climate + Lock — collapsible ═══ */}
        {isActive && hasServices && (
          <Section
            icon={<WashingMachine className="h-4 w-4 text-blue-500" />}
            title={locale === "en" ? "Services" : locale === "de" ? "Dienste" : "Services"}
            defaultOpen={true}
          >
            <div className="space-y-4">
              {/* Laundry */}
              {laundryMachines.length > 0 && (
                <LaundrySection machines={laundryMachines} token={token} locale={locale} credit={laundryCredit} />
              )}

              {/* Climate */}
              {hasClimate && (
                <div className="space-y-2">
                  {laundryMachines.length > 0 && <Separator />}
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Thermometer className="h-4 w-4 text-blue-400" />
                    {tx.temperature}
                  </div>
                  <div className="flex items-center gap-3">
                    <input type="range" min="16" max="25" step="0.5"
                      value={tempValue} onChange={(e) => setTempValue(e.target.value)}
                      className="flex-1 accent-primary" />
                    <span className="text-lg font-semibold w-14 text-center">{tempValue}°C</span>
                  </div>
                  <Button onClick={handleSetTemp} disabled={isPending}
                    className="w-full" variant="outline" size="sm">
                    {isPending ? tx.setting : tx.setTemperature}
                  </Button>
                </div>
              )}

              {/* Smart Lock */}
              {hasSmartLock && (
                <div className="space-y-2">
                  {(hasClimate || laundryMachines.length > 0) && <Separator />}
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <DoorOpen className="h-4 w-4 text-primary" />
                    {tx.door}
                  </div>
                  <Button onClick={handleUnlock} disabled={isPending} className="w-full" size="sm">
                    {isPending ? tx.opening : tx.unlock}
                  </Button>
                  {unlockMsg && <p className="text-sm text-primary text-center">{tx.doorUnlocked}</p>}
                </div>
              )}

              {/* Power Toggle */}
              {hasElectricity && (
                <PowerToggle token={token} locale={locale as "da" | "en" | "de"} showSeparator={hasClimate || hasSmartLock || laundryMachines.length > 0} />
              )}
            </div>
          </Section>
        )}

        {/* ═══ Info: Practical info + Site map — collapsible ═══ */}
        {hasInfoSection && (
          <Section
            icon={<Info className="h-4 w-4 text-blue-500" />}
            title={tx.practicalInfo}
            defaultOpen={false}
          >
            <div className="space-y-4">
              {(() => {
                const info = practicalInfo[locale] || practicalInfo.da;
                if (!info) return null;
                return (
                  <div
                    className="text-sm text-muted-foreground leading-relaxed prose prose-sm max-w-none [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h3]:text-foreground [&_h3]:font-semibold [&_h3]:text-base [&_h4]:text-foreground [&_h4]:font-medium [&_p]:my-1"
                    dangerouslySetInnerHTML={{ __html: info }}
                  />
                );
              })()}

              {siteMapUrl && (
                <>
                  {hasPracticalInfo && <Separator />}
                  <div className="flex items-center gap-2 text-sm font-medium mb-2">
                    <Map className="h-4 w-4 text-green-600" />
                    {tx.siteMap}
                  </div>
                  <img
                    src={siteMapUrl}
                    alt={tx.siteMap}
                    className="w-full rounded-lg cursor-zoom-in"
                    onClick={() => setMapExpanded(true)}
                  />
                </>
              )}
            </div>
          </Section>
        )}

        {/* Fullscreen map overlay */}
        {mapExpanded && siteMapUrl && (
          <div
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
            onClick={() => setMapExpanded(false)}
          >
            <img
              src={siteMapUrl}
              alt={tx.siteMap}
              className="max-w-full max-h-full object-contain"
            />
            <button
              className="absolute top-4 right-4 text-white bg-black/50 rounded-full w-10 h-10 flex items-center justify-center text-xl"
              onClick={() => setMapExpanded(false)}
            >
              &times;
            </button>
          </div>
        )}

        {/* ═══ Long-term: next invoice date ═══ */}
        {isActive && isLongTerm && nextInvoiceDateStr && unpaidInvoices.length === 0 && (
          <Card className="border-dashed border-border/50">
            <CardContent className="py-4 text-center">
              <CalendarClock className="h-6 w-6 mx-auto mb-1.5 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {locale === "en" ? `Next invoice: ${nextInvoiceDateStr}` :
                 locale === "de" ? `Nächste Rechnung: ${nextInvoiceDateStr}` :
                 `Næste faktura: ${nextInvoiceDateStr}`}
              </p>
            </CardContent>
          </Card>
        )}

        {/* ═══ Invoices for long-term renters — at bottom ═══ */}
        {isLongTerm && invoices.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="h-4 w-4" />
                {tx.yourInvoices}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {invoices.map((inv) => (
                <div key={inv.id} className="p-3 rounded-lg bg-muted/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {new Date(inv.periodStart).toLocaleDateString(locale === "de" ? "de-DE" : locale === "en" ? "en-GB" : "da-DK", { month: "long", year: "numeric" })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {tx.electricity}: {inv.electricityCost.toFixed(2)} · {tx.water}: {inv.waterCost.toFixed(2)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{inv.totalAmount.toFixed(2)} DKK</span>
                      <Badge variant={inv.status === "PAID" ? "default" : "secondary"}
                        className={inv.status === "PAID" ? "bg-primary/20 text-primary" :
                          inv.status === "OVERDUE" ? "bg-destructive/20 text-destructive" : ""}>
                        {inv.status === "PENDING" ? tx.pending :
                         inv.status === "PAID" ? tx.paid :
                         inv.status === "OVERDUE" ? tx.overdue : tx.draft}
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
                      {payingInvoiceId === inv.id ? tx.creatingPayment : tx.payInvoice}
                    </Button>
                  )}
                </div>
              ))}
              {payError && <p className="text-xs text-red-600 text-center">{payError}</p>}
            </CardContent>
          </Card>
        )}

        {/* ═══ Payment info — only for short-term postpaid stays ═══ */}
        {isActive && !isLongTerm && quickpayEnabled && billingMode !== "PREPAID" && (
          <Card className="border-dashed border-border/50">
            <CardContent className="py-4 text-center">
              <CreditCard className="h-6 w-6 mx-auto mb-1.5 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{tx.paymentAtCheckout}</p>
            </CardContent>
          </Card>
        )}

        <p className="text-[10px] text-center text-muted-foreground/40 pt-4 pb-6">{tx.poweredBy}</p>
      </div>
    </div>
  );
}

// ── Laundry Section (inline, no card wrapper) ──
function LaundrySection({
  machines: initialMachines,
  token,
  locale,
  credit,
}: {
  machines: GuestPortalClientProps["laundryMachines"];
  token: string;
  locale: string;
  credit: number;
}) {
  const [machines, setMachines] = useState(initialMachines);
  const [startingId, setStartingId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const updated = await getGuestLaundryMachines();
        setMachines(updated);
      } catch { /* ignore */ }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  async function handleStart(machineId: number) {
    setStartingId(machineId);
    setMessage(null);
    try {
      const res = await createLaundryPayment(machineId, token);
      if (res.ok && res.paymentLink) {
        window.location.href = res.paymentLink;
        return;
      }
      setMessage({ ok: res.ok, text: res.message });
    } catch {
      setMessage({ ok: false, text: "Fejl" });
    } finally {
      setStartingId(null);
    }
  }

  const labels = {
    title: locale === "en" ? "Laundry" : locale === "de" ? "Waschraum" : "Vaskerum",
    available: locale === "en" ? "Available" : locale === "de" ? "Verfügbar" : "Ledig",
    inUse: locale === "en" ? "In use" : locale === "de" ? "In Benutzung" : "I brug",
    minutesLeft: locale === "en" ? "min left" : locale === "de" ? "Min übrig" : "min tilbage",
    start: locale === "en" ? "Pay & Start" : locale === "de" ? "Bezahlen & Starten" : "Betal & Start",
    perUse: locale === "en" ? "per use" : locale === "de" ? "pro Nutzung" : "pr. vask",
  };

  const creditLabel = locale === "en" ? "Credit" : locale === "de" ? "Guthaben" : "Kredit";
  const freeLabel = locale === "en" ? "Free" : locale === "de" ? "Gratis" : "Gratis";

  function buttonLabel(m: typeof machines[0]) {
    if (credit >= m.pricePerUse) return freeLabel;
    if (credit > 0) {
      const toPay = m.pricePerUse - credit;
      return `${toPay.toFixed(0)} DKK`;
    }
    return labels.start;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <WashingMachine className="h-4 w-4 text-blue-500" />
          {labels.title}
        </div>
        {credit > 0 && (
          <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
            {creditLabel}: {credit.toFixed(0)} DKK
          </span>
        )}
      </div>
      {machines.map((m) => (
        <div key={m.id} className="flex items-center justify-between py-2 border-b last:border-0">
          <div>
            <p className="text-sm font-medium">{m.name}</p>
            <p className="text-xs text-muted-foreground">
              {m.available ? (
                <span className="text-green-600">{labels.available}</span>
              ) : (
                <span className="text-orange-600">
                  {labels.inUse} — {m.minutesLeft} {labels.minutesLeft}
                </span>
              )}
              {" · "}{m.durationMinutes} min · {m.pricePerUse.toFixed(0)} DKK {labels.perUse}
            </p>
          </div>
          <Button
            size="sm"
            disabled={!m.available || startingId !== null}
            onClick={() => handleStart(m.id)}
          >
            {startingId === m.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              buttonLabel(m)
            )}
          </Button>
        </div>
      ))}
      {message && (
        <div className={`text-sm p-2 rounded-lg ${message.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
          {message.text}
        </div>
      )}
    </div>
  );
}

// ── Top-up Section for Prepaid Guests ──
function TopUpSection({
  sessionId,
  token,
  locale,
}: {
  sessionId: number;
  token: string;
  locale: string;
}) {
  const [amount, setAmount] = useState("100");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets = [50, 100, 200, 500];

  async function handleTopUp() {
    const val = parseFloat(amount);
    if (!val || val <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await createPrepaidTopUp(sessionId, token, val);
      if (res.ok && res.paymentLink) {
        window.location.href = res.paymentLink;
        return;
      }
      setError(res.message);
    } catch {
      setError("Fejl ved oprettelse af betaling");
    } finally {
      setLoading(false);
    }
  }

  const labels = {
    title: locale === "en" ? "Buy extra power" : locale === "de" ? "Extra Strom kaufen" : "Køb ekstra strøm",
    buy: locale === "en" ? "Buy" : locale === "de" ? "Kaufen" : "Køb",
  };

  return (
    <Card>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Wallet className="h-4 w-4 text-green-500" />
          {labels.title}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => setAmount(String(p))}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                amount === String(p)
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {p} DKK
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="number"
              min="10"
              step="10"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-1.5 text-sm pr-12"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">DKK</span>
          </div>
          <Button size="sm" onClick={handleTopUp} disabled={loading || !amount || parseFloat(amount) <= 0}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : labels.buy}
          </Button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}

// ── Power Toggle for Guest Portal ──
function PowerToggle({
  token,
  locale,
  showSeparator,
}: {
  token: string;
  locale: "da" | "en" | "de";
  showSeparator: boolean;
}) {
  const [powerOn, setPowerOn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const tx = getTranslations(locale);

  useEffect(() => {
    let mounted = true;
    async function fetchState() {
      try {
        const state = await guestGetPowerState(token);
        if (mounted) setPowerOn(state);
      } catch {}
    }
    fetchState();
    const interval = setInterval(fetchState, 30000);
    return () => { mounted = false; clearInterval(interval); };
  }, [token]);

  async function handleToggle() {
    if (powerOn === null) return;
    setLoading(true);
    try {
      const res = await guestTogglePower(token, !powerOn);
      if (res.ok) setPowerOn(res.powerOn);
    } catch {}
    setLoading(false);
  }

  return (
    <div className="space-y-2">
      {showSeparator && <Separator />}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Zap className="h-4 w-4 text-amber-500" />
          {tx.power}
        </div>
        {powerOn !== null && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${powerOn ? "bg-green-50 text-green-600" : "bg-muted text-muted-foreground"}`}>
            {powerOn ? tx.powerIsOn : tx.powerIsOff}
          </span>
        )}
      </div>
      <Button
        onClick={handleToggle}
        disabled={loading || powerOn === null}
        variant={powerOn ? "destructive" : "default"}
        className="w-full"
        size="sm"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
        ) : (
          <Power className="h-3.5 w-3.5 mr-1.5" />
        )}
        {loading
          ? (powerOn ? tx.turningOff : tx.turningOn)
          : (powerOn ? tx.powerOff : tx.powerOn)
        }
      </Button>
    </div>
  );
}
