// The one answer to "hvad skylder gæsten?" — read by the booking page, the
// statement, check-out, the unpaid badge/banner, Økonomi and the guest portal.
//
// Plain server module (NOT a server action): no auth check, callers guard
// access. It never reads meters or ticks; callers that want live figures for
// an ACTIVE stay tick first.

import { prisma } from "./prisma";
import { resolvePrepaidDeposited } from "./prepaid";
import {
  roundOre,
  dueOrZero,
  type Settlement,
  type SettlementInvoice,
  type SettlementPayment,
  type SettlementService,
  type ServiceSettlement,
  type SettlementState,
} from "./settlement-shared";

export type { Settlement, SettlementState } from "./settlement-shared";

interface SessionRow {
  id: number;
  unitId: number;
  status: string;
  billingMode: string;
  paymentStatus: string;
  paidAt: Date | null;
  checkInTime: Date;
  checkOutTime: Date | null;
  prepaidAmount: number | null;
  prepaidDeposited: number | null;
  accumulatedElCost: number;
  accumulatedElKwh: number;
  accumulatedWaterCost: number;
  accumulatedWaterLiters: number;
  totalElectricityCost: number | null;
  totalWaterCost: number | null;
  startKwh: number | null;
  endKwh: number | null;
  startHeatingKwh: number | null;
  endHeatingKwh: number | null;
  startWaterLiters: number | null;
  endWaterLiters: number | null;
  lastTickAt: Date | null;
  externalPrice: number | null;
}

interface InvoiceRow {
  id: number;
  unitId: number;
  /** The stay the invoice bills; null on older and unit-level invoices. */
  sessionId?: number | null;
  periodStart: Date;
  periodEnd: Date;
  startKwh: number | null;
  endKwh: number | null;
  startHeatingKwh: number | null;
  endHeatingKwh: number | null;
  startWaterLiters: number | null;
  endWaterLiters: number | null;
  electricityCost: number;
  waterCost: number;
  servicesCost: number;
  totalAmount: number;
  status: string;
  paidAt: Date | null;
}

interface ServiceRow {
  id: string;
  kind: "LAUNDRY" | "SHOWER";
  label: string;
  detail: string | null;
  occurredAt: Date;
  amount: number;
  paymentStatus: string;
  running: boolean;
}

interface PaymentRow {
  id: number;
  amount: number;
  method: string;
  kind: string;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
  invoiceId: number | null;
  reversesId: number | null;
}

export interface SettlementInput {
  session: SessionRow;
  isLongTerm: boolean;
  /** Prepaid only: total ever deposited (resolvePrepaidDeposited). */
  deposited: number | null;
  /** The stay's own invoices and the unit's untagged ones; filtered to the stay here. */
  invoices: InvoiceRow[];
  services: ServiceRow[];
  payments: PaymentRow[];
  currency: string;
  now: Date;
}

export interface SettlementOptions {
  /**
   * Ignore a bare paymentStatus=PAID flag (no payment on file). Checkout uses
   * this: a flag set mid-stay must not hide consumption that came after it.
   */
  ignorePaidFlag?: boolean;
}

const delta = (end: number | null, start: number | null) =>
  end != null && start != null ? Math.max(0, end - start) : null;

const sumKwh = (a: number | null, b: number | null) => (a !== null || b !== null ? (a ?? 0) + (b ?? 0) : null);

function classifyService(paymentStatus: string): ServiceSettlement {
  // FREE: a desk start given away (pricePaid 0) — nothing on the bill.
  if (paymentStatus === "PAID" || paymentStatus === "FREE") return "PAID";
  if (paymentStatus === "PREPAID") return "BALANCE";
  if (paymentStatus === "INVOICED") return "INVOICED";
  return "ON_ACCOUNT";
}

