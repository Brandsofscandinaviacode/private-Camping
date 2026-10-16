// Unit (plads/hytte) tools: overview, detail, live meter read and
// consumption history. Nothing here switches a relay or writes a row.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { UnitHardware } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { openReservationWhere } from "@/lib/booking-status";
import * as hardware from "@/lib/hardware";
import type { HardwareEndpoint } from "@/lib/hardware";
import * as ha from "@/lib/homeassistant";
import { mqttClient } from "@/lib/mqtt-client";
import { unitDisplayName } from "@/lib/utils";
import { maskEmail, maskPhone } from "@/lib/mcp/redact";
import {
  ToolError,
  cphBuckets,
  expiredReservationWhere,
  registerReadOnlyTool,
  secondsSince,
  sessionSummary,
  SITE_TIME_ZONE,
} from "@/lib/mcp/tools/common";

const unitIdInput = z.number().int().positive().describe("Unit id (from list_units)");

function source(s: string): "HA" | "MQTT" {
  return s === "MQTT" ? "MQTT" : "HA";
}

/** Which meters/switches are wired up, without the entity ids. */
function hardwareSummary(hw: UnitHardware | null) {
  if (!hw) return null;
  return {
    electricity: hw.hasElectricity
      ? {
          source: source(hw.electricitySource),
          switch: hardware.hasElectricitySwitch(hw),
          meter: hardware.hasElectricityMeter(hw),
          power: hardware.hasElectricityPower(hw),
        }
      : null,
    heating: hw.hasHeating
      ? {
          source: source(hw.heatingSource),
          switch: hardware.hasHeatingSwitch(hw),
          meter: hardware.hasHeatingMeter(hw),
          power: hardware.hasHeatingPower(hw),
          winterMode: hw.winterModeEnabled,
        }
      : null,
    water: hw.hasWater ? { source: source(hw.waterSource), meter: hardware.hasWaterMeter(hw) } : null,
    climate: hw.hasClimate ? { configured: !!hw.climateEntityId } : null,
    smartLock: hw.hasSmartLock ? { configured: !!hw.lockEntityId } : null,
  };
}

/** Full endpoint configuration — entity ids and MQTT topics are not secrets. */
function hardwareConfig(hw: UnitHardware) {
  return {
    electricity: {
      enabled: hw.hasElectricity,
      source: source(hw.electricitySource),
      ha: { switch: hw.electricitySwitchEntityId, meter: hw.electricityMeterEntityId, power: hw.electricityPowerEntityId },
      mqtt: { prefix: hw.electricityMqttPrefix, component: hw.electricityMqttComponent },
      usable: {
        switch: hardware.hasElectricitySwitch(hw),
        meter: hardware.hasElectricityMeter(hw),
        power: hardware.hasElectricityPower(hw),
      },
    },
    heating: {
      enabled: hw.hasHeating,
      source: source(hw.heatingSource),
      ha: { switch: hw.heatingSwitchEntityId, meter: hw.heatingMeterEntityId, power: hw.heatingPowerEntityId },
      mqtt: { prefix: hw.heatingMqttPrefix, component: hw.heatingMqttComponent },
      winterModeEnabled: hw.winterModeEnabled,
      usable: {
        switch: hardware.hasHeatingSwitch(hw),
        meter: hardware.hasHeatingMeter(hw),
        power: hardware.hasHeatingPower(hw),
      },
    },
    water: {
      enabled: hw.hasWater,
      source: source(hw.waterSource),
      ha: { meter: hw.waterMeterEntityId },
      mqtt: { prefix: hw.waterMqttPrefix, component: hw.waterMqttComponent },
      usable: { meter: hardware.hasWaterMeter(hw) },
    },
    climate: { enabled: hw.hasClimate, entityId: hw.climateEntityId },
    smartLock: { enabled: hw.hasSmartLock, entityId: hw.lockEntityId },
  };
}

function tenant(u: {
  isLongTerm: boolean;
  longTermGuestName: string | null;
  longTermGuestEmail: string | null;
  longTermGuestPhone: string | null;
}) {
  if (!u.isLongTerm) return null;
  return {
    name: u.longTermGuestName,
    email: maskEmail(u.longTermGuestEmail),
    phone: maskPhone(u.longTermGuestPhone),
  };
}

