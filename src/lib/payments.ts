// The payments ledger: every krone taken or paid back at the desk (and online
// via QuickPay) is a Payment row with amount, method, purpose, who and when.
// Mistakes are undone with a counter-entry, never by deleting.
//
// Plain server module (NOT a server action): no auth check — callers pass the
// admin's username and guard access. Expected problems throw PaymentError with
// a Danish message for the desk.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { resolvePrepaidDeposited, restorePrepaidPowerIfFunded } from "./prepaid";
import { computeSettlement, syncPaymentStatus } from "./settlement";
import { DUE_THRESHOLD, fmtMoney, roundOre } from "./settlement-shared";
import {
  isDeskPaymentMethod,
  methodLabel,
  paymentGroupKey,
  reverseBlock,
  type RegisterPaymentInput,
} from "./payments-shared";

export class PaymentError extends Error {}

const CHANGED = "Betalingerne på opholdet er ændret imens. Genindlæs siden og prøv igen.";

export interface RegisteredPayment {
  paymentId: number;
  sessionId: number | null;
  message: string;
}

type Db = Pick<Prisma.TransactionClient, "payment">;

/** Count + sum of a stay's ledger rows — to notice a concurrent registration. */
async function ledgerStamp(tx: Db, sessionId: number): Promise<string> {
  const agg = await tx.payment.aggregate({ where: { sessionId }, _count: { _all: true }, _sum: { amount: true } });
  return `${agg._count._all}|${roundOre(agg._sum.amount ?? 0)}`;
}

/** Net of the INVOICE rows on an invoice. */
export async function invoiceNet(tx: Db, invoiceId: number): Promise<number> {
  const agg = await tx.payment.aggregate({ where: { invoiceId, kind: "INVOICE" }, _sum: { amount: true } });
  return roundOre(agg._sum.amount ?? 0);
}

/**
 * Invoice status follows its payments: PAID once less than 1 kr is left,
 * back to PENDING when a payment on a paid invoice is undone. Only called for
 * invoices whose payments just changed — older invoices marked paid without
 * a ledger row keep their status.
 */
async function syncInvoiceStatus(tx: Prisma.TransactionClient, invoiceId: number, at: Date): Promise<void> {
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { totalAmount: true, status: true } });
  if (!inv) return;
  const net = await invoiceNet(tx, invoiceId);
  const settled = net > 0.005 && inv.totalAmount - net < DUE_THRESHOLD;
  if (settled && inv.status !== "PAID") {
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: "PAID", paidAt: at } });
  } else if (!settled && inv.status === "PAID") {
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: "PENDING", paidAt: null } });
  }
}

/**
 * The stay an invoice belongs to: the stay it was made for, or for older and
 * unit-level invoices the postpaid stay on the unit overlapping its period.
 */
export async function resolveInvoiceStay(
  invoice: { unitId: number; periodStart: Date; periodEnd: Date; sessionId?: number | null },
): Promise<number | null> {
  if (invoice.sessionId != null) return invoice.sessionId;
  const stays = await prisma.session.findMany({
    where: {
      unitId: invoice.unitId,
      status: { in: ["ACTIVE", "COMPLETED"] },
      billingMode: { not: "PREPAID" },
      checkInTime: { lt: invoice.periodEnd },
      OR: [{ checkOutTime: null }, { checkOutTime: { gt: invoice.periodStart } }],
    },
    orderBy: { checkInTime: "desc" },
    select: { id: true },
    take: 1,
  });
  return stays[0]?.id ?? null;
}

function cleanNote(note: string | null | undefined): string | null {
  const n = note?.trim();
  return n ? n.slice(0, 500) : null;
}

/** Largest single amount accepted at the desk (typo guard). */
export const MAX_DESK_AMOUNT = 100_000;