/** Pure: builds the settlement from loaded rows. Exported for tests. */
export function buildSettlement(input: SettlementInput, opts: SettlementOptions = {}): Settlement {
  const { session: s, now } = input;
  const status = (s.status === "ACTIVE" || s.status === "COMPLETED" ? s.status : "PENDING") as Settlement["sessionStatus"];
  const isPrepaid = s.billingMode === "PREPAID";
  const stayEnd = s.checkOutTime ?? now;

  // Invoices raised during the stay (long stays, "Ny faktura"). A prepaid stay
  // is never invoiced — leave other guests' invoices on the unit out of it.
  const invoices: SettlementInvoice[] = isPrepaid || status === "PENDING"
    ? []
    : input.invoices
        // A stay's own invoice always counts (it may have changed unit, or be
        // checked out as of an earlier departure); an untagged one by period.
        .filter((inv) => (inv.sessionId != null
          ? inv.sessionId === s.id
          : inv.periodEnd > s.checkInTime && inv.periodStart < stayEnd))
        .sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime())
        .map((inv) => ({
          id: inv.id,
          periodStart: inv.periodStart,
          periodEnd: inv.periodEnd,
          electricityKwh: sumKwh(delta(inv.endKwh, inv.startKwh), delta(inv.endHeatingKwh, inv.startHeatingKwh)),
          electricityCost: inv.electricityCost,
          waterLiters: delta(inv.endWaterLiters, inv.startWaterLiters),
          waterCost: inv.waterCost,
          servicesCost: inv.servicesCost,
          totalAmount: inv.totalAmount,
          status: inv.status,
          paidAt: inv.paidAt,
        }));
  const lastInvoice = invoices.length > 0
    ? input.invoices.find((i) => i.id === invoices[invoices.length - 1].id)!
    : null;

  // Remainder — what the stay itself bills for el/water. Checkout stores it in
  // totalElectricityCost/totalWaterCost (heating included); while the stay
  // runs it is the time-weighted accumulator.
  let remEl = 0;
  let remWater = 0;
  let remKwh: number | null = null;
  let remLiters: number | null = null;
  const ticked = s.lastTickAt != null || s.accumulatedElKwh > 0 || s.accumulatedWaterLiters > 0;
  if (status === "ACTIVE") {
    remEl = s.accumulatedElCost;
    remWater = s.accumulatedWaterCost;
    if (ticked) {
      remKwh = s.startKwh != null || s.startHeatingKwh != null || s.accumulatedElKwh > 0 ? s.accumulatedElKwh : null;
      remLiters = s.startWaterLiters != null || s.accumulatedWaterLiters > 0 ? s.accumulatedWaterLiters : null;
    }
  } else if (status === "COMPLETED") {
    remEl = s.totalElectricityCost ?? 0;
    remWater = s.totalWaterCost ?? 0;
    remKwh = sumKwh(
      delta(s.endKwh, lastInvoice?.endKwh ?? s.startKwh),
      delta(s.endHeatingKwh, lastInvoice?.endHeatingKwh ?? s.startHeatingKwh),
    );
    remLiters = delta(s.endWaterLiters, lastInvoice?.endWaterLiters ?? s.startWaterLiters);
    if (remKwh === null && s.accumulatedElKwh > 0) remKwh = s.accumulatedElKwh;
    if (remLiters === null && s.accumulatedWaterLiters > 0) remLiters = s.accumulatedWaterLiters;
  }

  const services: SettlementService[] = input.services
    .map((x) => ({
      id: x.id,
      kind: x.kind,
      label: x.label,
      detail: x.detail,
      occurredAt: x.occurredAt,
      amount: x.amount,
      settledBy: classifyService(x.paymentStatus),
      running: x.running,
    }))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const sumBy = (k: ServiceSettlement) => services.filter((x) => x.settledBy === k).reduce((t, x) => t + x.amount, 0);
  const servicesPaidAtPurchase = sumBy("PAID");
  const servicesFromBalance = sumBy("BALANCE");
  const servicesOnAccount = sumBy("ON_ACCOUNT");

  // Invoiced services are counted through the invoice's own servicesCost, so
  // the invoice total and the service lines are never added twice.
  const invEl = invoices.reduce((t, i) => t + i.electricityCost, 0);
  const invWater = invoices.reduce((t, i) => t + i.waterCost, 0);
  const invServices = invoices.reduce((t, i) => t + i.servicesCost, 0);
  const invoicesPaid = invoices.filter((i) => i.status === "PAID").reduce((t, i) => t + i.totalAmount, 0);
  const invoicesOpen = invoices.filter((i) => i.status !== "PAID").reduce((t, i) => t + i.totalAmount, 0);

  // The booking system's stay price is collected with the stay for postpaid
  // guests (portal + QuickPay always did); for prepaid it is settled separately.
  const stayPrice = !isPrepaid && status !== "PENDING" ? (s.externalPrice ?? 0) : 0;

  const electricityCost = invEl + remEl;
  const waterCost = invWater + remWater;
  const servicesCost = servicesPaidAtPurchase + servicesFromBalance + servicesOnAccount + invServices;
  const totalCost = electricityCost + waterCost + servicesCost + stayPrice;

  // Payments: SETTLEMENT rows (and their reversals) pay the stay. INVOICE rows
  // on an invoice that is still open are part payments of it; once an invoice
  // is PAID it has left `due`, so its rows must not count again. BALANCE rows
  // never count here — deposits are already in the prepaid balance.
  const reversedIds = new Set(input.payments.filter((p) => p.reversesId != null).map((p) => p.reversesId!));
  const settlementIds = new Set(input.payments.filter((p) => p.kind === "SETTLEMENT").map((p) => p.id));
  const isSettlementRow = (p: PaymentRow) => p.kind === "SETTLEMENT" || (p.reversesId != null && settlementIds.has(p.reversesId));
  const openInvoiceIds = new Set(invoices.filter((i) => i.status !== "PAID").map((i) => i.id));
  const isOpenInvoiceRow = (p: PaymentRow) => p.kind === "INVOICE" && p.invoiceId != null && openInvoiceIds.has(p.invoiceId);
  const paid = roundOre(input.payments.filter((p) => isSettlementRow(p) || isOpenInvoiceRow(p)).reduce((t, p) => t + p.amount, 0));

  let prepaid: Settlement["prepaid"] = null;
  let due: number;
  if (isPrepaid) {
    // prepaidAmount already has every service draw taken off — only el/water
    // remain to set against it (same as prepaidShortfall()).
    const deposited = input.deposited ?? s.prepaidAmount ?? 0;
    const remaining = (s.prepaidAmount ?? 0) - remEl - remWater;
    const refundIds = new Set(
      input.payments.filter((p) => p.kind === "BALANCE" && p.amount < 0 && p.reversesId == null).map((p) => p.id),
    );
    const refunded = input.payments.reduce((t, p) => {
      if (refundIds.has(p.id)) return t - p.amount;
      if (p.reversesId != null && refundIds.has(p.reversesId)) return t - p.amount;
      return t;
    }, 0);
    prepaid = {
      deposited: roundOre(deposited),
      usedElWater: roundOre(remEl + remWater),
      usedServices: roundOre(Math.max(0, deposited - (s.prepaidAmount ?? 0))),
      remaining: roundOre(remaining),
      refunded: roundOre(refunded),
    };
    due = roundOre(Math.max(0, -remaining) + servicesOnAccount);
  } else {
    due = roundOre(invoicesOpen + remEl + remWater + servicesOnAccount + stayPrice);
  }

  const paidWithoutRecord =
    !opts.ignorePaidFlag && status === "COMPLETED" && s.paymentStatus === "PAID" && Math.abs(paid) < 0.005 && due >= 1;
  const effectivePaid = paidWithoutRecord ? due : paid;
  const owed = dueOrZero(due - effectivePaid);
  const overpaid = effectivePaid - due > 0.005 ? roundOre(effectivePaid - due) : 0;
  const refundDue = prepaid ? roundOre(Math.max(0, Math.max(0, prepaid.remaining) - prepaid.refunded)) : 0;

  let state: SettlementState;
  if (status === "ACTIVE" && !isPrepaid) state = "RUNNING";
  else if (owed > 0) state = effectivePaid >= 0.005 ? "PARTIAL" : "OWED";
  else if (effectivePaid >= 0.005) state = "PAID";
  else state = "NOTHING_DUE";

  const payments: SettlementPayment[] = input.payments
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((p) => ({ ...p, reversed: reversedIds.has(p.id) }));
  const lastRow = [...payments].reverse().find((p) => (isSettlementRow(p) || p.kind === "INVOICE") && p.amount > 0 && !p.reversed);
  const lastPayment = lastRow
    ? { at: lastRow.createdAt, method: lastRow.method }
    : paidWithoutRecord && s.paidAt ? { at: s.paidAt, method: null } : null;

  return {
    sessionId: s.id,
    sessionStatus: status,
    billingMode: isPrepaid ? "PREPAID" : "POSTPAID",
    isLongTerm: input.isLongTerm,
    currency: input.currency,
    remainder: {
      from: lastInvoice ? lastInvoice.periodEnd : s.checkInTime,
      to: stayEnd,
      electricityKwh: remKwh,
      electricityCost: roundOre(remEl),
      waterLiters: remLiters,
      waterCost: roundOre(remWater),
    },
    invoices,
    services,
    payments,
    totals: {
      electricityCost: roundOre(electricityCost),
      waterCost: roundOre(waterCost),
      servicesCost: roundOre(servicesCost),
      stayPrice: roundOre(stayPrice),
      totalCost: roundOre(totalCost),
      servicesPaidAtPurchase: roundOre(servicesPaidAtPurchase),
      servicesFromBalance: roundOre(servicesFromBalance),
      servicesOnAccount: roundOre(servicesOnAccount),
      invoicesOpen: roundOre(invoicesOpen),
      invoicesPaid: roundOre(invoicesPaid),
    },
    prepaid,
    due,
    paid,
    owed,
    overpaid,
    refundDue,
    state,
    paidWithoutRecord,
    lastPayment,
  };
}

