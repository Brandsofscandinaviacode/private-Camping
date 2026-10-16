"use server";

// Desk payments: "Registrér betaling", "Fortryd", the payment lists, the
// receipt slip and "Kasse i dag". Every export is a public endpoint and starts
// with requireAuth(); the ledger itself lives in payments.ts.

import { revalidatePath } from "next/cache";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { requireAuth } from "./auth";
import { readGlobalSettings } from "./settings";
import { logger } from "./logger";
import { unitDisplayName } from "./utils";
import { computeSettlement } from "./settlement";
import { PaymentError, invoiceNet, registerPaymentCore, reversePaymentCore } from "./payments";
import { addDaysToKey, todayKey } from "./check-in";
import {
  isDayKey,
  paymentBasePurpose,
  paymentGroupKey,
  paymentPurposeLabel,
  reverseBlock,
  siteDayRange,
  summarizeTill,
  type PaymentActionResult,
  type PaymentFilter,
  type PaymentListRow,
  type PaymentReceipt,
  type RegisterPaymentInput,
  type TillReport,
} from "./payments-shared";

const UNEXPECTED = "Betalingen kunne ikke gemmes. Prøv igen — fortsætter fejlen, så se loggen.";

function username(auth: { username?: string }): string {
  return auth.username || "admin";
}

function revalidateMoney(sessionId: number | null) {
  // The layout carries the unpaid badge; the booking, statement and till show the rows.
  revalidatePath("/admin", "layout");
  if (sessionId) {
    revalidatePath(`/admin/bookings/${sessionId}`);
    revalidatePath(`/admin/bookings/${sessionId}/statement`);
  }
  revalidatePath("/admin/economy/kasse");
}

function optionalId(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}

/** "Registrér betaling": deposit/top-up, payout, stay payment or invoice payment. */
export async function registerPayment(input: RegisterPaymentInput): Promise<PaymentActionResult> {
  const auth = await requireAuth();
  const sessionId = optionalId(input?.sessionId);
  const invoiceId = optionalId(input?.invoiceId);
  if (Number.isNaN(sessionId) || Number.isNaN(invoiceId)) return { ok: false, message: "Ugyldigt ophold eller faktura." };
  try {
    const res = await registerPaymentCore(
      {
        sessionId,
        invoiceId,
        amount: Number(input.amount),
        method: String(input.method ?? ""),
        kind: String(input.kind ?? ""),
        note: typeof input.note === "string" ? input.note : null,
      },
      username(auth),
    );
    revalidateMoney(res.sessionId);
    return {
      ok: true,
      message: res.message,
      paymentId: res.paymentId,
      receiptPath: res.sessionId ? `/admin/bookings/${res.sessionId}/receipt/${res.paymentId}` : null,
    };
  } catch (e) {
    if (e instanceof PaymentError) return { ok: false, message: e.message };
    logger.error("payment", "registerPayment fejlede", e);
    return { ok: false, message: UNEXPECTED };
  }
}

/** "Fortryd": a counter-entry for the payment (and the rest of its registration). */
export async function reversePayment(paymentId: number, reason: string): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const auth = await requireAuth();
  if (!Number.isInteger(paymentId) || paymentId <= 0) return { ok: false, message: "Betalingen findes ikke." };
  try {
    const res = await reversePaymentCore(paymentId, String(reason ?? ""), username(auth));
    revalidateMoney(res.sessionId);
    return { ok: true, message: res.message };
  } catch (e) {
    if (e instanceof PaymentError) return { ok: false, message: e.message };
    logger.error("payment", `reversePayment ${paymentId} fejlede`, e);
    return { ok: false, message: "Betalingen kunne ikke fortrydes. Prøv igen." };
  }
}

const listInclude = {
  session: { select: { guestName: true, unit: { select: { name: true, type: true } } } },
  invoice: { select: { unit: { select: { name: true, type: true } } } },
} as const;

type ListPayment = Awaited<ReturnType<typeof loadPayments>>[number];

function loadPayments(where: Prisma.PaymentWhereInput, take: number) {
  return prisma.payment.findMany({ where, include: listInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take });
}

