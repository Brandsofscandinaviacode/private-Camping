"use client";

import { useState, useEffect } from "react";
import { WashingMachine, Loader2, Clock, CheckCircle2, XCircle, Tent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getPublicLaundryGroup, createPublicLaundryPayment, completeExpiredLaundry } from "@/lib/actions";

interface Machine {
  id: number;
  name: string;
  durationMinutes: number;
  pricePerUse: number;
  available: boolean;
  minutesLeft: number;
  endsAt: string | null;
}

interface Props {
  token: string;
  groupName: string;
  machines: Machine[];
}

export function PublicLaundryClient({ token, groupName, machines: initialMachines }: Props) {
  const [machines, setMachines] = useState(initialMachines);
  const [startingId, setStartingId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Auto-refresh every 15 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await getPublicLaundryGroup(token);
        if (data) setMachines(data.machines);
      } catch { /* ignore */ }
    }, 15000);
    return () => clearInterval(interval);
  }, [token]);

  // Countdown timer — update minutesLeft every 10s and auto-stop expired machines
  const stoppedIds = useState(() => new Set<number>())[0];
  useEffect(() => {
    const interval = setInterval(() => {
      setMachines((prev) =>
        prev.map((m) => {
          if (!m.endsAt) return m;
          const remaining = Math.max(0, Math.ceil((new Date(m.endsAt).getTime() - Date.now()) / 60000));
          const expired = new Date(m.endsAt).getTime() <= Date.now();
          // Auto-stop: call server to turn off relay when time is actually up
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

  async function handleStart(machineId: number) {
    setStartingId(machineId);
    setMessage(null);
    try {
      const res = await createPublicLaundryPayment(machineId, token);
      if (res.ok && res.paymentLink) {
        window.location.href = res.paymentLink;
        return;
      }
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        // Refresh machines after successful start
        const data = await getPublicLaundryGroup(token);
        if (data) setMachines(data.machines);
      }
    } catch {
      setMessage({ ok: false, text: "Der opstod en fejl" });
    } finally {
      setStartingId(null);
    }
  }

  const availableCount = machines.filter((m) => m.available).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-background px-4 pt-6 pb-10 text-center relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-primary/5" />
        <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-primary/5" />
        <div className="relative z-10">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-primary/20">
            <WashingMachine className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-bold">{groupName}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {machines.length} {machines.length === 1 ? "maskine" : "maskiner"} &middot;{" "}
            <span className={availableCount > 0 ? "text-green-600 font-medium" : "text-orange-600 font-medium"}>
              {availableCount} {availableCount === 1 ? "ledig" : "ledige"}
            </span>
          </p>
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

        {/* Machine cards */}
        {machines.map((m) => (
          <Card key={m.id} className="overflow-hidden">
            <CardContent className="p-0">
              <div className="flex items-center gap-4 p-4">
                <div className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 ${
                  m.available ? "bg-green-500/10" : "bg-orange-500/10"
                }`}>
                  <WashingMachine className={`h-6 w-6 ${m.available ? "text-green-600" : "text-orange-500"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold">{m.name}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    {m.available ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600 font-medium inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        Ledig
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 font-medium inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />
                        I brug — {m.minutesLeft} min tilbage
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Action area */}
              <div className={`px-4 pb-4 ${m.available ? "" : "opacity-60"}`}>
                <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {m.durationMinutes} minutter
                  </div>
                  <span className="font-semibold text-foreground">{m.pricePerUse.toFixed(0)} DKK</span>
                </div>
                <Button
                  className="w-full"
                  size="lg"
                  disabled={!m.available || startingId !== null}
                  onClick={() => handleStart(m.id)}
                >
                  {startingId === m.id ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  {startingId === m.id ? "Opretter betaling..." : `Betal ${m.pricePerUse.toFixed(0)} DKK & Start`}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {machines.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <WashingMachine className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Ingen maskiner tilgængelige</p>
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
