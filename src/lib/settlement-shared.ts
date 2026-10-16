// Types and pure helpers for the stay settlement ("hvad skylder gæsten?").
// Plain module without imports, safe on server and client. The database side
// lives in settlement.ts.

/**
 * RUNNING     — postpaid stay still checked in; the figure is "so far".
 * NOTHING_DUE — nothing to collect (under 1 kr, or covered by the prepayment).
 * OWED        — money due, nothing paid on it yet.
 * PARTIAL     — money due, part of it paid.
 * PAID        — everything due has been paid.
 */
export type SettlementState = "RUNNING" | "NOTHING_DUE" | "OWED" | "PARTIAL" | "PAID";

/** Amounts under this are rounding noise, not a debt (same rule everywhere). */
export const DUE_THRESHOLD = 1;

/** Readings older than this (two cron ticks) are shown as stale at checkout. */
export const STALE_READING_MINUTES = 20;

/** How a laundry/shower purchase is settled. */
export type ServiceSettlement =
  | "PAID"        // paid when bought (card, laundry credit, free)
  | "BALANCE"     // drawn from the prepaid balance
  | "ON_ACCOUNT"  // on the guest's bill, paid at checkout
  | "INVOICED";   // already on an invoice

export interface SettlementService {
  id: string;
  kind: "LAUNDRY" | "SHOWER";
  label: string;
  detail: string | null;
  occurredAt: Date;
  amount: number;
  settledBy: ServiceSettlement;
  /** Metered wash still running — amount is the reservation, not final. */
  running: boolean;
}

export interface SettlementInvoice {
  id: number;
  periodStart: Date;
  periodEnd: Date;
  electricityKwh: number | null;
  electricityCost: number;
  waterLiters: number | null;
  waterCost: number;
  servicesCost: number;
  totalAmount: number;
  status: string;
  paidAt: Date | null;
}

export interface SettlementPayment {
  id: number;
  amount: number;
  method: string;
  kind: string;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
  invoiceId: number | null;
  reversesId: number | null;
  /** A later row reverses this one. */
  reversed: boolean;
}

export interface Settlement {
  sessionId: number;
  sessionStatus: "PENDING" | "ACTIVE" | "COMPLETED";
  billingMode: "PREPAID" | "POSTPAID";
  isLongTerm: boolean;
  currency: string;
  /** Consumption since the last invoice — the part billed on the stay itself. */
  remainder: {
    from: Date;
    to: Date;
    electricityKwh: number | null;
    electricityCost: number;
    waterLiters: number | null;
    waterCost: number;
  };
  invoices: SettlementInvoice[];
  services: SettlementService[];
  payments: SettlementPayment[];
  totals: {
    /** All electricity incl. heating: invoiced periods + remainder. */
    electricityCost: number;
    waterCost: number;
    /** Every purchase, however it was settled. */
    servicesCost: number;
    /** Stay price from the booking system (postpaid only). */
    stayPrice: number;
    /** Everything the guest consumed. */
    totalCost: number;
    /** Services paid when bought — part of totalCost, never due. */
    servicesPaidAtPurchase: number;
    /** Services drawn from the prepaid balance. */
    servicesFromBalance: number;
    servicesOnAccount: number;
    invoicesOpen: number;
    invoicesPaid: number;
  };
  /** Present for PREPAID stays only. */
  prepaid: {
    deposited: number;
    usedElWater: number;
    usedServices: number;
    /** Balance after el/water; negative when overdrawn. */
    remaining: number;
    /** Already paid back out of the balance (BALANCE refunds). */
    refunded: number;
  } | null;
  /** What the stay bills: open invoices + remainder + on-account services + stay price (prepaid: the shortfall). */
  due: number;
  /** Net SETTLEMENT payments (reversals are negative rows). */
  paid: number;
  /** due − paid, rounded to øre; under 1 kr counts as nothing. */
  owed: number;
  overpaid: number;
  /** Prepaid: unused balance not yet paid back. */
  refundDue: number;
  state: SettlementState;
  /** Marked paid before payments were recorded (or via QuickPay) — no amount on file. */
  paidWithoutRecord: boolean;
  lastPayment: { at: Date; method: string | null } | null;
}

export type CheckoutMeterMode = "AUTO" | "LAST" | "MANUAL" | "NONE";

export interface CheckoutOptions {
  /**
   * How to settle a meter that couldn't be read at checkout:
   * AUTO — last reading if there is one, otherwise refuse (API default);
   * LAST — accept the last reading; MANUAL — use the readings below;
   * NONE — no further el/water billing (note required).
   */
  meterMode?: CheckoutMeterMode;
  manual?: {
    endKwh?: number | null;
    endHeatingKwh?: number | null;
    endWaterLiters?: number | null;
    /** Only when the stay has no start reading at all. */
    startKwh?: number | null;
    startHeatingKwh?: number | null;
    startWaterLiters?: number | null;
  };
  note?: string;
  /**
   * When the guest really left ("YYYY-MM-DDTHH:mm", site time), if not now —
   * stored as the stay's check-out time. Billing still follows the meters.
   */
  departedAt?: string;
  /** Long-term unit: also end the tenancy (unit vacant, tenant and monthly invoicing removed). */
  endTenancy?: boolean;
}