/** Ledger rows with who/what, whether they were undone and whether "Fortryd" applies. */
async function toListRows(payments: ListPayment[]): Promise<PaymentListRow[]> {
  const reversals = payments.length
    ? await prisma.payment.findMany({
        where: { reversesId: { in: payments.map((p) => p.id) } },
        select: { reversesId: true, createdAt: true, createdBy: true, note: true },
      })
    : [];
  const reversalOf = new Map(reversals.map((r) => [r.reversesId!, r]));
  const groups = new Map<string, { count: number; total: number }>();
  for (const p of payments) {
    const key = paymentGroupKey(p);
    if (!key || reversalOf.has(p.id)) continue;
    const g = groups.get(key) ?? { count: 0, total: 0 };
    g.count++;
    g.total = Math.round((g.total + p.amount) * 100) / 100;
    groups.set(key, g);
  }

  return payments.map((p) => {
    const reversal = reversalOf.get(p.id) ?? null;
    const unit = p.session?.unit ?? p.invoice?.unit ?? null;
    const key = paymentGroupKey(p);
    const group = key ? groups.get(key) ?? null : null;
    return {
      id: p.id,
      createdAt: p.createdAt.toISOString(),
      amount: p.amount,
      method: p.method,
      kind: p.kind,
      purpose: paymentPurposeLabel(p),
      basePurpose: paymentBasePurpose(p),
      note: p.note,
      createdBy: p.createdBy,
      reversesId: p.reversesId,
      reversed: !!reversal,
      reversal: reversal ? { at: reversal.createdAt.toISOString(), by: reversal.createdBy, note: reversal.note } : null,
      sessionId: p.sessionId,
      invoiceId: p.invoiceId,
      guestName: p.session?.guestName ?? null,
      unitName: unit ? unitDisplayName(unit.type, unit.name) : null,
      externalId: p.externalId,
      reverseBlock: reverseBlock({ ...p, reversed: !!reversal }),
      group: group && group.count > 1 ? group : null,
    };
  });
}

/** Payments by stay, invoice, day, method, user or purpose — newest first. */
export async function listPayments(filter: PaymentFilter = {}): Promise<PaymentListRow[]> {
  await requireAuth();
  const where: Prisma.PaymentWhereInput = {};
  if (filter.sessionId) where.sessionId = Number(filter.sessionId);
  if (filter.invoiceId) where.invoiceId = Number(filter.invoiceId);
  if (filter.method) where.method = String(filter.method);
  if (filter.createdBy) where.createdBy = String(filter.createdBy);
  if (filter.kind) where.kind = String(filter.kind);
  if (filter.date && isDayKey(filter.date)) {
    const { start, end } = siteDayRange(filter.date);
    where.createdAt = { gte: start, lt: end };
  }
  const take = Math.min(Math.max(Number(filter.limit) || 200, 1), 1000);
  return toListRows(await loadPayments(where, take));
}

/** "Kasse i dag": one site day's payments, totalled per method, user and purpose. */
export async function getTillReport(date?: string): Promise<TillReport> {
  await requireAuth();
  const today = todayKey();
  const day = date && isDayKey(date) && date <= today ? date : today;
  const { start, end } = siteDayRange(day);
  const [payments, settings] = await Promise.all([
    loadPayments({ createdAt: { gte: start, lt: end } }, 2000),
    readGlobalSettings(),
  ]);
  const rows = await toListRows(payments);
  return {
    date: day,
    prev: addDaysToKey(day, -1),
    next: day < today ? addDaysToKey(day, 1) : null,
    isToday: day === today,
    rows,
    summary: summarizeTill(rows),
    campName: settings.camp_name?.trim() || null,
  };
}

/** What has been paid on each invoice (net of counter-entries). */
export async function getInvoicePaidAmounts(invoiceIds: number[]): Promise<Record<number, number>> {
  await requireAuth();
  const ids = [...new Set(invoiceIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 100);
  const out: Record<number, number> = {};
  for (const id of ids) out[id] = await invoiceNet(prisma, id);
  return out;
}

/** The printable slip for one registration on a stay. */
export async function getPaymentReceipt(sessionId: number, paymentId: number): Promise<PaymentReceipt | null> {
  await requireAuth();
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: listInclude });
  if (!p || p.sessionId !== sessionId) return null;
  const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { unit: { select: { name: true, type: true } } } });
  if (!session) return null;

  const key = paymentGroupKey(p);
  const siblings = key
    ? await prisma.payment.findMany({
        where: { sessionId, createdAt: p.createdAt, createdBy: p.createdBy, reversesId: null, kind: { in: ["SETTLEMENT", "INVOICE"] } },
        include: listInclude,
        orderBy: { id: "asc" },
      })
    : [p];
  const [row] = await toListRows([p]);
  const [settlement, settings] = await Promise.all([computeSettlement(sessionId), readGlobalSettings()]);
  const total = Math.round(siblings.reduce((t, x) => t + x.amount, 0) * 100) / 100;

  return {
    payment: row,
    lines: siblings.map((x) => ({
      purpose: x.kind === "INVOICE" && x.invoiceId ? `Faktura nr. ${x.invoiceId}` : paymentPurposeLabel(x),
      amount: x.amount,
    })),
    total,
    camp: {
      name: settings.camp_name?.trim() || null,
      address: settings.camp_address?.trim() || null,
      cvr: settings.camp_cvr?.trim() || null,
    },
    guestName: session.guestName,
    unitName: unitDisplayName(session.unit.type, session.unit.name),
    bookingRef: session.bookingRef,
    sessionId,
    balance: settlement?.prepaid
      ? { deposited: settlement.prepaid.deposited, remaining: settlement.prepaid.remaining }
      : null,
    owedNow: settlement && settlement.sessionStatus === "COMPLETED" ? settlement.owed : null,
    currency: settlement?.currency ?? "DKK",
  };
}
