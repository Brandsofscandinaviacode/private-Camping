// System-level tools: health/status, settings (masked) and booking sync.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/prisma";
import { readGlobalSettings } from "@/lib/settings";
import { getBaseUrl } from "@/lib/base-url";
import { arrivedNotCheckedInWhere, openReservationWhere, overdueStayWhere } from "@/lib/booking-status";
import { mqttClient } from "@/lib/mqtt-client";
import { isHiddenSetting, maskSettingValue } from "@/lib/mcp/redact";
import { readLogTail } from "@/lib/mcp/tools/logs";
import {
  expiredReservationWhere,
  registerReadOnlyTool,
  secondsSince,
  type McpToolContext,
} from "@/lib/mcp/tools/common";

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function dateOrNull(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

async function callerInfo(ctx: McpToolContext) {
  const auth = ctx.auth;
  if (!auth) return null;
  if (auth.kind === "key") return { via: "static read-only key" };
  const client = await prisma.mcpOAuthClient.findUnique({
    where: { clientId: auth.clientId },
    select: { clientName: true, createdAt: true },
  });
  return { via: "oauth", clientName: client?.clientName ?? null, authorizedSince: client?.createdAt ?? null, scope: auth.scope };
}

export function registerSystemTools(server: McpServer, ctx: McpToolContext): void {
  registerReadOnlyTool(server, {
    name: "get_system_status",
    title: "System status",
    description:
      "Health overview: cron (last run, last heavy 10-minute run, heavy-run status, meter-logging summary with per-unit reasons for missing readings), " +
      "meter read failures in the last hour, MQTT client connection state, key counts (units, active stays, open and expired reservations, unpaid sessions, invoices by status), " +
      "consumption-log freshness, feature flags and app/MCP info. Start here when diagnosing a problem.",
    input: z.object({}),
    handler: async () => {
      const settings = await readGlobalSettings();
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 3600_000).toISOString();

      const [
        unitCount,
        occupiedUnits,
        activeSessions,
        openReservations,
        expiredReservations,
        arrivedNotCheckedIn,
        overdueStays,
        unpaidCompletedSessions,
        invoicesByStatus,
        logCount,
        latestLog,
        activeOAuthClients,
        caller,
      ] = await Promise.all([
        prisma.unit.count(),
        prisma.unit.count({ where: { status: "OCCUPIED" } }),
        prisma.session.count({ where: { status: "ACTIVE" } }),
        prisma.session.count({ where: openReservationWhere(now) }),
        prisma.session.count({ where: expiredReservationWhere(now) }),
        prisma.session.count({ where: arrivedNotCheckedInWhere(now) }),
        prisma.session.count({ where: overdueStayWhere(now) }),
        prisma.session.count({ where: { status: "COMPLETED", paymentStatus: "UNPAID" } }),
        prisma.invoice.groupBy({ by: ["status"], _count: { _all: true }, _sum: { totalAmount: true } }),
        prisma.consumptionLog.count(),
        prisma.consumptionLog.findFirst({ orderBy: { recordedAt: "desc" }, select: { recordedAt: true } }),
        prisma.mcpOAuthClient.count({
          where: { tokens: { some: { revokedAt: null, expiresAt: { gt: now } } } },
        }),
        callerInfo(ctx),
      ]);

      const cronLastRun = dateOrNull(settings._cron_last_run);
      const cronLastFullRun = dateOrNull(settings._cron_last_full_run);

      return {
        serverTime: now,
        cron: {
          lastRun: cronLastRun,
          lastRunAgeSeconds: secondsSince(cronLastRun),
          lastStatus: settings._cron_last_status ?? null,
          // Heavy tasks (meter logging, billing ticks, invoices) run every ~10 min.
          lastFullRun: cronLastFullRun,
          lastFullRunAgeSeconds: secondsSince(cronLastFullRun),
          heavyStatus: settings._cron_heavy_status ?? null,
          alerts: Number(settings._cron_alerts ?? 0),
          logSummary: parseJson<unknown>(settings._cron_log_summary),
          expectedCadence: "fast tasks every 2 min, heavy tasks every 10 min",
        },
        meterFailuresLastHour: Object.keys(settings)
          .filter((k) => k.startsWith("_meter_fail_") && settings[k] > hourAgo)
          .map((k) => ({ context: k.replace("_meter_fail_", "").replace(/_/g, " ").trim(), lastFail: settings[k] }))
          .sort((a, b) => b.lastFail.localeCompare(a.lastFail))
          .slice(0, 50),
        mqtt: {
          enabled: settings.mqtt_enabled === "true",
          connected: mqttClient.isConnected(),
          host: settings.mqtt_host || null,
        },
        homeAssistant: { configured: !!(settings.ha_url && settings.ha_token), url: settings.ha_url || null },
        counts: {
          units: unitCount,
          occupiedUnits,
          activeSessions,
          openReservations,
          expiredReservations,
          // Open reservations whose arrival day has come but nobody checked in.
          arrivedNotCheckedIn,
          // ACTIVE stays past their planned checkout day.
          overdueStays,
          unpaidCompletedSessions,
          invoicesByStatus: Object.fromEntries(
            invoicesByStatus.map((g) => [g.status, { count: g._count._all, totalAmount: g._sum.totalAmount ?? 0 }]),
          ),
        },
        consumptionLog: {
          rows: logCount,
          latestAt: latestLog?.recordedAt ?? null,
          latestAgeSeconds: secondsSince(latestLog?.recordedAt),
        },
        features: {
          pricingMode: settings.pricing_mode || "fixed",
          quickpayEnabled: settings.quickpay_enabled === "true",
          bookingProvider: settings.booking_provider || "none",
          bookingAutoSync: settings.booking_auto_sync === "true",
          alarmEnabled: settings.alarm_enabled === "true",
          smsEnabled: settings.notifications_sms_enabled === "true",
          emailEnabled: settings.notifications_email_enabled === "true",
          invoiceEmailEnabled: settings.invoice_email_enabled === "true",
          autoPowerOffOnCheckout: settings.auto_power_off_on_checkout === "true",
          prepaidAutoPowerOff: settings.prepaid_auto_power_off === "true",
        },
        app: {
          siteUrl: getBaseUrl(settings),
          nodeVersion: process.version,
          environment: process.env.NODE_ENV ?? null,
          uptimeSeconds: Math.round(process.uptime()),
          serverTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        mcp: {
          enabled: settings.mcp_enabled === "true",
          staticKeyConfigured: !!settings.mcp_api_key_hash,
          authorizedOAuthClients: activeOAuthClients,
          caller,
        },
      };
    },
  });

  registerReadOnlyTool(server, {
    name: "get_settings_overview",
    title: "Settings (masked)",
    description:
      "All CampSense settings (Indstillinger) as key → value, excluding internal '_' bookkeeping keys and the MCP key. " +
      "Anything credential-like (keys, tokens, passwords, cookies, secrets) is shown only as '•••• (sat)' or '(ikke sat)'. Long templates are truncated.",
    input: z.object({
      prefix: z.string().max(64).optional().describe("Only keys starting with this prefix, e.g. 'mqtt_', 'pricing', 'danplanner_'"),
    }),
    handler: async ({ prefix }) => {
      const rows = await prisma.globalSetting.findMany({ orderBy: { key: "asc" } });
      const visible = rows.filter((r) => !isHiddenSetting(r.key) && (!prefix || r.key.startsWith(prefix)));
      return {
        count: visible.length,
        settings: Object.fromEntries(visible.map((r) => [r.key, maskSettingValue(r.key, r.value)])),
      };
    },
  });

  registerReadOnlyTool(server, {
    name: "get_booking_sync_status",
    title: "Booking sync status",
    description:
      "Status of the external booking-system sync (Danplanner): provider, auto-sync schedule, last sync time/result, whether credentials and a login session are stored (never their values), " +
      "how many imported reservations are open vs. expired (a PENDING booking whose planned checkout has passed without check-in counts as expired, not reserved), " +
      "a sample of expired reservations, and the latest danplanner log entries.",
    input: z.object({
      logLimit: z.number().int().min(0).max(100).default(20).describe("Recent danplanner log entries to include"),
    }),
    handler: async ({ logLimit }) => {
      const settings = await readGlobalSettings();
      const now = new Date();
      const intervalMin = Math.max(5, parseInt(settings.booking_sync_interval_minutes || "30", 10) || 30);
      const lastAttempt = dateOrNull(settings._booking_last_sync_attempt);

      const [openCount, expiredCount, expiredSample, linkedUnits, logs] = await Promise.all([
        prisma.session.count({ where: openReservationWhere(now) }),
        prisma.session.count({ where: expiredReservationWhere(now) }),
        prisma.session.findMany({
          where: expiredReservationWhere(now),
          orderBy: { checkInTime: "desc" },
          take: 10,
          select: {
            id: true,
            guestName: true,
            bookingRef: true,
            checkInTime: true,
            expectedCheckOut: true,
            unit: { select: { id: true, name: true } },
          },
        }),
        prisma.unit.count({ where: { externalId: { not: null } } }),
        logLimit > 0 ? readLogTail({ context: "danplanner", limit: logLimit }) : Promise.resolve(null),
      ]);

      return {
        provider: settings.booking_provider || "none",
        autoSync: settings.booking_auto_sync === "true",
        intervalMinutes: intervalMin,
        productType: settings.booking_sync_product_type || "all",
        lastSync: dateOrNull(settings._booking_last_sync),
        lastSyncStatus: settings._booking_last_sync_status ?? null,
        lastAttempt,
        nextDueAt: lastAttempt ? new Date(lastAttempt.getTime() + intervalMin * 60_000) : null,
        danplanner: {
          url: settings.danplanner_url || null,
          usernameSet: !!settings.danplanner_username,
          passwordSet: !!settings.danplanner_password,
          sessionStored: !!settings.danplanner_cookies,
          awaitingTwoFactor: !!settings.danplanner_approve_form,
        },
        unitsLinkedToBookingSystem: linkedUnits,
        reservations: {
          open: openCount,
          expired: expiredCount,
          expiredSample: expiredSample.map((s) => ({
            id: s.id,
            unit: s.unit,
            guestName: s.guestName,
            bookingRef: s.bookingRef,
            checkInTime: s.checkInTime,
            expectedCheckOut: s.expectedCheckOut,
          })),
        },
        recentLogs: logs?.entries ?? [],
      };
    },
  });
}