export interface CheckoutMeterInfo {
  key: "el" | "heat" | "water";
  label: string;
  unit: "kWh" | "L";
  /** Read successfully just now. */
  online: boolean;
  lastValue: number | null;
  lastReadAt: Date | null;
  startValue: number | null;
  stale: boolean;
}

export interface CheckoutPreview {
  settlement: Settlement;
  meters: CheckoutMeterInfo[];
  elPrice: number;
  waterPrice: number;
  powerOff: boolean;
}

export interface CampInfo {
  name: string | null;
  address: string | null;
  cvr: string | null;
}

/** Fields of "Redigér booking". Leave a field out (undefined) to keep it. */
export interface SessionDetailsInput {
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  bookingRef?: string;
  notes?: string;
  expectedCheckOut?: string;
  startKwh?: number | null;
  endKwh?: number | null;
  startHeatingKwh?: number | null;
  endHeatingKwh?: number | null;
  startWaterLiters?: number | null;
  endWaterLiters?: number | null;
  pricePerKwhOverride?: number | null;
  pricePerLiterWaterOverride?: number | null;
}

export type UpdateSessionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string; needsConfirmation?: undefined }
  | { ok: false; needsConfirmation: true; message: string; before: number; after: number };

export function roundOre(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Amounts below 1 kr are nothing due. */
export function dueOrZero(v: number): number {
  const r = roundOre(v);
  return r >= DUE_THRESHOLD ? r : 0;
}

const amountFmt = new Intl.NumberFormat("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1.234,50 DKK */
export function fmtMoney(v: number, currency = "DKK"): string {
  // -0,00 looks like a refund; normalise it.
  const n = Math.abs(v) < 0.005 ? 0 : v;
  return `${amountFmt.format(n)} ${currency}`;
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Kontant",
  MOBILEPAY: "MobilePay",
  CARD_TERMINAL: "Kortterminal",
  BANK: "Bankoverførsel",
  QUICKPAY: "Kort (online)",
  OTHER: "Registreret i skranken",
};

export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return "Ukendt betalingsmåde";
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

export const SERVICE_SETTLEMENT_LABELS: Record<ServiceSettlement, string> = {
  PAID: "Betalt ved køb",
  BALANCE: "Fra saldo",
  ON_ACCOUNT: "På regning",
  INVOICED: "Faktureret",
};

export type SettlementTone = "red" | "emerald" | "blue" | "muted" | "amber";

/** The one figure to show for a stay, with its label. */
export function settlementHeadline(s: Settlement): { label: string; amount: number | null; tone: SettlementTone; hint: string | null } {
  const prepaid = s.prepaid;
  switch (s.state) {
    case "RUNNING":
      return {
        label: "Til betaling indtil nu",
        amount: roundOre(Math.max(0, s.due - s.paid)),
        tone: "blue",
        hint: "Opholdet er i gang — beløbet afregnes ved udtjek.",
      };
    case "OWED":
      return {
        label: "Gæsten skylder",
        amount: s.owed,
        tone: "red",
        hint: prepaid ? "Forbruget overstiger den forudbetalte saldo." : null,
      };
    case "PARTIAL":
      return { label: "Gæsten skylder", amount: s.owed, tone: "red", hint: `Delvist betalt: ${fmtMoney(s.paid, s.currency)}` };
    case "PAID":
      return {
        label: "Betalt",
        amount: s.paidWithoutRecord ? s.due : roundOre(s.paid),
        tone: "emerald",
        hint: s.overpaid > 0 ? `Betalt ${fmtMoney(s.overpaid, s.currency)} for meget` : null,
      };
    case "NOTHING_DUE":
    default:
      if (prepaid && s.sessionStatus === "ACTIVE") {
        return { label: "Resterende saldo", amount: roundOre(Math.max(0, prepaid.remaining)), tone: "blue", hint: null };
      }
      if (prepaid && s.refundDue > 0) {
        return { label: "Intet at betale", amount: null, tone: "emerald", hint: `Ubrugt saldo: ${fmtMoney(s.refundDue, s.currency)}` };
      }
      return {
        label: "Intet at betale",
        amount: null,
        tone: s.sessionStatus === "PENDING" ? "muted" : "emerald",
        hint: prepaid ? "Forbruget er trukket fra forudbetalingen." : null,
      };
  }
}

/** Danish "for 33 dage siden" style age of a reading. */
export function fmtAge(from: Date | string | null, now: Date = new Date()): string | null {
  if (!from) return null;
  const ms = now.getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms)) return null;
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return "lige nu";
  if (min < 60) return `${min} min siden`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "time" : "timer"} siden`;
  const days = Math.round(hours / 24);
  return `${days} dage siden`;
}