/** Settlements for many stays with a fixed number of queries. */
export async function computeSettlements(
  sessionIds: number[],
  opts: SettlementOptions = {},
): Promise<Map<number, Settlement>> {
  const result = new Map<number, Settlement>();
  const ids = [...new Set(sessionIds)];
  if (ids.length === 0) return result;

  const sessions = await prisma.session.findMany({
    where: { id: { in: ids } },
    include: { unit: { select: { isLongTerm: true } } },
  });
  if (sessions.length === 0) return result;

  const invoiceUnitIds = [...new Set(sessions.filter((x) => x.billingMode !== "PREPAID").map((x) => x.unitId))];
  const [invoices, laundry, showers, payments, currencySetting] = await Promise.all([
    invoiceUnitIds.length > 0
      ? prisma.invoice.findMany({ where: { OR: [{ unitId: { in: invoiceUnitIds } }, { sessionId: { in: ids } }] } })
      : Promise.resolve([]),
    // UNPAID rows are purchases still waiting for their card payment — not a charge yet.
    prisma.laundrySess.findMany({
      where: { sessionId: { in: ids }, status: { not: "CANCELLED" }, paymentStatus: { not: "UNPAID" } },
      include: { machine: { select: { name: true } } },
    }),
    prisma.showerSess.findMany({
      where: { sessionId: { in: ids }, status: { not: "CANCELLED" }, paymentStatus: { not: "UNPAID" } },
      include: { shower: { select: { name: true } } },
    }),
    prisma.payment.findMany({ where: { sessionId: { in: ids } } }),
    prisma.globalSetting.findUnique({ where: { key: "currency" } }),
  ]);

  const currency = currencySetting?.value || "DKK";
  const now = new Date();

  for (const s of sessions) {
    const services: ServiceRow[] = [
      ...laundry.filter((l) => l.sessionId === s.id).map((l) => {
        const running = l.billingMode === "METERED" && l.status === "ACTIVE";
        return {
          id: `laundry-${l.id}`,
          kind: "LAUNDRY" as const,
          label: l.machine.name,
          detail: l.programName || (l.durationMinutes ? `${l.durationMinutes} min` : null),
          occurredAt: l.startedAt,
          amount: running ? (l.reservedAmount ?? 0) : l.pricePaid,
          paymentStatus: l.paymentStatus,
          running,
        };
      }),
      ...showers.filter((x) => x.sessionId === s.id).map((x) => ({
        id: `shower-${x.id}`,
        kind: "SHOWER" as const,
        label: x.shower.name,
        detail: x.minutesPaid ? `${x.minutesPaid} min` : null,
        occurredAt: x.startedAt,
        amount: x.pricePaid,
        paymentStatus: x.paymentStatus,
        running: false,
      })),
    ];
    const deposited = s.billingMode === "PREPAID" ? await resolvePrepaidDeposited(s) : null;
    result.set(
      s.id,
      buildSettlement(
        {
          session: s,
          isLongTerm: s.unit.isLongTerm,
          deposited,
          invoices: invoices.filter((i) => i.sessionId === s.id || (i.sessionId == null && i.unitId === s.unitId)),
          services,
          payments: payments.filter((p) => p.sessionId === s.id),
          currency,
          now,
        },
        opts,
      ),
    );
  }
  return result;
}

