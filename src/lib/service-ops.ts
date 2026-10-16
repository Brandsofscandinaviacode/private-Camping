// Server-side laundry/shower operations shared by the guest flows and the
// desk actions. Deliberately NOT a server action module: nothing here checks
// auth, so callers (actions with requireAuth or a guest token) guard access.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import * as hardware from "./hardware";
import { mqttClient } from "./mqtt-client";
import { logger } from "./logger";
import {
  refundPlan,
  serviceChannel,
  channelMethod,
  PAY_METHOD_LABELS,
  type FundedGuestFunding,
  type RefundChoice,
} from "./service-billing";

export type ServiceKind = "LAUNDRY" | "SHOWER";

/** Credit or balance ran out between the check and the draw. */
export class InsufficientFunds extends Error {}

/**
 * Takes a funded start's credit and prepaid balance from the stay, inside the
 * caller's transaction. Conditional decrements, so two concurrent starts can't
 * both spend the same money; throws InsufficientFunds if one lost the race.
 */
export async function drawStayFunds(
  tx: Prisma.TransactionClient,
  stayId: number,
  f: Pick<FundedGuestFunding, "kind" | "creditUsed" | "amount">,
): Promise<void> {
  const fromBalance = f.kind === "BALANCE" ? f.amount : 0;
  if (f.creditUsed <= 0 && fromBalance <= 0) return;
  const res = await tx.session.updateMany({
    where: {
      id: stayId,
      ...(f.creditUsed > 0 && { laundryCredit: { gte: f.creditUsed } }),
      ...(fromBalance > 0 && { prepaidAmount: { gte: fromBalance } }),
    },
    data: {
      ...(f.creditUsed > 0 && { laundryCredit: { decrement: f.creditUsed } }),
      ...(fromBalance > 0 && { prepaidAmount: { decrement: fromBalance } }),
    },
  });
  if (res.count === 0) throw new InsufficientFunds();
}

/** Ledger line for credit spent on a laundry/shower use. */
export async function logCreditUse(
  tx: Prisma.TransactionClient,
  stayId: number,
  amount: number,
  serviceRef: string,
  note: string,
  by: string | null = null,
): Promise<void> {
  if (amount <= 0) return;
  await tx.serviceCreditEntry.create({
    data: { sessionId: stayId, amount: -amount, reason: "USED", note, serviceRef, createdBy: by },
  });
}

/**
 * Whether the Shelly behind a machine/shower is online, from its retained
 * last-will topic ({prefix}/online). null = unknown (HA, not configured, or
 * the broker has no answer yet).
 */
export async function serviceDeviceOnline(
  dev: { source: string; mqttPrefix: string | null },
  waitMs = 300,
): Promise<boolean | null> {
  if (dev.source !== "MQTT" || !dev.mqttPrefix) return null;
  try {
    // Bounded: a broker that is down must not hold up the page or a start
    // (a fresh connect attempt alone can take 10 s).
    const msg = await Promise.race([
      mqttClient.getStatus(`${dev.mqttPrefix}/online`, waitMs),
      new Promise<null>((r) => setTimeout(() => r(null), waitMs + 700)),
    ]);
    if (!msg) return null;
    return msg.payload.trim() === "true";
  } catch {
    return null;
  }
}

