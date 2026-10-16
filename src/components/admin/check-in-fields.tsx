"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCheckInHardwareStatus } from "@/lib/actions";
import {
  LONG_STAY_WARN_NIGHTS,
  PREPAID_HINT,
  PREPAID_HINT_NO_METER,
  addDaysToKey,
  nightsBetween,
  nightsLabel,
  todayKey,
  type ReceiptLine,
} from "@/lib/check-in";
import type { DeskPaymentMethod } from "@/lib/payments-shared";
import { PaymentMethodPicker } from "./payment-dialog";

// Pieces shared by the walk-in and the booking check-in dialogs.

const TONES = {
  ok: { icon: CheckCircle2, cls: "text-green-600" },
  warn: { icon: AlertTriangle, cls: "text-amber-600" },
  error: { icon: XCircle, cls: "text-red-600" },
  info: { icon: Info, cls: "text-muted-foreground" },
} as const;

export function ReceiptLines({ lines }: { lines: ReceiptLine[] }) {
  return (
    <ul className="space-y-2">
      {lines.map((l, i) => {
        const tone = TONES[l.tone];
        const Icon = tone.icon;
        return (
          <li key={i} className="flex items-start gap-2 text-sm">
            <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${tone.cls}`} aria-hidden="true" />
            <div className="min-w-0">
              <p>
                <span className="text-muted-foreground">{l.label}: </span>
                <span className={l.tone === "error" ? "font-medium text-red-600" : ""}>{l.text}</span>
              </p>
              {l.detail && <p className="text-xs text-muted-foreground mt-0.5 break-words">{l.detail}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Live meter/relay status, fetched when the dialog opens. Only for units with hardware. */
export function HardwarePrecheck({ unitId }: { unitId: number }) {
  const [state, setState] = useState<{ lines: ReceiptLine[]; problem: boolean } | "loading" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    getCheckInHardwareStatus(unitId)
      .then((r) => { if (!cancelled) setState(r); })
      .catch(() => { if (!cancelled) setState("failed"); });
    return () => { cancelled = true; };
  }, [unitId]);

  if (state === "loading") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Tjekker måler og relæ…
      </p>
    );
  }
  if (state === "failed") {
    return <p className="text-xs text-muted-foreground">Kunne ikke tjekke måler og relæ. Kvitteringen viser bagefter, hvad der lykkedes.</p>;
  }
  return (
    <div className="space-y-2">
      <ReceiptLines lines={state.lines} />
      {state.problem && (
        <p className="text-xs text-amber-700">
          Strømmen kan måske ikke tændes, og startaflæsningen kan mangle. Du kan godt fortsætte – kvitteringen viser
          bagefter, hvad der lykkedes.
        </p>
      )}
    </div>
  );
}

export const TECHNICAL_ERROR =
  "Check-in fejlede på grund af en teknisk fejl. Prøv igen om lidt – sker det igen, så kontakt support.";

/** What happens with the portal link, from the live notification settings. */
export function WelcomeHint({ notify }: { notify: { email: boolean; sms: boolean } }) {
  const channels = [notify.email && "e-mail", notify.sms && "SMS"].filter(Boolean).join(" og ");
  return (
    <p className="text-xs text-muted-foreground">
      {channels
        ? `Gæsten får portal-linket på ${channels}, hvis kontaktoplysningen er udfyldt. Efter check-in ser du også linket og en QR-kode.`
        : "E-mail og SMS er slået fra, så intet sendes. Efter check-in får du portal-linket og en QR-kode, som du giver gæsten."}
    </p>
  );
}

export function NoHardwareNote() {
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <Info className="h-3.5 w-3.5 shrink-0" />
      Ingen måler/relæ på denne enhed – intet tændes eller aflæses.
    </p>
  );
}

export function BillingModeField({
  idPrefix,
  mode,
  onModeChange,
  amount,
  onAmountChange,
  method,
  onMethodChange,
  hasMeters,
}: {
  idPrefix: string;
  mode: "PREPAID" | "POSTPAID";
  onModeChange: (mode: "PREPAID" | "POSTPAID") => void;
  amount: string;
  onAmountChange: (amount: string) => void;
  /** How the deposit was paid — recorded in the till. */
  method: DeskPaymentMethod;
  onMethodChange: (method: DeskPaymentMethod) => void;
  hasMeters: boolean;
}) {
  const option = (value: "PREPAID" | "POSTPAID", title: string, hint: string) => (
    <button
      type="button"
      onClick={() => onModeChange(value)}
      aria-pressed={mode === value}
      className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
        mode === value
          ? "border-primary bg-primary/5 text-primary font-medium"
          : "border-border text-muted-foreground hover:border-foreground/20"
      }`}
    >
      {title}
      <span className="block text-xs mt-0.5 font-normal opacity-70">{hint}</span>
    </button>
  );

  return (
    <div className="space-y-2">
      <Label>Afregning</Label>
      <div className="flex gap-2">
        {option("POSTPAID", "Bagudbetalt", "Betaler ved udtjek")}
        {option("PREPAID", "Forudbetalt", "Har betalt i kassen nu")}
      </div>
      {mode === "PREPAID" && (
        <div>
          <Label htmlFor={`${idPrefix}-prepaid`}>Forudbetalt beløb (DKK) *</Label>
          <Input
            id={`${idPrefix}-prepaid`}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            required
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            placeholder="F.eks. 500"
            className="mt-1"
          />
          <div className="mt-2">
            <PaymentMethodPicker value={method} onChange={onMethodChange} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{hasMeters ? PREPAID_HINT : PREPAID_HINT_NO_METER}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Planned checkout with +1/+2/+7 nights, the resulting number of nights and
 * warnings for a past date or an unusually long stay.
 */
export function CheckOutDateField({
  id,
  value,
  onChange,
  fromKey,
  required,
  allowOpen = false,
  warnLong = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** First night of the stay ("YYYY-MM-DD"). */
  fromKey: string;
  required: boolean;
  allowOpen?: boolean;
  warnLong?: boolean;
}) {
  const today = todayKey();
  const past = !!value && value < today;
  const nights = value && !past ? nightsBetween(fromKey, value) : null;

  function addNights(n: number) {
    const start = fromKey > today ? fromKey : today;
    const base = value && value >= start ? value : start;
    onChange(addDaysToKey(base, n));
  }

  return (
    <div>
      <Label htmlFor={id}>Planlagt afrejse{required ? " *" : ""}</Label>
      <div className="flex flex-wrap items-center gap-2 mt-1">
        <Input
          id={id}
          type="date"
          min={today}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-auto"
        />
        <div className="flex gap-1">
          {[1, 2, 7].map((n) => (
            <Button key={n} type="button" variant="outline" size="sm" onClick={() => addNights(n)} title={`Læg ${nightsLabel(n)} til`}>
              +{n}
            </Button>
          ))}
        </div>
        {nights !== null && nights >= 0 && <span className="text-sm text-muted-foreground">{nightsLabel(nights)}</span>}
      </div>
      {past && <p className="text-xs text-red-600 mt-1">Datoen ligger før i dag.</p>}
      {warnLong && nights !== null && nights > LONG_STAY_WARN_NIGHTS && (
        <p className="text-xs text-amber-700 mt-1">Opholdet er {nightsLabel(nights)} – er datoen rigtig?</p>
      )}
      {allowOpen && !value && (
        <p className="text-xs text-muted-foreground mt-1">Tomt felt = åbent ophold uden planlagt afrejse (fastligger).</p>
      )}
    </div>
  );
}