export async function computeSettlement(sessionId: number, opts: SettlementOptions = {}): Promise<Settlement | null> {
  return (await computeSettlements([sessionId], opts)).get(sessionId) ?? null;
}

/**
 * Completed stays the guest still owes money on (≥ 1 kr) — the unpaid badge,
 * dashboard banner and Økonomi list. paymentStatus is kept in step with the
 * settlement, so UNPAID narrows the candidates.
 */
export async function listUnpaidSettlements(): Promise<Settlement[]> {
  const candidates = await prisma.session.findMany({
    where: { status: "COMPLETED", paymentStatus: "UNPAID" },
    select: { id: true },
  });
  const map = await computeSettlements(candidates.map((c) => c.id));
  return [...map.values()].filter((x) => x.owed > 0);
}

/**
 * Bring session.paymentStatus in line with the settlement after anything that
 * changes what is owed: PAID when nothing (≥ 1 kr) is left, UNPAID otherwise.
 * Only for completed stays — while a stay runs the flag means nothing.
 */
export async function syncPaymentStatus(sessionId: number, opts: SettlementOptions = {}): Promise<Settlement | null> {
  const settlement = await computeSettlement(sessionId, opts);
  if (!settlement || settlement.sessionStatus !== "COMPLETED") return settlement;
  const settled = settlement.owed === 0;
  const current = await prisma.session.findUnique({ where: { id: sessionId }, select: { paymentStatus: true, paidAt: true } });
  if (!current) return settlement;
  if (settled && current.paymentStatus !== "PAID") {
    await prisma.session.update({
      where: { id: sessionId },
      data: { paymentStatus: "PAID", paidAt: settlement.lastPayment?.at ?? new Date() },
    });
  } else if (!settled && current.paymentStatus === "PAID") {
    await prisma.session.update({ where: { id: sessionId }, data: { paymentStatus: "UNPAID", paidAt: null } });
  }
  return settlement;
}

