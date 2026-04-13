import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCallbackChecksum, isPaymentAccepted } from "@/lib/quickpay";
import { activateLaundrySession, activateShowerSession, applyShowerExtension } from "@/lib/actions";

// QuickPay sends POST callback when payment status changes
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const checksum = req.headers.get("quickpay-checksum-sha256") || "";

    // Verify the callback authenticity
    const valid = await verifyCallbackChecksum(rawBody, checksum);
    if (!valid) {
      console.error("QuickPay callback: invalid checksum");
      return NextResponse.json({ error: "Invalid checksum" }, { status: 403 });
    }

    const body = JSON.parse(rawBody);
    const quickpayId = String(body.id);
    const accepted = isPaymentAccepted(body);

    if (!accepted) {
      console.log(`QuickPay callback: payment ${quickpayId} not yet accepted`);
      return NextResponse.json({ status: "noted" });
    }

    // 1. Check session payments
    const session = await prisma.session.findFirst({
      where: { paymentId: quickpayId },
    });

    if (session) {
      await prisma.session.update({
        where: { id: session.id },
        data: { paymentStatus: "PAID", paidAt: new Date() },
      });
      console.log(`QuickPay: Session ${session.id} marked as PAID`);
      return NextResponse.json({ status: "ok", type: "session", id: session.id });
    }

    // 2. Check invoice payments
    const invoice = await prisma.invoice.findFirst({
      where: { paymentId: quickpayId },
    });

    if (invoice) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: "PAID", paidAt: new Date() },
      });
      console.log(`QuickPay: Invoice ${invoice.id} marked as PAID`);
      return NextResponse.json({ status: "ok", type: "invoice", id: invoice.id });
    }

    // 3. Check laundry payments
    const laundrySess = await prisma.laundrySess.findFirst({
      where: { paymentId: quickpayId },
    });

    if (laundrySess) {
      await activateLaundrySession(laundrySess.id);
      console.log(`QuickPay: Laundry session ${laundrySess.id} activated`);
      return NextResponse.json({ status: "ok", type: "laundry", id: laundrySess.id });
    }

    // 3b. Check shower payments — either an initial purchase (PENDING)
    // or an extension on an active/paused session.
    const showerSess = await prisma.showerSess.findFirst({
      where: { paymentId: quickpayId },
    });

    if (showerSess) {
      if (showerSess.status === "PENDING") {
        await activateShowerSession(showerSess.id);
        console.log(`QuickPay: Shower session ${showerSess.id} activated`);
      } else if (showerSess.status === "ACTIVE" || showerSess.status === "PAUSED") {
        await applyShowerExtension(showerSess.id);
        console.log(`QuickPay: Shower session ${showerSess.id} extended`);
      }
      return NextResponse.json({ status: "ok", type: "shower", id: showerSess.id });
    }

    // 4. Check prepaid top-up payments (stored in session notes as TOPUP:paymentId:amount)
    //    Already-processed entries are marked TOPUP_DONE — skip those.
    const topupSession = await prisma.session.findFirst({
      where: { notes: { contains: `TOPUP:${quickpayId}:` } },
    });

    if (topupSession) {
      // Guard: skip if this topup was already processed (idempotency)
      if (topupSession.notes?.includes(`TOPUP_DONE:${quickpayId}:`)) {
        console.log(`QuickPay: Top-up ${quickpayId} already processed for session ${topupSession.id}, skipping`);
        return NextResponse.json({ status: "ok", type: "topup_duplicate", id: topupSession.id });
      }

      // Extract amount from notes
      const match = topupSession.notes?.match(new RegExp(`TOPUP:${quickpayId}:(\\d+\\.?\\d*)`));
      const topupAmount = match ? parseFloat(match[1]) : 0;

      if (topupAmount > 0) {
        const newPrepaid = (topupSession.prepaidAmount || 0) + topupAmount;
        // Mark as processed by renaming TOPUP → TOPUP_DONE so retries are ignored
        const updatedNotes = (topupSession.notes || "").replace(
          `TOPUP:${quickpayId}:${match![1]}`,
          `TOPUP_DONE:${quickpayId}:${match![1]}`
        );
        await prisma.session.update({
          where: { id: topupSession.id },
          data: { prepaidAmount: newPrepaid, notes: updatedNotes },
        });
        console.log(`QuickPay: Top-up ${topupAmount} DKK for session ${topupSession.id}, new balance: ${newPrepaid}`);
        return NextResponse.json({ status: "ok", type: "topup", id: topupSession.id, amount: topupAmount });
      }
    }

    console.warn(`QuickPay callback: no session/invoice/laundry found for payment ${quickpayId}`);
    return NextResponse.json({ status: "not_found" }, { status: 200 });
  } catch (e) {
    console.error("QuickPay callback error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
