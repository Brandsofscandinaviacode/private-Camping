"use client";

import { useState, useEffect } from "react";
import { WashingMachine, Wind, Zap, Clock, CheckCircle2, Loader2, Tent, AlertTriangle, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getMeteredLaundryStatus } from "@/lib/actions";
import { type Locale, detectLocale, getTranslations } from "@/lib/guest-translations";
import { LanguagePicker } from "./language-picker";

interface MeteredStatus {
  sessionId: number;
  machineName: string;
  machineKind: string;
  machineLocation: string | null;
  phase: "waiting" | "billing" | "idle" | "done" | "cancelled";
  billedMinutes: number;
  currentCost: number;
  reservedAmount: number;
  pricePerMinute: number;
  lastPowerW: number | null;
  meterStartedAt: string | null;
  meterEndedAt: string | null;
  pricePaid: number;
  createdAt?: string;
}

interface Props {
  accessToken: string;
  initial: MeteredStatus;
}

const AUTO_CANCEL_MS = 10 * 60 * 1000;

function formatMinutes(min: number, locale: Locale): string {
  if (min < 1) return "< 1 min";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  const hLabel = locale === "de" ? "Std" : locale === "en" ? "h" : "t";
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} ${hLabel}` : `${h} ${hLabel} ${m} min`;
}

function formatCountdown(ms: number) {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const meteredLabels = {
  da: { washInProgress: "Vask i gang", time: "Tid", price: "Pris", endingSoon: "Afslutter snart...", lowPower: "Lavt strømforbrug registreret. Stopper automatisk.", washDone: "Vask færdig!", totalTime: "Total tid", charged: "Betalt" },
  en: { washInProgress: "Wash in progress", time: "Time", price: "Price", endingSoon: "Ending soon...", lowPower: "Low power consumption detected. Stopping automatically.", washDone: "Wash complete!", totalTime: "Total time", charged: "Charged" },
  de: { washInProgress: "Waschgang läuft", time: "Zeit", price: "Preis", endingSoon: "Endet bald...", lowPower: "Niedriger Stromverbrauch erkannt. Wird automatisch gestoppt.", washDone: "Wäsche fertig!", totalTime: "Gesamtzeit", charged: "Berechnet" },
} as const;

export function MeteredLaundryClient({ accessToken, initial }: Props) {
  const [locale, setLocale] = useState<Locale>(detectLocale);
  const tx = getTranslations(locale);
  const ml = meteredLabels[locale];
  const [status, setStatus] = useState(initial);
  const [cancelCountdown, setCancelCountdown] = useState<number | null>(null);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await getMeteredLaundryStatus(accessToken);
        if (data) {
          setStatus(data);
          if (data.phase !== "waiting") {
            setCancelCountdown(null);
          }
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [accessToken]);

  // Auto-cancel countdown for waiting phase
  useEffect(() => {
    if (status.phase !== "waiting") { setCancelCountdown(null); return; }
    const createdMs = status.createdAt ? new Date(status.createdAt).getTime() : Date.now();
    const tick = () => {
      const remaining = Math.max(0, AUTO_CANCEL_MS - (Date.now() - createdMs));
      if (remaining <= 0) {
        setCancelCountdown(null);
        setCancelled(true);
        return;
      }
      setCancelCountdown(remaining);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [status.phase, status.createdAt]);

  const Icon = status.machineKind === "DRYER" ? Wind : WashingMachine;
  const kindLabel = status.machineKind === "DRYER" ? tx.dryer : tx.washer;

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-background px-4 pt-6 pb-10 text-center relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-primary/5" />
        <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-primary/5" />
        <div className="relative z-10">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-primary/20">
            <Icon className="h-6 w-6 text-white" />
          </div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{kindLabel}</p>
          <h1 className="text-xl font-bold mt-0.5">{status.machineName}</h1>
          <LanguagePicker locale={locale} onChange={setLocale} />
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-4 space-y-3 -mt-4">
        {/* Auto-cancel warning */}
        {cancelCountdown !== null && !cancelled && (
          <Card>
            <CardContent className="py-3">
              <div className="flex items-center gap-3 text-amber-700">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <p className="text-sm font-medium">{tx.autoCancel} {formatCountdown(cancelCountdown)}</p>
              </div>
            </CardContent>
          </Card>
        )}
        {cancelled && (
          <Card>
            <CardContent className="py-3">
              <div className="flex items-center gap-3 text-red-600">
                <XCircle className="h-5 w-5 shrink-0" />
                <p className="text-sm font-medium">{tx.sessionCancelled}</p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-5">
            {status.phase === "waiting" && !cancelled && (
              <div className="text-center space-y-3">
                <div className="h-16 w-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto">
                  <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
                </div>
                <div>
                  <p className="font-semibold">{tx.machineReady}</p>
                  <p className="text-sm text-muted-foreground mt-1">{tx.machineReadyMetered}</p>
                </div>
              </div>
            )}

            {status.phase === "billing" && (
              <div className="text-center space-y-3">
                <div className="h-16 w-16 rounded-full bg-green-50 flex items-center justify-center mx-auto">
                  <Zap className="h-8 w-8 text-green-500" />
                </div>
                <div>
                  <p className="font-semibold text-green-700">{ml.washInProgress}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">{ml.time}</p>
                      <p className="text-lg font-bold">{formatMinutes(status.billedMinutes, locale)}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">{ml.price}</p>
                      <p className="text-lg font-bold">{status.currentCost.toFixed(0)} DKK</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {status.phase === "idle" && (
              <div className="text-center space-y-3">
                <div className="h-16 w-16 rounded-full bg-orange-50 flex items-center justify-center mx-auto">
                  <Clock className="h-8 w-8 text-orange-500" />
                </div>
                <div>
                  <p className="font-semibold text-orange-700">{ml.endingSoon}</p>
                  <p className="text-sm text-muted-foreground mt-1">{ml.lowPower}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">{ml.time}</p>
                      <p className="text-lg font-bold">{formatMinutes(status.billedMinutes, locale)}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">{ml.price}</p>
                      <p className="text-lg font-bold">{status.currentCost.toFixed(0)} DKK</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {status.phase === "done" && (
              <div className="text-center space-y-3">
                <div className="h-16 w-16 rounded-full bg-green-50 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                </div>
                <div>
                  <p className="font-semibold text-green-700">{ml.washDone}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">{ml.totalTime}</p>
                      <p className="text-lg font-bold">{formatMinutes(status.billedMinutes, locale)}</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">{ml.charged}</p>
                      <p className="text-lg font-bold">{status.pricePaid.toFixed(0)} DKK</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {status.phase === "cancelled" && (
              <div className="text-center space-y-3">
                <div className="h-16 w-16 rounded-full bg-red-50 flex items-center justify-center mx-auto">
                  <XCircle className="h-8 w-8 text-red-500" />
                </div>
                <div>
                  <p className="font-semibold text-red-700">{tx.sessionCancelled}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {status.phase !== "done" && status.phase !== "cancelled" && !cancelled && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Zap className="h-4 w-4" />
                  <span>{tx.powerConsumption}</span>
                </div>
                <span className="font-medium">
                  {status.lastPowerW !== null ? `${status.lastPowerW.toFixed(0)} W` : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>{tx.rate}</span>
                </div>
                <span className="font-medium">{status.pricePerMinute.toFixed(2)} DKK/min</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-muted-foreground">{tx.maxReservation}</span>
                <span className="font-medium">{status.reservedAmount.toFixed(0)} DKK</span>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-[10px] text-center text-muted-foreground/40 pt-2 pb-6 flex items-center justify-center gap-1">
          <Tent className="h-3 w-3" />
          CampSense
        </p>
      </div>
    </div>
  );
}
