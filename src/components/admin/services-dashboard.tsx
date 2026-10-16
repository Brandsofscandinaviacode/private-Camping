"use client";

import { useState, useEffect, useCallback } from "react";
import {
  WashingMachine,
  Wind,
  ShowerHead,
  Square,
  Clock,
  Loader2,
  User,
  Timer,
  WifiOff,
  CreditCard,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminExtendLaundry, adminStopLaundry, adminStopShower } from "@/lib/actions";
import { getServicesOverview, adminExtendShower } from "@/lib/service-actions";
import { AlertBanner, StatusBadge, type BadgeTone } from "@/components/admin/admin-ui";
import { ServiceStartDialog } from "@/components/admin/service-start-dialog";
import { ServiceCancelDialog } from "@/components/admin/service-cancel-dialog";
import { fmtTime } from "@/lib/format";

type Overview = Awaited<ReturnType<typeof getServicesOverview>>;
type Machine = Overview["machines"][number];
type Shower = Overview["showers"][number];
type Active = NonNullable<Machine["active"]>;

function clock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ServicesDashboard({ initial }: { initial: Overview }) {
  const [data, setData] = useState(initial);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [extendMinutes, setExtendMinutes] = useState<Record<number, string>>({});
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      setData(await getServicesOverview());
    } catch { /* keep the last view */ }
  }, []);

  // Data every 15 s; the countdowns tick locally every second.
  useEffect(() => {
    const poll = setInterval(refresh, 15000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [refresh]);

  async function run(key: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setActionLoading(key);
    setMessage(null);
    try {
      const res = await fn();
      setMessage({ ok: res.ok, text: res.message });
    } catch {
      setMessage({ ok: false, text: "Handlingen fejlede — prøv igen" });
    } finally {
      setActionLoading(null);
      refresh();
    }
  }

  function done(text: string) {
    setMessage({ ok: true, text });
    refresh();
  }

  function stop(kind: "LAUNDRY" | "SHOWER", a: Active, name: string) {
    if (!window.confirm(`Stop ${name} nu?\n\nGæsten får ikke pengene tilbage — brug "Annullér og refundér" til det.`)) return;
    run(`stop-${kind}-${a.id}`, () => (kind === "LAUNDRY" ? adminStopLaundry(a.id) : adminStopShower(a.id)));
  }

  const all = [...data.showers.map((s) => s.active), ...data.machines.map((m) => m.active)];
  const inUse = all.filter(Boolean).length;
  const total = data.showers.length + data.machines.length;
  const offline = [...data.showers, ...data.machines].filter((x) => x.online === false).length;

  return (
    <div className="space-y-4">
      {!data.cardPayment && (
        <AlertBanner tone="amber" icon={CreditCard}>
          Kortbetaling er slået fra. Gæster kan kun selv starte vask og bad, når det betales med kredit eller saldo
          {data.servicesOnAccount ? " eller skrives på opholdet" : ""}. Alle andre betaler her — brug »Start for gæst«.
        </AlertBanner>
      )}

      <div className="grid grid-cols-3 gap-4">
        <SummaryTile label="I brug nu" value={inUse} className="text-green-600" />
        <SummaryTile label="Ledige" value={total - inUse} />
        <SummaryTile label="Offline" value={offline} className={offline > 0 ? "text-red-600" : ""} />
      </div>

      {message && (
        <div className={`text-sm p-3 rounded-lg ${message.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
          {message.text}
        </div>
      )}

      {total === 0 && (
        <div className="rounded-xl border border-border/60 bg-card shadow-sm p-8 text-center text-muted-foreground">
          <WashingMachine className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>Ingen bade eller maskiner konfigureret</p>
          <p className="text-xs mt-1">Tilføj dem under fanerne Bade, Vaskemaskiner og Tørretumblere</p>
        </div>
      )}

      {data.showers.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Bade</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.showers.map((s) => (
              <ServiceCard
                key={`s-${s.id}`}
                icon={ShowerHead}
                name={s.name}
                meta={[s.code, s.location, `${s.pricePerMinute.toFixed(2)} DKK/min`]}
                enabled={s.enabled}
                online={s.online}
                active={s.active}
                now={now}
                showSeconds
              >
                {s.active ? (
                  <ActiveActions
                    kind="SHOWER"
                    name={s.name}
                    active={s.active}
                    loading={actionLoading}
                    onStop={() => stop("SHOWER", s.active!, s.name)}
                    onDone={done}
                    extend={
                      s.active.status !== "PENDING" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={actionLoading !== null}
                          onClick={() => run(`extend-SHOWER-${s.active!.id}`, () => adminExtendShower(s.active!.id, 5))}
                        >
                          {actionLoading === `extend-SHOWER-${s.active.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                          5 min
                        </Button>
                      )
                    }
                  />
                ) : (
                  <IdleActions enabled={s.enabled}>
                    <ServiceStartDialog target={{ kind: "SHOWER", ...pickShower(s) }} onStarted={done} />
                  </IdleActions>
                )}
              </ServiceCard>
            ))}
          </div>
        </div>
      )}

      {data.machines.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Vask og tørring</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.machines.map((m) => (
              <ServiceCard
                key={`m-${m.id}`}
                icon={m.machineKind === "DRYER" ? Wind : WashingMachine}
                name={m.name}
                meta={[
                  m.code,
                  m.location,
                  m.billingMode === "METERED" ? "Målt forbrug" : `${m.durationMinutes} min · ${m.pricePerUse.toFixed(0)} DKK`,
                ]}
                enabled={m.enabled}
                online={m.online}
                active={m.active}
                now={now}
              >
                {m.active ? (
                  <ActiveActions
                    kind="LAUNDRY"
                    name={m.name}
                    active={m.active}
                    loading={actionLoading}
                    onStop={() => stop("LAUNDRY", m.active!, m.name)}
                    onDone={done}
                    extend={
                      m.active.status === "ACTIVE" && !m.active.metered && (
                        <div className="flex gap-1">
                          <Input
                            type="number"
                            min="5"
                            step="5"
                            value={extendMinutes[m.active.id] ?? "15"}
                            onChange={(e) => setExtendMinutes((v) => ({ ...v, [m.active!.id]: e.target.value }))}
                            className="w-16 h-7 text-sm"
                            aria-label="Minutter"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actionLoading !== null}
                            onClick={() => {
                              const extra = parseInt(extendMinutes[m.active!.id] ?? "15", 10);
                              if (extra > 0) run(`extend-LAUNDRY-${m.active!.id}`, () => adminExtendLaundry(m.active!.id, extra));
                            }}
                          >
                            {actionLoading === `extend-LAUNDRY-${m.active.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
                            Forlæng
                          </Button>
                        </div>
                      )
                    }
                  />
                ) : (
                  <IdleActions enabled={m.enabled}>
                    <ServiceStartDialog
                      target={{
                        kind: "LAUNDRY",
                        id: m.id,
                        name: m.name,
                        durationMinutes: m.durationMinutes,
                        pricePerUse: m.pricePerUse,
                        programs: m.programs,
                        online: m.online,
                      }}
                      onStarted={done}
                    />
                  </IdleActions>
                )}
              </ServiceCard>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center">
        Opdateres automatisk hvert 15. sekund
      </p>
    </div>
  );
}

function pickShower(s: Shower) {
  return {
    id: s.id,
    name: s.name,
    pricePerMinute: s.pricePerMinute,
    minMinutes: s.minMinutes,
    maxMinutes: s.maxMinutes,
    online: s.online,
  };
}

function SummaryTile({ label, value, className = "" }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm p-4">
      <div className="text-xs text-muted-foreground font-medium">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${className}`}>{value}</div>
    </div>
  );
}

function statusOf(active: Active | null, enabled: boolean): { tone: BadgeTone; label: string; pulse?: boolean } {
  if (!active) return enabled ? { tone: "emerald", label: "Ledig" } : { tone: "muted", label: "Deaktiveret" };
  if (active.status === "PENDING") return { tone: "amber", label: "Venter betaling" };
  if (active.status === "PAUSED") return { tone: "amber", label: "Pause" };
  return { tone: "blue", label: "I brug", pulse: true };
}

function ServiceCard({
  icon: Icon,
  name,
  meta,
  enabled,
  online,
  active,
  now,
  showSeconds = false,
  children,
}: {
  icon: typeof WashingMachine;
  name: string;
  meta: (string | null)[];
  enabled: boolean;
  online: boolean | null;
  active: Active | null;
  now: number;
  showSeconds?: boolean;
  children: React.ReactNode;
}) {
  const st = statusOf(active, enabled);
  const running = active && active.status === "ACTIVE";
  const secondsLeft = active
    ? active.pausedSecondsLeft ?? Math.max(0, Math.ceil((new Date(active.endsAt).getTime() - now) / 1000))
    : 0;

  return (
    <div className={`rounded-xl border bg-card shadow-sm overflow-hidden ${online === false ? "border-red-200" : "border-border/60"}`}>
      <div className={`px-5 py-4 border-b flex items-center justify-between gap-3 ${running ? "bg-blue-50/60 border-blue-100" : ""}`}>
        <div className="flex items-center gap-3 min-w-0">
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${running ? "bg-blue-100" : "bg-muted"}`}>
            <Icon className={`h-5 w-5 ${running ? "text-blue-600" : "text-muted-foreground"}`} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold truncate">{name}</h3>
            <p className="text-xs text-muted-foreground truncate">{meta.filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge tone={st.tone} pulse={st.pulse}>{st.label}</StatusBadge>
          {online === false && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600">
              <WifiOff className="h-3 w-3" /> Offline
            </span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-3">
        {online === false && !active && (
          <p className="text-xs text-red-600">
            Shelly-enheden svarer ikke — gæster kan ikke starte den, og en start herfra vil fejle.
          </p>
        )}
        {active && (
          <div className="space-y-1.5 text-sm">
            {active.status !== "PENDING" && !active.metered && (
              <Row icon={Timer} label={active.status === "PAUSED" ? "Tid tilbage (pause)" : "Tid tilbage"}>
                <span className="font-semibold text-blue-600 tabular-nums">
                  {showSeconds ? clock(secondsLeft) : `${Math.ceil(secondsLeft / 60)} min`}
                </span>
              </Row>
            )}
            {active.status === "ACTIVE" && !active.metered && (
              <Row icon={Clock} label="Slutter">{fmtTime(active.endsAt)}</Row>
            )}
            <Row icon={User} label="Gæst">
              <span className="text-right">
                {active.guestName ?? active.source}
                {active.unitName && <span className="text-muted-foreground ml-1">({active.unitName})</span>}
              </span>
            </Row>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{active.detail ?? "Betaling"}</span>
              <span className="flex items-center gap-2">
                <StatusBadge tone={active.payment.tone}>{active.payment.label}</StatusBadge>
                <span className="tabular-nums font-medium">{active.amount.toFixed(2)} DKK</span>
              </span>
            </div>
            {(active.startedBy || active.note || active.creditUsed > 0) && (
              <p className="text-xs text-muted-foreground">
                {[
                  active.startedBy && `Startet af ${active.startedBy}`,
                  active.creditUsed > 0 && `${active.creditUsed.toFixed(2)} DKK kredit`,
                  active.note,
                ].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof Clock; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      {children}
    </div>
  );
}

function ActiveActions({
  kind,
  name,
  active,
  loading,
  onStop,
  onDone,
  extend,
}: {
  kind: "LAUNDRY" | "SHOWER";
  name: string;
  active: Active;
  loading: string | null;
  onStop: () => void;
  onDone: (message: string) => void;
  extend: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {extend}
      {active.status !== "PENDING" && (
        <Button size="sm" variant="destructive" disabled={loading !== null} onClick={onStop}>
          {loading === `stop-${kind}-${active.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
          Stop
        </Button>
      )}
      <ServiceCancelDialog kind={kind} id={active.id} label={name} plan={active.refund} onDone={onDone} />
    </div>
  );
}

function IdleActions({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  if (!enabled) {
    return <p className="text-xs text-muted-foreground">Deaktiveret — aktivér den under indstillingerne for at bruge den.</p>;
  }
  return <div className="flex gap-2">{children}</div>;
}
