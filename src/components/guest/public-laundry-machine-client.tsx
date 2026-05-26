"use client";

import { useState, useEffect, useCallback } from "react";
import { WashingMachine, Wind, Loader2, Clock, CheckCircle2, XCircle, MapPin, Tent, Zap, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getPublicLaundryMachine, createPublicLaundryPayment, completeExpiredLaundry } from "@/lib/actions";
import { type Locale, detectLocale, getTranslations } from "@/lib/guest-translations";
import { LanguagePicker } from "./language-picker";

interface Program {
  id: number;
  name: string;
  durationMinutes: number;
  pricePerUse: number;
}

interface Machine {
  id: number;
  name: string;
  kind: string;
  location: string | null;
  durationMinutes: number;
  pricePerUse: number;
  billingMode: "FIXED" | "METERED";
  pricePerMinute: number;
  maxReservationDKK: number;
  available: boolean;
  minutesLeft: number;
  endsAt: string | null;
  programs: Program[];
}

interface Props {
  machine: Machine;
}

function formatDuration(min: number, locale: Locale): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hLabel = locale === "de" ? "Std" : locale === "en" ? "h" : "t";
  return m === 0 ? `${h} ${hLabel}` : `${h} ${hLabel} ${m} min`;
}

const AUTO_CANCEL_MS = 10 * 60 * 1000;

