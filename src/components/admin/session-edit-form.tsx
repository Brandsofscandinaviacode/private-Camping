"use client";

import { useState, useTransition } from "react";
import { Save, Send, Loader2, ChevronDown, ChevronRight, Pencil, Gauge, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateSessionDetails, resendGuestNotification } from "@/lib/actions";
import { bookingRefLabel } from "@/lib/booking-ref";
import { fmtMoney, type SessionDetailsInput } from "@/lib/settlement-shared";

interface SessionEditFormProps {
  sessionId: number;
  status: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  bookingRef: string;
  /** Booking number comes from the booking system — shown, not editable. */
  bookingRefLocked: boolean;
  notes: string;
  expectedCheckOut: string;
  startKwh: number | null;
  endKwh: number | null;
  startHeatingKwh: number | null;
  endHeatingKwh: number | null;
  hasHeatingMeter: boolean;
  startWaterLiters: number | null;
  endWaterLiters: number | null;
  pricePerKwhOverride: number | null;
  pricePerLiterWaterOverride: number | null;
  defaultPricePerKwh: number;
  defaultPricePerLiterWater: number;
  hasWaterMeter: boolean;
  /** Units without meters (most pitches) get no meter/price section at all. */
  hasElectricityMeter: boolean;
  isActive: boolean;
  /** A tick has read this meter — its start reading no longer drives billing. */
  startLocked: { el: boolean; heat: boolean; water: boolean };
}

const GUEST_KEYS = ["guestName", "guestEmail", "guestPhone", "bookingRef", "expectedCheckOut", "notes"] as const;
const MONEY_KEYS = [
  "startKwh", "endKwh", "startHeatingKwh", "endHeatingKwh", "startWaterLiters", "endWaterLiters",
  "pricePerKwhOverride", "pricePerLiterWaterOverride",
] as const;
type GuestKey = (typeof GUEST_KEYS)[number];
type MoneyKey = (typeof MONEY_KEYS)[number];

const numStr = (v: number | null) => (v !== null ? String(v) : "");

