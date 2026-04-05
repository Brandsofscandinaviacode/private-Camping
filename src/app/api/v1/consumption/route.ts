import { NextRequest, NextResponse } from "next/server";
import { authenticateAPI } from "@/lib/api-auth";
import { getLiveConsumption, getConsumptionLogs, getTotalUsage, getPricing, getEffectiveElPricing } from "@/lib/actions";

// GET /api/v1/consumption?session_id=1 — Get live consumption for a session
// GET /api/v1/consumption?unit_id=1&days=7 — Get consumption logs for a unit
// GET /api/v1/consumption?total=true — Get total current consumption rate
// GET /api/v1/consumption?pricing=true — Get current pricing
export async function GET(req: NextRequest) {
  const auth = await authenticateAPI(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const sessionId = req.nextUrl.searchParams.get("session_id");
  const unitId = req.nextUrl.searchParams.get("unit_id");
  const days = req.nextUrl.searchParams.get("days");
  const total = req.nextUrl.searchParams.get("total");
  const pricing = req.nextUrl.searchParams.get("pricing");

  // Get pricing (includes effective spot price if applicable)
  if (pricing === "true") {
    const p = await getPricing();
    let effectivePrice = null;
    try { effectivePrice = await getEffectiveElPricing(); } catch { /* fallback */ }
    return NextResponse.json({
      ...p,
      effectiveElPrice: effectivePrice,
    });
  }

  // Get total usage rate
  if (total === "true") {
    const usage = await getTotalUsage();
    return NextResponse.json(usage);
  }

  // Get live consumption for a session
  if (sessionId) {
    const data = await getLiveConsumption(parseInt(sessionId, 10));
    if (!data) return NextResponse.json({ error: "Session not found or not active" }, { status: 404 });
    return NextResponse.json(data);
  }

  // Get consumption logs for a unit
  if (unitId) {
    const logs = await getConsumptionLogs(parseInt(unitId, 10), parseInt(days || "7", 10));
    return NextResponse.json({
      logs: logs.map((l) => ({
        recordedAt: l.recordedAt.toISOString(),
        electricityKwh: l.electricityKwh,
        waterLiters: l.waterLiters,
      })),
    });
  }

  return NextResponse.json({ error: "Provide session_id, unit_id, total=true, or pricing=true" }, { status: 400 });
}