/** Validates and writes one desk registration. */
export async function registerPaymentCore(
  input: RegisterPaymentInput,
  by: string,
): Promise<RegisteredPayment> {
  const amount = roundOre(Number(input.amount));
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) throw new PaymentError("Skriv et beløb større end 0 kr.");
  // A typo guard, not a business rule: 5000 instead of 500 is fine, 10.000.000 isn't.
  if (Math.abs(amount) > MAX_DESK_AMOUNT) {
    throw new PaymentError(`Beløbet er urealistisk stort (over ${MAX_DESK_AMOUNT.toLocaleString("da-DK")} kr.) — tjek tastningen.`);
  }
  if (!isDeskPaymentMethod(input.method)) throw new PaymentError("Vælg hvordan der er betalt.");
  const note = cleanNote(input.note);
  const method = input.method;

  switch (input.kind) {
    case "BALANCE":
      if (!input.sessionId) throw new PaymentError("Vælg opholdet.");
      return amount > 0
        ? depositToBalance(input.sessionId, amount, method, note, by)
        : refundBalance(input.sessionId, -amount, method, note, by);
    case "SETTLEMENT":
      if (!input.sessionId) throw new PaymentError("Vælg opholdet.");
      if (amount < 0) throw new PaymentError("Beløbet skal være positivt.");
      return settleStay(input.sessionId, amount, method, note, by);
    case "INVOICE":
      if (!input.invoiceId) throw new PaymentError("Vælg fakturaen.");
      if (amount < 0) throw new PaymentError("Beløbet skal være positivt.");
      return recordInvoicePayment(input.invoiceId, amount, method, note, by);
    default:
      throw new PaymentError("Vask og bad registreres under Services.");
  }
}

// ──────────────────────────────────────────────
// Prepaid balance: deposit / top-up and paying unused balance back
// ──────────────────────────────────────────────

/**
 * Money onto a running prepaid stay's balance. The row and the balance change
 * in one transaction, with increments, so a concurrent laundry/shower draw is
 * never lost.
 */
export async function depositToBalance(
  sessionId: number,
  amount: number,
  method: string,
  note: string | null,
  by: string,
): Promise<RegisteredPayment> {
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, billingMode: true, prepaidAmount: true, prepaidDeposited: true },
  });
  if (!s) throw new PaymentError("Opholdet findes ikke.");
  if (s.billingMode !== "PREPAID") throw new PaymentError("Opholdet er ikke forudbetalt. Betalingen registreres som afregning efter udtjek.");
  if (s.status === "PENDING") throw new PaymentError("Gæsten er ikke tjekket ind. Forudbetalingen registreres ved check-in.");
  if (s.status !== "ACTIVE") throw new PaymentError("Opholdet er tjekket ud. Registrér betalingen som afregning af opholdet.");

  // An increment on a NULL column stays NULL in SQLite: legacy rows get an
  // absolute value once.
  const depositedBase = s.prepaidDeposited == null ? await resolvePrepaidDeposited(s) : null;
  const payment = await prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: sessionId },
      data: {
        prepaidAmount: s.prepaidAmount == null ? amount : { increment: amount },
        prepaidDeposited: depositedBase == null ? { increment: amount } : depositedBase + amount,
      },
    });
    return tx.payment.create({
      data: { sessionId, amount, method, kind: "BALANCE", note, createdBy: by },
    });
  });
  logger.info("payment", `Ophold ${sessionId}: ${fmtMoney(amount)} indbetalt på saldo (${methodLabel(method)}) af ${by}`);
  await restorePrepaidPowerIfFunded(sessionId);
  return { paymentId: payment.id, sessionId, message: `${fmtMoney(amount)} indbetalt på saldoen · ${methodLabel(method)}` };
}

/**
 * Unused prepaid balance paid back to the guest after check-out — a negative
 * BALANCE row. The balance itself is left as it was: the settlement subtracts
 * what was paid back from the unused balance (refundDue).
 */
