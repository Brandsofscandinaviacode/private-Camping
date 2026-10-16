// Check-in helpers shared by the server actions and the desk dialogs — plain
// module, safe on server and client.

import { siteDayKey } from "./format";

export type ReceiptTone = "ok" | "warn" | "error" | "info";

/** One step of a check-in and what really happened. */
export interface ReceiptLine {
  label: string;
  tone: ReceiptTone;
  text: string;
  /** Longer reason or what to do about it, shown in small print. */
  detail?: string;
}

export interface CheckInReceipt {
  sessionId: number;
  unitId: number;
  unitName: string;
  guestName: string;
  /** "/guest/<token>"; the page puts the public base URL in front. */
  portalPath: string;
  lines: ReceiptLine[];
}

export type CheckInResult =
  | { ok: true; message: string; receipt: CheckInReceipt; sessionId: number; guestPortalToken: string }
  | { ok: false; message: string };

export interface SendResult {
  ok: boolean;
  error?: string;
}

// Same wording in both check-in dialogs.
export const PREPAID_HINT =
  "Beløbet er betalt i kassen og trækkes af el, vand og køb af vask/bad under opholdet. Ubrugt beløb refunderes ikke.";
export const PREPAID_HINT_NO_METER =
  "Enheden har ingen målere, så forudbetalingen bruges kun til vask og bad. Ubrugt beløb refunderes ikke.";

export const LONG_STAY_WARN_NIGHTS = 60;

// ──────────────────────────────────────────────
// Dates — "YYYY-MM-DD" keys in the site's time zone
// ──────────────────────────────────────────────
const DAY_MS = 86_400_000;

export function todayKey(now: Date = new Date()): string {
  return siteDayKey(now)!;
}

export function addDaysToKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nightsBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS);
}

export function nightsLabel(n: number): string {
  return n === 1 ? "1 nat" : `${n} nætter`;
}

function isDateKey(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

/** Danish error for a planned checkout date, or null when it is fine. */
export function checkOutDateError(
  value: string | null | undefined,
  opts: { required: boolean; today?: string },
): string | null {
  if (!value) return opts.required ? "Vælg forventet udtjek." : null;
  if (!isDateKey(value)) return "Ugyldig dato for forventet udtjek.";
  if (value < (opts.today ?? todayKey())) return "Forventet udtjek kan ikke ligge før i dag.";
  return null;
}

export function prepaidAmountError(amount: number | null | undefined): string | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) {
    return "Skriv det beløb, gæsten har betalt (mere end 0 kr.).";
  }
  return null;
}

// ──────────────────────────────────────────────
// Welcome message (portal link by e-mail/SMS)
// ──────────────────────────────────────────────
export const HAND_OVER_HINT = "Giv gæsten portal-linket eller QR-koden ved skranken.";

/**
 * Turns the settings, the guest's contact details and the send result into
 * one receipt line. `sent` is true only when at least one channel delivered.
 */
export function describeWelcomeMessage(input: {
  emailEnabled: boolean;
  smsEnabled: boolean;
  guestEmail?: string | null;
  guestPhone?: string | null;
  result?: { email?: SendResult; sms?: SendResult } | null;
  error?: string | null;
}): { sent: boolean; line: ReceiptLine } {
  const label = "Velkomstbesked";
  if (input.error) {
    return { sent: false, line: { label, tone: "error", text: `Fejl – ${input.error}`, detail: HAND_OVER_HINT } };
  }
  if (!input.emailEnabled && !input.smsEnabled) {
    return {
      sent: false,
      line: { label, tone: "info", text: "Ikke sendt – e-mail og SMS er slået fra", detail: HAND_OVER_HINT },
    };
  }

  const sent: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  const channel = (
    name: "e-mail" | "SMS",
    enabled: boolean,
    address: string | null | undefined,
    r: SendResult | undefined,
    missing: string,
  ) => {
    if (!enabled) skipped.push(`${name} er slået fra`);
    else if (!address) skipped.push(missing);
    else if (r?.ok) sent.push(`${name} til ${address}`);
    else if (r) failed.push(`${name} fejlede (${r.error || "ukendt fejl"})`);
    else skipped.push(`${name} blev ikke sendt`);
  };
  channel("e-mail", input.emailEnabled, input.guestEmail, input.result?.email, "ingen e-mail på bookingen");
  channel("SMS", input.smsEnabled, input.guestPhone, input.result?.sms, "intet telefonnummer");

  const parts = [...sent, ...failed, ...skipped].join(" · ");
  if (sent.length > 0) {
    return { sent: true, line: { label, tone: failed.length ? "warn" : "ok", text: `Sendt – ${parts}` } };
  }
  return {
    sent: false,
    line: { label, tone: failed.length ? "error" : "warn", text: `Ikke sendt – ${parts}`, detail: HAND_OVER_HINT },
  };
}

/** Short summary for the top of a receipt. */
export function receiptMessage(lines: ReceiptLine[]): string {
  return lines.some((l) => l.tone === "error")
    ? "Gæsten er tjekket ind, men ikke alt lykkedes – se kvitteringen."
    : "Gæsten er tjekket ind.";
}