/** "12,5" → 12.5; "" → null; garbage → NaN. */
function parseNum(s: string): number | null {
  const t = s.replace(",", ".").trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

export function SessionEditForm(props: SessionEditFormProps) {
  const { sessionId, status, bookingRefLocked, hasHeatingMeter, hasWaterMeter, hasElectricityMeter, isActive, startLocked } = props;
  const isCompleted = status === "COMPLETED";
  const [isPending, startTransition] = useTransition();
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState("");
  // Collapsed by default — editing is a secondary action, and the full form
  // dominated the page when always open.
  const [expanded, setExpanded] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const initialGuest: Record<GuestKey, string> = {
    guestName: props.guestName,
    guestEmail: props.guestEmail,
    guestPhone: props.guestPhone,
    bookingRef: props.bookingRef,
    expectedCheckOut: props.expectedCheckOut,
    notes: props.notes,
  };
  const initialMoney: Record<MoneyKey, string> = {
    startKwh: numStr(props.startKwh),
    endKwh: numStr(props.endKwh),
    startHeatingKwh: numStr(props.startHeatingKwh),
    endHeatingKwh: numStr(props.endHeatingKwh),
    startWaterLiters: numStr(props.startWaterLiters),
    endWaterLiters: numStr(props.endWaterLiters),
    pricePerKwhOverride: numStr(props.pricePerKwhOverride),
    pricePerLiterWaterOverride: numStr(props.pricePerLiterWaterOverride),
  };
  // Baselines move forward after a save, so the next save diffs against it.
  const [guestBase, setGuestBase] = useState(initialGuest);
  const [guest, setGuest] = useState(initialGuest);
  const [moneyBase, setMoneyBase] = useState(initialMoney);
  const [money, setMoney] = useState(initialMoney);

  const [guestMsg, setGuestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [moneyMsg, setMoneyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmChange, setConfirmChange] = useState<{ before: number; after: number; data: SessionDetailsInput } | null>(null);

  function saveGuest() {
    const data: SessionDetailsInput = {};
    for (const k of GUEST_KEYS) {
      if (k === "bookingRef" && bookingRefLocked) continue;
      if (guest[k] !== guestBase[k]) data[k] = guest[k];
    }
    if (Object.keys(data).length === 0) {
      setGuestMsg({ ok: true, text: "Ingen ændringer at gemme." });
      return;
    }
    startTransition(async () => {
      setGuestMsg(null);
      try {
        const res = await updateSessionDetails(sessionId, data);
        if (res.ok) {
          setGuestBase(guest);
          setGuestMsg({ ok: true, text: res.message ?? "Gemt." });
        } else {
          setGuestMsg({ ok: false, text: res.message });
        }
      } catch {
        setGuestMsg({ ok: false, text: "Ændringerne kunne ikke gemmes. Prøv igen." });
      }
    });
  }

  function moneyDiff(): SessionDetailsInput | string {
    const data: SessionDetailsInput = {};
    for (const k of MONEY_KEYS) {
      if (money[k] === moneyBase[k]) continue;
      const v = parseNum(money[k]);
      if (Number.isNaN(v)) return "Målerstande og priser skal være tal.";
      data[k] = v;
    }
    return data;
  }

  function saveMoney(confirm: boolean, preset?: SessionDetailsInput) {
    const data = preset ?? moneyDiff();
    if (typeof data === "string") {
      setMoneyMsg({ ok: false, text: data });
      return;
    }
    if (Object.keys(data).length === 0) {
      setMoneyMsg({ ok: true, text: "Ingen ændringer at gemme." });
      return;
    }
    startTransition(async () => {
      setMoneyMsg(null);
      try {
        const res = await updateSessionDetails(sessionId, data, { confirm });
        if (res.ok) {
          setMoneyBase(money);
          setConfirmChange(null);
          setMoneyMsg({ ok: true, text: res.message ?? "Gemt." });
        } else if (res.needsConfirmation) {
          setConfirmChange({ before: res.before, after: res.after, data });
        } else {
          setConfirmChange(null);
          setMoneyMsg({ ok: false, text: res.message });
        }
      } catch {
        setMoneyMsg({ ok: false, text: "Ændringerne kunne ikke gemmes. Prøv igen." });
      }
    });
  }

  async function handleResend() {
    setResending(true);
    setResendMsg("");
    try {
      await resendGuestNotification(sessionId);
      setResendMsg("Sendt!");
      setTimeout(() => setResendMsg(""), 4000);
    } catch (e) {
      setResendMsg(e instanceof Error ? e.message : "Fejl ved afsendelse");
    } finally {
      setResending(false);
    }
  }

  const g = (key: GuestKey, value: string) => setGuest((v) => ({ ...v, [key]: value }));
  const m = (key: MoneyKey, value: string) => {
    setMoney((v) => ({ ...v, [key]: value }));
    setConfirmChange(null);
  };

  const meterInput = (key: MoneyKey, label: string, opts: { disabled?: boolean; placeholder?: string } = {}) => (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        inputMode="decimal"
        value={money[key]}
        onChange={(e) => m(key, e.target.value)}
        placeholder={opts.placeholder ?? "—"}
        disabled={opts.disabled}
        className="mt-1"
      />
    </div>
  );

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="px-5 py-4 flex items-center justify-between gap-3">
        <button
          className="flex items-center gap-2 text-left flex-1 min-w-0"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <Pencil className="h-4 w-4 text-muted-foreground shrink-0" />
          <h2 className="font-semibold truncate">Redigér booking</h2>
          {!expanded && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Gæst, kontakt, afrejse og noter
            </span>
          )}
        </button>
        <Button variant="outline" size="sm" onClick={handleResend} disabled={resending}>
          {resending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
          {resending ? "Sender..." : "Gensend"}
        </Button>
      </div>
      {resendMsg && (
        <div className={`mx-5 mb-3 text-sm p-2 rounded-lg ${resendMsg === "Sendt!" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
          {resendMsg}
        </div>
      )}
      {expanded && (
      <div className="p-5 pt-0 space-y-4 border-t border-border mt-1">
        {/* ── Gæst og ophold — never changes any amount ── */}
        <p className="text-xs font-medium text-muted-foreground pt-4">Gæst og ophold</p>
        <div>
          <Label className="text-sm text-muted-foreground">Gæstenavn</Label>
          <Input value={guest.guestName} onChange={(e) => g("guestName", e.target.value)} className="mt-1" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm text-muted-foreground">Email</Label>
            <Input
              type="email"
              value={guest.guestEmail}
              onChange={(e) => g("guestEmail", e.target.value)}
              placeholder="gæst@email.dk"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-sm text-muted-foreground">Telefon</Label>
            <Input
              type="tel"
              value={guest.guestPhone}
              onChange={(e) => g("guestPhone", e.target.value)}
              placeholder="+4512345678"
              className="mt-1"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm text-muted-foreground">Booking nr.</Label>
            {bookingRefLocked ? (
              <div className="mt-1 h-9 flex items-center px-3 rounded-md border border-border bg-muted/40 text-sm" title="Booking nr. hentes fra booking-systemet og kan ikke ændres">
                {bookingRefLabel(guestBase.bookingRef) || "—"}
              </div>
            ) : (
              <Input
                value={guest.bookingRef}
                onChange={(e) => g("bookingRef", e.target.value)}
                placeholder="BK-001"
                className="mt-1"
              />
            )}
          </div>
          <div>
            <Label className="text-sm text-muted-foreground">Forventet checkout</Label>
            <Input
              type="date"
              value={guest.expectedCheckOut}
              onChange={(e) => g("expectedCheckOut", e.target.value)}
              className="mt-1"
            />
          </div>
        </div>
        <div>
          <Label className="text-sm text-muted-foreground">Bemærkninger</Label>
          <textarea
            className="w-full h-20 text-sm border rounded-lg px-3 py-2 mt-1 bg-background text-foreground resize-none border-border"
            value={guest.notes}
            onChange={(e) => g("notes", e.target.value)}
            placeholder="Interne noter..."
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={saveGuest} disabled={isPending} size="sm">
            <Save className="h-4 w-4 mr-2" />
            {isPending ? "Gemmer..." : "Gem"}
          </Button>
          {guestMsg && (
            <span className={`text-sm ${guestMsg.ok ? "text-green-700" : "text-red-600"}`}>{guestMsg.text}</span>
          )}
        </div>

        {/* ── Målerstande og pris — changes money, so it is tucked away and confirmed ── */}
        {status !== "PENDING" && (hasElectricityMeter || hasWaterMeter) && (
          <div className="pt-3 border-t border-border">
            <button
              className="flex items-center gap-2 text-left text-sm font-medium"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
            >
              {advancedOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <Gauge className="h-4 w-4 text-muted-foreground" />
              Ret målerstande/pris (avanceret)
            </button>
            {advancedOpen && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                  {isCompleted
                    ? "Ændringer genberegner beløbet for opholdet. Du ser beløbet før og efter, inden det gemmes."
                    : "Opholdet afregnes ud fra løbende måling. Slutaflæsning sættes ved udtjek, og en ny pris gælder fra næste aflæsning."}
                </p>
                {hasElectricityMeter && (
                  <div className="grid grid-cols-2 gap-3">
                    {meterInput("startKwh", hasHeatingMeter ? "Hovedmåler start (kWh)" : "El start (kWh)", { disabled: isActive && startLocked.el })}
                    {isCompleted && meterInput("endKwh", hasHeatingMeter ? "Hovedmåler slut (kWh)" : "El slut (kWh)")}
                  </div>
                )}
                {hasHeatingMeter && (
                  <div className="grid grid-cols-2 gap-3">
                    {meterInput("startHeatingKwh", "Varme start (kWh)", { disabled: isActive && startLocked.heat })}
                    {isCompleted && meterInput("endHeatingKwh", "Varme slut (kWh)")}
                  </div>
                )}
                {hasWaterMeter && (
                  <div className="grid grid-cols-2 gap-3">
                    {meterInput("startWaterLiters", "Vand start (L)", { disabled: isActive && startLocked.water })}
                    {isCompleted && meterInput("endWaterLiters", "Vand slut (L)")}
                  </div>
                )}
                <div className={`grid gap-3 ${hasWaterMeter && hasElectricityMeter ? "grid-cols-2" : "grid-cols-1"}`}>
                  {hasElectricityMeter && meterInput("pricePerKwhOverride", isCompleted ? "Pris pr. kWh for opholdet" : "Pris pr. kWh fra nu", {
                    placeholder: `Standard: ${props.defaultPricePerKwh.toFixed(2)}`,
                  })}
                  {hasWaterMeter && meterInput("pricePerLiterWaterOverride", isCompleted ? "Pris pr. liter for opholdet" : "Pris pr. liter fra nu", {
                    placeholder: `Standard: ${props.defaultPricePerLiterWater.toFixed(2)}`,
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Tomt prisfelt = målt pris (spotpris/standardpris fra indstillingerne).
                </p>

                {confirmChange ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                    <p className="text-sm text-amber-900 flex items-start gap-1.5">
                      <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        Før <strong className="tabular-nums">{fmtMoney(confirmChange.before)}</strong> → efter{" "}
                        <strong className="tabular-nums">{fmtMoney(confirmChange.after)}</strong>
                      </span>
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => saveMoney(true, confirmChange.data)} disabled={isPending}>
                        {isPending ? "Gemmer..." : "Bekræft ændring"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmChange(null)} disabled={isPending}>
                        Annullér
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button onClick={() => saveMoney(false)} disabled={isPending} size="sm" variant="outline">
                    <Save className="h-4 w-4 mr-2" />
                    {isPending ? "Beregner..." : isCompleted ? "Beregn og gem" : "Gem"}
                  </Button>
                )}
                {moneyMsg && (
                  <p className={`text-sm ${moneyMsg.ok ? "text-green-700" : "text-red-600"}`}>{moneyMsg.text}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
