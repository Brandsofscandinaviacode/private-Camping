"use client";

import { useState, useEffect } from "react";
import {
  WashingMachine,
  Play,
  Square,
  Clock,
  Loader2,
  User,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getServiceStatus,
  adminStartLaundry,
  adminExtendLaundry,
  adminStopLaundry,
} from "@/lib/actions";

type MachineStatus = Awaited<ReturnType<typeof getServiceStatus>>[number];

interface Props {
  initialMachines: MachineStatus[];
}

export function ServicesDashboard({ initialMachines }: Props) {
  const [machines, setMachines] = useState(initialMachines);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [startDuration, setStartDuration] = useState<Record<number, string>>({});
  const [extendMinutes, setExtendMinutes] = useState<Record<number, string>>({});

  // Auto-refresh every 15 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const updated = await getServiceStatus();
        setMachines(updated);
      } catch { /* ignore */ }
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  async function handleStart(machineId: number) {
    const duration = parseInt(startDuration[machineId] || "60", 10);
    if (!duration || duration <= 0) return;
    setActionLoading(`start-${machineId}`);
    setMessage(null);
    try {
      const res = await adminStartLaundry(machineId, duration);
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        const updated = await getServiceStatus();
        setMachines(updated);
      }
    } catch {
      setMessage({ ok: false, text: "Fejl" });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleExtend(sessionId: number) {
    const extra = parseInt(extendMinutes[sessionId] || "15", 10);
    if (!extra || extra <= 0) return;
    setActionLoading(`extend-${sessionId}`);
    setMessage(null);
    try {
      const res = await adminExtendLaundry(sessionId, extra);
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        const updated = await getServiceStatus();
        setMachines(updated);
      }
    } catch {
      setMessage({ ok: false, text: "Fejl" });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleStop(sessionId: number) {
    setActionLoading(`stop-${sessionId}`);
    setMessage(null);
    try {
      const res = await adminStopLaundry(sessionId);
      setMessage({ ok: res.ok, text: res.message });
      const updated = await getServiceStatus();
      setMachines(updated);
    } catch {
      setMessage({ ok: false, text: "Fejl" });
    } finally {
      setActionLoading(null);
    }
  }

  const runningCount = machines.filter((m) => m.isRunning).length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border/60 bg-card shadow-sm p-4">
          <div className="text-xs text-muted-foreground font-medium">Maskiner</div>
          <div className="text-2xl font-bold mt-1">{machines.length}</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card shadow-sm p-4">
          <div className="text-xs text-muted-foreground font-medium">Kører nu</div>
          <div className="text-2xl font-bold text-green-600 mt-1">{runningCount}</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card shadow-sm p-4">
          <div className="text-xs text-muted-foreground font-medium">Ledige</div>
          <div className="text-2xl font-bold mt-1">{machines.length - runningCount}</div>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`text-sm p-3 rounded-lg ${message.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
          {message.text}
        </div>
      )}

      {/* Machine cards */}
      {machines.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card shadow-sm p-8 text-center text-muted-foreground">
          <WashingMachine className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>Ingen maskiner konfigureret</p>
          <p className="text-xs mt-1">Tilføj maskiner under Indstillinger → Vaskerum</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {machines.map((m) => (
            <div key={m.id} className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
              {/* Header */}
              <div className={`px-5 py-4 border-b flex items-center justify-between ${
                m.isRunning ? "bg-green-50 border-green-100" : m.isPending ? "bg-amber-50 border-amber-100" : ""
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                    m.isRunning ? "bg-green-100" : "bg-muted"
                  }`}>
                    <WashingMachine className={`h-5 w-5 ${m.isRunning ? "text-green-600" : "text-muted-foreground"}`} />
                  </div>
                  <div>
                    <h3 className="font-semibold">{m.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {m.durationMinutes} min · {m.pricePerUse.toFixed(0)} DKK
                      {!m.enabled && " · Deaktiveret"}
                    </p>
                  </div>
                </div>
                <div>
                  {m.isRunning ? (
                    <span className="flex items-center gap-1.5 text-sm font-medium text-green-600">
                      <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                      Kører
                    </span>
                  ) : m.isPending ? (
                    <span className="text-sm font-medium text-amber-600">Venter betaling</span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Ledig</span>
                  )}
                </div>
              </div>

              <div className="p-5 space-y-4">
                {/* Active session info */}
                {m.isRunning && m.activeSession && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Timer className="h-3.5 w-3.5" />
                        Tid tilbage
                      </div>
                      <span className="font-semibold text-green-600">{m.minutesLeft} min</span>
                    </div>
                    {m.activeSession.guestName && (
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <User className="h-3.5 w-3.5" />
                          Gæst
                        </div>
                        <span>
                          {m.activeSession.guestName}
                          {m.activeSession.unitName && (
                            <span className="text-muted-foreground ml-1">({m.activeSession.unitName})</span>
                          )}
                        </span>
                      </div>
                    )}
                    {m.endsAt && (
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          Slutter
                        </div>
                        <span>{new Date(m.endsAt).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    )}

                    {/* Extend */}
                    <div className="flex gap-2 pt-1">
                      <Input
                        type="number"
                        min="5"
                        step="5"
                        value={extendMinutes[m.activeSession.id] ?? "15"}
                        onChange={(e) => setExtendMinutes((v) => ({ ...v, [m.activeSession!.id]: e.target.value }))}
                        className="w-20 text-sm"
                        placeholder="min"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actionLoading !== null}
                        onClick={() => handleExtend(m.activeSession!.id)}
                      >
                        {actionLoading === `extend-${m.activeSession.id}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <Clock className="h-3.5 w-3.5 mr-1" />
                        )}
                        Forlæng
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={actionLoading !== null}
                        onClick={() => handleStop(m.activeSession!.id)}
                      >
                        {actionLoading === `stop-${m.activeSession.id}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <Square className="h-3.5 w-3.5 mr-1" />
                        )}
                        Stop
                      </Button>
                    </div>
                  </div>
                )}

                {/* Manual start (when idle) */}
                {!m.isRunning && !m.isPending && (
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="5"
                      step="5"
                      value={startDuration[m.id] ?? String(m.durationMinutes)}
                      onChange={(e) => setStartDuration((v) => ({ ...v, [m.id]: e.target.value }))}
                      className="w-20 text-sm"
                      placeholder="min"
                    />
                    <Button
                      size="sm"
                      disabled={actionLoading !== null}
                      onClick={() => handleStart(m.id)}
                      className="flex-1"
                    >
                      {actionLoading === `start-${m.id}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Start manuelt
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center">
        Opdateres automatisk hvert 15. sekund
      </p>
    </div>
  );
}
