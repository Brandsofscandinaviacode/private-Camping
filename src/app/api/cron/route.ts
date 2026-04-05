import { NextResponse } from "next/server";
import { logAllConsumption, checkConsumptionAlarms, updateMultipleSettings } from "@/lib/actions";

// GET /api/cron — Called periodically (e.g. every 15 min via cron or HA automation)
// Logs consumption for all units and checks alarms
// Example cron: */15 * * * * curl http://localhost:3000/api/cron
export async function GET() {
  try {
    await logAllConsumption();
    const { alerts } = await checkConsumptionAlarms();

    // Track last run time and count
    await updateMultipleSettings([
      { key: "_cron_last_run", value: new Date().toISOString() },
      { key: "_cron_last_status", value: "ok" },
      { key: "_cron_alerts", value: String(alerts.length) },
    ]);

    return NextResponse.json({
      ok: true,
      logged: true,
      alerts: alerts.length,
      alertDetails: alerts,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    // Track failure
    try {
      await updateMultipleSettings([
        { key: "_cron_last_run", value: new Date().toISOString() },
        { key: "_cron_last_status", value: `fejl: ${msg}` },
      ]);
    } catch {}

    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
