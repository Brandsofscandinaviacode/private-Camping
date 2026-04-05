import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCallbackChecksum, isPaymentAccepted } from "@/lib/quickpay";

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
      // Payment not yet accepted — QuickPay may send multiple callbacks
      console.log(`QuickPay callback: payment ${quickpayId} not yet accepted`);
      return NextResponse.json({ status: "noted" });
    }

    // Find and update the session or invoice with this payment ID
    const session = await prisma.session.findFirst({
      where: { paymentId: quickpayId },
    });

    if (session) {
      await prisma.session.update({
        where: { id: session.id },
        data: {
          paymentStatus: "PAID",
          paidAt: new Date(),
        },
      });
      console.log(`QuickPay: Session ${session.id} marked as PAID`);
      return NextResponse.json({ status: "ok", type: "session", id: session.id });
    }

    const invoice = await prisma.invoice.findFirst({
      where: { paymentId: quickpayId },
    });

    if (invoice) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "PAID",
          paidAt: new Date(),
        },
      });
      console.log(`QuickPay: Invoice ${invoice.id} marked as PAID`);
      return NextResponse.json({ status: "ok", type: "invoice", id: invoice.id });
    }

    console.warn(`QuickPay callback: no session/invoice found for payment ${quickpayId}`);
    return NextResponse.json({ status: "not_found" }, { status: 200 });
  } catch (e) {
    console.error("QuickPay callback error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