async function refundBalance(sessionId: number, amount: number, method: string, note: string | null, by: string): Promise<RegisteredPayment> {
  const s = await prisma.session.findUnique({ where: { id: sessionId }, select: { status: true, billingMode: true } });
  if (!s) throw new PaymentError("Opholdet findes ikke.");
  if (s.billingMode !== "PREPAID") throw new PaymentError("Kun forudbetalte ophold har en saldo at udbetale.");
  if (s.status !== "COMPLETED") throw new PaymentError("Ubrugt saldo udbetales først, når gæsten er tjekket ud.");
  const settlement = await computeSettlement(sessionId);
  if (!settlement) throw new PaymentError("Opholdet findes ikke.");
  if (settlement.refundDue < 0.005) throw new PaymentError("Der er ingen ubrugt saldo at udbetale.");
  if (amount > settlement.refundDue + 0.005) {
    throw new PaymentError(`Der er kun ${fmtMoney(settlement.refundDue, settlement.currency)} ubrugt saldo at udbetale.`);
  }

  const stampBefore = await ledgerStamp(prisma, sessionId);
  const payment = await prisma.$transaction(async (tx) => {
    if ((await ledgerStamp(tx, sessionId)) !== stampBefore) throw new PaymentError(CHANGED);
    return tx.payment.create({
      data: { sessionId, amount: -amount, method, kind: "BALANCE", note, createdBy: by },
    });
  });
  await syncPaymentStatus(sessionId);
  logger.info("payment", `Ophold ${sessionId}: ${fmtMoney(amount)} ubrugt saldo udbetalt (${methodLabel(method)}) af ${by}`);
  return { paymentId: payment.id, sessionId, message: `${fmtMoney(amount)} udbetalt · ${methodLabel(method)}` };
}

// ──────────────────────────────────────────────
// A checked-out stay's bill
// ──────────────────────────────────────────────

/**
 * What a checked-out stay owes, paid in full or in part. Open invoices of the
 * stay are paid first (oldest first), the rest goes on the stay itself; all
 * rows of one registration share their timestamp so "Fortryd" undoes them
 * together.
 */
async function settleStay(sessionId: number, amount: number, method: string, note: string | null, by: string): Promise<RegisteredPayment> {
  const s = await prisma.session.findUnique({ where: { id: sessionId }, select: { status: true, billingMode: true } });
  if (!s) throw new PaymentError("Opholdet findes ikke.");
  if (s.status === "PENDING") throw new PaymentError("Gæsten er ikke tjekket ind.");
  if (s.status === "ACTIVE") {
    throw new PaymentError(
      s.billingMode === "PREPAID"
        ? "Gæsten er stadig tjekket ind — brug 'Tilføj indbetaling' på saldoen."
        : "Opholdet er stadig i gang. Betalingen registreres, når gæsten er tjekket ud.",
    );
  }
  const settlement = await computeSettlement(sessionId);
  if (!settlement) throw new PaymentError("Opholdet findes ikke.");
  const cur = settlement.currency;
  if (settlement.owed <= 0) throw new PaymentError("Der er intet at betale på opholdet.");
  if (amount > settlement.owed + 0.005) {
    throw new PaymentError(
      `Beløbet er højere end det skyldige (${fmtMoney(settlement.owed, cur)}). Registrér det skyldige beløb — byttepenge udregnes under "Modtaget".`,
    );
  }

  // Remaining per open invoice, from the rows the settlement saw.
  const parts: { invoiceId: number | null; amount: number }[] = [];
  let left = amount;
  for (const inv of settlement.invoices.filter((i) => i.status !== "PAID")) {
    if (left < 0.005) break;
    const paidOnIt = settlement.payments
      .filter((p) => p.kind === "INVOICE" && p.invoiceId === inv.id)
      .reduce((t, p) => t + p.amount, 0);
    const rest = roundOre(inv.totalAmount - paidOnIt);
    if (rest < 0.005) continue;
    const take = roundOre(Math.min(left, rest));
    parts.push({ invoiceId: inv.id, amount: take });
    left = roundOre(left - take);
  }
  if (left >= 0.005) parts.push({ invoiceId: null, amount: left });

  const stampBefore = await ledgerStamp(prisma, sessionId);
  const at = new Date();
  const ids = await prisma.$transaction(async (tx) => {
    if ((await ledgerStamp(tx, sessionId)) !== stampBefore) throw new PaymentError(CHANGED);
    const created: number[] = [];
    for (const part of parts) {
      const row = await tx.payment.create({
        data: {
          sessionId,
          invoiceId: part.invoiceId,
          amount: part.amount,
          method,
          kind: part.invoiceId != null ? "INVOICE" : "SETTLEMENT",
          note,
          createdBy: by,
          createdAt: at,
        },
      });
      created.push(row.id);
      if (part.invoiceId != null) await syncInvoiceStatus(tx, part.invoiceId, at);
    }
    return created;
  });
  const after = await syncPaymentStatus(sessionId);
  const rest = after?.owed ?? 0;
  logger.info("payment", `Ophold ${sessionId}: ${fmtMoney(amount, cur)} betalt (${methodLabel(method)}) af ${by}${rest > 0 ? `, mangler ${fmtMoney(rest, cur)}` : ""}`);
  return {
    paymentId: ids[ids.length - 1],
    sessionId,
    message: `${fmtMoney(amount, cur)} registreret · ${methodLabel(method)}${rest > 0 ? ` — mangler ${fmtMoney(rest, cur)}` : " — opholdet er betalt"}`,
  };
}