// ──────────────────────────────────────────────
// Corrections on a completed stay ("Ret målerstande/pris")
// ──────────────────────────────────────────────

export interface CompletedCostsInput {
  before: {
    startKwh: number | null;
    endKwh: number | null;
    startHeatingKwh: number | null;
    endHeatingKwh: number | null;
    startWaterLiters: number | null;
    endWaterLiters: number | null;
    pricePerKwhOverride: number | null;
    pricePerLiterWaterOverride: number | null;
    totalElectricityCost: number | null;
    totalWaterCost: number | null;
  };
  after: CompletedCostsInput["before"];
  accumulatedElCost: number;
  accumulatedElKwh: number;
  accumulatedWaterCost: number;
  accumulatedWaterLiters: number;
  /** A tick read the el (incl. heating) / water meter at some point. */
  elTicked: boolean;
  waterTicked: boolean;
  /** Fallback rates when the stay has no measured rate to go by. */
  elPrice: number;
  waterPrice: number;
}

/**
 * Recalculate el/water for a completed stay the way checkout bills it.
 * The spot-weighted accumulator stays the basis: a corrected meter difference
 * is priced at the stay's own measured rate (never silently at the fixed
 * price) and moved into the accumulator, so it keeps meaning "billed so far".
 * A price override reprices everything billed on the stay; removing it goes
 * back to the measured amount. A utility nobody touched keeps its amount.
 */
