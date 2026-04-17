import { NextRequest, NextResponse } from "next/server";
import { authenticateAPI } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

// GET /api/v1/invoices?unit_id=1&status=PENDING — List invoices
export async function GET(req: NextRequest) {
  const auth = await authenticateAPI(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const unitId = req.nextUrl.searchParams.get("unit_id");
  const statusFilter = req.nextUrl.searchParams.get("status");
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "100", 10), 500);

  const where: Record<string, unknown> = {};
  if (unitId) where.unitId = parseInt(unitId, 10);
  if (statusFilter) {
    const upper = statusFilter.toUpperCase();
    if (["DRAFT", "PENDING", "PAID", "OVERDUE"].includes(upper)) {
      where.status = upper;
    }
  }

  const invoices = await prisma.invoice.findMany({
    where,
    include: { unit: true },
    orderBy: { periodEnd: "desc" },
    take: limit,
  });

  return NextResponse.json({
    invoices: invoices.map((inv) => ({
      id: inv.id,
      unitId: inv.unitId,
      unitName: inv.unit.name,

      periodStart: inv.periodStart.toISOString(),
      periodEnd: inv.periodEnd.toISOString(),

      startKwh: inv.startKwh,
      endKwh: inv.endKwh,
      startHeatingKwh: inv.startHeatingKwh,
      endHeatingKwh: inv.endHeatingKwh,
      startWaterLiters: inv.startWaterLiters,
      endWaterLiters: inv.endWaterLiters,

      electricityCost: inv.electricityCost,
      waterCost: inv.waterCost,
      totalAmount: inv.totalAmount,

      status: inv.status,
      paidAt: inv.paidAt?.toISOString() ?? null,
      paymentId: inv.paymentId,

      createdAt: inv.createdAt.toISOString(),
    })),
  });
}
