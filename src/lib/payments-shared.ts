// The payments ledger as the desk sees it: methods, purposes, labels, amount
// parsing and the till summary ("Kasse i dag"). Plain module without prisma,
// safe on server and client. The database side lives in payments.ts.

import { SITE_TIME_ZONE, siteDayKey } from "./format";
import { PAYMENT_METHOD_LABELS, roundOre } from "./settlement-shared";

/** Ways money is taken at the desk. QUICKPAY (online card) only comes from the callback. */
export type DeskPaymentMethod = "CASH" | "MOBILEPAY" | "CARD_TERMINAL" | "BANK" | "OTHER";
export const DESK_PAYMENT_METHODS: DeskPaymentMethod[] = ["CASH", "MOBILEPAY", "CARD_TERMINAL", "BANK", "OTHER"];
/** Every method in the ledger, in till order. */
export const ALL_PAYMENT_METHODS = [...DESK_PAYMENT_METHODS, "QUICKPAY"] as const;

export function isDeskPaymentMethod(m: unknown): m is DeskPaymentMethod {
  return typeof m === "string" && (DESK_PAYMENT_METHODS as string[]).includes(m);
}

export function methodLabel(m: string | null | undefined): string {
  return (m && PAYMENT_METHOD_LABELS[m]) || m || "Ukendt";
}

/**
 * BALANCE    — money onto a prepaid balance (deposit, top-up) or, negative, unused balance paid back.
 * SETTLEMENT — paying what a checked-out stay owes.
 * INVOICE    — paying (part of) an invoice.
 * SERVICE    — laundry/shower/service credit at the desk (Services page).
 */
export type PaymentKind = "BALANCE" | "SETTLEMENT" | "INVOICE" | "SERVICE";
export const REGISTERABLE_KINDS: PaymentKind[] = ["BALANCE", "SETTLEMENT", "INVOICE"];

export interface RegisterPaymentInput {
  sessionId?: number | null;
  invoiceId?: number | null;
  /** DKK. Negative only for paying unused prepaid balance back (BALANCE). */
  amount: number;
  method: string;
  kind: string;
  note?: string | null;
}

export interface PaymentFilter {
  sessionId?: number;
  invoiceId?: number;
  /** One site day, "YYYY-MM-DD". */
  date?: string;
  method?: string;
  createdBy?: string;
  kind?: string;
  limit?: number;
}

export type PaymentActionResult =
  | { ok: true; message: string; paymentId: number; receiptPath: string | null }
  | { ok: false; message: string };

/** What a ledger row was for, in the desk's words ("Modpost: …" for a counter-entry). */
export function paymentPurposeLabel(p: { kind: string; amount: number; reversesId: number | null }): string {
  return p.reversesId != null ? `Modpost: ${paymentBasePurpose(p).toLowerCase()}` : paymentBasePurpose(p);
}

/** The purpose a counter-entry undoes — so the till nets each purpose. */
export function paymentBasePurpose(p: { kind: string; amount: number; reversesId: number | null }): string {
  const amount = p.reversesId != null ? -p.amount : p.amount;
  switch (p.kind) {
    case "BALANCE": return amount < 0 ? "Udbetalt af saldo" : "Indbetaling på saldo";
    case "SETTLEMENT": return "Betaling af ophold";
    case "INVOICE": return "Betaling af faktura";
    case "SERVICE": return amount < 0 ? "Refusion vask/bad" : "Vask/bad/servicekredit";
    default: return p.kind;
  }
}

/** Why a row can't be undone with "Fortryd", or null when it can. */
export function reverseBlock(p: { kind: string; method: string; reversesId: number | null; reversed: boolean }): string | null {
  if (p.reversesId != null) return "En modpost kan ikke fortrydes.";
  if (p.reversed) return "Betalingen er allerede fortrudt.";
  if (p.kind === "SERVICE") return "Vask og bad fortrydes under Services med 'Annullér og refundér'.";
  if (p.method === "QUICKPAY") return "Kortbetalinger online tilbageføres i QuickPay, ikke her.";
  return null;
}

/**
 * Rows written by one "Registrér betaling" share their timestamp: a stay's
 * payment is split over its open invoices and the stay itself, and "Fortryd"
 * undoes the whole registration. Null for rows that stand alone.
 */
export function paymentGroupKey(p: {
  sessionId: number | null;
  kind: string;
  createdAt: Date | string;
  createdBy: string | null;
  reversesId: number | null;
}): string | null {
  if (p.sessionId == null || p.reversesId != null) return null;
  if (p.kind !== "SETTLEMENT" && p.kind !== "INVOICE") return null;
  return `${p.sessionId}|${new Date(p.createdAt).getTime()}|${p.createdBy ?? ""}`;
}

// ──────────────────────────────────────────────
// Amounts typed at the desk
// ──────────────────────────────────────────────

/**
 * "500", "437,50", "1.234,50", "1234.5" → number; null when it isn't one.
 * A comma is the decimal mark; with a comma, dots are thousands separators.
 */