export function recalcCompletedCosts(input: CompletedCostsInput): {
  electricityCost: number | null;
  waterCost: number | null;
  elChanged: boolean;
  waterChanged: boolean;
  /** New accumulator values to store (only for corrected, ticked meters). */
  accumulators: Partial<Record<"accumulatedElCost" | "accumulatedElKwh" | "accumulatedWaterCost" | "accumulatedWaterLiters", number>>;
} {
  const { before: b, after: a } = input;
  const elKwh = (x: CompletedCostsInput["before"]) =>
    sumKwh(delta(x.endKwh, x.startKwh), delta(x.endHeatingKwh, x.startHeatingKwh));
  const waterL = (x: CompletedCostsInput["before"]) => delta(x.endWaterLiters, x.startWaterLiters);

  const elReadingsChanged =
    a.startKwh !== b.startKwh || a.endKwh !== b.endKwh || a.startHeatingKwh !== b.startHeatingKwh || a.endHeatingKwh !== b.endHeatingKwh;
  const elPriceChanged = a.pricePerKwhOverride !== b.pricePerKwhOverride;
  const waterReadingsChanged = a.startWaterLiters !== b.startWaterLiters || a.endWaterLiters !== b.endWaterLiters;
  const waterPriceChanged = a.pricePerLiterWaterOverride !== b.pricePerLiterWaterOverride;

  const reprice = (opt: {
    changedReadings: boolean;
    changedPrice: boolean;
    oldUnits: number | null;
    newUnits: number | null;
    stored: number | null;
    ticked: boolean;
    accCost: number;
    accUnits: number;
    newOverride: number | null;
    fallbackRate: number;
  }): { cost: number | null; acc: { cost: number; units: number } | null } => {
    if (!opt.changedReadings && !opt.changedPrice) return { cost: opt.stored, acc: null };
    const correction = opt.changedReadings ? (opt.newUnits ?? 0) - (opt.oldUnits ?? 0) : 0;

    if (opt.ticked) {
      // Accumulator = consumption since the last invoice, at the spot price
      // of the hour it was used.
      const measuredRate = opt.accUnits > 0 ? opt.accCost / opt.accUnits : opt.fallbackRate;
      const units = Math.max(0, opt.accUnits + correction);
      const accCost = units === 0 ? 0 : Math.max(0, opt.accCost + correction * measuredRate);
      const acc = correction !== 0 ? { cost: roundOre(accCost), units } : null;
      if (opt.newOverride != null) return { cost: roundOre(units * opt.newOverride), acc };
      if (opt.changedPrice) return { cost: roundOre(accCost), acc };
      const base = opt.stored ?? opt.accCost;
      const rate = opt.accUnits > 0 ? base / opt.accUnits : measuredRate;
      return { cost: roundOre(Math.max(0, base + correction * rate)), acc };
    }

    // No tick ever read the meter (legacy stay): billed on the raw difference.
    const oldUnits = opt.oldUnits ?? 0;
    const units = Math.max(0, oldUnits + correction);
    if (opt.newOverride != null) return { cost: roundOre(units * opt.newOverride), acc: null };
    if (opt.changedPrice) return { cost: roundOre(units * opt.fallbackRate), acc: null };
    const base = opt.stored ?? 0;
    const rate = oldUnits > 0 && base > 0 ? base / oldUnits : opt.fallbackRate;
    return { cost: roundOre(Math.max(0, base + correction * rate)), acc: null };
  };

  const el = reprice({
    changedReadings: elReadingsChanged,
    changedPrice: elPriceChanged,
    oldUnits: elKwh(b),
    newUnits: elKwh(a),
    stored: b.totalElectricityCost,
    ticked: input.elTicked,
    accCost: input.accumulatedElCost,
    accUnits: input.accumulatedElKwh,
    newOverride: a.pricePerKwhOverride,
    fallbackRate: input.elPrice,
  });
  const water = reprice({
    changedReadings: waterReadingsChanged,
    changedPrice: waterPriceChanged,
    oldUnits: waterL(b),
    newUnits: waterL(a),
    stored: b.totalWaterCost,
    ticked: input.waterTicked,
    accCost: input.accumulatedWaterCost,
    accUnits: input.accumulatedWaterLiters,
    newOverride: a.pricePerLiterWaterOverride,
    fallbackRate: input.waterPrice,
  });

  const accumulators: Partial<Record<"accumulatedElCost" | "accumulatedElKwh" | "accumulatedWaterCost" | "accumulatedWaterLiters", number>> = {};
  if (el.acc) {
    accumulators.accumulatedElCost = el.acc.cost;
    accumulators.accumulatedElKwh = el.acc.units;
  }
  if (water.acc) {
    accumulators.accumulatedWaterCost = water.acc.cost;
    accumulators.accumulatedWaterLiters = water.acc.units;
  }
  return {
    electricityCost: el.cost,
    waterCost: water.cost,
    elChanged: elReadingsChanged || elPriceChanged,
    waterChanged: waterReadingsChanged || waterPriceChanged,
    accumulators,
  };
}
