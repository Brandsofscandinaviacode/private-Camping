// Laundry/shower payment vocabulary shared by the server and the admin UI:
// which channel a use was paid through, how it is labelled, how a guest's own
// start may be funded, and what "Annullér og refundér" would give back.
// Plain module without prisma, so client components can import it.

export type DeskPayMethod = "CASH" | "MOBILEPAY" | "CARD_TERMINAL";
export const DESK_PAY_METHODS: DeskPayMethod[] = ["CASH", "MOBILEPAY", "CARD_TERMINAL"];

/** How a start from the desk ("Start for gæst") is paid. */
export type DeskStartMethod = DeskPayMethod | "STAY" | "FREE";

export interface DeskStartInput {
  kind: "LAUNDRY" | "SHOWER";
  /** Machine or shower id. */
  id: number;
  programId?: number | null;
  minutes: number;
  price: number;
  method: DeskStartMethod;
  /** The guest's stay, for method STAY. */
  stayId?: number | null;
  /** Required for FREE (why), optional otherwise. */
  note?: string;
}

/** How service credit was added at the desk. */
export type CreditSource = DeskPayMethod | "COMPENSATION";

export const PAY_METHOD_LABELS: Record<string, string> = {
  CASH: "Kontant",
  MOBILEPAY: "MobilePay",
  CARD_TERMINAL: "Kortterminal",
  QUICKPAY: "Kort (online)",
  CREDIT: "Servicekredit",
  BALANCE: "Saldo",
  ACCOUNT: "På opholdet",
  FREE: "Gratis",
  NONE: "Ingen",
};

export function isDeskPayMethod(m: string | null | undefined): m is DeskPayMethod {
  return m === "CASH" || m === "MOBILEPAY" || m === "CARD_TERMINAL";
}

/** The fields of a LaundrySess/ShowerSess row that say how it was paid. */
export interface ServicePaymentFields {
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  paymentId: string | null;
  pricePaid: number;
  creditUsed: number;
  billingMode?: string | null;
  reservedAmount?: number | null;
  cancelledAt?: Date | string | null;
  refundAmount?: number | null;
  refundMethod?: string | null;
}

/**
 * Where the money for a use came from. UNVERIFIED is a PAID row without any
 * payment reference — before this was tracked, starts with card payments
 * switched off were saved as PAID although nothing was collected.
 */
export type ServiceChannel =
  | "DESK" | "CARD" | "BALANCE" | "ACCOUNT" | "INVOICED" | "CREDIT" | "FREE" | "UNVERIFIED" | "UNPAID";

export function serviceChannel(r: Pick<ServicePaymentFields, "paymentStatus" | "paymentMethod" | "paymentId">): ServiceChannel {
  const m = r.paymentMethod;
  if (m === "FREE" || r.paymentStatus === "FREE") return "FREE";
  if (isDeskPayMethod(m)) return "DESK";
  if (r.paymentStatus === "INVOICED") return "INVOICED";
  if (r.paymentStatus === "PREPAID" || m === "BALANCE") return "BALANCE";
  if (r.paymentStatus === "ON_ACCOUNT" || m === "ACCOUNT") return "ACCOUNT";
  if (m === "QUICKPAY") return "CARD";
  if (m === "CREDIT") return "CREDIT";
  if (r.paymentStatus === "PAID" || r.paymentStatus === "REFUNDED") return r.paymentId ? "CARD" : "UNVERIFIED";
  return "UNPAID";
}

/** paymentMethod to store for a channel when the row had none (legacy rows). */
export function channelMethod(c: ServiceChannel): string | null {
  switch (c) {
    case "CARD": return "QUICKPAY";
    case "BALANCE": return "BALANCE";
    case "ACCOUNT":
    case "INVOICED": return "ACCOUNT";
    case "FREE": return "FREE";
    default: return null;
  }
}

/** Is this row's money real revenue that is not already in a stay/invoice total? */
export function countsAsServiceRevenue(c: ServiceChannel): boolean {
  return c === "CARD" || c === "BALANCE";
}

export type ServiceTone = "emerald" | "blue" | "amber" | "red" | "muted";

/** Badge text + tone for the payment state of a use. */
export function servicePaymentBadge(r: ServicePaymentFields): { label: string; tone: ServiceTone } {
  if (r.cancelledAt || (r.status === "CANCELLED" && r.paymentStatus === "REFUNDED")) {
    return { label: refundLabel(r), tone: "muted" };
  }
  if (r.status === "PENDING") return { label: "Venter betaling", tone: "amber" };
  const c = serviceChannel(r);
  switch (c) {
    case "DESK": return { label: `Betalt · ${PAY_METHOD_LABELS[r.paymentMethod!]}`, tone: "emerald" };
    case "CARD": return { label: "Betalt · kort", tone: "emerald" };
    case "CREDIT": return { label: "Betalt med kredit", tone: "emerald" };
    case "BALANCE": return { label: "Fra saldo", tone: "blue" };
    case "ACCOUNT": return { label: "På regning", tone: "amber" };
    case "INVOICED": return { label: "Faktureret", tone: "muted" };
    case "FREE": return { label: "Gratis", tone: "muted" };
    case "UNVERIFIED": return { label: "Ingen betaling registreret", tone: "red" };
    default: return { label: "Ikke betalt", tone: "muted" };
  }
}

