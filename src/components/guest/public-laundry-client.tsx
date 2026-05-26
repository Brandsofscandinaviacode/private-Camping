"use client";

import { useState, useEffect } from "react";
import { WashingMachine, Wind, Loader2, Clock, CheckCircle2, XCircle, Tent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getPublicLaundryGroup, createPublicLaundryPayment, completeExpiredLaundry } from "@/lib/actions";
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
  kind?: string;
  durationMinutes: number;
  pricePerUse: number;
  billingMode?: "FIXED" | "METERED";
  pricePerMinute?: number;
  maxReservationDKK?: number;
  available: boolean;
  minutesLeft: number;
  endsAt: string | null;
  programs: Program[];
}

interface Props {
  token: string;
  groupName: string;
  machines: Machine[];
}

function formatDuration(min: number, locale: Locale): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hLabel = locale === "de" ? "Std" : locale === "en" ? "h" : "t";
  return m === 0 ? `${h} ${hLabel}` : `${h} ${hLabel} ${m} min`;
}

export function PublicLaundryClient({ token, groupName, machines: initialMachines }: Props) {
  const [locale, setLocale] = useState<Locale>(detectLocale);
  const tx = getTranslations(locale);
  const [machines, setMachines] = useState(initialMachines);
  const [startingId, setStartingId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pickingProgramFor, setPickingProgramFor] = useState<number | null>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await getPublicLaundryGroup(token);
        if (data) setMachines(data.machines);
      } catch { /* ignore */ }
    }, 15000);
    return () => clearInterval(interval);
  }, [token]);

  const stoppedIds = useState(() => new Set<number>())[0];
  useEffect(() => {
    const interval = setInterval(() => {
      setMachines((prev) =>
        prev.map((m) => {
          if (!m.endsAt) return m;
          const remaining = Math.max(0, Math.ceil((new Date(m.endsAt).getTime() - Date.now()) / 60000));
          const expired = new Date(m.endsAt).getTime() <= Date.now();
          if (expired && !m.available && !stoppedIds.has(m.id)) {
            stoppedIds.add(m.id);
            completeExpiredLaundry(m.id).catch(() => {});
          }
          return { ...m, minutesLeft: remaining, available: remaining === 0 };
        })
      );
    }, 10_000);
    return () => clearInterval(interval);
  }, [stoppedIds]);

  async function handleStart(machineId: number, programId?: number) {
    setStartingId(machineId);
    setMessage(null);
    try {
      const res = await createPublicLaundryPayment(machineId, token, programId ?? null);
      if (res.ok && res.paymentLink) {
        window.location.href = res.paymentLink;
        return;
      }
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        setPickingProgramFor(null);
        const data = await getPublicLaundryGroup(token);
        if (data) setMachines(data.machines);
      }
    } catch {
      setMessage({ ok: false, text: tx.errorOccurred });
    } finally {
      setStartingId(null);
    }
  }

  const availableCount = machines.filter((m) => m.available).length;

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-background px-4 pt-6 pb-10 text-center relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-primary/5" />
        <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-primary/5" />
        <div className="relative z-10">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-primary/20">
            <WashingMachine className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-bold">{groupName}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {machines.length} {machines.length === 1 ? tx.machine : tx.machines} &middot;{" "}
            <span className={availableCount > 0 ? "text-green-600 font-medium" : "text-orange-600 font-medium"}>
              {availableCount} {availableCount === 1 ? tx.xOfYAvailable : tx.xOfYAvailablePlural}
            </span>
          </p>
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

        {machines.map((m) => {
          const MachineIcon = m.kind === "DRYER" ? Wind : WashingMachine;
          return (
            <Card key={m.id} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="flex items-center gap-4 p-4">
                  <div className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 ${
                    m.available ? "bg-green-500/10" : "bg-orange-500/10"
                  }`}>
                    <MachineIcon className={`h-6 w-6 ${m.available ? "text-green-600" : "text-orange-500"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold">{m.name}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      {m.available ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600 font-medium inline-flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                          {tx.available}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 font-medium inline-flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />
                          {tx.inUse} — {m.minutesLeft} {tx.minLeft}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className={`px-4 pb-4 ${m.available ? "" : "opacity-60"}`}>
                  {m.billingMode === "METERED" ? (
                    <>
                      <div className="space-y-1 text-sm text-muted-foreground mb-3">
                        <div className="flex items-center justify-between">
                          <span>{tx.rate}</span>
                          <span className="font-semibold text-foreground">{(m.pricePerMinute ?? 0).toFixed(2)} DKK/min</span>
                        </div>
                        <p className="text-xs">{tx.reserveExplain.replace("{amount}", (m.maxReservationDKK ?? 0).toFixed(0))}</p>
                      </div>
                      <Button className="w-full" size="lg" disabled={!m.available || startingId !== null} onClick={() => handleStart(m.id)}>
                        {startingId === m.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        {startingId === m.id ? tx.creatingPayment : tx.startMachine}
                      </Button>
                    </>
                  ) : m.programs.length > 0 ? (
                    pickingProgramFor === m.id ? (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground mb-1">{tx.selectProgram}:</p>
                        {m.programs.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            disabled={!m.available || startingId !== null}
                            onClick={() => handleStart(m.id, p.id)}
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
                              {startingId === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            </div>
                          </button>
                        ))}
                        <Button variant="ghost" size="sm" className="w-full" onClick={() => setPickingProgramFor(null)} disabled={startingId !== null}>
                          {tx.cancel}
                        </Button>
                      </div>
                    ) : (
                      <Button className="w-full" size="lg" disabled={!m.available || startingId !== null} onClick={() => setPickingProgramFor(m.id)}>
                        {tx.selectProgram}
                      </Button>
                    )
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          {formatDuration(m.durationMinutes, locale)}
                        </div>
                        <span className="font-semibold text-foreground">{m.pricePerUse.toFixed(0)} DKK</span>
                      </div>
                      <Button className="w-full" size="lg" disabled={!m.available || startingId !== null} onClick={() => handleStart(m.id)}>
                        {startingId === m.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        {startingId === m.id ? tx.creatingPayment : tx.payAndStart.replace("{amount}", m.pricePerUse.toFixed(0))}
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {machines.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <WashingMachine className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">{tx.noMachinesAvailable}</p>
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
