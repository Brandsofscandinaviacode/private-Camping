"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import DOMPurify from "isomorphic-dompurify";
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
  ChevronLeft,
  ChevronRight,
  CalendarClock,
  Wind,
  MapPin,
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
  startKwh: number | null;
  endKwh: number | null;
  startWaterLiters: number | null;
  endWaterLiters: number | null;
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
  laundryMachines: { id: number; name: string; kind: "WASHER" | "DRYER"; location: string | null; durationMinutes: number; pricePerUse: number; billingMode?: "FIXED" | "METERED"; pricePerMinute?: number; maxReservationDKK?: number; available: boolean; minutesLeft: number; endsAt: string | null; programs: { id: number; name: string; durationMinutes: number; pricePerUse: number }[] }[];
  laundryCredit: number;
  showers: { id: number; name: string; location: string | null; pricePerMinute: number; minMinutes: number; maxMinutes: number; available: boolean; minutesLeft: number }[];
  nextInvoiceDay: number | null; // 1-31 or null
  servicesOnAccount?: boolean;
}

interface ConsumptionData {
  usedKwh: number | null;
  electricityCost: number | null;
  usedWaterLiters: number | null;
  waterCost: number | null;
  servicesCost: number | null;
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
  showers,
  nextInvoiceDay,
  servicesOnAccount,
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
  const [monthIndex, setMonthIndex] = useState(0); // 0 = current period (live), 1+ = invoices
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

