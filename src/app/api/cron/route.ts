import { NextResponse } from "next/server";
import {
  logAllConsumption,
  checkConsumptionAlarms,
  updateMultipleSettings,
  autoCreateAndSendInvoices,
  checkLaundryMachines,
  checkShowerSessions,
  checkOverdueInvoices,
  checkPrepaidBalances,
  tickAllSessionConsumption,
} from "@/lib/actions";
import { refreshSpotPriceCache, cleanOldSpotPrices } from "@/lib/energi-data-service";

// GET /api/cron — Called periodically (every 10 min via cron or HA automation)
// Logs consumption, ticks session accumulators against the current spot price,
// checks alarms, and auto-sends invoices on the configured day.
// IMPORTANT: run at least every 10 min so time-weighted spot-price billing
// stays accurate (worst-case discretisation error = the tick interval).
// Example cron: */10 * * * * curl http://localhost:3000/api/cron
export async function GET() {
  try {
    // Refresh spot prices BEFORE ticking sessions — the tick reads the
    // current hour's spot price, so we want it as fresh as possible.
    let spotCacheResult = { fetched: 0, cleaned: 0 };
    try {
      const refreshed = await refreshSpotPriceCache();
      const cleaned = await cleanOldSpotPrices();
      spotCacheResult = { fetched: refreshed.fetched, cleaned };
    } catch {
      // Non-critical — don't fail the cron
    }

    // Tick every active session: delta × current hourly spot price → accumulator
    const tickResult = await tickAllSessionConsumption();

    await logAllConsumption();
    const { alerts } = await checkConsumptionAlarms();
    const invoiceResult = await autoCreateAndSendInvoices();
    const laundryResult = await checkLaundryMachines();
    const showerResult = await checkShowerSessions();
    const overdueResult = await checkOverdueInvoices();
    const prepaidResult = await checkPrepaidBalances();

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
      invoices: invoiceResult,
      laundry: laundryResult,
      showers: showerResult,
      overdue: overdueResult,
      prepaid: prepaidResult,
      spotCache: spotCacheResult,
      consumptionTick: tickResult,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    try {
      await updateMultipleSettings([
        { key: "_cron_last_run", value: new Date().toISOString() },
        { key: "_cron_last_status", value: `fejl: ${msg}` },
      ]);
    } catch {}

    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
