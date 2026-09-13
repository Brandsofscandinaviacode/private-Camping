import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCallbackChecksum, isPaymentAccepted } from "@/lib/quickpay";
import { activateLaundrySession, activateShowerSession, applyShowerExtension } from "@/lib/actions";
import { logger } from "@/lib/logger";
import { resolvePrepaidDeposited, restorePrepaidPowerIfFunded } from "@/lib/prepaid";

function getCallbackAmount(body: Record<string, unknown>): number | null {
  const ops = body.operations;
  if (!Array.isArray(ops) || ops.length === 0) return null;
  const last = ops[ops.length - 1];
  if (typeof last?.amount === "number") return last.amount;
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const checksum = req.headers.get("quickpay-checksum-sha256") || "";

    const valid = await verifyCallbackChecksum(rawBody, checksum);
    if (!valid) {
      logger.error("quickpay", "Invalid callback checksum");
      return NextResponse.json({ error: "Invalid checksum" }, { status: 403 });
    }

    const body = JSON.parse(rawBody);
    const quickpayId = String(body.id);
    const accepted = isPaymentAccepted(body);

    if (!accepted) {
      logger.info("quickpay", `Payment ${quickpayId} not yet accepted`);
      return NextResponse.json({ status: "noted" });
    }

    const paidAmountOere = getCallbackAmount(body);

    // 1. Check session payments
    const session = await prisma.session.findFirst({
      where: { paymentId: quickpayId },
    });

    if (session) {
      if (paidAmountOere !== null && session.totalCost !== null) {
        const expectedOere = Math.round(session.totalCost * 100);
        if (paidAmountOere < expectedOere) {
          logger.error("quickpay", `Session ${session.id}: amount mismatch — paid ${paidAmountOere} øre, expected ${expectedOere} øre`);
          return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
        }
      }
      await prisma.session.update({
        where: { id: session.id },
        data: { paymentStatus: "PAID", paidAt: new Date() },
      });
      logger.info("quickpay", `Session ${session.id} marked as PAID`);
      return NextResponse.json({ status: "ok", type: "session", id: session.id });
    }

    // 2. Check invoice payments
    const invoice = await prisma.invoice.findFirst({
      where: { paymentId: quickpayId },
    });

    if (invoice) {
      if (paidAmountOere !== null) {
        const expectedOere = Math.round(invoice.totalAmount * 100);
        if (paidAmountOere < expectedOere) {
          logger.error("quickpay", `Invoice ${invoice.id}: amount mismatch — paid ${paidAmountOere} øre, expected ${expectedOere} øre`);
          return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
        }
      }
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: "PAID", paidAt: new Date() },
      });
      logger.info("quickpay", `Invoice ${invoice.id} marked as PAID`);
      return NextResponse.json({ status: "ok", type: "invoice", id: invoice.id });
    }

    // 3. Check laundry payments
    const laundrySess = await prisma.laundrySess.findFirst({
      where: { paymentId: quickpayId },
    });

    if (laundrySess) {
      // Skip amount validation for metered sessions (pre-auth amount ≠ final charge).
      // The link was for chargedAmount (price minus laundry credit), not pricePaid.
      if (paidAmountOere !== null && laundrySess.billingMode !== "METERED") {
        const expectedOere = Math.round((laundrySess.chargedAmount ?? laundrySess.pricePaid) * 100);
        if (paidAmountOere < expectedOere) {
          logger.error("quickpay", `Laundry ${laundrySess.id}: amount mismatch — paid ${paidAmountOere} øre, expected ${expectedOere} øre`);
          return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
        }
      }
      // A guest who took longer than the pending TTL on the card page arrives
      // here with an auto-CANCELLED row but a captured payment. Re-open it if
      // the machine is still free; otherwise flag it loudly for a refund.
      if (laundrySess.status === "CANCELLED") {
        const busy = await prisma.laundrySess.findFirst({
          where: { machineId: laundrySess.machineId, status: "ACTIVE", endsAt: { gt: new Date() } },
          select: { id: true },
        });
        if (busy) {
          logger.error("quickpay", `Laundry ${laundrySess.id}: paid after cancel but machine busy — REFUND ${quickpayId} manually`);
          return NextResponse.json({ status: "ok", type: "laundry_late_busy", id: laundrySess.id });
        }
        await prisma.laundrySess.update({ where: { id: laundrySess.id }, data: { status: "PENDING" } });
        logger.warn("quickpay", `Laundry ${laundrySess.id}: late payment after auto-cancel — re-opened`);
      }
      await activateLaundrySession(laundrySess.id);
      logger.info("quickpay", `Laundry session ${laundrySess.id} activated`);
      return NextResponse.json({ status: "ok", type: "laundry", id: laundrySess.id });
    }

    // 4. Check shower payments
    const showerSess = await prisma.showerSess.findFirst({
      where: { paymentId: quickpayId },
      include: { shower: { select: { pricePerMinute: true } } },
    });

    if (showerSess) {
      if (paidAmountOere !== null) {
        // For an extension the link was for the extra minutes only — pricePaid
        // is the running total, so comparing against it rejected every extension.
        const isExtension = showerSess.status === "ACTIVE" || showerSess.status === "PAUSED";
        const expectedDKK = isExtension
          ? (showerSess.pendingMinutes ?? 0) * showerSess.shower.pricePerMinute
          : showerSess.pricePaid;
        const expectedOere = Math.round(expectedDKK * 100);
        if (paidAmountOere < expectedOere) {
          logger.error("quickpay", `Shower ${showerSess.id}: amount mismatch — paid ${paidAmountOere} øre, expected ${expectedOere} øre`);
          return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
        }
      }
      if (showerSess.status === "CANCELLED") {
        const busy = await prisma.showerSess.findFirst({
          where: { showerId: showerSess.showerId, status: { in: ["ACTIVE", "PAUSED"] }, endsAt: { gt: new Date() } },
          select: { id: true },
        });
        if (busy) {
          logger.error("quickpay", `Shower ${showerSess.id}: paid after cancel but shower busy — REFUND ${quickpayId} manually`);
          return NextResponse.json({ status: "ok", type: "shower_late_busy", id: showerSess.id });
        }
        await prisma.showerSess.update({ where: { id: showerSess.id }, data: { status: "PENDING" } });
        showerSess.status = "PENDING";
        logger.warn("quickpay", `Shower ${showerSess.id}: late payment after auto-cancel — re-opened`);
      }
      if (showerSess.status === "PENDING") {
        await activateShowerSession(showerSess.id);
        logger.info("quickpay", `Shower session ${showerSess.id} activated`);
      } else if (showerSess.status === "ACTIVE" || showerSess.status === "PAUSED") {
        await applyShowerExtension(showerSess.id);
        logger.info("quickpay", `Shower session ${showerSess.id} extended`);
      }
      return NextResponse.json({ status: "ok", type: "shower", id: showerSess.id });
    }

    // 5. Check prepaid top-up payments (using PrepaidTopUp model for idempotency)
    const existingTopUp = await prisma.prepaidTopUp.findUnique({
      where: { paymentId: quickpayId },
    });

    if (existingTopUp) {
      logger.info("quickpay", `Top-up ${quickpayId} already processed for session ${existingTopUp.sessionId}, skipping`);
      return NextResponse.json({ status: "ok", type: "topup_duplicate", id: existingTopUp.sessionId });
    }

    // Legacy: check notes for TOPUP:paymentId:amount pattern
    const topupSession = await prisma.session.findFirst({
      where: { notes: { contains: `TOPUP:${quickpayId}:` } },
    });

    if (topupSession) {
      if (topupSession.notes?.includes(`TOPUP_DONE:${quickpayId}:`)) {
        logger.info("quickpay", `Top-up ${quickpayId} already processed (legacy) for session ${topupSession.id}`);
        return NextResponse.json({ status: "ok", type: "topup_duplicate", id: topupSession.id });
      }

      const match = topupSession.notes?.match(new RegExp(`TOPUP:${quickpayId}:(\\d+\\.?\\d*)`));
      const topupAmount = match ? parseFloat(match[1]) : 0;

      if (topupAmount > 0) {
        if (paidAmountOere !== null) {
          const expectedOere = Math.round(topupAmount * 100);
          if (paidAmountOere < expectedOere) {
            logger.error("quickpay", `Top-up ${quickpayId}: amount mismatch — paid ${paidAmountOere} øre, expected ${expectedOere} øre`);
            return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
          }
        }

        // Deposited total must grow too — but `increment` on a NULL column
        // stays NULL in SQLite, so resolve the legacy fallback and set it
        // absolutely.
        const depositedBefore = await resolvePrepaidDeposited(topupSession);
        await prisma.$transaction([
          prisma.session.update({
            where: { id: topupSession.id },
            data: {
              prepaidAmount: { increment: topupAmount },
              prepaidDeposited: depositedBefore + topupAmount,
              notes: (topupSession.notes || "").replace(
                `TOPUP:${quickpayId}:${match![1]}`,
                `TOPUP_DONE:${quickpayId}:${match![1]}`,
              ),
            },
          }),
          prisma.prepaidTopUp.create({
            data: {
              sessionId: topupSession.id,
              paymentId: quickpayId,
              amount: topupAmount,
            },
          }),
        ]);

        logger.info("quickpay", `Top-up ${topupAmount} DKK for session ${topupSession.id}`);
        // A prior auto power-off is now funded — turn the electricity back on.
        await restorePrepaidPowerIfFunded(topupSession.id);
        return NextResponse.json({ status: "ok", type: "topup", id: topupSession.id, amount: topupAmount });
      }
    }

    logger.warn("quickpay", `No matching record found for payment ${quickpayId}`);
    return NextResponse.json({ status: "not_found" }, { status: 200 });
  } catch (e) {
    logger.error("quickpay", "Callback processing error", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