async function requireUnit(unitId: number) {
  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: { hardware: true, resourceType: { select: { name: true } } },
  });
  if (!unit) throw new ToolError(`Unit ${unitId} not found. Use list_units to see valid ids.`);
  return unit;
}

// ── Live reads ────────────────────────────────────────────────

/** Status topic the MQTT read used, so the age of the cached value can be reported. */
function mqttStatusTopic(ep: HardwareEndpoint, energy: boolean): string | null {
  if (ep.source !== "MQTT" || !ep.mqttPrefix || !ep.mqttComponent) return null;
  const m = ep.mqttComponent.match(/^([a-z0-9]+):(\d+)$/i);
  const kind = m?.[1].toLowerCase();
  // The EM family keeps its energy counter in a separate data component.
  if (energy && m && (kind === "em1" || kind === "em")) {
    return `${ep.mqttPrefix}/status/${kind === "em1" ? "em1data" : "emdata"}:${m[2]}`;
  }
  return `${ep.mqttPrefix}/status/${ep.mqttComponent}`;
}

function mqttValueAgeSeconds(ep: HardwareEndpoint, energy: boolean): number | null {
  const topic = mqttStatusTopic(ep, energy);
  return topic ? secondsSince(mqttClient.getCached(topic)?.receivedAt) : null;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number } & ({ value: T } | { error: string })> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { ms: Date.now() - t0, value };
  } catch (e) {
    return { ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

async function readMeter(ep: HardwareEndpoint, unitLabel: "kWh" | "liters") {
  const r = await timed(() => hardware.readEnergyKwhWithReason(ep));
  if ("error" in r) return { endpoint: hardware.endpointLabel(ep), value: null, reason: r.error, ms: r.ms };
  return {
    endpoint: hardware.endpointLabel(ep),
    value: r.value.kwh,
    unit: unitLabel,
    reason: r.value.reason,
    ms: r.ms,
    ...(ep.source === "MQTT" && r.value.kwh !== null ? { valueAgeSeconds: mqttValueAgeSeconds(ep, true) } : {}),
  };
}

async function readPower(ep: HardwareEndpoint) {
  // readPowerWatts swallows HA errors; fetch the state once first so a
  // missing token or HTTP 401 shows up as the reason.
  if (ep.source !== "MQTT" && ep.haEntityId) {
    const id = ep.haEntityId;
    const probe = await timed(() => ha.getEntityState(id));
    if ("error" in probe) return { endpoint: hardware.endpointLabel(ep), watts: null, reason: probe.error, ms: probe.ms };
  }
  const r = await timed(() => hardware.readPowerWatts(ep));
  if ("error" in r) return { endpoint: hardware.endpointLabel(ep), watts: null, reason: r.error, ms: r.ms };
  if (!r.value) return { endpoint: hardware.endpointLabel(ep), watts: null, reason: "no value (offline, unavailable or no power field)", ms: r.ms };
  return { endpoint: hardware.endpointLabel(ep), watts: r.value.watts, valueAgeSeconds: Math.round(r.value.ageMs / 1000), ms: r.ms };
}

async function readRelay(ep: HardwareEndpoint) {
  const r = await timed(() => hardware.getSwitchState(ep));
  if ("error" in r) return { endpoint: hardware.endpointLabel(ep), on: null, reason: r.error, ms: r.ms };
  return {
    endpoint: hardware.endpointLabel(ep),
    on: r.value,
    ...(r.value === null ? { reason: "state unknown (offline or unavailable)" } : {}),
    ms: r.ms,
    ...(ep.source === "MQTT" && r.value !== null ? { valueAgeSeconds: mqttValueAgeSeconds(ep, false) } : {}),
  };
}

async function readHaEntity(entityId: string) {
  const r = await timed(() => ha.getEntityState(entityId));
  if ("error" in r) return { entityId, state: null, reason: r.error, ms: r.ms };
  const a = r.value.attributes;
  return {
    entityId,
    state: r.value.state,
    currentTemperature: a.current_temperature ?? null,
    targetTemperature: a.temperature ?? null,
    hvacAction: a.hvac_action ?? null,
    ms: r.ms,
  };
}

const skip = Promise.resolve(null);

// ── Consumption aggregation ───────────────────────────────────

interface Bucket {
  kwh: number;
  liters: number;
  readings: number;
}

// Same plausibility limits as the billing tick (actions.ts tickSessionConsumption).
const MAX_KW = 11; // 16 A three-phase
const MAX_LITERS_PER_HOUR = 1800; // 30 L/min
// How long a dip below the previous value may last before it counts as a
// genuine meter reset/replacement rather than bad data.
const DIP_MAX_MS = 6 * 3600_000;

/**
 * Turns successive cumulative readings into consumption.
 * - A step larger than maxPerHour × hours since the previous reading is a
 *   glitch (a spike, HA reporting 0 on restart), not consumption.
 * - After a drop the pre-drop value is remembered: if readings return to it
 *   (possibly after several bad low readings) the dip was bad data and only
 *   growth above it counts; if they stay below it for DIP_MAX_MS, it was a
 *   genuine reset and counting continues from the new values.
 */
function counterTracker(start: number | null, startAt: Date | null, maxPerHour: number) {
  let prev = start;
  let prevAt = startAt;
  let dipFrom: number | null = null;
  let dipAt: Date | null = null;
  const stats = { resets: 0, glitches: 0, rejectedJumps: 0 };
  const plausible = (delta: number, from: Date | null, to: Date): number => {
    const hours = Math.max(0.05, from ? (to.getTime() - from.getTime()) / 3_600_000 : 0.05);
    if (delta <= maxPerHour * hours) return delta;
    stats.rejectedJumps++;
    return 0;
  };
  const next = (v: number, at: Date): number => {
    const last = prev;
    const lastAt = prevAt;
    prev = v;
    prevAt = at;
    if (last === null) return 0;
    if (dipFrom !== null && dipAt && at.getTime() - dipAt.getTime() > DIP_MAX_MS) {
      dipFrom = null; // stayed low too long: it really was a reset
      dipAt = null;
    }
    if (dipFrom !== null) {
      if (v >= dipFrom) {
        const from = dipFrom;
        const fromAt = dipAt;
        dipFrom = null;
        dipAt = null;
        stats.resets--;
        stats.glitches++;
        return plausible(v - from, fromAt, at);
      }
      return v > last ? plausible(v - last, lastAt, at) : 0;
    }
    if (v < last) {
      stats.resets++;
      dipFrom = last;
      dipAt = lastAt;
      return 0;
    }
    return plausible(v - last, lastAt, at);
  };
  return { next, stats };
}

function aggregateLogs(
  logs: { electricityKwh: number | null; waterLiters: number | null; recordedAt: Date }[],
  baseline: { electricityKwh: number | null; waterLiters: number | null; recordedAt: Date } | null,
  hourly: boolean,
) {
  const perDay = new Map<string, Bucket>();
  const perHour = new Map<string, Bucket>();
  const bucket = (m: Map<string, Bucket>, k: string) => {
    let b = m.get(k);
    if (!b) m.set(k, (b = { kwh: 0, liters: 0, readings: 0 }));
    return b;
  };

  const el = counterTracker(baseline?.electricityKwh ?? null, baseline?.recordedAt ?? null, MAX_KW);
  const water = counterTracker(baseline?.waterLiters ?? null, baseline?.recordedAt ?? null, MAX_LITERS_PER_HOUR);
  let prevAt = baseline?.recordedAt ?? null;
  let maxGapMs = 0;
  let totalKwh = 0;
  let totalLiters = 0;

  for (const log of logs) {
    const { day, hourBucket: hour } = cphBuckets(log.recordedAt);
    const targets = hourly ? [bucket(perDay, day), bucket(perHour, hour)] : [bucket(perDay, day)];
    for (const t of targets) t.readings++;

    if (log.electricityKwh !== null) {
      const d = el.next(log.electricityKwh, log.recordedAt);
      for (const t of targets) t.kwh += d;
      totalKwh += d;
    }
    if (log.waterLiters !== null) {
      const d = water.next(log.waterLiters, log.recordedAt);
      for (const t of targets) t.liters += d;
      totalLiters += d;
    }
    if (prevAt) maxGapMs = Math.max(maxGapMs, log.recordedAt.getTime() - prevAt.getTime());
    prevAt = log.recordedAt;
  }

  // The window is rolling (now − days), so the first and last buckets only
  // cover part of their day/hour — flag them rather than let them look low.
  const rows = (m: Map<string, Bucket>, key: "date" | "hour") => {
    const list = [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, b]) => ({ [key]: k, ...b, partial: false }));
    if (list.length) {
      list[0].partial = true;
      list[list.length - 1].partial = true;
    }
    return list;
  };

  return {
    totals: { kwh: totalKwh, liters: totalLiters },
    counterResets: el.stats.resets + water.stats.resets,
    glitchReadingsIgnored: el.stats.glitches + water.stats.glitches,
    implausibleJumpsIgnored: el.stats.rejectedJumps + water.stats.rejectedJumps,
    largestGapMinutes: Math.round(maxGapMs / 60_000),
    perDay: rows(perDay, "date"),
    ...(hourly ? { perHour: rows(perHour, "hour") } : {}),
  };
}