// ──────────────────────────────────────────────
// Invoices
// ──────────────────────────────────────────────
/** What is left to pay on an invoice after its ledger rows. */
export async function invoiceRemaining(invoice: { id: number; totalAmount: number }): Promise<number> {
  return roundOre(invoice.totalAmount - (await invoiceNet(prisma, invoice.id)));
}

/** A desk payment on one invoice ("REST" = whatever is left). */
export async function recordInvoicePayment(
  invoiceId: number,
  amount: number | "REST",
  method: string,
  note: string | null,
  by: string,
): Promise<RegisteredPayment> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, unitId: true, sessionId: true, periodStart: true, periodEnd: true, totalAmount: true, status: true },
  });
  if (!inv) throw new PaymentError("Fakturaen findes ikke.");
  if (inv.status === "PAID") throw new PaymentError("Fakturaen er allerede betalt.");
  const rest = roundOre(inv.totalAmount - (await invoiceNet(prisma, invoiceId)));
  if (rest < 0.005) throw new PaymentError("Der er intet tilbage at betale på fakturaen.");
  const value = amount === "REST" ? rest : amount;
  if (value > rest + 0.005) {
    throw new PaymentError(`Der mangler kun ${fmtMoney(rest)} på fakturaen.`);
  }
  const sessionId = await resolveInvoiceStay(inv);

  const at = new Date();
  const payment = await prisma.$transaction(async (tx) => {
    // Paid twice at once (double click, second screen)?
    const fresh = roundOre(inv.totalAmount - (await invoiceNet(tx, invoiceId)));
    if (Math.abs(fresh - rest) > 0.005) throw new PaymentError("Fakturaen er netop blevet betalt. Genindlæs siden.");
    const row = await tx.payment.create({
      data: {
        sessionId,
        invoiceId,
        amount: value,
        method,
        kind: "INVOICE",
        note,
        createdBy: by,
        createdAt: at,
      },
    });
    await syncInvoiceStatus(tx, invoiceId, at);
    return row;
  });
  if (sessionId) await syncPaymentStatus(sessionId);
  const left = roundOre(rest - value);
  logger.info("payment", `Faktura ${invoiceId}: ${fmtMoney(value)} betalt (${methodLabel(method)}) af ${by}`);
  return {
    paymentId: payment.id,
    sessionId,
    message: `${fmtMoney(value)} registreret på fakturaen · ${methodLabel(method)}${left >= DUE_THRESHOLD ? ` — mangler ${fmtMoney(left)}` : " — fakturaen er betalt"}`,
  };
}

// ──────────────────────────────────────────────
// "Fortryd": counter-entries
// ──────────────────────────────────────────────

/**
 * Undo a payment with a counter-entry (negative of the original, reversesId
 * set). A row can be undone once (reversesId is unique) and a counter-entry
 * can't be undone. A stay payment split over invoices is undone as a whole.
 * Undoing a deposit takes it off the balance again.
 */