/** Short Danish amount, "40,00 DKK". */
export function kr(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} DKK`;
}

class AlreadyCancelled extends Error {}

/**
 * "Annullér og refundér" for one laundry/shower use: cancels it (switching the
 * relay off if it is running) and gives the money back the way it came —
 * prepaid balance, off the stay's bill, service credit, or as a negative
 * SERVICE payment for money taken at the desk. The row update is conditional
 * and the desk reversal points at the original payment (reversesId is unique),
 * so a second attempt can never refund twice.
 *
 * `auto` is for system cancels (relay never switched on): where the desk would
 * have to choose how to hand money back, nothing is paid out and it is logged.
 */
export async function cancelAndRefundService(
  kind: ServiceKind,
  id: number,
  opts: { reason: string; choice?: RefundChoice | null; by: string | null; auto?: boolean },
): Promise<{ ok: boolean; message: string }> {
  const reason = opts.reason.trim();
  if (!reason) return { ok: false, message: "Skriv en årsag" };

  const stayInclude = { session: { select: { id: true, status: true, guestName: true } } } as const;
  const row = kind === "LAUNDRY"
    ? await prisma.laundrySess.findUnique({ where: { id }, include: { machine: true, ...stayInclude } })
    : await prisma.showerSess.findUnique({ where: { id }, include: { shower: true, ...stayInclude } });
  if (!row) return { ok: false, message: "Linjen findes ikke" };

  const device = "machine" in row ? row.machine : row.shower;
  const billingMode = "billingMode" in row ? row.billingMode : null;
  const reservedAmount = "reservedAmount" in row ? row.reservedAmount : null;
  const stayActive = row.session?.status === "ACTIVE";
  const plan = refundPlan({ ...row, billingMode, reservedAmount }, { stayActive });
  if (!plan.allowed) return { ok: false, message: plan.blockedReason ?? "Kan ikke annulleres" };

  let choice: RefundChoice | null = null;
  if (plan.choices.length > 0) {
    choice = opts.auto ? "NONE" : opts.choice ?? null;
    if (!choice || !plan.choices.includes(choice)) {
      return { ok: false, message: "Vælg hvordan pengene gives tilbage" };
    }
  }

  const channel = serviceChannel(row);
  const moneyBack = plan.automatic ? plan.amount : choice && choice !== "NONE" ? plan.amount : 0;
  const refundMethod = plan.automatic ?? (moneyBack > 0 ? choice! : "NONE");
  const wasRunning = row.status === "ACTIVE" || row.status === "PAUSED";
  const now = new Date();
  const label = device.name;
  const ref = `${kind === "LAUNDRY" ? "laundry" : "shower"}:${row.id}`;

  const data = {
    status: "CANCELLED",
    cancelledAt: now,
    cancelledBy: opts.by,
    cancelReason: reason,
    refundAmount: moneyBack,
    refundMethod,
    // Off the bill / back on the balance / paid back: the row no longer
    // counts as money taken or owed anywhere (checkout, invoices, statement).
    paymentStatus: moneyBack > 0 || plan.automatic ? "REFUNDED" : row.paymentStatus,
    paymentMethod: row.paymentMethod ?? channelMethod(channel),
    ...(wasRunning && { endsAt: now }),
  };

  try {
    await prisma.$transaction(async (tx) => {
      const where = { id, cancelledAt: null, status: { in: ["ACTIVE", "PAUSED", "COMPLETED"] } };
      const res = kind === "LAUNDRY"
        ? await tx.laundrySess.updateMany({ where, data })
        : await tx.showerSess.updateMany({ where, data: { ...data, ...(wasRunning && { pausedAt: null, pauseRemainingMs: null }) } });
      if (res.count === 0) throw new AlreadyCancelled();

      if (plan.automatic === "BALANCE" && moneyBack > 0 && row.sessionId) {
        await tx.session.update({ where: { id: row.sessionId }, data: { prepaidAmount: { increment: moneyBack } } });
      }
      if (plan.creditBack > 0 && row.sessionId) {
        await tx.session.update({ where: { id: row.sessionId }, data: { laundryCredit: { increment: plan.creditBack } } });
        await tx.serviceCreditEntry.create({
          data: {
            sessionId: row.sessionId,
            amount: plan.creditBack,
            reason: "REFUNDED",
            note: `${label}: ${reason}`,
            serviceRef: ref,
            createdBy: opts.by,
          },
        });
      }
      if (!plan.automatic && moneyBack > 0 && choice && choice !== "NONE") {
        await tx.payment.create({
          data: {
            amount: -moneyBack,
            method: choice,
            kind: "SERVICE",
            note: `Refusion ${label}: ${reason}`,
            createdBy: opts.by,
            reversesId: row.deskPaymentId ?? null,
          },
        });
      }
    });
  } catch (e) {
    if (e instanceof AlreadyCancelled) return { ok: false, message: "Linjen er allerede annulleret" };
    if ((e as { code?: string })?.code === "P2002") return { ok: false, message: "Betalingen er allerede refunderet" };
    logger.error(kind === "LAUNDRY" ? "laundry" : "shower", `Annullering af ${ref} fejlede`, e);
    return { ok: false, message: "Annulleringen kunne ikke gemmes — prøv igen" };
  }

  let relayNote = "";
  if (wasRunning) {
    try {
      await hardware.setSwitch(hardware.switchRowEp(device), false);
    } catch (e) {
      relayNote = " — relæet svarede ikke, sluk manuelt";
      logger.error(kind === "LAUNDRY" ? "laundry" : "shower", `${label}: relæ off ved annullering`, e);
    }
  }
  // A metered wash still running only holds a card reservation — release it.
  if (billingMode === "METERED" && row.status === "ACTIVE" && channel === "CARD" && row.paymentId) {
    try {
      const { cancelPayment } = await import("./quickpay");
      await cancelPayment(row.paymentId);
    } catch (e) {
      logger.error("laundry", `${ref}: frigivelse af kortreservation fejlede`, e);
    }
  }
  if (opts.auto && choice === "NONE" && plan.amount > 0) {
    logger.error(kind === "LAUNDRY" ? "laundry" : "shower", `${ref}: annulleret automatisk — ${kr(plan.amount)} betalt med kort skal refunderes manuelt (${row.paymentId ?? "?"})`);
  }

  const parts: string[] = [];
  if (refundMethod === "BALANCE" && moneyBack > 0) parts.push(`${kr(moneyBack)} tilbage på saldoen`);
  else if (refundMethod === "ACCOUNT") parts.push(moneyBack > 0 ? `${kr(moneyBack)} fjernet fra regningen` : "fjernet fra regningen");
  else if (moneyBack > 0) parts.push(`${kr(moneyBack)} refunderet (${PAY_METHOD_LABELS[refundMethod].toLowerCase()})`);
  if (plan.creditBack > 0) parts.push(`${kr(plan.creditBack)} kredit tilbage`);
  logger.info(
    kind === "LAUNDRY" ? "laundry" : "shower",
    `${label} (${ref}) annulleret${opts.by ? ` af ${opts.by}` : ""}: ${reason}${parts.length ? ` — ${parts.join(", ")}` : ""}`,
  );
  return { ok: true, message: `${label} annulleret${parts.length ? ` — ${parts.join(", ")}` : ""}${relayNote}` };
}