export function parseAmount(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (raw == null) return null;
  let s = String(raw).trim().replace(/\s|kr\.?|dkk/gi, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** 437.5 → "437,50" for an input field. */
export function amountInput(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  return v.toFixed(2).replace(".", ",");
}

// ──────────────────────────────────────────────
// Days in the site's time zone
// ──────────────────────────────────────────────
const offsetFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: SITE_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function siteOffsetMs(at: number): number {
  const parts = offsetFmt.formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at / 1000) * 1000;
}

export function isDayKey(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

/** Midnight of a "YYYY-MM-DD" day at the campsite, as an instant. */
export function siteMidnight(key: string): Date {
  const guess = Date.parse(`${key}T00:00:00Z`);
  let t = guess - siteOffsetMs(guess);
  t = guess - siteOffsetMs(t);
  return new Date(t);
}

export function shiftDayKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** [start, end) of a site day. */
export function siteDayRange(key: string): { start: Date; end: Date } {
  return { start: siteMidnight(key), end: siteMidnight(shiftDayKey(key, 1)) };
}

export function todaySiteKey(now: Date = new Date()): string {
  return siteDayKey(now)!;
}

// ──────────────────────────────────────────────
// Ledger rows for lists and the till
// ──────────────────────────────────────────────
export interface PaymentListRow {
  id: number;
  createdAt: string;
  amount: number;
  method: string;
  kind: string;
  purpose: string;
  /** For counter-entries, the purpose they undo. */
  basePurpose: string;
  note: string | null;
  createdBy: string | null;
  reversesId: number | null;
  reversed: boolean;
  /** The counter-entry, when this row was undone. */
  reversal: { at: string; by: string | null; note: string | null } | null;
  sessionId: number | null;
  invoiceId: number | null;
  guestName: string | null;
  unitName: string | null;
  externalId: string | null;
  /** Null when "Fortryd" is allowed. */
  reverseBlock: string | null;
  /** Other rows undone together with this one (same registration). */
  group: { count: number; total: number } | null;
}

export interface TillReport {
  date: string;
  prev: string;
  next: string | null;
  isToday: boolean;
  rows: PaymentListRow[];
  summary: TillSummary;
  campName: string | null;
}

/** A printable slip for one registration (deposit, payment or payout). */
export interface PaymentReceipt {
  payment: PaymentListRow;
  /** The rows of the registration (a stay payment split over invoices). */
  lines: { purpose: string; amount: number }[];
  total: number;
  camp: { name: string | null; address: string | null; cvr: string | null };
  guestName: string;
  unitName: string;
  bookingRef: string | null;
  sessionId: number;
  /** Prepaid stays: the balance now. */
  balance: { deposited: number; remaining: number } | null;
  /** What the stay still owes now (checked-out stays). */
  owedNow: number | null;
  currency: string;
}

export interface TillMethodTotal {
  method: string;
  label: string;
  /** Money received (positive rows). */
  received: number;
  /** Money paid back or reversed (negative rows, as a positive figure). */
  paidOut: number;
  net: number;
  count: number;
}

export interface TillSummary {
  byMethod: TillMethodTotal[];
  byUser: { user: string; net: number; count: number; byMethod: { method: string; label: string; net: number }[] }[];
  byPurpose: { purpose: string; net: number; count: number }[];
  /** Everything taken at the desk (all methods but online card). */
  deskNet: number;
  /** QuickPay — online, not in the till. */
  onlineNet: number;
  count: number;
}

/**
 * Totals per method, per user and per purpose (counter-entries net against
 * the purpose they undo). Pure — exported for tests.
 */
export function summarizeTill(rows: Pick<PaymentListRow, "amount" | "method" | "createdBy" | "basePurpose">[]): TillSummary {
  const byMethod = new Map<string, TillMethodTotal>();
  for (const m of ALL_PAYMENT_METHODS) {
    byMethod.set(m, { method: m, label: methodLabel(m), received: 0, paidOut: 0, net: 0, count: 0 });
  }
  const byUser = new Map<string, { user: string; net: number; count: number; methods: Map<string, number> }>();
  const byPurpose = new Map<string, { purpose: string; net: number; count: number }>();

  for (const r of rows) {
    const m = byMethod.get(r.method) ?? { method: r.method, label: methodLabel(r.method), received: 0, paidOut: 0, net: 0, count: 0 };
    if (r.amount >= 0) m.received += r.amount;
    else m.paidOut += -r.amount;
    m.net += r.amount;
    m.count++;
    byMethod.set(r.method, m);

    const userKey = r.createdBy || "Ukendt";
    const u = byUser.get(userKey) ?? { user: userKey, net: 0, count: 0, methods: new Map<string, number>() };
    u.net += r.amount;
    u.count++;
    u.methods.set(r.method, (u.methods.get(r.method) ?? 0) + r.amount);
    byUser.set(userKey, u);

    const p = byPurpose.get(r.basePurpose) ?? { purpose: r.basePurpose, net: 0, count: 0 };
    p.net += r.amount;
    p.count++;
    byPurpose.set(r.basePurpose, p);
  }

  const methods = [...byMethod.values()].map((m) => ({
    ...m,
    received: roundOre(m.received),
    paidOut: roundOre(m.paidOut),
    net: roundOre(m.net),
  }));
  const deskNet = roundOre(methods.filter((m) => m.method !== "QUICKPAY").reduce((t, m) => t + m.net, 0));
  const onlineNet = roundOre(methods.find((m) => m.method === "QUICKPAY")?.net ?? 0);

  return {
    byMethod: methods,
    byUser: [...byUser.values()]
      .sort((a, b) => a.user.localeCompare(b.user, "da"))
      .map((u) => ({
        user: u.user,
        net: roundOre(u.net),
        count: u.count,
        byMethod: [...u.methods.entries()].map(([method, net]) => ({ method, label: methodLabel(method), net: roundOre(net) })),
      })),
    byPurpose: [...byPurpose.values()].map((p) => ({ ...p, net: roundOre(p.net) })),
    deskNet,
    onlineNet,
    count: rows.length,
  };
}
