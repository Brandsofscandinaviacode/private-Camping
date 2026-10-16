// Laundry/shower status and electricity pricing. Reads only — unlike the
// admin page's getServiceStatus, stale PENDING payments are reported, not
// cancelled.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/prisma";
import { getPricing } from "@/lib/actions";
import { getCurrentSpotPrice } from "@/lib/energi-data-service";
import { cphBuckets, registerReadOnlyTool, secondsSince } from "@/lib/mcp/tools/common";

// Mirrors PENDING_PAYMENT_TTL_MS in actions.ts: older PENDING rows get cancelled
// the next time the admin services page or the cron looks at them.
const PENDING_PAYMENT_TTL_MS = 15 * 60_000;

const guestRef = {
  select: { id: true, guestName: true, unit: { select: { id: true, name: true } } },
} as const;

type Mode = "fixed" | "minimum" | "spot";

/** Same rule as getEffectiveElPrice, without its logging side effect. */
function effectivePrice(mode: Mode, fixed: number, surcharge: number, spot: number | null): number {
  if (mode === "fixed" || spot === null) return fixed;
  if (mode === "minimum") return Math.max(fixed, spot);
  return spot + surcharge;
}

export function registerServiceTools(server: McpServer): void {
  registerReadOnlyTool(server, {
    name: "get_services_status",
    title: "Laundry & shower status",
    description:
      "Laundry machines and showers with configuration (source, switch entity / MQTT prefix, price, billing mode) and their current or pending use: status, startedAt, endsAt, time left, " +
      "paid amount, payment status, and for metered laundry the live meter fields (lastPowerW, lastPowerAt, billedMinutes, idleSince). " +
      "Also lists PENDING card payments and flags those older than 15 minutes (stale, due for auto-cancel).",
    input: z.object({}),
    handler: async () => {
      const now = new Date();
      const [machines, showers, pendingLaundry, pendingShowers] = await Promise.all([
        prisma.laundryMachine.findMany({
          orderBy: { name: "asc" },
          include: {
            group: { select: { name: true } },
            sessions: {
              where: { status: { in: ["ACTIVE", "PENDING"] } },
              orderBy: { startedAt: "desc" },
              take: 3,
              include: { session: guestRef },
            },
          },
        }),
        prisma.shower.findMany({
          orderBy: { name: "asc" },
          include: {
            sessions: {
              where: { status: { in: ["ACTIVE", "PAUSED", "PENDING"] } },
              orderBy: { startedAt: "desc" },
              take: 3,
              include: { session: guestRef },
            },
          },
        }),
        prisma.laundrySess.findMany({
          where: { status: "PENDING" },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { machine: { select: { id: true, name: true } } },
        }),
        prisma.showerSess.findMany({
          where: { status: "PENDING" },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { shower: { select: { id: true, name: true } } },
        }),
      ]);

      const secondsLeft = (endsAt: Date) => Math.max(0, Math.round((endsAt.getTime() - now.getTime()) / 1000));
      const stale = (createdAt: Date) => now.getTime() - createdAt.getTime() > PENDING_PAYMENT_TTL_MS;

      return {
        serverTime: now,
        laundryMachines: machines.map((m) => ({
          id: m.id,
          name: m.name,
          kind: m.kind,
          enabled: m.enabled,
          code: m.code,
          location: m.location,
          group: m.group?.name ?? null,
          hardware: { source: m.source, switchEntityId: m.switchEntityId, mqttPrefix: m.mqttPrefix, mqttComponent: m.mqttComponent, powerEntityId: m.powerEntityId },
          billingMode: m.billingMode,
          pricing:
            m.billingMode === "METERED"
              ? { pricePerMinute: m.pricePerMinute, maxReservationDKK: m.maxReservationDKK, powerThresholdW: m.powerThresholdW, idleTimeoutMinutes: m.idleTimeoutMinutes }
              : { pricePerUse: m.pricePerUse, durationMinutes: m.durationMinutes },
          current: m.sessions.map((l) => ({
            id: l.id,
            status: l.status,
            startedAt: l.startedAt,
            endsAt: l.endsAt,
            secondsLeft: l.status === "ACTIVE" ? secondsLeft(l.endsAt) : null,
            programName: l.programName,
            durationMinutes: l.durationMinutes,
            pricePaid: l.pricePaid,
            chargedAmount: l.chargedAmount,
            paymentStatus: l.paymentStatus,
            billingMode: l.billingMode,
            ...(l.billingMode === "METERED"
              ? {
                  metered: {
                    pricePerMinute: l.pricePerMinute,
                    reservedAmount: l.reservedAmount,
                    meterStartedAt: l.meterStartedAt,
                    meterEndedAt: l.meterEndedAt,
                    billedMinutes: l.billedMinutes,
                    lastPowerW: l.lastPowerW,
                    lastPowerAt: l.lastPowerAt,
                    lastPowerAgeSeconds: secondsSince(l.lastPowerAt),
                    idleSince: l.idleSince,
                  },
                }
              : {}),
            guestSession: l.session,
          })),
        })),
        showers: showers.map((s) => ({
          id: s.id,
          name: s.name,
          enabled: s.enabled,
          code: s.code,
          location: s.location,
          hardware: { source: s.source, switchEntityId: s.switchEntityId, mqttPrefix: s.mqttPrefix, mqttComponent: s.mqttComponent },
          pricing: { pricePerMinute: s.pricePerMinute, minMinutes: s.minMinutes, maxMinutes: s.maxMinutes },
          current: s.sessions.map((x) => ({
            id: x.id,
            status: x.status,
            startedAt: x.startedAt,
            endsAt: x.endsAt,
            secondsLeft:
              x.status === "ACTIVE"
                ? secondsLeft(x.endsAt)
                : x.status === "PAUSED" && x.pauseRemainingMs
                  ? Math.ceil(x.pauseRemainingMs / 1000)
                  : null,
            pausedAt: x.pausedAt,
            minutesPaid: x.minutesPaid,
            pricePaid: x.pricePaid,
            paymentStatus: x.paymentStatus,
            pendingMinutes: x.pendingMinutes,
            guestSession: x.session,
          })),
        })),
        pendingPayments: {
          laundry: pendingLaundry.map((l) => ({
            id: l.id,
            machine: l.machine,
            createdAt: l.createdAt,
            ageSeconds: secondsSince(l.createdAt),
            stale: stale(l.createdAt),
            pricePaid: l.pricePaid,
            chargedAmount: l.chargedAmount,
            billingMode: l.billingMode,
            sessionId: l.sessionId,
          })),
          showers: pendingShowers.map((x) => ({
            id: x.id,
            shower: x.shower,
            createdAt: x.createdAt,
            ageSeconds: secondsSince(x.createdAt),
            stale: stale(x.createdAt),
            minutesPaid: x.minutesPaid,
            pricePaid: x.pricePaid,
            sessionId: x.sessionId,
          })),
        },
      };
    },
  });

  registerReadOnlyTool(server, {
    name: "get_pricing",
    title: "Electricity & water pricing",
    description:
      "Pricing settings (mode fixed / minimum / spot, fixed price, spot surcharge, price area DK1/DK2, water price, currency), the effective electricity price right now " +
      "(fixed; max(fixed, spot); or spot + surcharge — falls back to the fixed price when no current spot price is cached) and the cached hourly spot prices for the next 24 hours " +
      "with the effective price per hour. Prices in DKK per kWh; hours in Danish local time. Per-booking overrides (see get_session) take precedence.",
    input: z.object({
      hours: z.number().int().min(1).max(48).default(24).describe("How many hours of spot prices to include"),
    }),
    handler: async ({ hours }) => {
      const pricing = await getPricing();
      const mode = pricing.pricingMode;
      const area = pricing.edsPriceArea;
      const now = new Date();
      const fromHour = cphBuckets(now).hour;
      const toHour = cphBuckets(new Date(now.getTime() + hours * 3600_000)).hour;

      const [spot, rows, latest] = await Promise.all([
        getCurrentSpotPrice(area),
        prisma.spotPriceCache.findMany({
          where: { area, hourDK: { gte: fromHour, lt: toHour } },
          orderBy: { hourDK: "asc" },
          select: { hourDK: true, priceDKK: true },
        }),
        prisma.spotPriceCache.findFirst({ where: { area }, orderBy: { hourDK: "desc" }, select: { hourDK: true } }),
      ]);

      return {
        mode,
        area,
        currency: pricing.currency,
        fixedPricePerKwh: pricing.pricePerKwh,
        spotSurchargePerKwh: pricing.elSurcharge,
        waterPricePerLiter: pricing.pricePerLiterWater,
        current: {
          hourDK: fromHour,
          spotPricePerKwh: spot,
          effectivePricePerKwh: effectivePrice(mode, pricing.pricePerKwh, pricing.elSurcharge, spot),
          ...(mode !== "fixed" && spot === null ? { note: "No cached spot price for this hour — billing falls back to the fixed price." } : {}),
        },
        latestCachedHour: latest?.hourDK ?? null,
        nextHours: rows.map((r) => {
          const spotKwh = r.priceDKK / 1000;
          return {
            hourDK: r.hourDK,
            spotPricePerKwh: spotKwh,
            effectivePricePerKwh: effectivePrice(mode, pricing.pricePerKwh, pricing.elSurcharge, spotKwh),
          };
        }),
      };
    },
  });
}
