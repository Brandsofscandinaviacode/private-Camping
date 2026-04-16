import { NextRequest, NextResponse } from "next/server";
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
import { authenticateAPI } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

// GET /api/cron — Called every 2 minutes.
//
// Fast tasks (every call, ~2 min): shower/laundry session expiry + auto-resume.
// Heavy tasks (throttled to ~10 min): spot price refresh, consumption tick,
// meter logging, alarms, invoices, overdue/prepaid checks.
//
// The heavy-task interval is tracked via `_cron_last_full_run` in the DB so
// the cron itself stays stateless and can be called from any scheduler.
//
// Requires Bearer auth — set the API key in Admin → Indstillinger → System.
// Example cron: */2 * * * * curl -H "Authorization: Bearer <api_key>" http://localhost:3000/api/cron
export async function GET(req: NextRequest) {
  const auth = await authenticateAPI(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const HEAVY_INTERVAL_MS = 10 * 60_000; // 10 minutes

  try {
    // ── Fast tasks (every call) ──────────────────────────────
    const laundryResult = await checkLaundryMachines();
    const showerResult = await checkShowerSessions();

    // ── Should we run heavy tasks? ───────────────────────────
    let lastFullRun = 0;
    try {
      const row = await prisma.globalSetting.findUnique({
        where: { key: "_cron_last_full_run" },
      });
      if (row?.value) lastFullRun = new Date(row.value).getTime();
    } catch { /* treat as never run */ }

    const sinceLastFull = Date.now() - lastFullRun;
    const runHeavy = sinceLastFull >= HEAVY_INTERVAL_MS;

    let spotCacheResult = { fetched: 0, cleaned: 0 };
    let tickResult: Awaited<ReturnType<typeof tickAllSessionConsumption>> | null = null;
    let alerts: unknown[] = [];
    let invoiceResult = null;
    let overdueResult = null;
    let prepaidResult = null;

    if (runHeavy) {
      // Refresh spot prices BEFORE ticking sessions — the tick reads the
      // current hour's spot price, so we want it as fresh as possible.
      try {
        const refreshed = await refreshSpotPriceCache();
        const cleaned = await cleanOldSpotPrices();
        spotCacheResult = { fetched: refreshed.fetched, cleaned };
      } catch {
        // Non-critical — don't fail the cron
      }

      // Tick every active session: delta × current hourly spot price → accumulator
      tickResult = await tickAllSessionConsumption();

      await logAllConsumption();
      const alarmResult = await checkConsumptionAlarms();
      alerts = alarmResult.alerts;
      invoiceResult = await autoCreateAndSendInvoices();
      overdueResult = await checkOverdueInvoices();
      prepaidResult = await checkPrepaidBalances();
    }

    // Track last run time
    const settingsToUpdate = [
      { key: "_cron_last_run", value: new Date().toISOString() },
      { key: "_cron_last_status", value: "ok" },
    ];
    if (runHeavy) {
      settingsToUpdate.push(
        { key: "_cron_last_full_run", value: new Date().toISOString() },
        { key: "_cron_alerts", value: String(alerts.length) },
      );
    }
    await updateMultipleSettings(settingsToUpdate);

    return NextResponse.json({
      ok: true,
      ranHeavyTasks: runHeavy,
      laundry: laundryResult,
      showers: showerResult,
      ...(runHeavy
        ? {
            logged: true,
            alerts: alerts.length,
            alertDetails: alerts,
            invoices: invoiceResult,
            overdue: overdueResult,
            prepaid: prepaidResult,
            spotCache: spotCacheResult,
            consumptionTick: tickResult,
          }
        : {}),
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
