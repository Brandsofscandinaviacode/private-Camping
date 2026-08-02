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
  autoSyncBookings,
} from "@/lib/actions";
import { refreshSpotPriceCache, cleanOldSpotPrices } from "@/lib/energi-data-service";
import { authenticateAPI } from "@/lib/api-auth";
import { runWithApiAuth } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

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

    // ── Booking auto-sync ────────────────────────────────────
    // Called on every tick but self-throttling: it honours its own
    // `booking_sync_interval_minutes` setting, so the admin-chosen cadence is
    // respected exactly rather than being rounded to the heavy-task interval.
    // Runs with API auth because syncBookings() calls requireAuth().
    let bookingSync: Awaited<ReturnType<typeof autoSyncBookings>> = { ran: false };
    try {
      bookingSync = await runWithApiAuth(() => autoSyncBookings());
    } catch (e) {
      logger.error("cron", "Booking auto-sync failed", e instanceof Error ? e.message : e);
    }

    // ── Should we run heavy tasks? ───────────────────────────
    // Atomic check-and-set: only one cron invocation runs heavy tasks at a time.
    // Uses updateMany with a WHERE guard on the timestamp to prevent overlap.
    let lastFullRun = 0;
    try {
      const row = await prisma.globalSetting.findUnique({
        where: { key: "_cron_last_full_run" },
      });
      if (row?.value) lastFullRun = new Date(row.value).getTime();
    } catch { /* treat as never run */ }

    const sinceLastFull = Date.now() - lastFullRun;
    let runHeavy = sinceLastFull >= HEAVY_INTERVAL_MS;

    if (runHeavy) {
      const lockValue = new Date().toISOString();
      const prevValue = lastFullRun ? new Date(lastFullRun).toISOString() : null;
      try {
        if (prevValue) {
          const locked = await prisma.globalSetting.updateMany({
            where: { key: "_cron_last_full_run", value: prevValue },
            data: { value: lockValue },
          });
          if (locked.count === 0) {
            runHeavy = false;
            logger.info("cron", "Heavy task lock already taken by another instance, skipping");
          }
        } else {
          await prisma.globalSetting.upsert({
            where: { key: "_cron_last_full_run" },
            create: { key: "_cron_last_full_run", value: lockValue },
            update: { value: lockValue },
          });
        }
      } catch {
        runHeavy = false;
      }
    }

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
      bookingSync,
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
