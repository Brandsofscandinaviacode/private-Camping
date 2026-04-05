import { NextResponse } from "next/server";
import { logAllConsumption, checkConsumptionAlarms } from "@/lib/actions";

// GET /api/cron — Called periodically (e.g. every 15 min via cron or HA automation)
// Logs consumption for all units and checks alarms
// Example cron: */15 * * * * curl http://localhost:3000/api/cron
export async function GET() {
  try {
    await logAllConsumption();
    const { alerts } = await checkConsumptionAlarms();

    return NextResponse.json({
      ok: true,
      logged: true,
      alerts: alerts.length,
      alertDetails: alerts,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
