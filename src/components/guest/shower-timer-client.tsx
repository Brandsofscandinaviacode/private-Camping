"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Droplets,
  Pause,
  Play,
  Plus,
  CheckCircle2,
  XCircle,
  Tent,
  Loader2,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  getShowerSessionState,
  pauseShower,
  resumeShower,
  extendShowerPayment,
  completeExpiredShower,
  startShowerRelay,
} from "@/lib/actions";

type State = NonNullable<Awaited<ReturnType<typeof getShowerSessionState>>>;

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function ShowerTimerClient({ initial }: { initial: State }) {
  const [state, setState] = useState<State>(initial);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [extendMinutes, setExtendMinutes] = useState<number>(Math.max(5, initial.minMinutes));
  const [showExtend, setShowExtend] = useState(false);

  // Track whether relay has been started after warmup
  const relayStartedRef = useRef(initial.warmupSecondsLeft <= 0);

  // Server state poll every 3s to pick up pause cooldown + auto-resume.
  // Authorization is handled server-side via the per-session httpOnly cookie.
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    const tick = async () => {
      try {
        const fresh = await getShowerSessionState(initial.id);
        if (fresh) setState(fresh);
      } catch {}
    };
    pollRef.current = window.setInterval(tick, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [initial.id]);

  // Warmup → relay start: when warmup ends, call server to turn on the relay
  useEffect(() => {
    if (state.status === "ACTIVE" && state.warmupSecondsLeft <= 0 && !relayStartedRef.current) {
      relayStartedRef.current = true;
      startShowerRelay(state.id).catch(() => {});
    }
  }, [state.status, state.warmupSecondsLeft, state.id]);

  // Auto-stop: call server to turn off relay immediately when time expires.
  // The ref ensures we fire exactly once even if multiple ticks or polls hit 0.
  const autoStopFired = useRef(false);
  useEffect(() => {
    if (state.status === "ACTIVE" && state.warmupSecondsLeft <= 0 && state.secondsLeft <= 0 && !autoStopFired.current) {
      autoStopFired.current = true;
      completeExpiredShower(state.id).catch(() => {});
    }
    // Reset if session gets extended (secondsLeft goes back up)
    if (state.secondsLeft > 5) {
      autoStopFired.current = false;
    }
  }, [state.status, state.secondsLeft, state.warmupSecondsLeft, state.id]);

  // Local 1s tick between server polls (so the display stays smooth)
  useEffect(() => {
    const i = setInterval(() => {
      setState((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        if (prev.status === "ACTIVE" && prev.warmupSecondsLeft > 0) {
          next.warmupSecondsLeft = prev.warmupSecondsLeft - 1;
          // Both warmup and secondsLeft count down from endsAt, so decrement both
          if (prev.secondsLeft > 0) next.secondsLeft = prev.secondsLeft - 1;
        } else if (prev.status === "ACTIVE" && prev.secondsLeft > 0) {
          next.secondsLeft = prev.secondsLeft - 1;
        }
        if (prev.status === "PAUSED" && prev.pauseSecondsLeft > 0) {
          next.pauseSecondsLeft = prev.pauseSecondsLeft - 1;
        }
        if (prev.pauseCooldownSeconds > 0) {
          next.pauseCooldownSeconds = prev.pauseCooldownSeconds - 1;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(i);
  }, []);

  async function handlePause() {
    setActionLoading("pause");
    setMessage(null);
    try {
      const res = await pauseShower(state.id);
      if (!res.ok) setMessage({ ok: false, text: res.message });
      const fresh = await getShowerSessionState(state.id);
      if (fresh) setState(fresh);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleResume() {
    setActionLoading("resume");
    setMessage(null);
    try {
      const res = await resumeShower(state.id);
      if (!res.ok) setMessage({ ok: false, text: res.message });
      const fresh = await getShowerSessionState(state.id);
      if (fresh) setState(fresh);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleExtend() {
    setActionLoading("extend");
    setMessage(null);
    try {
      const res = await extendShowerPayment(state.id, extendMinutes);
      if (!res.ok) {
        setMessage({ ok: false, text: res.message });
        setActionLoading(null);
        return;
      }
      if (res.paymentLink) {
        window.location.href = res.paymentLink;
        return;
      }
      // Free mode
      const fresh = await getShowerSessionState(state.id);
      if (fresh) setState(fresh);
      setShowExtend(false);
    } finally {
      setActionLoading(null);
    }
  }

  const isWarmup = state.status === "ACTIVE" && state.warmupSecondsLeft > 0;
  const isActive = state.status === "ACTIVE" && !isWarmup;
  const isPaused = state.status === "PAUSED";
  const isFinished = state.status === "COMPLETED" || state.status === "CANCELLED";
  const isPending = state.status === "PENDING";

  if (isFinished) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="max-w-md mx-auto w-full px-4 py-8 flex-1 flex flex-col justify-center">
          <Card>
            <CardContent className="py-8 text-center">
              <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-green-600" />
              <h1 className="text-lg font-bold">Tak for badet!</h1>
              <p className="text-sm text-muted-foreground mt-2">
                Du brugte {state.minutesPaid} minutter for {state.pricePaid.toFixed(2)} DKK.
              </p>
              <Link href="/services">
                <Button variant="outline" className="mt-5" size="sm">
                  <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                  Se alle services
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="max-w-md mx-auto w-full px-4 py-8 flex-1 flex flex-col justify-center">
          <Card>
            <CardContent className="py-8 text-center">
              <Loader2 className="h-10 w-10 mx-auto mb-3 text-sky-500 animate-spin" />
              <h1 className="text-lg font-bold">Venter på betaling</h1>
              <p className="text-sm text-muted-foreground mt-2">
                Siden opdateres automatisk når betalingen er gennemført.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isWarmup) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="bg-gradient-to-br from-emerald-500/15 via-emerald-400/5 to-background px-4 pt-6 pb-10 text-center relative overflow-hidden">
          <div className="relative z-10">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-emerald-500/20">
              <Droplets className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-xl font-bold">{state.showerName}</h1>
            {state.location && (
              <p className="text-muted-foreground text-sm mt-1">{state.location}</p>
            )}
            <div className="mt-2 inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full bg-background/60 backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Gør dig klar...
            </div>
          </div>
        </div>

        <div className="max-w-md mx-auto w-full px-4 py-4 space-y-4 -mt-4 flex-1">
          <Card>
            <CardContent className="p-6 space-y-5">
              <div className="text-center">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Vandet starter om
                </div>
                <div className="text-7xl font-bold tabular-nums tracking-tight text-emerald-600">
                  {state.warmupSecondsLeft}
                </div>
                <p className="text-sm text-muted-foreground mt-3">
                  Gå ind i badet &mdash; vandet starter automatisk
                </p>
                <div className="text-xs text-muted-foreground mt-2">
                  Betalt: {state.minutesPaid} min &middot; {state.pricePaid.toFixed(2)} DKK
                </div>
              </div>

              <Button
                className="w-full h-12"
                variant="outline"
                disabled={actionLoading !== null}
                onClick={handlePause}
              >
                {actionLoading === "pause" ? (
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                ) : (
                  <Pause className="h-5 w-5 mr-2" />
                )}
                Pause &mdash; jeg har brug for mere tid
              </Button>
            </CardContent>
          </Card>
        </div>

        <p className="text-[10px] text-center text-muted-foreground/40 pb-4 flex items-center justify-center gap-1">
          <Tent className="h-3 w-3" />
          CampSense
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className={`px-4 pt-6 pb-10 text-center relative overflow-hidden ${
        isPaused
          ? "bg-gradient-to-br from-amber-500/15 via-amber-400/5 to-background"
          : "bg-gradient-to-br from-sky-500/15 via-sky-400/5 to-background"
      }`}>
        <div className="relative z-10">
          <div className={`h-12 w-12 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg ${
            isPaused
              ? "bg-gradient-to-br from-amber-500 to-amber-600 shadow-amber-500/20"
              : "bg-gradient-to-br from-sky-500 to-sky-600 shadow-sky-500/20"
          }`}>
            <Droplets className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-bold">{state.showerName}</h1>
          {state.location && (
            <p className="text-muted-foreground text-sm mt-1">{state.location}</p>
          )}
          <div className="mt-2 inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full bg-background/60 backdrop-blur">
            <span className={`h-2 w-2 rounded-full ${isPaused ? "bg-amber-500" : "bg-sky-500 animate-pulse"}`} />
            {isPaused ? "På pause" : "Bruser"}
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto w-full px-4 py-4 space-y-4 -mt-4 flex-1">
        {/* Main timer card */}
        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="text-center">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                {isPaused ? "Tid tilbage når du fortsætter" : "Tid tilbage"}
              </div>
              <div className="text-6xl font-bold tabular-nums tracking-tight" role="timer" aria-live="polite" aria-label={`${Math.floor(state.secondsLeft / 60)} minutter og ${state.secondsLeft % 60} sekunder tilbage`}>
                {fmt(state.secondsLeft)}
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Betalt: {state.minutesPaid} min &middot; {state.pricePaid.toFixed(2)} DKK
              </div>
            </div>

            {isPaused && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-center">
                <div className="text-xs text-amber-700 font-medium mb-1">Pause udløber om</div>
                <div className="text-2xl font-bold tabular-nums text-amber-700">
                  {fmt(state.pauseSecondsLeft)}
                </div>
                <div className="text-[11px] text-amber-600 mt-1">
                  Fortsætter automatisk når tiden er gået
                </div>
              </div>
            )}

            {/* Pause / Resume */}
            {isActive && (
              <Button
                className="w-full h-12"
                variant="outline"
                disabled={actionLoading !== null || state.pauseCooldownSeconds > 0}
                onClick={handlePause}
              >
                {actionLoading === "pause" ? (
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                ) : (
                  <Pause className="h-5 w-5 mr-2" />
                )}
                {state.pauseCooldownSeconds > 0
                  ? `Pause (${state.pauseCooldownSeconds}s)`
                  : "Pause"}
              </Button>
            )}
            {isPaused && (
              <Button
                className="w-full h-12"
                disabled={actionLoading !== null}
                onClick={handleResume}
              >
                {actionLoading === "resume" ? (
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                ) : (
                  <Play className="h-5 w-5 mr-2" />
                )}
                Fortsæt
              </Button>
            )}

            {/* Extend */}
            {!showExtend ? (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setShowExtend(true)}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Køb mere tid
              </Button>
            ) : (
              <div className="space-y-3 pt-2 border-t border-border">
                <div className="text-sm font-medium text-center">Køb ekstra tid</div>
                <div className="flex items-center justify-center gap-4">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 rounded-full"
                    onClick={() => setExtendMinutes((m) => Math.max(state.minMinutes, m - 1))}
                    disabled={extendMinutes <= state.minMinutes}
                  >
                    <span className="text-xl">−</span>
                  </Button>
                  <div className="text-center w-20">
                    <div className="text-3xl font-bold tabular-nums">{extendMinutes}</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">min</div>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 rounded-full"
                    onClick={() => setExtendMinutes((m) => Math.min(state.maxMinutes, m + 1))}
                    disabled={extendMinutes >= state.maxMinutes}
                  >
                    <span className="text-xl">+</span>
                  </Button>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Pris</span>
                  <span className="font-semibold tabular-nums">
                    {(extendMinutes * state.pricePerMinute).toFixed(2)} DKK
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={actionLoading !== null}
                    onClick={handleExtend}
                  >
                    {actionLoading === "extend" ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : null}
                    Betal & tilføj
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowExtend(false)}
                  >
                    Annullér
                  </Button>
                </div>
              </div>
            )}

            {message && (
              <div className={`flex items-center gap-2 text-sm ${message.ok ? "text-green-700" : "text-red-600"}`}>
                {message.ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0" />
                )}
                <span>{message.text}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-[10px] text-center text-muted-foreground/40 pb-4 flex items-center justify-center gap-1">
        <Tent className="h-3 w-3" />
        CampSense
      </p>
    </div>
  );
}
