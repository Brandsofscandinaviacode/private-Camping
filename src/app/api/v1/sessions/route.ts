import { NextRequest, NextResponse } from "next/server";
import { authenticateAPI } from "@/lib/api-auth";
import { checkIn, checkOut, getActiveSession } from "@/lib/actions";
import { prisma } from "@/lib/prisma";

// GET /api/v1/sessions?unit_id=1&status=active — List sessions
export async function GET(req: NextRequest) {
  const auth = await authenticateAPI(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const unitId = req.nextUrl.searchParams.get("unit_id");
  const statusFilter = req.nextUrl.searchParams.get("status");

  const where: Record<string, unknown> = {};
  if (unitId) where.unitId = parseInt(unitId, 10);
  if (statusFilter === "active") where.status = "ACTIVE";
  if (statusFilter === "completed") where.status = "COMPLETED";

  const sessions = await prisma.session.findMany({
    where,
    include: { unit: true },
    orderBy: { checkInTime: "desc" },
    take: 100,
  });

  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      unitId: s.unitId,
      unitName: s.unit.name,
      unitType: s.unit.type,
      guestName: s.guestName,
      guestEmail: s.guestEmail,
      guestPhone: s.guestPhone,
      bookingRef: s.bookingRef,
      status: s.status,
      paymentStatus: s.paymentStatus,
      checkInTime: s.checkInTime.toISOString(),
      checkOutTime: s.checkOutTime?.toISOString() ?? null,
      startKwh: s.startKwh,
      endKwh: s.endKwh,
      startWaterLiters: s.startWaterLiters,
      endWaterLiters: s.endWaterLiters,
      totalElectricityCost: s.totalElectricityCost,
      totalWaterCost: s.totalWaterCost,
      totalCost: s.totalCost,
      externalPrice: s.externalPrice,
      externalDescription: s.externalDescription,
      guestPortalToken: s.guestPortalToken,
    })),
  });
}

// POST /api/v1/sessions — Check in a guest
// Body: { unit_id, guest_name, guest_email?, guest_phone?, booking_ref?, external_price?, external_description? }
export async function POST(req: NextRequest) {
  const auth = await authenticateAPI(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  try {
    const body = await req.json();
    const { unit_id, guest_name, guest_email, guest_phone, booking_ref, external_price, external_description } = body;

    if (!unit_id || !guest_name) {
      return NextResponse.json({ error: "unit_id and guest_name are required" }, { status: 400 });
    }

    const result = await checkIn(
      parseInt(unit_id, 10),
      guest_name,
      guest_email || undefined,
      guest_phone || undefined,
      booking_ref || undefined,
    );

    // If external_price is provided, update the session
    if (external_price != null) {
      await prisma.session.update({
        where: { id: result.session.id },
        data: {
          externalPrice: parseFloat(external_price),
          externalDescription: external_description || null,
        },
      });
    }

    const settings = await prisma.globalSetting.findMany();
    const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));
    const baseUrl = settingsMap.site_url || "http://localhost:3000";

    return NextResponse.json({
      session_id: result.session.id,
      guest_portal_token: result.guestPortalToken,
      guest_portal_url: `${baseUrl}/guest/${result.guestPortalToken}`,
      status: "ACTIVE",
    }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

// PATCH /api/v1/sessions — Update a session (checkout, set external price, mark paid)
// Body: { session_id, action: "checkout" | "set_price" | "mark_paid", external_price?, external_description?, payment_id? }
export async function PATCH(req: NextRequest) {
  const auth = await authenticateAPI(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  try {
    const body = await req.json();
    const { session_id, action, external_price, external_description, payment_id } = body;

    if (!session_id || !action) {
      return NextResponse.json({ error: "session_id and action are required" }, { status: 400 });
    }

    const id = parseInt(session_id, 10);

    if (action === "checkout") {
      const result = await checkOut(id);
      // Include external price in total if set
      const session = await prisma.session.findUnique({ where: { id } });
      const grandTotal = (result.totalCost || 0) + (session?.externalPrice || 0);
      return NextResponse.json({ ...result, externalPrice: session?.externalPrice, grandTotal });
    }

    if (action === "set_price") {
      await prisma.session.update({
        where: { id },
        data: {
          externalPrice: external_price != null ? parseFloat(external_price) : null,
          externalDescription: external_description || null,
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "mark_paid") {
      await prisma.session.update({
        where: { id },
        data: { paymentStatus: "PAID", paidAt: new Date(), paymentId: payment_id || null },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action. Use: checkout, set_price, mark_paid" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
