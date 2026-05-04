"use client";

import { useState, useEffect } from "react";
import { WashingMachine, Wind, Loader2, Clock, CheckCircle2, XCircle, MapPin, Tent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getPublicLaundryMachine, createPublicLaundryPayment, completeExpiredLaundry } from "@/lib/actions";

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
  available: boolean;
  minutesLeft: number;
  endsAt: string | null;
  programs: Program[];
}

interface Props {
  machine: Machine;
}

function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} t` : `${h} t ${m} min`;
}

export function PublicLaundryMachineClient({ machine: initialMachine }: Props) {
  const [machine, setMachine] = useState(initialMachine);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pickingProgram, setPickingProgram] = useState(false);

  // Auto-refresh every 15 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await getPublicLaundryMachine(machine.id);
        if (data) setMachine(data);
      } catch { /* ignore */ }
    }, 15000);
    return () => clearInterval(interval);
  }, [machine.id]);

  // Countdown timer — update minutesLeft every 10s and auto-stop when expired
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

  async function handleStart(programId?: number) {
    setStarting(true);
    setMessage(null);
    try {
      const res = await createPublicLaundryPayment(machine.id, `machine:${machine.id}`, programId ?? null);
      if (res.ok && res.paymentLink) {
        window.location.href = res.paymentLink;
        return;
      }
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        setPickingProgram(false);
        const data = await getPublicLaundryMachine(machine.id);
        if (data) setMachine(data);
      }
    } catch {
      setMessage({ ok: false, text: "Der opstod en fejl" });
    } finally {
      setStarting(false);
    }
  }

  const Icon = machine.kind === "DRYER" ? Wind : WashingMachine;
  const kindLabel = machine.kind === "DRYER" ? "Tørretumbler" : "Vaskemaskine";

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
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-4 space-y-3 -mt-4">
        {/* Success/error message */}
        {message && (
          <Card>
            <CardContent className="py-4">
              <div className={`flex items-center gap-3 ${message.ok ? "text-green-700" : "text-red-600"}`}>
                {message.ok ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                ) : (
                  <XCircle className="h-5 w-5 shrink-0" />
                )}
                <p className="text-sm font-medium">{message.text}</p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-5">
            {/* Status */}
            <div className="flex items-center gap-2 mb-4">
              {machine.available ? (
                <span className="text-xs px-2.5 py-1 rounded-full bg-green-50 text-green-600 font-medium inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  Ledig
                </span>
              ) : (
                <span className="text-xs px-2.5 py-1 rounded-full bg-orange-50 text-orange-600 font-medium inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />
                  I brug — {machine.minutesLeft} min tilbage
                </span>
              )}
            </div>

            {/* Action area */}
            {machine.programs.length > 0 ? (
              pickingProgram ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground mb-1">Vælg program:</p>
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
                          {formatDuration(p.durationMinutes)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-semibold text-sm">{p.pricePerUse.toFixed(0)} DKK</span>
                        {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      </div>
                    </button>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => setPickingProgram(false)}
                    disabled={starting}
                  >
                    Annullér
                  </Button>
                </div>
              ) : (
                <Button
                  className="w-full"
                  size="lg"
                  disabled={!machine.available || starting}
                  onClick={() => setPickingProgram(true)}
                >
                  Vælg program
                </Button>
              )
            ) : (
              <>
                <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDuration(machine.durationMinutes)}
                  </div>
                  <span className="font-semibold text-foreground">{machine.pricePerUse.toFixed(0)} DKK</span>
                </div>
                <Button
                  className="w-full"
                  size="lg"
                  disabled={!machine.available || starting}
                  onClick={() => handleStart()}
                >
                  {starting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {starting ? "Opretter betaling..." : `Betal ${machine.pricePerUse.toFixed(0)} DKK & Start`}
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
