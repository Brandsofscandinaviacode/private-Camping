import { NextResponse } from "next/server";
import {
  logAllConsumption,
  checkConsumptionAlarms,
  updateMultipleSettings,
  autoCreateAndSendInvoices,
  checkLaundryMachines,
  checkOverdueInvoices,
  checkPrepaidBalances,
} from "@/lib/actions";
import { refreshSpotPriceCache, cleanOldSpotPrices } from "@/lib/energi-data-service";

// GET /api/cron — Called periodically (e.g. every 15 min via cron or HA automation)
// Logs consumption, checks alarms, and auto-sends invoices on the configured day
// Example cron: */15 * * * * curl http://localhost:3000/api/cron
export async function GET() {
  try {
    await logAllConsumption();
    const { alerts } = await checkConsumptionAlarms();
    const invoiceResult = await autoCreateAndSendInvoices();
    const laundryResult = await checkLaundryMachines();
    const overdueResult = await checkOverdueInvoices();
    const prepaidResult = await checkPrepaidBalances();

    // Refresh spot price cache (proactive — keeps data fresh even if no page visits)
    let spotCacheResult = { fetched: 0, cleaned: 0 };
    try {
      const refreshed = await refreshSpotPriceCache();
      const cleaned = await cleanOldSpotPrices();
      spotCacheResult = { fetched: refreshed.fetched, cleaned };
    } catch {
      // Non-critical — don't fail the cron
    }

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
      overdue: overdueResult,
      prepaid: prepaidResult,
      spotCache: spotCacheResult,
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