  // Laundry state lives here, not in ServicesSection, so the "running now"
  // banner and the machine list count down from the same data. When only the
  // list polled, the banner kept showing the minutes from initial page load.
  const [machines, setMachines] = useState(laundryMachines);
  useEffect(() => { setMachines(laundryMachines); }, [laundryMachines]);
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const updated = await getGuestLaundryMachines();
        if (mounted) setMachines(updated);
      } catch { /* keep last known state */ }
    };
    const interval = setInterval(refresh, 30000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // Tick the countdown locally between refreshes, derived from endsAt, so the
  // remaining time stays right even if a refresh is slow or fails.
  useEffect(() => {
    const interval = setInterval(() => {
      setMachines((prev) => prev.map((m) => {
        if (!m.endsAt) return m;
        const remaining = Math.max(0, Math.round((new Date(m.endsAt).getTime() - Date.now()) / 60000));
        if (remaining === m.minutesLeft) return m;
        return { ...m, minutesLeft: remaining, available: remaining === 0 };
      }));
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  const [tempMsg, setTempMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function handleSetTemp() {
    startTransition(async () => {
      try {
        await guestSetTemperature(token, parseFloat(tempValue));
        setTempMsg({ ok: true, text: tx.temperatureSet });
        setTimeout(() => setTempMsg(null), 4000);
      } catch {
        setTempMsg({ ok: false, text: tx.paymentFailed });
        setTimeout(() => setTempMsg(null), 5000);
      }
    });
  }

  function handleUnlock() {
    startTransition(async () => {
      try {
        await guestUnlockDoor(token);
        setUnlockMsg("ok");
        setTimeout(() => setUnlockMsg(""), 5000);
      } catch {
        setUnlockMsg("error");
        setTimeout(() => setUnlockMsg(""), 5000);
      }
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

  const hasServiceItems = laundryMachines.length > 0 || showers.length > 0;
  const hasServices = hasClimate || hasSmartLock || hasServiceItems;
  const hasPracticalInfo = !!(practicalInfo[locale] || practicalInfo.da);
  const hasInfoSection = hasPracticalInfo || !!siteMapUrl;

  // Filter invoices to only this session's period (exclude previous tenants on same unit)
  const sessionStartDate = new Date(checkInTime);
  const relevantInvoices = invoices.filter(inv => new Date(inv.periodEnd) >= sessionStartDate);

  // Unpaid invoices for long-term
  const unpaidInvoices = relevantInvoices.filter((inv) => inv.status === "PENDING" || inv.status === "OVERDUE");

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

        {/* ═══ Consumption Card — with monthly navigation for long-term ═══ */}
        {isActive && sessionId && (hasElectricity || hasWater) && (() => {
          // For long-term renters: monthly navigation through invoices + current period
          // For short-term: just show current live data (monthIndex always 0)
          const isCurrentMonth = monthIndex === 0;

          // Separate current-month invoices from past-month invoices
          const now = new Date();
          const isInCurrentMonth = (inv: InvoiceData) => {
            const d = new Date(inv.periodStart);
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
          };
          const currentMonthInvoices = relevantInvoices.filter(isInCurrentMonth);
          const pastMonthInvoices = relevantInvoices.filter(inv => !isInCurrentMonth(inv));

          // Sum PAID invoices for the current month → "Betalt" in current view
          const currentMonthPaid = currentMonthInvoices
            .filter(inv => inv.status === "PAID")
            .reduce((sum, inv) => sum + inv.totalAmount, 0);

          const totalMonths = isLongTerm ? 1 + pastMonthInvoices.length : 1;
          const canGoBack = isLongTerm && monthIndex < totalMonths - 1;
          const canGoForward = monthIndex > 0;

          // Current invoice for past-month view (null if viewing live data)
          const viewedInvoice = isCurrentMonth ? null : pastMonthInvoices[monthIndex - 1];

          // Data for display
          const elecKwh = isCurrentMonth
            ? consumption?.usedKwh ?? null
            : (viewedInvoice?.startKwh != null && viewedInvoice?.endKwh != null
              ? Math.max(0, viewedInvoice.endKwh - viewedInvoice.startKwh) : null);
          const elecCost = isCurrentMonth
            ? consumption?.electricityCost ?? null
            : viewedInvoice?.electricityCost ?? null;
          const waterLiters = isCurrentMonth
            ? consumption?.usedWaterLiters ?? null
            : (viewedInvoice?.startWaterLiters != null && viewedInvoice?.endWaterLiters != null
              ? Math.max(0, viewedInvoice.endWaterLiters - viewedInvoice.startWaterLiters) : null);
          const waterCost = isCurrentMonth
            ? consumption?.waterCost ?? null
            : viewedInvoice?.waterCost ?? null;
          const total = isCurrentMonth
            ? consumption?.totalLiveCost ?? null
            : viewedInvoice?.totalAmount ?? null;
          const paidAmount = isCurrentMonth
            ? currentMonthPaid
            : (viewedInvoice?.status === "PAID" ? viewedInvoice.totalAmount : 0);

          // Month label
          const locStr = locale === "de" ? "de-DE" : locale === "en" ? "en-GB" : "da-DK";
          const monthLabel = isCurrentMonth
            ? new Date().toLocaleDateString(locStr, { month: "long", year: "numeric" })
            : viewedInvoice
              ? new Date(viewedInvoice.periodStart).toLocaleDateString(locStr, { month: "long", year: "numeric" })
              : "";

          const paidLabel = locale === "en" ? "Paid" : locale === "de" ? "Bezahlt" : "Betalt";
          const unpaidLabel = locale === "en" ? "Unpaid" : locale === "de" ? "Unbezahlt" : "Ubetalt";

          return (
            <Card>
              <CardHeader className="pb-2">
                {isLongTerm && totalMonths > 1 ? (
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => canGoBack && setMonthIndex(monthIndex + 1)}
                      className={`p-1 rounded-md transition-colors ${canGoBack ? "hover:bg-muted text-foreground" : "text-muted-foreground/30 cursor-default"}`}
                      disabled={!canGoBack}
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <div className="text-center">
                      <CardTitle className="text-base capitalize">{monthLabel}</CardTitle>
                      {isCurrentMonth && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {locale === "en" ? "Current period" : locale === "de" ? "Aktueller Zeitraum" : "Igangværende"}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => canGoForward && setMonthIndex(monthIndex - 1)}
                      className={`p-1 rounded-md transition-colors ${canGoForward ? "hover:bg-muted text-foreground" : "text-muted-foreground/30 cursor-default"}`}
                      disabled={!canGoForward}
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </div>
                ) : (
                  <CardTitle className="text-base">{tx.yourConsumption}</CardTitle>
                )}
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
                          {elecKwh != null ? `${elecKwh.toFixed(2)} kWh` : tx.awaitingData}
                        </p>
                      </div>
                    </div>
                    <span className="font-semibold">{formatDKK(elecCost)}</span>
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
                          {waterLiters != null ? `${waterLiters.toFixed(0)} liter` : tx.awaitingData}
                        </p>
                      </div>
                    </div>
                    <span className="font-semibold">{formatDKK(waterCost)}</span>
                  </div>
                )}
                {isCurrentMonth && (consumption?.servicesCost ?? 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-xl bg-purple-500/10 flex items-center justify-center">
                        <WashingMachine className="h-4 w-4 text-purple-500" />
                      </div>
                      <p className="text-sm font-medium">Services</p>
                    </div>
                    <span className="font-semibold">{formatDKK(consumption!.servicesCost)}</span>
                  </div>
                )}
                <Separator />
                <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5">
                  <span className="font-bold">{tx.total}</span>
                  <span className="text-lg font-bold text-primary tracking-tight">
                    {formatDKK(total)}
                  </span>
                </div>

                {/* Paid amount row */}
                {isLongTerm && (
                  <div className="flex items-center justify-between px-3">
                    <span className="text-sm font-medium text-muted-foreground">{paidLabel}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold tabular-nums ${paidAmount > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                        {formatDKK(paidAmount)}
                      </span>
                      {!isCurrentMonth && viewedInvoice && (
                        <Badge
                          variant={viewedInvoice.status === "PAID" ? "default" : "secondary"}
                          className={`text-[10px] px-1.5 py-0 ${
                            viewedInvoice.status === "PAID" ? "bg-green-100 text-green-700" :
                            viewedInvoice.status === "OVERDUE" ? "bg-red-100 text-red-600" :
                            "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {viewedInvoice.status === "PAID" ? paidLabel :
                           viewedInvoice.status === "OVERDUE" ? tx.overdue :
                           unpaidLabel}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}

                {/* Pay button for unpaid past invoices */}
                {!isCurrentMonth && viewedInvoice && (viewedInvoice.status === "PENDING" || viewedInvoice.status === "OVERDUE") && quickpayEnabled && (
                  <>
                    <Separator />
                    <Button
                      variant="outline" size="sm"
                      disabled={payingInvoiceId === viewedInvoice.id}
                      onClick={() => handlePayInvoice(viewedInvoice.id)}
                      className="w-full text-xs"
                    >
                      <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                      {payingInvoiceId === viewedInvoice.id ? tx.creatingPayment : `${tx.payInvoice} — ${viewedInvoice.totalAmount.toFixed(2)} DKK`}
                    </Button>
                  </>
                )}

                {/* Live-only: update timer + power toggle */}
                {isCurrentMonth && (
                  <>
                    <p className="text-[11px] text-center text-muted-foreground">{tx.updatesEvery30s}</p>

                    {hasElectricity && (
                      <>
                        <Separator />
                        <PowerToggle token={token} locale={locale as "da" | "en" | "de"} showSeparator={false} />
                      </>
                    )}

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
                  </>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* ═══ Unpaid invoice banner — fastliggere + short-term postpaid ═══ */}
        {unpaidInvoices.length > 0 && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="py-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                  <Receipt className="h-4 w-4 text-amber-700" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-amber-900 text-sm">
                    {locale === "en" ? "You have unpaid invoices" :
                     locale === "de" ? "Sie haben unbezahlte Rechnungen" :
                     "Du har ubetalte fakturaer"}
                  </p>
                  <p className="text-xs text-amber-800 mt-0.5">
                    {unpaidInvoices.length} {locale === "en" ? "invoice(s) awaiting payment" :
                                              locale === "de" ? "Rechnung(en) ausstehend" :
                                              "faktura(er) afventer betaling"}
                    {" — "}
                    {unpaidInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0).toFixed(2)} DKK
                  </p>
                </div>
              </div>
              {quickpayEnabled && unpaidInvoices[0] && (
                <Button
                  onClick={() => handlePayInvoice(unpaidInvoices[0].id)}
                  disabled={payingInvoiceId !== null}
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                  size="sm"
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  {payingInvoiceId === unpaidInvoices[0].id ? tx.creatingPayment : `${tx.payInvoice} — ${unpaidInvoices[0].totalAmount.toFixed(2)} DKK`}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* ═══ Prepaid Top-up ═══ */}
        {isActive && billingMode === "PREPAID" && sessionId && quickpayEnabled && (
          <TopUpSection sessionId={sessionId} token={token} locale={locale} />
        )}

        {/* ═══ Active services banner ═══ */}
        {isActive && (() => {
          const activeMachines = machines.filter((m) => !m.available && m.minutesLeft > 0);
          if (activeMachines.length === 0) return null;
          const endsInLabel = locale === "en" ? "Ends in" : locale === "de" ? "Fertig in" : "Færdig om";
          return (
            <Card className="border-blue-200 bg-blue-50/50">
              <CardContent className="py-3 space-y-2">
                {activeMachines.map((m) => (
                  <div key={m.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                        {m.kind === "WASHER"
                          ? <WashingMachine className="h-4 w-4 text-blue-500" />
                          : <Wind className="h-4 w-4 text-purple-500" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{m.name}</p>
                        {m.location && <p className="text-[11px] text-muted-foreground">{m.location}</p>}
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-1 rounded-full animate-pulse">
                      {endsInLabel} {m.minutesLeft} min
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })()}

        {/* ═══ Services: Laundry + Climate + Lock — collapsible ═══ */}
        {isActive && hasServices && (
          <Section
            icon={<WashingMachine className="h-4 w-4 text-blue-500" />}
            title={locale === "en" ? "Services" : locale === "de" ? "Dienste" : "Services"}
            defaultOpen={true}
          >
            <div className="space-y-4">
              {/* Services drill-down (Bad / Vaskemaskine / Tørretumbler) */}
              {hasServiceItems && (
                <GuestServicesSection
                  showers={showers}
                  machines={machines}
                  token={token}
                  locale={locale}
                  credit={laundryCredit}
                  onAccount={servicesOnAccount}
                />
              )}

              {/* Climate */}
              {hasClimate && (
                <div className="space-y-2">
                  {hasServiceItems && <Separator />}
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
                  {tempMsg && (
                    <p className={`text-sm text-center rounded-lg px-3 py-1.5 ${tempMsg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                      {tempMsg.text}
                    </p>
                  )}
                </div>
              )}

              {/* Smart Lock */}
              {hasSmartLock && (
                <div className="space-y-2">
                  {(hasClimate || hasServiceItems) && <Separator />}
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <DoorOpen className="h-4 w-4 text-primary" />
                    {tx.door}
                  </div>
                  <Button onClick={handleUnlock} disabled={isPending} className="w-full" size="sm">
                    {isPending ? tx.opening : tx.unlock}
                  </Button>
                  {unlockMsg === "ok" && <p className="text-sm text-center rounded-lg px-3 py-1.5 bg-green-50 text-green-700">{tx.doorUnlocked}</p>}
                  {unlockMsg === "error" && <p className="text-sm text-center rounded-lg px-3 py-1.5 bg-red-50 text-red-600">{tx.paymentFailed}</p>}
                </div>
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
                const sanitized = DOMPurify.sanitize(info, {
                  ALLOWED_TAGS: ["p", "br", "strong", "em", "b", "i", "a", "ul", "ol", "li", "h3", "h4", "span"],
                  ALLOWED_ATTR: ["href", "target", "rel", "class"],
                });
                return (
                  <div
                    className="text-sm text-muted-foreground leading-relaxed prose prose-sm max-w-none [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h3]:text-foreground [&_h3]:font-semibold [&_h3]:text-base [&_h4]:text-foreground [&_h4]:font-medium [&_p]:my-1"
                    dangerouslySetInnerHTML={{ __html: sanitized }}
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

        {/* ═══ Invoices — collapsible, fastliggere + short-term postpaid ═══ */}
        {relevantInvoices.length > 0 && (
          <Section
            icon={<Receipt className="h-4 w-4 text-primary" />}
            title={`${tx.yourInvoices} (${relevantInvoices.length})`}
            defaultOpen={unpaidInvoices.length > 0}
          >
            <div className="space-y-2">
              {relevantInvoices.map((inv) => (
                <div key={inv.id} className="p-3 rounded-lg bg-muted/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {new Date(inv.periodStart).toLocaleDateString(locale === "de" ? "de-DE" : locale === "en" ? "en-GB" : "da-DK", { month: "long", year: "numeric" })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          hasElectricity && `${tx.electricity}: ${inv.electricityCost.toFixed(2)}`,
                          hasWater && `${tx.water}: ${inv.waterCost.toFixed(2)}`,
                        ].filter(Boolean).join(" · ")}
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
            </div>
          </Section>
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

// ── Services Section (drill-down: type → location → items) ──
type ServiceType = "shower" | "washer" | "dryer";
const NO_LOCATION_KEY = "__nolocation__";

function GuestServicesSection({
  showers: initialShowers,
  machines: initialMachines,
  token,
  locale,
  credit,
  onAccount,
}: {
  showers: GuestPortalClientProps["showers"];
  machines: GuestPortalClientProps["laundryMachines"];
  token: string;
  locale: string;
  credit: number;
  onAccount?: boolean;
}) {
  const [showers, setShowers] = useState(initialShowers);
  const machines = initialMachines;
  const [selectedType, setSelectedType] = useState<ServiceType | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [pickingProgramFor, setPickingProgramFor] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Keep initial showers fresh when server re-renders
  useEffect(() => { setShowers(initialShowers); }, [initialShowers]);

  const labels = {
    chooseType: locale === "en" ? "Choose service" : locale === "de" ? "Service wählen" : "Vælg service",
    chooseLocation: locale === "en" ? "Choose location" : locale === "de" ? "Ort wählen" : "Vælg lokation",
    back: locale === "en" ? "Back" : locale === "de" ? "Zurück" : "Tilbage",
    shower: locale === "en" ? "Shower" : locale === "de" ? "Dusche" : "Bad",
    washer: locale === "en" ? "Washer" : locale === "de" ? "Waschmaschine" : "Vaskemaskine",
    dryer: locale === "en" ? "Dryer" : locale === "de" ? "Trockner" : "Tørretumbler",
    noLocation: locale === "en" ? "No location" : locale === "de" ? "Ohne Ort" : "Uden lokation",
    available: locale === "en" ? "Available" : locale === "de" ? "Verfügbar" : "Ledig",
    availablePlural: locale === "en" ? "available" : locale === "de" ? "verfügbar" : "ledige",
    inUse: locale === "en" ? "In use" : locale === "de" ? "In Benutzung" : "I brug",
    minutesLeft: locale === "en" ? "min left" : locale === "de" ? "Min übrig" : "min tilbage",
    start: onAccount
      ? (locale === "en" ? "Start" : locale === "de" ? "Starten" : "Start")
      : (locale === "en" ? "Pay & Start" : locale === "de" ? "Bezahlen & Starten" : "Betal & Start"),
    choose: locale === "en" ? "Choose" : locale === "de" ? "Wählen" : "Vælg",
    perUse: locale === "en" ? "per use" : locale === "de" ? "pro Nutzung" : "pr. vask",
    perMinute: locale === "en" ? "per minute" : locale === "de" ? "pro Minute" : "pr. min",
    items: locale === "en" ? "items" : locale === "de" ? "Stück" : "stk",
  };
  const creditLabel = locale === "en" ? "Credit" : locale === "de" ? "Guthaben" : "Kredit";
  const freeLabel = locale === "en" ? "Free" : locale === "de" ? "Gratis" : "Gratis";

  const washers = machines.filter((m) => m.kind === "WASHER");
  const dryers = machines.filter((m) => m.kind === "DRYER");

  function getAvailableCount(type: ServiceType): number {
    if (type === "shower") return showers.filter((s) => s.available).length;
    if (type === "washer") return washers.filter((m) => m.available).length;
    return dryers.filter((m) => m.available).length;
  }

  const typeCards: { type: ServiceType; count: number; availableCount: number; icon: React.ReactNode; label: string; accent: string }[] = [
    showers.length > 0 && {
      type: "shower" as ServiceType,
      count: showers.length,
      availableCount: getAvailableCount("shower"),
      icon: <Droplets className="h-5 w-5" />,
      label: labels.shower,
      accent: "text-sky-500",
    },
    washers.length > 0 && {
      type: "washer" as ServiceType,
      count: washers.length,
      availableCount: getAvailableCount("washer"),
      icon: <WashingMachine className="h-5 w-5" />,
      label: labels.washer,
      accent: "text-blue-500",
    },
    dryers.length > 0 && {
      type: "dryer" as ServiceType,
      count: dryers.length,
      availableCount: getAvailableCount("dryer"),
      icon: <Wind className="h-5 w-5" />,
      label: labels.dryer,
      accent: "text-purple-500",
    },
  ].filter(Boolean) as { type: ServiceType; count: number; availableCount: number; icon: React.ReactNode; label: string; accent: string }[];

  function getLocationsFor(type: ServiceType): { key: string; label: string; count: number }[] {
    const items: { location: string | null }[] =
      type === "shower" ? showers : type === "washer" ? washers : dryers;
    const byLocation: Record<string, { label: string; count: number }> = {};
    for (const it of items) {
      const key = it.location?.trim() || NO_LOCATION_KEY;
      const label = it.location?.trim() || labels.noLocation;
      if (byLocation[key]) byLocation[key].count += 1;
      else byLocation[key] = { label, count: 1 };
    }
    return Object.entries(byLocation)
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) => a.label.localeCompare(b.label, "da-DK"));
  }

  function getItemsFor(type: ServiceType, locKey: string) {
    if (type === "shower") {
      return showers.filter((s) => (s.location?.trim() || NO_LOCATION_KEY) === locKey);
    }
    const pool = type === "washer" ? washers : dryers;
    return pool.filter((m) => (m.location?.trim() || NO_LOCATION_KEY) === locKey);
  }

  async function handleStartMachine(machineId: number, programId?: number) {
    setStartingId(`m-${machineId}`);
    setMessage(null);
    try {
      const res = await createLaundryPayment(machineId, token, programId ?? null);
      if (res.ok && res.paymentLink) {
        window.location.href = res.paymentLink;
        return;
      }
      setPickingProgramFor(null);
      setMessage({ ok: res.ok, text: res.message });
    } catch {
      setMessage({ ok: false, text: "Fejl" });
    } finally {
      setStartingId(null);
    }
  }

  function handleStartShower(showerId: number) {
    setStartingId(`s-${showerId}`);
    window.location.href = `/shower/${showerId}`;
  }

  function machineButtonLabel(m: GuestPortalClientProps["laundryMachines"][number]) {
    if (onAccount) return labels.start;
    if (m.billingMode === "METERED") return labels.start;
    if (credit >= m.pricePerUse) return freeLabel;
    if (credit > 0) {
      const toPay = m.pricePerUse - credit;
      return `${toPay.toFixed(0)} DKK`;
    }
    return labels.start;
  }

  // ── Step 1: Type selection ──
  if (!selectedType) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <WashingMachine className="h-4 w-4 text-blue-500" />
            {labels.chooseType}
          </div>
          {credit > 0 && (
            <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
              {creditLabel}: {credit.toFixed(0)} DKK
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2">
          {typeCards.map((tc) => (
            <button
              key={tc.type}
              onClick={() => setSelectedType(tc.type)}
              className="flex items-center gap-3 px-3 py-3 rounded-lg border border-border/60 hover:border-primary/40 hover:bg-muted/30 transition-colors text-left"
            >
              <span className={tc.accent}>{tc.icon}</span>
              <span className="flex-1">
                <span className="text-sm font-medium block">{tc.label}</span>
                <span className="text-xs text-muted-foreground">
                  {tc.count} {labels.items}
                </span>
              </span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                tc.availableCount > 0
                  ? "bg-green-50 text-green-600"
                  : "bg-orange-50 text-orange-600"
              }`}>
                {tc.availableCount}/{tc.count} {tc.availableCount === 1 ? labels.available : labels.availablePlural}
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  const typeLabel =
    selectedType === "shower" ? labels.shower : selectedType === "washer" ? labels.washer : labels.dryer;

  // ── Step 2: Location selection ──
  if (!selectedLocation) {
    const locations = getLocationsFor(selectedType);
    // Skip this step if there's only one location
    if (locations.length === 1) {
      // Defer to avoid setState during render
      queueMicrotask(() => setSelectedLocation(locations[0].key));
    }
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSelectedType(null)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {labels.back}
          </button>
          <span className="text-sm font-medium">{typeLabel}</span>
          <span className="w-12" />
        </div>
        <p className="text-xs text-muted-foreground">{labels.chooseLocation}</p>
        <div className="grid grid-cols-1 gap-2">
          {locations.map((loc) => (
            <button
              key={loc.key}
              onClick={() => setSelectedLocation(loc.key)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border/60 hover:border-primary/40 hover:bg-muted/30 transition-colors text-left"
            >
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-sm">{loc.label}</span>
              <span className="text-xs text-muted-foreground">{loc.count}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Step 3: Items list ──
  const items = getItemsFor(selectedType, selectedLocation);
  const locationLabel = selectedLocation === NO_LOCATION_KEY
    ? labels.noLocation
    : items[0]?.location?.trim() || selectedLocation;
  const hasMultipleLocations = getLocationsFor(selectedType).length > 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            if (hasMultipleLocations) {
              setSelectedLocation(null);
            } else {
              setSelectedLocation(null);
              setSelectedType(null);
            }
          }}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {labels.back}
        </button>
        <span className="text-sm font-medium">
          {typeLabel} · {locationLabel}
        </span>
        <span className="w-12" />
      </div>
      <div className="space-y-1.5">
        {selectedType === "shower"
          ? (items as GuestPortalClientProps["showers"]).map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2.5 px-2 rounded-lg border-b last:border-0">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{s.name}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {s.available ? (
                      <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">{labels.available}</span>
                    ) : (
                      <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-700">
                        {labels.inUse} · {s.minutesLeft} {labels.minutesLeft}
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">{s.pricePerMinute.toFixed(2)} DKK {labels.perMinute}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={!s.available || startingId !== null}
                  onClick={() => handleStartShower(s.id)}
                >
                  {startingId === `s-${s.id}` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    labels.choose
                  )}
                </Button>
              </div>
            ))
          : (items as GuestPortalClientProps["laundryMachines"]).map((m) => (
              <div key={m.id} className="py-2.5 px-2 border-b last:border-0">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{m.name}</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {m.available ? (
                        <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">{labels.available}</span>
                      ) : (
                        <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-700">
                          {labels.inUse} · {m.minutesLeft} {labels.minutesLeft}
                        </span>
                      )}
                      {m.programs.length === 0 && (
                        <span className="text-[11px] text-muted-foreground">{m.durationMinutes} min · {m.pricePerUse.toFixed(0)} DKK {labels.perUse}</span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={!m.available || startingId !== null}
                    onClick={() => {
                      if (m.programs.length > 0) {
                        setPickingProgramFor(pickingProgramFor === m.id ? null : m.id);
                      } else {
                        handleStartMachine(m.id);
                      }
                    }}
                  >
                    {startingId === `m-${m.id}` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : m.programs.length > 0 ? (
                      pickingProgramFor === m.id ? labels.back : labels.choose
                    ) : (
                      machineButtonLabel(m)
                    )}
                  </Button>
                </div>
                {m.programs.length > 0 && pickingProgramFor === m.id && m.available && (
                  <div className="mt-2 space-y-1.5">
                    {m.programs.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        disabled={startingId !== null}
                        onClick={() => handleStartMachine(m.id, p.id)}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left disabled:opacity-50"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-[11px] text-muted-foreground">{p.durationMinutes} min</p>
                        </div>
                        <span className="text-sm font-semibold shrink-0">{p.pricePerUse.toFixed(0)} DKK</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
      </div>
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
