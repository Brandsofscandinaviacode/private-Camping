// Fixing desk mistakes on a stay: cancel / no-show, change unit, undo a
// check-in or check-out, change the departure. Rules, periods and wording
// shared by the server actions (stay-actions.ts) and the dialogs. Plain
// module, safe on server and client.

import { SITE_TIME_ZONE, fmtShortDate, siteDayKey } from "./format";
import { addDaysToKey } from "./check-in";
import type { ReceiptLine } from "./check-in";

// ── Cancel / no-show ─────────────────────────

export const CANCEL_REASONS = ["CANCELLED", "NO_SHOW"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export function isCancelReason(v: unknown): v is CancelReason {
  return typeof v === "string" && (CANCEL_REASONS as readonly string[]).includes(v);
}

/** "Annulleret" / "Udeblevet" — cancelledAt without a reason counts as cancelled. */
export function cancelReasonLabel(reason: string | null | undefined): string {
  return reason === "NO_SHOW" ? "Udeblevet" : "Annulleret";
}

// ── Undo windows ─────────────────────────────

export const UNDO_CHECK_IN_MINUTES = 30;
export const UNDO_CHECK_OUT_HOURS = 24;

/** Until when "Fortryd check-in" is offered — counted from when the desk checked the guest in. */
export function undoCheckInDeadline(s: { checkInRecordedAt: Date | null; checkInTime: Date }): Date {
  return new Date((s.checkInRecordedAt ?? s.checkInTime).getTime() + UNDO_CHECK_IN_MINUTES * 60_000);
}

/** Until when "Fortryd udtjek" is offered — counted from the check-out itself, not the (earlier) departure. */
export function undoCheckOutDeadline(s: { checkOutRecordedAt: Date | null; checkOutTime: Date | null }): Date | null {
  const at = s.checkOutRecordedAt ?? s.checkOutTime;
  return at ? new Date(at.getTime() + UNDO_CHECK_OUT_HOURS * 3_600_000) : null;
}

// ── Periods and conflicts ────────────────────
// A stay as site-local days [from, to): the departure day is free for the
// next guest. to = null is open-ended.

export interface DayRange {
  from: string;
  to: string | null;
}

/** "2026-10-18" → a timestamp on that day, for the date formatters. */
export function dayKeyDate(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}

/**
 * The days a stay holds its unit. A checked-in guest holds it from today
 * until the planned departure (an overdue one at least until tomorrow; no
 * departure = open). A reservation holds arrival → departure (one night when
 * it has none).
 */
export function stayDayRange(
  s: { status: string; checkInTime: Date; expectedCheckOut: Date | null },
  today: string,
): DayRange {
  const arrival = siteDayKey(s.checkInTime)!;
  const departure = siteDayKey(s.expectedCheckOut);
  if (s.status === "ACTIVE") {
    const from = arrival < today ? arrival : today;
    if (!departure) return { from, to: null };
    const minTo = addDaysToKey(today, 1);
    return { from, to: departure > minTo ? departure : minTo };
  }
  return { from: arrival, to: departure && departure > arrival ? departure : addDaysToKey(arrival, 1) };
}

export function rangesOverlap(a: DayRange, b: DayRange): boolean {
  return (b.to === null || a.from < b.to) && (a.to === null || b.from < a.to);
}

/** Another stay that holds the same unit in the period. */
export interface StayConflict {
  sessionId: number;
  guestName: string;
  status: "ACTIVE" | "PENDING";
  unitName: string;
  from: string;
  to: string | null;
}

/** "Plads 44 er reserveret til Hansen 18. okt.–20. okt." */
export function conflictText(c: StayConflict): string {
  if (c.status === "ACTIVE") {
    return `${c.unitName} er optaget af ${c.guestName}${c.to ? ` (planlagt afrejse ${fmtShortDate(dayKeyDate(c.to))})` : ""}`;
  }
  const period = c.to
    ? `${fmtShortDate(dayKeyDate(c.from))}–${fmtShortDate(dayKeyDate(c.to))}`
    : `fra ${fmtShortDate(dayKeyDate(c.from))}`;
  return `${c.unitName} er reserveret til ${c.guestName} ${period}`;
}

/** Conflicts as one sentence — the dates already end in "okt.". */
export function conflictSentence(conflicts: StayConflict[]): string {
  const text = conflicts.map(conflictText).join(" · ");
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

// ── Change unit ──────────────────────────────

export type MoveTargetState = "free" | "occupied" | "reserved";

export interface MoveTarget {
  id: number;
  name: string;
  group: string;
  state: MoveTargetState;
  /** Why it isn't simply free, in the desk's words. */
  conflicts: string[];
  /** The stay's own unit. */
  current: boolean;
  hasHardware: boolean;
}

export interface StayReceipt {
  sessionId: number;
  title: string;
  summary: string;
  lines: ReceiptLine[];
}

export type StayActionResult =
  | { ok: true; message: string; receipt?: StayReceipt }
  | { ok: false; message: string; conflicts?: string[]; needsConfirmation?: boolean };

// ── Interim invoice ("Lav mellemfaktura") ────

export interface StayInvoicePreview {
  periodStart: Date;
  periodEnd: Date;
  /** The unit has an el meter: el/water come from the running meter billing. */
  metered: boolean;
  /** Metered el/water not invoiced yet (spot-weighted, as on the statement). */
  electricityCost: number;
  waterCost: number;
  /** Laundry/shower on the bill in the period. */
  servicesCost: number;
  /** Unit without an el meter: last reading the desk entered, and where it came from. */
  previousKwh: number | null;
  previousKwhSource: "invoice" | "stay" | null;
  /** Price options for a hand reading. */
  fixedPricePerKwh: number;
  effectivePricePerKwh: number | null;
  priceOverride: number | null;
  currency: string;
  invoiceCount: number;
  lastInvoiceAt: Date | null;
}

/** Plausibility limit for one hand reading (a pitch on 16 A all month is ~8.000 kWh). */
export const MAX_MANUAL_KWH = 20_000;

/** A month after the last interim invoice (or check-in) the stay is due for the next. */
export function nextMonthlyInvoiceDue(from: Date): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d;
}

// ── Actual departure ─────────────────────────

const inputFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: SITE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** A time as a datetime-local value in the site's time zone: "2026-10-16T08:37". */
export function siteDateTimeInput(d: Date): string {
  const p = Object.fromEntries(inputFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Offset of the site's time zone from UTC at an instant, in ms. */
function siteOffsetMs(at: number): number {
  const p = Object.fromEntries(inputFmt.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return asUtc - Math.floor(at / 60_000) * 60_000;
}

/** "2026-09-12T12:00" read as site-local time (independent of the server's zone). */
export function parseSiteDateTime(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = guess - siteOffsetMs(guess);
  const again = guess - siteOffsetMs(t);
  if (again !== t) t = again;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) || siteDateTimeInput(d) !== value.trim() ? null : d;
}