function refundLabel(r: ServicePaymentFields): string {
  const amt = r.refundAmount ?? 0;
  if (amt <= 0 || !r.refundMethod || r.refundMethod === "NONE") return "Annulleret";
  if (r.refundMethod === "ACCOUNT") return "Annulleret · fjernet fra regning";
  if (r.refundMethod === "BALANCE") return "Annulleret · tilbage på saldo";
  return `Annulleret · refunderet ${PAY_METHOD_LABELS[r.refundMethod] ?? r.refundMethod}`;
}

// ──────────────────────────────────────────────
// Guest self-service: how may this start be paid?
// ──────────────────────────────────────────────
export interface GuestStayFunds {
  status: string;
  billingMode: string | null;
  prepaidAmount: number | null;
  laundryCredit: number | null;
}

export type GuestFunding =
  | { kind: "FREE"; creditUsed: 0; amount: 0 }
  | { kind: "CREDIT"; creditUsed: number; amount: 0 }
  | { kind: "BALANCE"; creditUsed: number; amount: number }
  | { kind: "ACCOUNT"; creditUsed: number; amount: number }
  | { kind: "CARD"; creditUsed: number; amount: number }
  | { kind: "BLOCKED"; message: string };

export type FundedGuestFunding = Exclude<GuestFunding, { kind: "BLOCKED" }>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A guest start is paid from service credit first, then the prepaid balance
 * (PREPAID stay) or the stay's bill (POSTPAID stay with services "på regning"),
 * otherwise by card. Without card payments it is refused — never started for
 * free. Only a checked-in (ACTIVE) stay can carry the cost.
 */
export function planGuestFunding(
  price: number,
  stay: GuestStayFunds | null,
  opts: { cardEnabled: boolean; servicesOnAccount: boolean; payAtDeskMessage: string },
): GuestFunding {
  // A program priced at 0 by the site itself is free by design.
  if (price <= 0) return { kind: "FREE", creditUsed: 0, amount: 0 };
  const usable = stay && stay.status === "ACTIVE" ? stay : null;
  const credit = Math.max(0, usable?.laundryCredit ?? 0);
  const creditUsed = round2(Math.min(credit, price));
  const rest = round2(price - creditUsed);

  if (rest <= 0) return { kind: "CREDIT", creditUsed, amount: 0 };

  if (usable?.billingMode === "PREPAID") {
    const balance = usable.prepaidAmount ?? 0;
    if (balance >= rest) return { kind: "BALANCE", creditUsed, amount: rest };
    return {
      kind: "BLOCKED",
      message: `Utilstrækkelig saldo — behøver ${price.toFixed(0)} DKK, har ${(balance + creditUsed).toFixed(0)} DKK. Indbetal i receptionen.`,
    };
  }
  if (usable && usable.billingMode !== "PREPAID" && opts.servicesOnAccount) {
    return { kind: "ACCOUNT", creditUsed, amount: rest };
  }
  if (opts.cardEnabled) return { kind: "CARD", creditUsed, amount: rest };
  return { kind: "BLOCKED", message: opts.payAtDeskMessage };
}

/** paymentStatus/paymentMethod a funded start is stored with (card: once paid). */
export function fundingPaymentFields(f: FundedGuestFunding): { paymentStatus: string; paymentMethod: string } {
  switch (f.kind) {
    case "FREE": return { paymentStatus: "FREE", paymentMethod: "FREE" };
    case "CREDIT": return { paymentStatus: "PAID", paymentMethod: "CREDIT" };
    case "BALANCE": return { paymentStatus: "PREPAID", paymentMethod: "BALANCE" };
    case "ACCOUNT": return { paymentStatus: "ON_ACCOUNT", paymentMethod: "ACCOUNT" };
    case "CARD": return { paymentStatus: "UNPAID", paymentMethod: "QUICKPAY" };
  }
}

/** Guest-facing wording of how a funded start was paid (Danish, like other guest messages). */
export function fundingNote(f: FundedGuestFunding): string {
  const credit = f.creditUsed > 0 ? `${f.creditUsed.toFixed(0)} DKK kredit` : "";
  switch (f.kind) {
    case "FREE": return "gratis";
    case "CREDIT": return `betalt med ${credit}`;
    case "BALANCE": return [`${f.amount.toFixed(0)} DKK trukket fra saldo`, credit].filter(Boolean).join(" + ");
    case "ACCOUNT": return [`${f.amount.toFixed(0)} DKK på regning`, credit].filter(Boolean).join(" + ");
    case "CARD": return `${f.amount.toFixed(0)} DKK med kort`;
  }
}

// ──────────────────────────────────────────────
// "Annullér og refundér"
// ──────────────────────────────────────────────
export type RefundChoice = DeskPayMethod | "NONE";