// ── Tools ─────────────────────────────────────────────────────

export function registerUnitTools(server: McpServer): void {
  registerReadOnlyTool(server, {
    name: "list_units",
    title: "List units",
    description:
      "Every unit (hytte/plads/campingvogn/fastligger) with id, name, type, status (VACANT/OCCUPIED), resource type, long-term tenant name, " +
      "a hardware summary (which meters/switches are configured and whether via Home Assistant or MQTT), the current ACTIVE stay, " +
      "the next open reservation, and the number of expired reservations (PENDING bookings whose stay ended without check-in — not counted as reserved).",
    input: z.object({
      nameContains: z.string().max(100).optional().describe("Only units whose name contains this text"),
    }),
    handler: async ({ nameContains }) => {
      const now = new Date();
      const [units, expired] = await Promise.all([
        prisma.unit.findMany({
          where: nameContains ? { name: { contains: nameContains } } : undefined,
          orderBy: [{ resourceTypeId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
          take: 500,
          include: {
            hardware: true,
            resourceType: { select: { name: true } },
            sessions: {
              where: { OR: [{ status: "ACTIVE" }, openReservationWhere(now)] },
              orderBy: { checkInTime: "asc" },
            },
          },
        }),
        prisma.session.groupBy({ by: ["unitId"], where: expiredReservationWhere(now), _count: { _all: true } }),
      ]);
      const expiredByUnit = new Map(expired.map((g) => [g.unitId, g._count._all]));

      return {
        count: units.length,
        units: units.map((u) => {
          const active = u.sessions.filter((s) => s.status === "ACTIVE").at(-1) ?? null;
          const open = u.sessions.filter((s) => s.status === "PENDING");
          const next = open[0] ?? null;
          return {
            id: u.id,
            name: u.name,
            displayName: unitDisplayName(u.type, u.name),
            type: u.type,
            status: u.status,
            resourceType: u.resourceType?.name ?? null,
            isLongTerm: u.isLongTerm,
            tenant: tenant(u),
            external: u.externalId ? { provider: u.externalProvider, id: u.externalId } : null,
            hardware: hardwareSummary(u.hardware),
            activeSession: active ? sessionSummary(active) : null,
            nextReservation: next
              ? {
                  id: next.id,
                  guestName: next.guestName,
                  bookingRef: next.bookingRef,
                  checkInTime: next.checkInTime,
                  expectedCheckOut: next.expectedCheckOut,
                }
              : null,
            openReservations: open.length,
            expiredReservations: expiredByUnit.get(u.id) ?? 0,
          };
        }),
      };
    },
  });

  registerReadOnlyTool(server, {
    name: "get_unit",
    title: "Unit detail",
    description:
      "One unit in depth: full hardware endpoint configuration (HA entity ids, MQTT prefix/component), long-term tenant, the ACTIVE stay with its billing state, " +
      "open reservations, recently expired reservations, the last 10 invoices and consumption-log statistics for the last 24 hours. Database only — use read_unit_meters for live values.",
    input: z.object({ unitId: unitIdInput }),
    handler: async ({ unitId }) => {
      const unit = await requireUnit(unitId);
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 3600_000);

      const [active, open, expired, expiredCount, invoices, logs24h, latestLog] = await Promise.all([
        prisma.session.findFirst({ where: { unitId, status: "ACTIVE" }, orderBy: { checkInTime: "desc" } }),
        prisma.session.findMany({ where: { unitId, ...openReservationWhere(now) }, orderBy: { checkInTime: "asc" }, take: 5 }),
        prisma.session.findMany({ where: { unitId, ...expiredReservationWhere(now) }, orderBy: { checkInTime: "desc" }, take: 5 }),
        prisma.session.count({ where: { unitId, ...expiredReservationWhere(now) } }),
        prisma.invoice.findMany({ where: { unitId }, orderBy: { periodEnd: "desc" }, take: 10 }),
        prisma.consumptionLog.findMany({
          where: { unitId, recordedAt: { gte: dayAgo } },
          orderBy: { recordedAt: "asc" },
          select: { electricityKwh: true, waterLiters: true, recordedAt: true },
        }),
        prisma.consumptionLog.findFirst({ where: { unitId }, orderBy: { recordedAt: "desc" } }),
      ]);

      const first = logs24h[0] ?? null;
      const last = logs24h.at(-1) ?? null;
      const agg = aggregateLogs(logs24h, null, false);

      return {
        id: unit.id,
        name: unit.name,
        displayName: unitDisplayName(unit.type, unit.name),
        type: unit.type,
        status: unit.status,
        resourceType: unit.resourceType?.name ?? null,
        isLongTerm: unit.isLongTerm,
        tenant: tenant(unit),
        external: unit.externalId ? { provider: unit.externalProvider, id: unit.externalId } : null,
        hardware: unit.hardware ? hardwareConfig(unit.hardware) : null,
        activeSession: active
          ? {
              ...sessionSummary(active),
              readings: {
                startKwh: active.startKwh,
                startHeatingKwh: active.startHeatingKwh,
                startWaterLiters: active.startWaterLiters,
                lastTickKwh: active.lastTickKwh,
                lastTickHeatingKwh: active.lastTickHeatingKwh,
                lastTickWaterLiters: active.lastTickWaterLiters,
              },
              lastTickAgeSeconds: secondsSince(active.lastTickAt),
              overrides: { pricePerKwh: active.pricePerKwhOverride, pricePerLiterWater: active.pricePerLiterWaterOverride },
            }
          : null,
        openReservations: open.map((s) => sessionSummary(s)),
        expiredReservations: { count: expiredCount, latest: expired.map((s) => sessionSummary(s)) },
        invoices: invoices.map((i) => ({
          id: i.id,
          periodStart: i.periodStart,
          periodEnd: i.periodEnd,
          status: i.status,
          electricityCost: i.electricityCost,
          waterCost: i.waterCost,
          servicesCost: i.servicesCost,
          totalAmount: i.totalAmount,
          paidAt: i.paidAt,
        })),
        consumptionLast24h: {
          readings: logs24h.length,
          first,
          last,
          kwh: agg.totals.kwh,
          liters: agg.totals.liters,
          counterResets: agg.counterResets,
          largestGapMinutes: agg.largestGapMinutes,
          latestEver: latestLog ? { recordedAt: latestLog.recordedAt, electricityKwh: latestLog.electricityKwh, waterLiters: latestLog.waterLiters } : null,
        },
      };
    },
  });

  registerReadOnlyTool(server, {
    name: "read_unit_meters",
    title: "Read unit meters (live)",
    description:
      "Reads a unit's hardware RIGHT NOW over Home Assistant / MQTT: cumulative electricity, heating and water meters (with the reason when a meter gives no value), " +
      "instantaneous power, relay on/off states, thermostat and lock state. Read-only — never switches anything and writes no log rows. " +
      "For comparison it includes the last consumption-log row and the active stay's last billing tick. MQTT values may come from a cache; valueAgeSeconds shows how old.",
    live: true,
    input: z.object({ unitId: unitIdInput }),
    handler: async ({ unitId }) => {
      const unit = await requireUnit(unitId);
      const hw = unit.hardware;
      const base = { unit: { id: unit.id, name: unit.name, type: unit.type }, readAt: new Date() };
      if (!hw) return { ...base, note: "No hardware configured for this unit." };

      const t0 = Date.now();
      const [elMeter, elPower, elRelay, heatMeter, heatPower, heatRelay, waterMeter, climate, lock, lastLog, active] =
        await Promise.all([
          hardware.hasElectricityMeter(hw) ? readMeter(hardware.electricityMeterEp(hw), "kWh") : skip,
          hardware.hasElectricityPower(hw) ? readPower(hardware.electricityPowerEp(hw)) : skip,
          hardware.hasElectricitySwitch(hw) ? readRelay(hardware.electricitySwitchEp(hw)) : skip,
          hardware.hasHeatingMeter(hw) ? readMeter(hardware.heatingMeterEp(hw), "kWh") : skip,
          hardware.hasHeatingPower(hw) ? readPower(hardware.heatingPowerEp(hw)) : skip,
          hardware.hasHeatingSwitch(hw) ? readRelay(hardware.heatingSwitchEp(hw)) : skip,
          hardware.hasWaterMeter(hw) ? readMeter(hardware.waterMeterEp(hw), "liters") : skip,
          hw.hasClimate && hw.climateEntityId ? readHaEntity(hw.climateEntityId) : skip,
          hw.hasSmartLock && hw.lockEntityId ? readHaEntity(hw.lockEntityId) : skip,
          prisma.consumptionLog.findFirst({ where: { unitId }, orderBy: { recordedAt: "desc" } }),
          prisma.session.findFirst({ where: { unitId, status: "ACTIVE" }, orderBy: { checkInTime: "desc" } }),
        ]);

      return {
        ...base,
        totalMs: Date.now() - t0,
        mqttConnected: mqttClient.isConnected(),
        electricity: hw.hasElectricity ? { meter: elMeter, power: elPower, relay: elRelay } : null,
        heating: hw.hasHeating ? { meter: heatMeter, power: heatPower, relay: heatRelay, winterModeEnabled: hw.winterModeEnabled } : null,
        water: hw.hasWater ? { meter: waterMeter } : null,
        climate,
        smartLock: lock ? { entityId: lock.entityId, state: lock.state, ms: lock.ms, ...("reason" in lock ? { reason: lock.reason } : {}) } : null,
        lastConsumptionLog: lastLog
          ? { recordedAt: lastLog.recordedAt, ageSeconds: secondsSince(lastLog.recordedAt), electricityKwh: lastLog.electricityKwh, waterLiters: lastLog.waterLiters }
          : null,
        activeSessionTick: active
          ? {
              sessionId: active.id,
              lastTickAt: active.lastTickAt,
              lastTickAgeSeconds: secondsSince(active.lastTickAt),
              lastTickKwh: active.lastTickKwh,
              lastTickHeatingKwh: active.lastTickHeatingKwh,
              lastTickWaterLiters: active.lastTickWaterLiters,
              startKwh: active.startKwh,
              startHeatingKwh: active.startHeatingKwh,
              startWaterLiters: active.startWaterLiters,
            }
          : null,
      };
    },
  });

  registerReadOnlyTool(server, {
    name: "get_consumption_history",
    title: "Consumption history",
    description:
      "Electricity (kWh) and water (liters) used by a unit, from the cron's 10-minute ConsumptionLog meter readings: deltas between consecutive readings, " +
      `aggregated per day (and per hour when days <= 2) in local ${SITE_TIME_ZONE} time. Also reports reading counts, counter resets and the largest gap between readings (a logging outage).`,
    input: z.object({
      unitId: unitIdInput,
      days: z.number().int().min(1).max(90).default(7),
    }),
    handler: async ({ unitId, days }) => {
      const unit = await requireUnit(unitId);
      const now = new Date();
      const since = new Date(now.getTime() - days * 24 * 3600_000);
      const [baseline, logs] = await Promise.all([
        // A reading just before the window gives the first delta; an older one
        // would lump a long outage into the first bucket.
        prisma.consumptionLog.findFirst({
          where: { unitId, recordedAt: { lt: since, gte: new Date(since.getTime() - 3600_000) } },
          orderBy: { recordedAt: "desc" },
          select: { electricityKwh: true, waterLiters: true, recordedAt: true },
        }),
        prisma.consumptionLog.findMany({
          where: { unitId, recordedAt: { gte: since } },
          orderBy: { recordedAt: "asc" },
          select: { electricityKwh: true, waterLiters: true, recordedAt: true },
        }),
      ]);

      return {
        unit: { id: unit.id, name: unit.name, type: unit.type },
        hasMeters: hardware.hasElectricityMeter(unit.hardware) || hardware.hasWaterMeter(unit.hardware),
        timeZone: SITE_TIME_ZONE,
        from: since,
        to: now,
        readings: logs.length,
        firstReading: logs[0] ?? null,
        lastReading: logs.at(-1) ?? null,
        ...aggregateLogs(logs, baseline, days <= 2),
      };
    },
  });
}