export function PublicLaundryMachineClient({ machine: initialMachine }: Props) {
  const [locale, setLocale] = useState<Locale>(detectLocale);
  const tx = getTranslations(locale);
  const [machine, setMachine] = useState(initialMachine);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pickingProgram, setPickingProgram] = useState(false);

  // Metered auto-cancel: countdown until session cancelled if machine not started
  const [cancelCountdown, setCancelCountdown] = useState<number | null>(null);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await getPublicLaundryMachine(machine.id);
        if (data) setMachine(data);
      } catch { /* ignore */ }
    }, 15000);
    return () => clearInterval(interval);
  }, [machine.id]);

  // Countdown timer
  const stoppedRef = useState(() => ({ stopped: false }))[0];
  useEffect(() => {
    const interval = setInterval(() => {
      setMachine((prev) => {
        if (!prev.endsAt) return prev;
        const remaining = Math.max(0, Math.ceil((new Date(prev.endsAt).getTime() - Date.now()) / 60000));
        const expired = new Date(prev.endsAt).getTime() <= Date.now();
        if (expired && !prev.available && !stoppedRef.stopped) {
          stoppedRef.stopped = true;
          completeExpiredLaundry(prev.id).catch(() => {});
        }
        return { ...prev, minutesLeft: remaining, available: remaining === 0 };
      });
    }, 10_000);
    return () => clearInterval(interval);
  }, [stoppedRef]);

  // Metered auto-cancel countdown
  const handleMeteredStart = useCallback((startTime: number) => {
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, AUTO_CANCEL_MS - elapsed);
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
  }, []);

  async function handleStart(programId?: number) {
    setStarting(true);
    setMessage(null);
    setCancelled(false);
    try {
      const res = await createPublicLaundryPayment(machine.id, `machine:${machine.id}`, programId ?? null);
      if (res.ok && res.paymentLink) {
        window.location.href = res.paymentLink;
        return;
      }
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        setPickingProgram(false);
        if (machine.billingMode === "METERED") {
          handleMeteredStart(Date.now());
        }
        const data = await getPublicLaundryMachine(machine.id);
        if (data) setMachine(data);
      }
    } catch {
      setMessage({ ok: false, text: tx.errorOccurred });
    } finally {
      setStarting(false);
    }
  }

  const Icon = machine.kind === "DRYER" ? Wind : WashingMachine;
  const kindLabel = machine.kind === "DRYER" ? tx.dryer : tx.washer;

  function formatCountdown(ms: number) {
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-background px-4 pt-6 pb-10 text-center relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-primary/5" />
        <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-primary/5" />
        <div className="relative z-10">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-primary/20">
            <Icon className="h-6 w-6 text-white" />
          </div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{kindLabel}</p>
          <h1 className="text-xl font-bold mt-0.5">{machine.name}</h1>
          {machine.location && (
            <p className="text-muted-foreground text-sm mt-1 inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {machine.location}
            </p>
          )}
          <LanguagePicker locale={locale} onChange={setLocale} />
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-4 space-y-3 -mt-4">
        {message && (
          <Card>
            <CardContent className="py-4">
              <div className={`flex items-center gap-3 ${message.ok ? "text-green-700" : "text-red-600"}`}>
                {message.ok ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <XCircle className="h-5 w-5 shrink-0" />}
                <p className="text-sm font-medium">{message.text}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Auto-cancel countdown for metered */}
        {cancelCountdown !== null && (
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
            <div className="flex items-center gap-2 mb-4">
              {machine.available ? (
                <span className="text-xs px-2.5 py-1 rounded-full bg-green-50 text-green-600 font-medium inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  {tx.available}
                </span>
              ) : (
                <span className="text-xs px-2.5 py-1 rounded-full bg-orange-50 text-orange-600 font-medium inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />
                  {tx.inUse} — {machine.minutesLeft} {tx.minLeft}
                </span>
              )}
            </div>

            {machine.billingMode === "METERED" ? (
              <>
                {machine.available && (
                  <div className="text-center mb-4">
                    <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-blue-50 mb-2">
                      <Loader2 className="h-8 w-8 text-blue-400 animate-spin" style={{ animationDuration: "3s" }} />
                    </div>
                    <p className="font-semibold text-sm">{tx.machineReady}</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-[260px] mx-auto">{tx.machineReadyMetered}</p>
                  </div>
                )}
                <div className="space-y-2 text-sm text-muted-foreground mb-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> {tx.powerConsumption}</span>
                    <span className="font-semibold text-foreground">0 W</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {tx.rate}</span>
                    <span className="font-semibold text-foreground">{machine.pricePerMinute.toFixed(2)} DKK/min</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{tx.maxReservation}</span>
                    <span className="font-semibold text-foreground">{machine.maxReservationDKK.toFixed(0)} DKK</span>
                  </div>
                </div>
                <Button
                  className="w-full"
                  size="lg"
                  disabled={!machine.available || starting}
                  onClick={() => handleStart()}
                >
                  {starting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {starting ? tx.creatingPayment : tx.startMachine}
                </Button>
              </>
            ) : machine.programs.length > 0 ? (
              pickingProgram ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground mb-1">{tx.selectProgram}:</p>
                  {machine.programs.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={!machine.available || starting}
                      onClick={() => handleStart(p.id)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left disabled:opacity-50"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" />
                          {formatDuration(p.durationMinutes, locale)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-semibold text-sm">{p.pricePerUse.toFixed(0)} DKK</span>
                        {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      </div>
                    </button>
                  ))}
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => setPickingProgram(false)} disabled={starting}>
                    {tx.cancel}
                  </Button>
                </div>
              ) : (
                <Button className="w-full" size="lg" disabled={!machine.available || starting} onClick={() => setPickingProgram(true)}>
                  {tx.selectProgram}
                </Button>
              )
            ) : (
              <>
                <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDuration(machine.durationMinutes, locale)}
                  </div>
                  <span className="font-semibold text-foreground">{machine.pricePerUse.toFixed(0)} DKK</span>
                </div>
                <Button className="w-full" size="lg" disabled={!machine.available || starting} onClick={() => handleStart()}>
                  {starting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {starting ? tx.creatingPayment : tx.payAndStart.replace("{amount}", machine.pricePerUse.toFixed(0))}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <p className="text-[10px] text-center text-muted-foreground/40 pt-2 pb-6 flex items-center justify-center gap-1">
          <Tent className="h-3 w-3" />
          CampSense
        </p>
      </div>
    </div>
  );
}