export async function reversePaymentCore(
  paymentId: number,
  reason: string,
  by: string,
): Promise<{ message: string; sessionId: number | null }> {
  const why = reason.trim();
  if (!why) throw new PaymentError("Skriv hvorfor betalingen fortrydes.");
  const p = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw new PaymentError("Betalingen findes ikke.");
  const reversedAlready = (await prisma.payment.count({ where: { reversesId: p.id } })) > 0;
  const block = reverseBlock({ ...p, reversed: reversedAlready });
  if (block) throw new PaymentError(block);

  // The rest of the same registration (a stay payment split over invoices).
  let rows = [p];
  const key = paymentGroupKey(p);
  if (key) {
    const siblings = await prisma.payment.findMany({
      where: {
        sessionId: p.sessionId,
        createdAt: p.createdAt,
        createdBy: p.createdBy,
        kind: { in: ["SETTLEMENT", "INVOICE"] },
        reversesId: null,
        id: { not: p.id },
      },
    });
    const undone = new Set(
      (await prisma.payment.findMany({ where: { reversesId: { in: siblings.map((x) => x.id) } }, select: { reversesId: true } }))
        .map((x) => x.reversesId),
    );
    rows = [p, ...siblings.filter((x) => !undone.has(x.id) && paymentGroupKey(x) === key)];
  }

  const at = new Date();
  let balanceNote = "";
  try {
    await prisma.$transaction(async (tx) => {
      for (const r of rows) {
        await tx.payment.create({
          data: {
            sessionId: r.sessionId,
            invoiceId: r.invoiceId,
            amount: -r.amount,
            method: r.method,
            kind: r.kind,
            reversesId: r.id,
            note: `Fortrudt: ${why}`.slice(0, 500),
            createdBy: by,
            createdAt: at,
          },
        });
        if (r.invoiceId != null && r.kind === "INVOICE") await syncInvoiceStatus(tx, r.invoiceId, at);
      }
      // A deposit comes off the balance again; a payout of unused balance
      // never changed the balance, so undoing it doesn't either.
      if (p.kind === "BALANCE" && p.amount > 0 && p.sessionId != null) {
        const s = await tx.session.findUnique({
          where: { id: p.sessionId },
          select: { id: true, prepaidAmount: true, prepaidDeposited: true, accumulatedElCost: true, accumulatedWaterCost: true },
        });
        if (s) {
          const deposited = s.prepaidDeposited ?? (await resolvePrepaidDeposited(s));
          await tx.session.update({
            where: { id: s.id },
            data: {
              prepaidAmount: s.prepaidAmount == null ? -p.amount : { decrement: p.amount },
              prepaidDeposited: s.prepaidDeposited == null ? Math.max(0, deposited - p.amount) : { decrement: p.amount },
            },
          });
          const remaining = (s.prepaidAmount ?? 0) - p.amount - s.accumulatedElCost - s.accumulatedWaterCost;
          if (remaining < 0) balanceNote = ` Saldoen er nu ${fmtMoney(remaining)}.`;
        }
      }
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") throw new PaymentError("Betalingen er allerede fortrudt.");
    throw e;
  }

  if (p.sessionId != null) await syncPaymentStatus(p.sessionId);
  const total = roundOre(rows.reduce((t, r) => t + r.amount, 0));
  logger.info("payment", `Betaling ${rows.map((r) => r.id).join(", ")} (${fmtMoney(total)}, ${methodLabel(p.method)}) fortrudt af ${by}: ${why}`);
  return {
    sessionId: p.sessionId,
    message: `${fmtMoney(Math.abs(total))} ${total < 0 ? "udbetaling" : "betaling"} fortrudt — der er bogført en modpost.${balanceNote}`,
  };
}

// ──────────────────────────────────────────────
// QuickPay — online card payments in the same ledger
// ──────────────────────────────────────────────

/**
 * A QuickPay payment of a stay or an invoice as a ledger row. Idempotent per
 * QuickPay id: a repeated callback writes nothing.
 */
export async function recordQuickPayPayment(input: {
  externalId: string;
  kind: "SETTLEMENT" | "INVOICE";
  sessionId?: number | null;
  invoiceId?: number | null;
  amount: number;
}): Promise<boolean> {
  const amount = roundOre(input.amount);
  if (!(amount > 0)) return false;
  const exists = await prisma.payment.findFirst({
    where: { externalId: input.externalId, kind: input.kind, method: "QUICKPAY" },
    select: { id: true },
  });
  if (exists) return false;
  let sessionId = input.sessionId ?? null;
  if (input.kind === "INVOICE" && input.invoiceId && sessionId == null) {
    const inv = await prisma.invoice.findUnique({
      where: { id: input.invoiceId },
      select: { unitId: true, sessionId: true, periodStart: true, periodEnd: true },
    });
    if (inv) sessionId = await resolveInvoiceStay(inv);
  }
  await prisma.payment.create({
    data: {
      sessionId,
      invoiceId: input.invoiceId ?? null,
      amount,
      method: "QUICKPAY",
      kind: input.kind,
      externalId: input.externalId,
      createdBy: "QuickPay",
      note: "Betalt online",
    },
  });
  return true;
}