export interface RefundPlan {
  allowed: boolean;
  blockedReason?: string;
  /** Money that goes back (excl. credit). */
  amount: number;
  creditBack: number;
  /** Handled without a choice: back on the balance / off the bill. */
  automatic: "BALANCE" | "ACCOUNT" | null;
  /** When money was taken outside the stay, the desk picks how it goes back. */
  choices: RefundChoice[];
  defaultChoice: RefundChoice | null;
  explanation: string;
}

const fmtKr = (n: number) => `${n.toFixed(2).replace(".", ",")} DKK`;

/**
 * What cancelling a use would give back. `stayActive` is whether the linked
 * stay is still checked in — after check-out the bill and balance are settled,
 * so money can no longer go back that way.
 */
export function refundPlan(r: ServicePaymentFields, ctx: { stayActive: boolean }): RefundPlan {
  const none: Omit<RefundPlan, "allowed" | "explanation"> = {
    amount: 0, creditBack: 0, automatic: null, choices: [], defaultChoice: null,
  };
  if (r.cancelledAt || r.status === "CANCELLED") {
    return { ...none, allowed: false, blockedReason: "Allerede annulleret", explanation: "" };
  }
  if (r.status === "PENDING") {
    return { ...none, allowed: false, blockedReason: "Venter stadig på betaling", explanation: "" };
  }
  const c = serviceChannel(r);
  if (c === "INVOICED") {
    return { ...none, allowed: false, blockedReason: "Linjen er faktureret — ret fakturaen i stedet", explanation: "" };
  }
  // A metered wash still running holds its reservation, not a final price.
  const meteredRunning = r.billingMode === "METERED" && r.status === "ACTIVE";
  const amount = round2(meteredRunning ? (c === "BALANCE" ? r.reservedAmount ?? 0 : 0) : r.pricePaid);
  const creditBack = round2(r.creditUsed ?? 0);
  const creditText = creditBack > 0 ? ` ${fmtKr(creditBack)} servicekredit sættes tilbage.` : "";
  const deskChoices: RefundChoice[] = ["CASH", "MOBILEPAY", "CARD_TERMINAL"];

  if (c === "ACCOUNT") {
    if (!ctx.stayActive) {
      return { ...none, allowed: false, blockedReason: "Opholdet er tjekket ud — beløbet er med i slutopgørelsen", explanation: "" };
    }
    return {
      ...none, allowed: true, amount, creditBack, automatic: "ACCOUNT",
      explanation: amount > 0 ? `${fmtKr(amount)} fjernes fra gæstens regning.${creditText}` : `Intet på regningen endnu.${creditText}`,
    };
  }
  if (c === "BALANCE") {
    if (ctx.stayActive) {
      return {
        ...none, allowed: true, amount, creditBack, automatic: "BALANCE",
        explanation: `${fmtKr(amount)} sættes tilbage på gæstens saldo.${creditText}`,
      };
    }
    return {
      ...none, allowed: true, amount, creditBack, choices: [...deskChoices, "NONE"], defaultChoice: "CASH",
      explanation: `Opholdet er tjekket ud — giv ${fmtKr(amount)} tilbage i receptionen.${creditText}`,
    };
  }
  if (c === "DESK") {
    const orig = r.paymentMethod as DeskPayMethod;
    return {
      ...none, allowed: true, amount, creditBack,
      choices: amount > 0 ? deskChoices : [], defaultChoice: amount > 0 ? orig : null,
      explanation: amount > 0 ? `Giv ${fmtKr(amount)} tilbage (betalt ${PAY_METHOD_LABELS[orig].toLowerCase()}).${creditText}` : `Intet at refundere.${creditText}`,
    };
  }
  if (c === "CARD") {
    return {
      ...none, allowed: true, amount, creditBack,
      choices: amount > 0 ? ["CASH", "MOBILEPAY", "NONE"] : [], defaultChoice: amount > 0 ? "CASH" : null,
      explanation: amount > 0
        ? `Betalt med kort online — giv ${fmtKr(amount)} tilbage i receptionen, eller vælg "Ingen" hvis det er refunderet i QuickPay.${creditText}`
        : `Kortreservationen frigives.${creditText}`,
    };
  }
  if (c === "UNVERIFIED") {
    return {
      ...none, allowed: true, amount, creditBack, choices: amount > 0 ? ["NONE", "CASH", "MOBILEPAY"] : [], defaultChoice: amount > 0 ? "NONE" : null,
      explanation: `Der er ikke registreret nogen betaling for denne linje. Vælg kun en refusion, hvis gæsten faktisk har betalt.${creditText}`,
    };
  }
  // CREDIT / FREE / UNPAID — no money changed hands beyond the credit.
  return {
    ...none, allowed: true, amount: 0, creditBack,
    explanation: creditBack > 0 ? `${fmtKr(creditBack)} servicekredit sættes tilbage.` : "Intet at refundere — linjen annulleres.",
  };
}
