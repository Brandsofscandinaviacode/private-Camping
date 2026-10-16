"use server";

import { revalidatePath } from "next/cache";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "./prisma";
import { readGlobalSettings } from "./settings";
import { arrivedNotCheckedInWhere, cancelledReservationWhere, expiredReservationWhere, openReservationWhere, overdueStayWhere, hasArrivedNotCheckedIn } from "./booking-status";
import { BOOKING_MAX_LIMIT, BOOKING_PAGE_SIZE, BOOKING_SEARCH_SCAN, compareBookingRows, rankBookingSearch, type BookingListFilter as ListFilter } from "./booking-list";
import { hasAnyHardware, unitStateKey, METER_FRESH_MS } from "./unit-state";
import * as ha from "./homeassistant";
import * as hardware from "./hardware";
import type { HardwareEndpoint } from "./hardware";
import { mqttClient, testMqttBroker, type MqttDevice } from "./mqtt-client";
import { requireAuth } from "./auth";
import { typeLabels, unitDisplayName } from "./utils";
import { logger } from "./logger";
import { getBaseUrl } from "./base-url";
import { cleanupMcpOAuth } from "./mcp/oauth";
import { resolvePrepaidDeposited, restorePrepaidPowerIfFunded, prepaidShortfall } from "./prepaid";
import { computeSettlement, computeSettlements, listUnpaidSettlements, recalcCompletedCosts, syncPaymentStatus } from "./settlement";
import {
  fmtMoney,
  roundOre,
  STALE_READING_MINUTES,
  type CampInfo,
  type CheckoutMeterInfo,
  type CheckoutOptions,
  type CheckoutPreview,
  type SessionDetailsInput,
  type Settlement,
  type UpdateSessionResult,
} from "./settlement-shared";
import { isProviderBookingRef, parseBookingRef } from "./booking-ref";
import { fmtDate, fmtDateTime, siteDayKey } from "./format";
import { findUnitConflicts } from "./stay-conflicts";
import { conflictSentence, conflictText, parseSiteDateTime, MAX_MANUAL_KWH, type StayInvoicePreview } from "./stay-corrections";
import {
  checkOutDateError,
  describeWelcomeMessage,
  prepaidAmountError,
  receiptMessage,
  type CheckInResult,
  type ReceiptLine,
} from "./check-in";
import { checkInHardwarePrecheck, startStayHardware } from "./check-in-hardware";
import {
  planGuestFunding,
  fundingPaymentFields,
  fundingNote,
  serviceChannel,
  servicePaymentBadge,
  refundPlan,
  countsAsServiceRevenue,
  type FundedGuestFunding,
  type RefundPlan,
  type ServiceTone,
} from "./service-billing";
import {
  serviceDeviceOnline,
  drawStayFunds,
  logCreditUse,
  cancelAndRefundService,
  InsufficientFunds,
} from "./service-ops";

// How long a PENDING laundry/shower row waits for its card payment before it
// is auto-cancelled. Must comfortably exceed the time a guest can spend on the
// QuickPay page, or a late-but-accepted payment lands on a cancelled row.
const PENDING_PAYMENT_TTL_MS = 15 * 60 * 1000;
import { danplannerLogin, danplannerVerify2FA, getBookingProvider } from "./booking";
import { claimBookingSyncSlot, resolveSyncConflictInternal, syncBookingsWithProvider } from "./booking/sync";
import { addLockedFields } from "./booking/sync-merge";

// Read a numeric meter via the hardware abstraction (HA or MQTT). Logs the
// failure with context instead of swallowing it silently and returns null on
// any failure so callers can keep their null-check logic unchanged.
async function safeReadMeter(
  ep: HardwareEndpoint,
  context: string,
): Promise<number | null> {
  try {
    return await hardware.readEnergyKwh(ep);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("meter", `meter read failed [${context}] ${hardware.endpointLabel(ep)}: ${msg}`);
    // Track failures for billing alerts visible in admin dashboard
    try {
      const key = `_meter_fail_${context.replace(/[^a-zA-Z0-9]/g, "_")}`;
      await prisma.globalSetting.upsert({
        where: { key },
        create: { key, value: new Date().toISOString() },
        update: { value: new Date().toISOString() },
      });
    } catch { /* don't fail the caller over alert tracking */ }
    return null;
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
export async function getPricing() {
  const settings = await prisma.globalSetting.findMany();
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  return {
    pricePerKwh: parseFloat(map.price_per_kwh || "2.50"),
    pricePerLiterWater: parseFloat(map.price_per_liter_water || "0.05"),
    currency: map.currency || "DKK",
    defaultOccupiedTemp: parseFloat(map.default_occupied_temp || "21"),
    defaultVacantTemp: parseFloat(map.default_vacant_temp || "15"),
    pricingMode: (map.pricing_mode || "fixed") as "fixed" | "minimum" | "spot",
    elSurcharge: parseFloat(map.el_surcharge || "0.50"),
    edsPriceArea: (map.eds_price_area || "DK1") as "DK1" | "DK2",
  };
}

// Get effective electricity price based on pricing mode (EDS integration)
export async function getEffectiveElPricing() {
  const pricing = await getPricing();
  const { getEffectiveElPrice } = await import("./energi-data-service");
  return getEffectiveElPrice(
    pricing.pricingMode,
    pricing.pricePerKwh,
    pricing.elSurcharge,
    pricing.edsPriceArea,
  );
}

export async function getGlobalSettings() {
  await requireAuth();
  const settings = await readGlobalSettings();
  // The MCP key is stored as a hash only and never shown again — don't ship
  // even the hash to the settings forms in the browser.
  for (const key of Object.keys(settings)) if (key.startsWith("mcp_api_key")) delete settings[key];
  return settings;
}

// ──────────────────────────────────────────────
// HA Connection Testing
// ──────────────────────────────────────────────
export async function testHAConnection(): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  const settings = await prisma.globalSetting.findMany();
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const url = map.ha_url;
  const token = map.ha_token;

  if (!url) return { ok: false, message: "HA URL er ikke udfyldt" };
  if (!token) return { ok: false, message: "HA Token er ikke udfyldt" };
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return { ok: false, message: `URL skal starte med http:// eller https:// — nuværende: "${url}"` };
  }

  try {
    const res = await fetch(`${url}/api/`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 401) return { ok: false, message: "Ugyldigt token — tjek dit Long-Lived Access Token" };
    if (res.status === 403) return { ok: false, message: "Adgang nægtet — tokenet har ikke tilstrækkelige rettigheder" };
    if (!res.ok) return { ok: false, message: `HA svarede med fejl: ${res.status} ${res.statusText}` };

    const data = await res.json();
    return { ok: true, message: `Forbundet til Home Assistant (${data.version || "ukendt version"})` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED")) {
      return { ok: false, message: `Kan ikke nå ${url} — er HA tændt og på netværket?` };
    }
    if (msg.includes("timeout") || msg.includes("AbortError")) {
      return { ok: false, message: `Timeout — ${url} svarer ikke inden for 10 sekunder` };
    }
    return { ok: false, message: `Fejl: ${msg}` };
  }
}

export async function testEntityId(entityId: string): Promise<{ ok: boolean; value: string; message: string }> {
  await requireAuth();
  if (!entityId.trim()) return { ok: false, value: "", message: "Entity ID er tomt" };

  try {
    const state = await ha.getEntityState(entityId);
    const attrs = state.attributes;
    const unit = (attrs.unit_of_measurement as string) || "";
    const friendly = (attrs.friendly_name as string) || "";
    return {
      ok: true,
      value: `${state.state}${unit ? ` ${unit}` : ""}`,
      message: friendly || entityId,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("404")) return { ok: false, value: "", message: `Entity "${entityId}" findes ikke i HA` };
    if (msg.includes("401")) return { ok: false, value: "", message: "HA token er ugyldigt" };
    return { ok: false, value: "", message: `Fejl: ${msg}` };
  }
}

// ──────────────────────────────────────────────
// MQTT Broker Testing
// ──────────────────────────────────────────────
export async function testMqttConnection(cfg?: {
  host: string;
  port: number;
  username: string;
  password: string;
  tls?: boolean;
}): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  let host: string;
  let port: number;
  let username: string;
  let password: string;
  let tls: boolean;

  if (cfg) {
    ({ host, port, username, password } = cfg);
    tls = cfg.tls ?? false;
  } else {
    const settings = await prisma.globalSetting.findMany({
      where: { key: { in: ["mqtt_host", "mqtt_port", "mqtt_username", "mqtt_password", "mqtt_tls"] } },
    });
    const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
    host = map.mqtt_host || "localhost";
    port = parseInt(map.mqtt_port || "1883", 10);
    username = map.mqtt_username || "";
    password = map.mqtt_password || "";
    tls = map.mqtt_tls === "true";
  }

  if (!host.trim()) return { ok: false, message: "MQTT host er tom" };
  return testMqttBroker({ host, port, username, password, tls });
}

/** Force the live MQTT client to pick up fresh GlobalSetting config. */
export async function reloadMqttClient(): Promise<{ ok: boolean; connected: boolean }> {
  await requireAuth();
  try {
    const c = await mqttClient.reconnect();
    return { ok: true, connected: !!c?.connected };
  } catch {
    return { ok: false, connected: false };
  }
}

/** An MQTT device enriched with where it is used inside CampSense. */
export interface MqttDeviceWithUsage extends MqttDevice {
  /** Human labels for every place this prefix is configured, e.g. "El · Hytte 1". */
  usedBy: string[];
}

/**
 * List devices currently visible on the MQTT broker, grouped by topic prefix
 * (like MQTT Explorer), enriched with which units/showers/machines in
 * CampSense are configured to use each prefix. Powers the "connected
 * devices" panel in settings.
 */
export async function listMqttDevices(): Promise<{ ok: boolean; devices: MqttDeviceWithUsage[]; message?: string }> {
  await requireAuth();
  try {
    const devices = await mqttClient.discoverDevices();
    if (!mqttClient.isConnected()) {
      return { ok: false, devices: [], message: "MQTT-klienten er ikke forbundet — gem og genstart klienten først" };
    }

    // Build prefix → usage labels from every place an MQTT prefix can be set.
    const [units, showers, machines] = await Promise.all([
      prisma.unitHardware.findMany({
        where: {
          OR: [
            { electricityMqttPrefix: { not: null } },
            { heatingMqttPrefix: { not: null } },
            { waterMqttPrefix: { not: null } },
          ],
        },
        include: { unit: { select: { name: true, type: true } } },
      }),
      prisma.shower.findMany({ where: { mqttPrefix: { not: null } }, select: { name: true, mqttPrefix: true } }),
      prisma.laundryMachine.findMany({ where: { mqttPrefix: { not: null } }, select: { name: true, mqttPrefix: true } }),
    ]);

    const usage = new Map<string, string[]>();
    const addUsage = (prefix: string | null | undefined, label: string) => {
      if (!prefix) return;
      const list = usage.get(prefix) ?? [];
      list.push(label);
      usage.set(prefix, list);
    };
    for (const hw of units) {
      const name = unitDisplayName(hw.unit.type, hw.unit.name);
      addUsage(hw.electricityMqttPrefix, `El · ${name}`);
      addUsage(hw.heatingMqttPrefix, `Varme · ${name}`);
      addUsage(hw.waterMqttPrefix, `Vand · ${name}`);
    }
    for (const s of showers) addUsage(s.mqttPrefix, s.name);
    for (const m of machines) addUsage(m.mqttPrefix, m.name);

    return { ok: true, devices: devices.map((d) => ({ ...d, usedBy: usage.get(d.id) ?? [] })) };
  } catch (e) {
    return { ok: false, devices: [], message: e instanceof Error ? e.message : "Ukendt fejl" };
  }
}

// ──────────────────────────────────────────────
// HA Entity Browser
// ──────────────────────────────────────────────
export type EntityCategory = "switch" | "sensor_energy" | "sensor_power" | "sensor_water" | "sensor_other" | "climate" | "lock" | "other";

export interface BrowsableEntity {
  entity_id: string;
  friendly_name: string;
  state: string;
  unit_of_measurement: string | null;
  category: EntityCategory;
  usedBy: string | null; // unit name if already assigned, null if free
}

export async function browseHAEntities(): Promise<BrowsableEntity[]> {
  await requireAuth();
  const allEntities = await ha.getAllEntities();
  const usedMap = await getUsedEntityMap();

  return allEntities
    .filter((e) => {
      // Only show relevant domains
      const d = e.domain;
      return ["switch", "sensor", "climate", "lock", "input_boolean", "light"].includes(d);
    })
    .filter((e) => {
      // Exclude HA internal entities
      return !e.entity_id.startsWith("sensor.sun_") && e.state !== "unavailable";
    })
    .map((e) => {
      let category: EntityCategory = "other";
      if (e.domain === "switch" || e.domain === "input_boolean" || e.domain === "light") {
        category = "switch";
      } else if (e.domain === "sensor") {
        if (e.device_class === "energy" || e.unit_of_measurement === "kWh" || e.unit_of_measurement === "Wh") {
          category = "sensor_energy";
        } else if (e.device_class === "power" || e.unit_of_measurement === "W" || e.unit_of_measurement === "kW") {
          category = "sensor_power";
        } else if (e.device_class === "water" || e.unit_of_measurement === "L" || e.unit_of_measurement === "m³") {
          category = "sensor_water";
        } else {
          category = "sensor_other";
        }
      } else if (e.domain === "climate") {
        category = "climate";
      } else if (e.domain === "lock") {
        category = "lock";
      }

      return {
        entity_id: e.entity_id,
        friendly_name: e.friendly_name,
        state: e.state,
        unit_of_measurement: e.unit_of_measurement,
        category,
        usedBy: usedMap.get(e.entity_id) || null,
      };
    })
    .sort((a, b) => a.friendly_name.localeCompare(b.friendly_name));
}

async function getUsedEntityMap(): Promise<Map<string, string>> {
  const allHw = await prisma.unitHardware.findMany({
    include: { unit: true },
  });


  const map = new Map<string, string>();

  for (const row of allHw) {
    const unitName = unitDisplayName(row.unit.type, row.unit.name);
    // Only count HA entity IDs — MQTT prefixes are free-form and can legitimately
    // be reused (e.g. different components of a Shelly Plus 2PM).
    const ids = [
      row.electricitySwitchEntityId,
      row.electricityMeterEntityId,
      row.electricityPowerEntityId,
      row.heatingSwitchEntityId,
      row.heatingMeterEntityId,
      row.heatingPowerEntityId,
      row.waterMeterEntityId,
      row.climateEntityId,
      row.lockEntityId,
    ].filter(Boolean) as string[];

    for (const id of ids) {
      map.set(id, unitName);
    }
  }

  return map;
}

// ──────────────────────────────────────────────
// SMS / Email Test
// ──────────────────────────────────────────────
export async function testSMS(toNumber: string): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  if (!toNumber.trim()) return { ok: false, message: "Indtast et telefonnummer" };
  try {
    const { sendSMS } = await import("./notifications");
    const result = await sendSMS(toNumber, "CampSense test-besked. Hvis du modtager denne, virker SMS-notifikationer korrekt!");
    if (result.ok) return { ok: true, message: `SMS sendt til ${toNumber}` };
    return { ok: false, message: result.error || "SMS kunne ikke sendes" };
  } catch (e) {
    return { ok: false, message: `Fejl: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function testEmail(toAddr: string): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  if (!toAddr.trim()) return { ok: false, message: "Indtast en email-adresse" };
  try {
    const { sendEmail } = await import("./notifications");
    const result = await sendEmail(
      toAddr,
      "CampSense test-email",
      "<h2>Test-email fra CampSense</h2><p>Hvis du modtager denne email, virker email-notifikationer korrekt!</p>"
    );
    if (result.ok) return { ok: true, message: `Email sendt til ${toAddr}` };
    return { ok: false, message: result.error || "Email kunne ikke sendes" };
  } catch (e) {
    return { ok: false, message: `Fejl: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ──────────────────────────────────────────────
// Resource Types (user-defined unit categories)
// ──────────────────────────────────────────────

const DEFAULT_RESOURCE_TYPES: Array<{
  name: string;
  icon: string;
  defaultUnitType: "CABIN" | "SEASONAL" | "CARAVAN" | "PITCH";
  sortOrder: number;
}> = [
  { name: "Hytter", icon: "Home", defaultUnitType: "CABIN", sortOrder: 0 },
  { name: "Lejligheder", icon: "Building2", defaultUnitType: "CABIN", sortOrder: 1 },
  { name: "Fastliggere", icon: "Caravan", defaultUnitType: "SEASONAL", sortOrder: 2 },
  { name: "Pladser", icon: "MapPin", defaultUnitType: "PITCH", sortOrder: 3 },
];

const TYPE_TO_DEFAULT_RT: Record<string, string> = {
  CABIN: "Hytter",
  SEASONAL: "Fastliggere",
  CARAVAN: "Fastliggere",
  PITCH: "Pladser",
};

/**
 * Ensures default resource types exist and migrates any unit without a
 * resourceTypeId to a default based on its legacy `type` enum value.
 * Idempotent — safe to call repeatedly.
 */
async function ensureResourceTypes() {
  const existing = await prisma.resourceType.findMany();
  const byName = new Map(existing.map((rt) => [rt.name, rt]));

  for (const def of DEFAULT_RESOURCE_TYPES) {
    if (!byName.has(def.name)) {
      const created = await prisma.resourceType.create({ data: def });
      byName.set(def.name, created);
    }
  }

  const orphans = await prisma.unit.findMany({ where: { resourceTypeId: null } });
  for (const u of orphans) {
    const targetName = TYPE_TO_DEFAULT_RT[u.type] || "Hytter";
    const target = byName.get(targetName);
    if (target) {
      await prisma.unit.update({
        where: { id: u.id },
        data: { resourceTypeId: target.id },
      });
    }
  }
}

export async function getResourceTypes() {
  await requireAuth();
  await ensureResourceTypes();
  return prisma.resourceType.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { units: true } } },
  });
}

export async function createResourceType(data: {
  name: string;
  icon?: string;
  defaultUnitType?: "CABIN" | "SEASONAL" | "CARAVAN" | "PITCH";
}) {
  await requireAuth();
  const max = await prisma.resourceType.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.resourceType.create({
    data: {
      name: data.name,
      icon: data.icon || "Home",
      defaultUnitType: data.defaultUnitType || "CABIN",
      sortOrder: (max._max.sortOrder ?? -1) + 1,
    },
  });
  revalidatePath("/admin");
  revalidatePath("/admin/settings");
  return created;
}

export async function updateResourceType(id: number, data: {
  name?: string;
  icon?: string;
  defaultUnitType?: "CABIN" | "SEASONAL" | "CARAVAN" | "PITCH";
  externalId?: string | null;
  externalProvider?: string | null;
}) {
  await requireAuth();
  await prisma.resourceType.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.icon !== undefined ? { icon: data.icon } : {}),
      ...(data.defaultUnitType !== undefined ? { defaultUnitType: data.defaultUnitType } : {}),
      ...(data.externalId !== undefined ? { externalId: data.externalId } : {}),
      ...(data.externalProvider !== undefined ? { externalProvider: data.externalProvider } : {}),
    },
  });
  revalidatePath("/admin");
  revalidatePath("/admin/settings");
}

export async function deleteResourceType(id: number) {
  await requireAuth();
  await prisma.resourceType.delete({ where: { id } });
  revalidatePath("/admin");
  revalidatePath("/admin/settings");
}

export async function reorderResourceTypes(orderedIds: number[]) {
  await requireAuth();
  await Promise.all(
    orderedIds.map((id, index) =>
      prisma.resourceType.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );
  revalidatePath("/admin");
  revalidatePath("/admin/settings");
}

export async function moveUnitToResourceType(unitId: number, resourceTypeId: number | null) {
  await requireAuth();
  const max = resourceTypeId
    ? await prisma.unit.aggregate({
        where: { resourceTypeId },
        _max: { sortOrder: true },
      })
    : { _max: { sortOrder: 0 } };
  await prisma.unit.update({
    where: { id: unitId },
    data: {
      resourceTypeId,
      sortOrder: (max._max.sortOrder ?? -1) + 1,
    },
  });
  revalidatePath("/admin");
}

export async function reorderUnits(resourceTypeId: number | null, orderedUnitIds: number[]) {
  await requireAuth();
  await Promise.all(
    orderedUnitIds.map((id, index) =>
      prisma.unit.update({
        where: { id },
        data: { sortOrder: index, ...(resourceTypeId !== undefined ? { resourceTypeId } : {}) },
      }),
    ),
  );
  revalidatePath("/admin");
}

// ──────────────────────────────────────────────
// Unit CRUD
// ──────────────────────────────────────────────
export async function createUnit(
  name: string,
  type: "CABIN" | "SEASONAL" | "CARAVAN" | "PITCH" = "CABIN",
  resourceTypeId?: number,
) {
  await requireAuth();
  await ensureResourceTypes();

  let rtId = resourceTypeId;
  if (!rtId) {
    const targetName = TYPE_TO_DEFAULT_RT[type] || "Hytter";
    const rt = await prisma.resourceType.findUnique({ where: { name: targetName } });
    rtId = rt?.id;
  }

  const max = rtId
    ? await prisma.unit.aggregate({ where: { resourceTypeId: rtId }, _max: { sortOrder: true } })
    : { _max: { sortOrder: 0 } };

  const unit = await prisma.unit.create({
    data: {
      name,
      type,
      isLongTerm: type === "SEASONAL",
      resourceTypeId: rtId,
      sortOrder: (max._max.sortOrder ?? -1) + 1,
      hardware: { create: {} },
    },
  });
  revalidatePath("/admin");
  return unit;
}

export async function deleteUnit(unitId: number) {
  await requireAuth();
  await prisma.unit.delete({ where: { id: unitId } });
  revalidatePath("/admin");
}

export async function getUnits() {
  await requireAuth();
  await ensureResourceTypes();
  return prisma.unit.findMany({
    include: { hardware: true, resourceType: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function getUnitWithDetails(unitId: number) {
  await requireAuth();
  return prisma.unit.findUnique({
    where: { id: unitId },
    include: {
      hardware: true,
      sessions: {
        orderBy: { checkInTime: "desc" },
        take: 10,
      },
      invoices: {
        orderBy: { periodEnd: "desc" },
        take: 12,
      },
    },
  });
}

// ──────────────────────────────────────────────
// Unit Hardware Configuration
// ──────────────────────────────────────────────
export async function updateUnitHardware(
  unitId: number,
  data: {
    hasElectricity: boolean;
    electricitySource: "HA" | "MQTT";
    electricitySwitchEntityId: string | null;
    electricityMeterEntityId: string | null;
    electricityPowerEntityId: string | null;
    electricityMqttPrefix: string | null;
    electricityMqttComponent: string | null;
    hasHeating: boolean;
    heatingSource: "HA" | "MQTT";
    heatingSwitchEntityId: string | null;
    heatingMeterEntityId: string | null;
    heatingPowerEntityId: string | null;
    heatingMqttPrefix: string | null;
    heatingMqttComponent: string | null;
    winterModeEnabled: boolean;
    hasWater: boolean;
    waterSource: "HA" | "MQTT";
    waterMeterEntityId: string | null;
    waterMqttPrefix: string | null;
    waterMqttComponent: string | null;
    hasClimate: boolean;
    climateEntityId: string | null;
    hasSmartLock: boolean;
    lockEntityId: string | null;
  }
) {
  await requireAuth();
  await prisma.unitHardware.upsert({
    where: { unitId },
    update: data,
    create: { unitId, ...data },
  });
  revalidatePath("/admin");
  revalidatePath(`/admin/units/${unitId}`);
  revalidatePath("/admin/settings");
}

export async function toggleWinterMode(unitId: number, enabled: boolean) {
  await requireAuth();
  await prisma.unitHardware.update({
    where: { unitId },
    data: { winterModeEnabled: enabled },
  });

  // If enabling winter mode, turn on heating immediately
  const hw = await prisma.unitHardware.findUnique({ where: { unitId } });
  if (hardware.hasHeatingSwitch(hw)) {
    try {
      if (enabled) {
        await hardware.setSwitch(hardware.heatingSwitchEp(hw!), true);
      }
      // Don't turn off here — that's handled by check-out logic
    } catch (e) {
      logger.error("hardware", "Winter mode toggle error", e);
    }
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/units/${unitId}`);
}

// ──────────────────────────────────────────────
// Long-term tenant management
// ──────────────────────────────────────────────
export async function updateLongTermTenant(
  unitId: number,
  data: {
    longTermGuestName: string;
    longTermGuestEmail: string;
    longTermGuestPhone: string;
  }
) {
  await requireAuth();
  const unit = await prisma.unit.findUnique({ where: { id: unitId } });
  if (!unit) throw new Error("Enhed ikke fundet");

  const portalToken = unit.longTermPortalToken || uuidv4();

  await prisma.unit.update({
    where: { id: unitId },
    data: {
      ...data,
      isLongTerm: true,
      longTermPortalToken: portalToken,
      status: "OCCUPIED",
    },
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/units/${unitId}`);
  return portalToken;
}

export async function removeLongTermTenant(unitId: number) {
  await requireAuth();
  await prisma.unit.update({
    where: { id: unitId },
    data: {
      longTermGuestName: null,
      longTermGuestEmail: null,
      longTermGuestPhone: null,
      longTermPortalToken: null,
      status: "VACANT",
    },
  });
  revalidatePath("/admin");
  revalidatePath(`/admin/units/${unitId}`);
}

// ──────────────────────────────────────────────
// Global Settings
// ──────────────────────────────────────────────
export async function updateMultipleSettings(
  settings: { key: string; value: string }[]
) {
  // Public server action — without this anyone could overwrite api_key,
  // payment keys etc. The cron route calls it inside runWithApiAuth.
  await requireAuth();
  for (const s of settings) {
    await prisma.globalSetting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: s,
    });
  }
  revalidatePath("/admin/settings");
}

// ──────────────────────────────────────────────
// CHECK-IN FLOW
// ──────────────────────────────────────────────
export async function checkIn(
  unitId: number,
  guestName: string,
  guestEmail?: string,
  guestPhone?: string,
  bookingRef?: string,
  expectedCheckOut?: string,
  billingMode?: "PREPAID" | "POSTPAID",
  prepaidAmount?: number,
  options?: {
    requireExpectedCheckOut?: boolean;
    /** Desk walk-in: an open reservation on the unit in the period needs the desk's OK. */
    checkReservations?: boolean;
    allowReservationConflict?: boolean;
  },
): Promise<CheckInResult> {
  await requireAuth();
  const name = guestName?.trim();
  if (!name) return { ok: false, message: "Gæstens navn er påkrævet." };
  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: { hardware: true },
  });
  if (!unit) return { ok: false, message: "Enheden findes ikke." };
  // Long-term tenants may have an open stay; the desk dialog requires a date
  // for everyone else (the API keeps it optional).
  const dateError = checkOutDateError(expectedCheckOut, {
    required: !!options?.requireExpectedCheckOut && !unit.isLongTerm,
  });
  if (dateError) return { ok: false, message: dateError };
  const mode = billingMode === "PREPAID" ? "PREPAID" : "POSTPAID";
  if (mode === "PREPAID") {
    const amountError = prepaidAmountError(prepaidAmount);
    if (amountError) return { ok: false, message: amountError };
  }
  if (options?.checkReservations && !options.allowReservationConflict) {
    const today = siteDayKey(new Date())!;
    const reserved = (await findUnitConflicts(unitId, unitDisplayName(unit.type, unit.name), { from: today, to: expectedCheckOut || null }))
      .filter((c) => c.status === "PENDING");
    if (reserved.length > 0) {
      return {
        ok: false,
        message: `${conflictSentence(reserved)} Bekræft for at checke walk-in-gæsten ind alligevel.`,
        reservationConflicts: reserved.map(conflictText),
      };
    }
  }

  // Claim the unit atomically so a double-click can't open two stays on it.
  const claimed = await prisma.unit.updateMany({
    where: { id: unitId, status: { not: "OCCUPIED" } },
    data: { status: "OCCUPIED" },
  });
  if (claimed.count === 0) return { ok: false, message: "Enheden er allerede optaget – tjek den nuværende gæst ud først." };

  const guestPortalToken = uuidv4();
  let session: Awaited<ReturnType<typeof prisma.session.create>>;
  let hwLines: ReceiptLine[];
  try {
    const pricing = await getPricing();
    const hw = await startStayHardware(unit.hardware, `checkIn unit=${unitId}`, pricing.defaultOccupiedTemp);
    hwLines = hw.lines;
    session = await prisma.session.create({
      data: {
        unitId,
        guestName: name,
        guestEmail: guestEmail?.trim() || null,
        guestPhone: guestPhone?.trim() || null,
        bookingRef: bookingRef?.trim() || null,
        expectedCheckOut: expectedCheckOut ? plannedDate(expectedCheckOut) : null,
        billingMode: mode,
        prepaidAmount: mode === "PREPAID" ? prepaidAmount! : null,
        prepaidDeposited: mode === "PREPAID" ? prepaidAmount! : null,
        guestPortalToken,
        startKwh: hw.startKwh,
        startHeatingKwh: hw.startHeatingKwh,
        startWaterLiters: hw.startWaterLiters,
        status: "ACTIVE",
        checkInRecordedAt: new Date(),
      },
    });
  } catch (e) {
    // Release the claim so the unit isn't stuck OCCUPIED with no stay.
    await prisma.unit.updateMany({ where: { id: unitId, status: "OCCUPIED" }, data: { status: "VACANT" } }).catch(() => {});
    throw e;
  }

  // Update unit status; for long-term units also store tenant info for invoicing/portal
  const updateData: Record<string, unknown> = { status: "OCCUPIED" };
  if (unit.isLongTerm) {
    updateData.longTermGuestName = session.guestName;
    updateData.longTermGuestEmail = session.guestEmail;
    updateData.longTermGuestPhone = session.guestPhone;
    updateData.longTermPortalToken = guestPortalToken;
  }
  await prisma.unit.update({ where: { id: unitId }, data: updateData });

  const dispName = unitDisplayName(unit.type, unit.name);
  const welcome = await sendWelcomeMessage(session, dispName);
  const lines = [...hwLines, welcome.line];

  revalidatePath("/admin");
  revalidatePath(`/admin/units/${unitId}`);
  revalidatePath("/admin/bookings");
  return {
    ok: true,
    message: receiptMessage(lines),
    sessionId: session.id,
    guestPortalToken,
    receipt: {
      sessionId: session.id,
      unitId,
      unitName: dispName,
      guestName: session.guestName,
      portalPath: `/guest/${guestPortalToken}`,
      lines,
    },
  };
}

// A planned date ("YYYY-MM-DD") is stored at local noon, like the booking
// sync does, so it stays the same calendar day in the site's time zone.
function plannedDate(key: string): Date {
  return new Date(`${key}T12:00:00`);
}

const WELCOME_TIMEOUT_MS = 15_000;

// Sends the check-in welcome (portal link) and reports what really happened:
// sent, switched off in settings, no address, or the provider's error.
async function sendWelcomeMessage(
  session: { id: number; guestName: string; guestEmail: string | null; guestPhone: string | null; guestPortalToken: string },
  unitName: string,
): Promise<{ sent: boolean; line: ReceiptLine }> {
  const settings = await readGlobalSettings();
  const base = {
    emailEnabled: settings.notifications_email_enabled === "true",
    smsEnabled: settings.notifications_sms_enabled === "true",
    guestEmail: session.guestEmail,
    guestPhone: session.guestPhone,
  };
  let outcome: { sent: boolean; line: ReceiptLine };
  if ((base.emailEnabled && session.guestEmail) || (base.smsEnabled && session.guestPhone)) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const { sendCheckInNotification } = await import("./notifications");
      const portalUrl = `${getBaseUrl(settings)}/guest/${session.guestPortalToken}`;
      const sending = sendCheckInNotification(session.guestName, session.guestPhone, session.guestEmail, portalUrl, unitName);
      sending.catch(() => {});
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), WELCOME_TIMEOUT_MS);
      });
      const result = await Promise.race([sending, timeout]);
      outcome = result
        ? describeWelcomeMessage({ ...base, result })
        : describeWelcomeMessage({ ...base, error: "intet svar fra e-mail/SMS-udbyderen inden for 15 sek. – det er uvist, om beskeden kom frem" });
    } catch (e) {
      outcome = describeWelcomeMessage({ ...base, error: e instanceof Error ? e.message : String(e) });
    } finally {
      clearTimeout(timer);
    }
  } else {
    outcome = describeWelcomeMessage(base);
  }
  if (outcome.line.tone === "error") logger.error("notify", `Velkomstbesked ophold ${session.id}: ${outcome.line.text}`);
  else logger.info("notify", `Velkomstbesked ophold ${session.id}: ${outcome.line.text}`);
  return outcome;
}

/** Live meter/relay status before a check-in (only units with hardware). */
export async function getCheckInHardwareStatus(unitId: number): Promise<{ lines: ReceiptLine[]; problem: boolean }> {
  await requireAuth();
  const hw = await prisma.unitHardware.findUnique({ where: { unitId } });
  return checkInHardwarePrecheck(hw);
}

// ──────────────────────────────────────────────
// CHECK-OUT FLOW
// ──────────────────────────────────────────────
type CheckoutResult =
  | {
      ok: true;
      totalElectricityCost: number | null;
      totalWaterCost: number | null;
      totalServicesCost: number;
      totalCost: number;
      isPrepaid: boolean;
      prepaidAmount: number | null;
      settlement: Settlement | null;
    }
  | { ok: false; message: string };

/**
 * Check a guest out. Expected problems (already checked out, a meter that
 * can't be read) come back as { ok: false, message } in Danish — thrown
 * messages are hidden in production. The API route calls this without
 * options, which keeps the old behaviour: last reading, refuse if none.
 */
export async function checkOut(sessionId: number, options: CheckoutOptions = {}): Promise<CheckoutResult> {
  const auth = await requireAuth();
  try {
    return await checkOutInternal(sessionId, options, auth.username || "admin");
  } catch (e) {
    logger.error("checkout", `checkOut fejl (session ${sessionId})`, e);
    return { ok: false, message: "Udtjek fejlede uventet. Prøv igen — fortsætter fejlen, så se loggen." };
  }
}

async function checkOutInternal(sessionId: number, options: CheckoutOptions, username: string): Promise<CheckoutResult> {
  const mode = options.meterMode ?? "AUTO";
  const extraNote = options.note?.trim() ?? "";
  if (mode === "NONE" && !extraNote) {
    return { ok: false, message: "Skriv en note om, hvorfor el og vand ikke afregnes yderligere." };
  }

  // Final tick first — ensures the accumulator captures every second of
  // consumption up to this instant at the correct hourly spot prices.
  // The tick uses optimistic concurrency, so if a cron tick is racing
  // us it's handled safely — we just re-read the session below and pick
  // up the freshest accumulator state either way.
  try {
    await tickSessionConsumptionInternal(sessionId);
  } catch (e) {
    logger.error("checkout", "checkOut: final tick fejlede", e);
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: { include: { hardware: true } } },
  });

  if (!session) return { ok: false, message: "Opholdet findes ikke." };
  if (session.status === "COMPLETED") return { ok: false, message: "Opholdet er allerede tjekket ud." };
  if (session.status !== "ACTIVE") return { ok: false, message: "Gæsten er ikke tjekket ind, så opholdet kan ikke tjekkes ud." };

  const hw = session.unit.hardware;
  const pricing = await getPricing();
  const now = new Date();

  // "Faktisk afrejse": an overdue guest who left days ago is checked out as
  // of that time. Only the dates change — el/water follow the meters.
  let departedAt = now;
  if (options.departedAt) {
    const d = parseSiteDateTime(options.departedAt);
    if (!d) return { ok: false, message: "Ugyldigt tidspunkt for faktisk afrejse." };
    if (d.getTime() > now.getTime() + 5 * 60_000) return { ok: false, message: "Faktisk afrejse kan ikke ligge i fremtiden." };
    if (d < session.checkInTime) {
      return { ok: false, message: `Faktisk afrejse kan ikke ligge før check-in (${fmtDateTime(session.checkInTime)}).` };
    }
    if (d < now) departedAt = d;
  }

  // End-of-session meter readings come from the latest tick — guaranteed
  // in-sync with the accumulator because tick just ran. Fall back to a
  // direct HA read only if the tick couldn't capture the value.
  let endKwh: number | null = session.lastTickKwh;
  let endHeatingKwh: number | null = session.lastTickHeatingKwh;
  let endWaterLiters: number | null = session.lastTickWaterLiters;

  if (endKwh === null && hardware.hasElectricityMeter(hw)) {
    endKwh = await safeReadMeter(hardware.electricityMeterEp(hw!), `checkOut:el session=${sessionId}`);
  }
  if (endHeatingKwh === null && hardware.hasHeatingMeter(hw)) {
    endHeatingKwh = await safeReadMeter(hardware.heatingMeterEp(hw!), `checkOut:heat session=${sessionId}`);
  }
  if (endWaterLiters === null && hardware.hasWaterMeter(hw)) {
    endWaterLiters = await safeReadMeter(hardware.waterMeterEp(hw!), `checkOut:water session=${sessionId}`);
  }

  // Whether the tick accumulator covers each meter. Decided by whether a
  // tick ever read it — NOT by the accumulator being > 0: after a mid-stay
  // invoice it is legitimately 0, and falling back to (end − start) × price
  // would bill the already-invoiced consumption a second time.
  const elTicked = session.lastTickAt != null && (session.lastTickKwh != null || session.lastTickHeatingKwh != null);
  const waterTicked = session.lastTickAt != null && session.lastTickWaterLiters != null;

  // AUTO (API, no choice made): refuse when a configured meter was never
  // read. The checkout dialog offers manual readings or no further billing.
  if (mode === "AUTO") {
    const meterFailures: string[] = [];
    if (hardware.hasElectricityMeter(hw) && endKwh === null && !elTicked) meterFailures.push("el-måleren");
    if (hardware.hasWaterMeter(hw) && endWaterLiters === null && !waterTicked) meterFailures.push("vandmåleren");
    if (meterFailures.length > 0) {
      logger.error("checkout", `Meter read failed at checkout for session ${sessionId}`, meterFailures);
      return {
        ok: false,
        message: `${meterFailures.join(" og ")} kunne ikke aflæses. Indtast slutaflæsningen manuelt, eller tjek ud uden yderligere el/vand-afregning.`.replace(/^./, (c) => c.toUpperCase()),
      };
    }
  }

  // MANUAL: the operator read the meter by hand. Only the part since the
  // last automatic reading is billed (manual − last tick), so consumption
  // already in the accumulator — or on a mid-stay invoice — isn't billed twice.
  const manualAdd = { elKwh: 0, elCost: 0, waterLiters: 0, waterCost: 0 };
  let elManual = false;
  let waterManual = false;
  const startUpdates: Record<string, number> = {};
  const manualNotes: string[] = [];
  if (mode === "MANUAL") {
    const m = options.manual ?? {};
    let elRate = session.pricePerKwhOverride ?? pricing.pricePerKwh;
    if (session.pricePerKwhOverride == null) {
      try { elRate = (await getEffectiveElPricing()).pricePerKwh; } catch { /* fixed price */ }
    }
    const waterRate = session.pricePerLiterWaterOverride ?? pricing.pricePerLiterWater;
    const fmt = (v: number, unit: string) => `${v.toLocaleString("da-DK", { maximumFractionDigits: 2 })} ${unit}`;

    const step = (
      label: string,
      unit: string,
      end: number | null | undefined,
      lastTick: number | null,
      start: number | null,
      manualStart: number | null | undefined,
    ): { end: number; delta: number; newStart: number | null } | string | null => {
      if (end == null) return null;
      if (!Number.isFinite(end) || end < 0) return `Ugyldig slutaflæsning for ${label}.`;
      let newStart: number | null = null;
      let baseline = lastTick ?? start;
      if (baseline == null) {
        if (manualStart == null || !Number.isFinite(manualStart) || manualStart < 0) {
          return `Opholdet har ingen startaflæsning for ${label} — indtast også den.`;
        }
        baseline = manualStart;
        newStart = manualStart;
      }
      if (end < baseline) return `Slutaflæsningen for ${label} (${fmt(end, unit)}) er lavere end sidste aflæsning (${fmt(baseline, unit)}).`;
      manualNotes.push(`${label} ${fmt(end, unit)}`);
      return { end, delta: end - baseline, newStart };
    };

    const el = step("el", "kWh", m.endKwh, session.lastTickKwh, session.startKwh, m.startKwh);
    const heat = step("varme", "kWh", m.endHeatingKwh, session.lastTickHeatingKwh, session.startHeatingKwh, m.startHeatingKwh);
    const water = step("vand", "L", m.endWaterLiters, session.lastTickWaterLiters, session.startWaterLiters, m.startWaterLiters);
    for (const r of [el, heat, water]) if (typeof r === "string") return { ok: false, message: r };
    if (!el && !heat && !water) return { ok: false, message: "Indtast mindst én slutaflæsning." };

    if (el && typeof el !== "string") {
      endKwh = el.end;
      manualAdd.elKwh += el.delta;
      if (el.newStart != null) startUpdates.startKwh = el.newStart;
      elManual = true;
    }
    if (heat && typeof heat !== "string") {
      endHeatingKwh = heat.end;
      manualAdd.elKwh += heat.delta;
      if (heat.newStart != null) startUpdates.startHeatingKwh = heat.newStart;
      elManual = true;
    }
    if (water && typeof water !== "string") {
      endWaterLiters = water.end;
      manualAdd.waterLiters += water.delta;
      if (water.newStart != null) startUpdates.startWaterLiters = water.newStart;
      waterManual = true;
    }
    manualAdd.elCost = manualAdd.elKwh * elRate;
    manualAdd.waterCost = manualAdd.waterLiters * waterRate;

    const missing: string[] = [];
    if (hardware.hasElectricityMeter(hw) && endKwh === null && !elTicked) missing.push("el");
    if (hardware.hasWaterMeter(hw) && endWaterLiters === null && !waterTicked) missing.push("vand");
    if (missing.length > 0) {
      return { ok: false, message: `Indtast også slutaflæsning for ${missing.join(" og ")} — måleren har ingen aflæsning.` };
    }
  }

  // Costs come straight from the accumulator — that's the time-weighted
  // sum of (delta × hourly spot price) across every tick, which is the
  // correct billable amount regardless of what the price is right now.
  // Only a meter no tick ever read (legacy session) uses the snapshot.
  let totalElectricityCost: number | null = elManual
    ? session.accumulatedElCost + manualAdd.elCost
    : elTicked || session.accumulatedElCost > 0 ? session.accumulatedElCost : null;
  let totalWaterCost: number | null = waterManual
    ? session.accumulatedWaterCost + manualAdd.waterCost
    : waterTicked || session.accumulatedWaterCost > 0 ? session.accumulatedWaterCost : null;

  if (mode !== "NONE" && (totalElectricityCost === null || totalWaterCost === null)) {
    // Legacy fallback: snapshot price × total delta
    let effectiveElPrice = pricing.pricePerKwh;
    try {
      const effective = await getEffectiveElPricing();
      effectiveElPrice = effective.pricePerKwh;
    } catch {
      // Fallback to fixed price
    }
    if (session.pricePerKwhOverride != null) effectiveElPrice = session.pricePerKwhOverride;
    const waterRate = session.pricePerLiterWaterOverride ?? pricing.pricePerLiterWater;

    if (totalElectricityCost === null) {
      if (endKwh !== null && session.startKwh !== null) {
        totalElectricityCost = Math.max(0, endKwh - session.startKwh) * effectiveElPrice;
      }
      if (endHeatingKwh !== null && session.startHeatingKwh !== null) {
        const heatingCost = Math.max(0, endHeatingKwh - session.startHeatingKwh) * effectiveElPrice;
        totalElectricityCost = (totalElectricityCost ?? 0) + heatingCost;
      }
    }
    if (totalWaterCost === null && endWaterLiters !== null && session.startWaterLiters !== null) {
      totalWaterCost = Math.max(0, endWaterLiters - session.startWaterLiters) * waterRate;
    }
  }

  // Sum any services billed on-account (POSTPAID ON_ACCOUNT mode)
  const [onAccountLaundry, onAccountShower] = await Promise.all([
    prisma.laundrySess.aggregate({
      where: { sessionId, paymentStatus: "ON_ACCOUNT" },
      _sum: { pricePaid: true },
    }),
    prisma.showerSess.aggregate({
      where: { sessionId, paymentStatus: "ON_ACCOUNT" },
      _sum: { pricePaid: true },
    }),
  ]);
  const totalServicesCost = (onAccountLaundry._sum.pricePaid ?? 0) + (onAccountShower._sum.pricePaid ?? 0);

  const totalCost = (totalElectricityCost ?? 0) + (totalWaterCost ?? 0) + totalServicesCost;

  // How the meters were settled goes on the booking's notes, so the
  // statement and a later look at the booking can explain the figure.
  const noteParts: string[] = [];
  if (mode === "LAST") {
    noteParts.push(session.lastTickAt
      ? `Sidste måleraflæsning brugt (målt ${fmtDateTime(session.lastTickAt)})`
      : "Sidste måleraflæsning brugt");
  }
  if (mode === "MANUAL") noteParts.push(`Manuel slutaflæsning: ${manualNotes.join(", ")}`);
  if (mode === "NONE") noteParts.push("Ingen yderligere el/vand-afregning");
  if (now.getTime() - departedAt.getTime() > 15 * 60_000) noteParts.push(`Faktisk afrejse ${fmtDateTime(departedAt)}`);
  if (session.unit.isLongTerm && options.endTenancy) noteParts.push("Lejemålet er afsluttet");
  if (extraNote) noteParts.push(extraNote);
  const noteLine = noteParts.length > 0 ? `[Udtjek ${fmtDateTime(now)} · ${username}] ${noteParts.join(". ")}` : null;

  const updateData: Record<string, unknown> = {
    status: "COMPLETED",
    checkOutTime: departedAt,
    checkOutRecordedAt: now,
    endKwh,
    endHeatingKwh,
    endWaterLiters,
    totalElectricityCost,
    totalWaterCost,
    totalCost,
    ...startUpdates,
  };
  if (manualAdd.elKwh > 0) {
    updateData.accumulatedElCost = { increment: manualAdd.elCost };
    updateData.accumulatedElKwh = { increment: manualAdd.elKwh };
  }
  if (manualAdd.waterLiters > 0) {
    updateData.accumulatedWaterCost = { increment: manualAdd.waterCost };
    updateData.accumulatedWaterLiters = { increment: manualAdd.waterLiters };
  }
  if (noteLine) updateData.notes = session.notes ? `${session.notes}\n${noteLine}` : noteLine;

  // Conditional update: fail if status changed between our read and write
  // (concurrent checkOut call, admin double-click, etc.). Prevents double
  // check-out and ensures concurrent cron ticks can no longer mutate this
  // session via tickSessionConsumption's own status=ACTIVE guard.
  const res = await prisma.session.updateMany({
    where: { id: sessionId, status: "ACTIVE" },
    data: updateData,
  });
  if (res.count === 0) {
    return { ok: false, message: "Opholdet er allerede tjekket ud eller blev ændret samtidig. Genindlæs siden." };
  }
  if (noteLine) logger.info("checkout", `Ophold ${sessionId}: ${noteParts.join(". ")}`);

  // Payment status follows the settlement: under 1 kr left (nothing used, or
  // covered by the prepayment) is settled now; anything else stays open. A
  // "paid" flag set while the stay ran doesn't cover what came after it.
  let settlement: Settlement | null = null;
  try {
    settlement = await syncPaymentStatus(sessionId, { ignorePaidFlag: true });
  } catch (e) {
    logger.error("checkout", `Betalingsstatus kunne ikke opdateres (session ${sessionId})`, e);
  }

  // Turn off devices based on auto_power_off setting
  const globalSettings = await readGlobalSettings();
  const autoPowerOff = globalSettings.auto_power_off_on_checkout === "true";

  if (autoPowerOff) {
    if (hardware.hasElectricitySwitch(hw)) {
      try { await hardware.setSwitch(hardware.electricitySwitchEp(hw!), false); } catch (e) { logger.error("checkout", "checkOut el off", e); }
    }
    // Turn off heating unless winter mode is enabled (protect cabin from frost)
    if (hardware.hasHeatingSwitch(hw) && !hw!.winterModeEnabled) {
      try { await hardware.setSwitch(hardware.heatingSwitchEp(hw!), false); } catch (e) { logger.error("checkout", "checkOut heat off", e); }
    }
    if (hw?.hasSmartLock && hw.lockEntityId) {
      try { await ha.lockDoor(hw.lockEntityId); } catch (e) { logger.error("checkout", "HA lock", e); }
    }
  }
  // Always set climate to vacant temp (HA only)
  if (hw?.hasClimate && hw.climateEntityId) {
    try { await ha.setClimateTemperature(hw.climateEntityId, pricing.defaultVacantTemp); } catch (e) { logger.error("checkout", "HA climate set vacant temp", e); }
  }

  // A long-term unit stays the tenant's (monthly invoices) unless the desk
  // ends the tenancy at check-out.
  if (!session.unit.isLongTerm) {
    await prisma.unit.update({ where: { id: session.unitId }, data: { status: "VACANT" } });
  } else if (options.endTenancy) {
    await prisma.unit.update({
      where: { id: session.unitId },
      data: { status: "VACANT", longTermGuestName: null, longTermGuestEmail: null, longTermGuestPhone: null, longTermPortalToken: null },
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${sessionId}`);
  revalidatePath(`/admin/units/${session.unitId}`);
  return {
    ok: true,
    totalElectricityCost,
    totalWaterCost,
    totalServicesCost,
    totalCost,
    isPrepaid: session.billingMode === "PREPAID",
    prepaidAmount: session.prepaidAmount,
    settlement,
  };
}

/**
 * What check-out will settle, shown in the dialog before the operator
 * confirms: the settlement so far and the state of each meter. Ticks first,
 * so the figures and readings are as fresh as the hardware allows.
 */
export async function getCheckoutPreview(
  sessionId: number,
): Promise<{ ok: true; preview: CheckoutPreview } | { ok: false; message: string }> {
  await requireAuth();
  const initial = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: { include: { hardware: true } } },
  });
  if (!initial) return { ok: false, message: "Opholdet findes ikke." };
  if (initial.status === "COMPLETED") return { ok: false, message: "Opholdet er allerede tjekket ud." };
  if (initial.status !== "ACTIVE") return { ok: false, message: "Gæsten er ikke tjekket ind." };

  const hw = initial.unit.hardware;
  let read = { el: false, heat: false, water: false };
  let session = initial;
  if (hw) {
    try {
      const tick = await tickSessionConsumptionInternal(sessionId);
      if (tick) read = tick.read;
      const reloaded = await prisma.session.findUnique({
        where: { id: sessionId },
        include: { unit: { include: { hardware: true } } },
      });
      if (reloaded) session = reloaded;
    } catch (e) {
      logger.error("checkout", "getCheckoutPreview: tick fejl", e);
    }
  }

  const settlement = await computeSettlement(sessionId, { ignorePaidFlag: true });
  if (!settlement) return { ok: false, message: "Opholdet findes ikke." };

  const now = new Date();
  const meters: CheckoutMeterInfo[] = [];
  const addMeter = (
    key: CheckoutMeterInfo["key"],
    label: string,
    unit: CheckoutMeterInfo["unit"],
    configured: boolean,
    readNow: boolean,
    lastTick: number | null,
    start: number | null,
  ) => {
    if (!configured) return;
    const lastValue = lastTick ?? start;
    const lastReadAt = readNow ? now : lastTick != null ? session.lastTickAt : start != null ? session.checkInTime : null;
    const ageMin = lastReadAt ? (now.getTime() - lastReadAt.getTime()) / 60_000 : Infinity;
    meters.push({
      key,
      label,
      unit,
      online: readNow,
      lastValue,
      lastReadAt,
      startValue: start,
      stale: !readNow && (lastValue == null || ageMin > STALE_READING_MINUTES),
    });
  };
  addMeter("el", hardware.hasHeatingMeter(hw) ? "El (hoved)" : "El", "kWh", hardware.hasElectricityMeter(hw), read.el, session.lastTickKwh, session.startKwh);
  addMeter("heat", "Varme", "kWh", hardware.hasHeatingMeter(hw), read.heat, session.lastTickHeatingKwh, session.startHeatingKwh);
  addMeter("water", "Vand", "L", hardware.hasWaterMeter(hw), read.water, session.lastTickWaterLiters, session.startWaterLiters);

  const pricing = await getPricing();
  let elPrice = session.pricePerKwhOverride ?? pricing.pricePerKwh;
  if (session.pricePerKwhOverride == null) {
    try { elPrice = (await getEffectiveElPricing()).pricePerKwh; } catch { /* fixed price */ }
  }
  const settings = await readGlobalSettings();

  return {
    ok: true,
    preview: {
      settlement,
      meters,
      elPrice,
      waterPrice: session.pricePerLiterWaterOverride ?? pricing.pricePerLiterWater,
      powerOff: settings.auto_power_off_on_checkout === "true" && hardware.hasElectricitySwitch(hw),
    },
  };
}

// ──────────────────────────────────────────────
// SESSION STATEMENT — the printable /admin/bookings/[id]/statement page.
// Everything money comes from the settlement (src/lib/settlement.ts), so the
// statement, the booking page and the unpaid lists can't disagree.
// ──────────────────────────────────────────────
export interface SessionStatement {
  session: {
    id: number;
    guestName: string;
    guestEmail: string | null;
    guestPhone: string | null;
    bookingRef: string | null;
    checkInTime: Date;
    checkOutTime: Date | null;
    status: "PENDING" | "ACTIVE" | "COMPLETED";
    isLongTerm: boolean;
  };
  unit: {
    id: number;
    name: string;
    type: string;
  };
  settlement: Settlement;
  camp: CampInfo;
  generatedAt: Date;
}

export async function getSessionStatement(sessionId: number): Promise<SessionStatement | null> {
  await requireAuth();
  const initial = await prisma.session.findUnique({ where: { id: sessionId }, select: { status: true } });
  if (!initial) return null;

  // For ACTIVE sessions, tick first so the figures reflect time-weighted
  // spot-price billing up to now (same numbers as /api/cron would produce).
  if (initial.status === "ACTIVE") {
    try {
      await tickSessionConsumptionInternal(sessionId);
    } catch (e) {
      logger.error("tick", "getSessionStatement: tick fejl", e);
    }
  }

  const [session, settlement, settings] = await Promise.all([
    prisma.session.findUnique({ where: { id: sessionId }, include: { unit: true } }),
    computeSettlement(sessionId),
    readGlobalSettings(),
  ]);
  if (!session || !settlement) return null;

  return {
    session: {
      id: session.id,
      guestName: session.guestName,
      guestEmail: session.guestEmail,
      guestPhone: session.guestPhone,
      bookingRef: session.bookingRef,
      checkInTime: session.checkInTime,
      checkOutTime: session.checkOutTime,
      status: settlement.sessionStatus,
      isLongTerm: session.unit.isLongTerm,
    },
    unit: {
      id: session.unit.id,
      name: session.unit.name,
      type: session.unit.type,
    },
    settlement,
    camp: {
      name: settings.camp_name?.trim() || null,
      address: settings.camp_address?.trim() || null,
      cvr: settings.camp_cvr?.trim() || null,
    },
    generatedAt: new Date(),
  };
}

/** The settlement for one stay (booking page, client components). No tick. */
export async function getSessionSettlement(sessionId: number): Promise<Settlement | null> {
  await requireAuth();
  return computeSettlement(sessionId);
}

// ──────────────────────────────────────────────
// CHECK-OUT WITH STATEMENT — the one check-out flow in the UI (booking page
// and unit page). No closing invoice: for a short stay the stay itself is the
// bill. The old closing invoice was raised after the stay was completed, so
// it found no active stay, was usually skipped, and double-billed when it
// wasn't. Long-term units keep their monthly invoices.
// ──────────────────────────────────────────────
export async function checkOutWithStatement(
  sessionId: number,
  options: CheckoutOptions = {},
): Promise<{ ok: true; state: Settlement["state"] | null; owed: number } | { ok: false; message: string }> {
  await requireAuth();
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true },
  });
  if (!session) return { ok: false, message: "Opholdet findes ikke." };
  if (session.status === "PENDING") return { ok: false, message: "Gæsten er ikke tjekket ind." };

  let state: Settlement["state"] | null = null;
  let owed = 0;
  if (session.status === "ACTIVE") {
    const res = await checkOut(sessionId, options);
    if (!res.ok) return res;
    state = res.settlement?.state ?? null;
    owed = res.settlement?.owed ?? 0;
  }

  revalidatePath(`/admin/bookings/${sessionId}`);
  revalidatePath(`/admin/bookings/${sessionId}/statement`);
  return { ok: true, state, owed };
}

// ──────────────────────────────────────────────
// TIME-WEIGHTED CONSUMPTION TICK
//
// Called by cron every ~10 min (heavy tasks) and ad-hoc before billing actions.
// Reads current meter values from Home Assistant / MQTT, computes the delta
// since the previous tick, and multiplies that delta by the *current* hourly
// spot price to produce a correctly time-weighted cost. The result is added
// to the session's `accumulatedElCost` / `accumulatedWaterCost`.
//
// This is the core of spot-price billing: if the guest uses 1 kWh between
// 17-18 (spot 2 kr) and 1 kWh between 18-19 (spot 1 kr), the accumulator
// gains 2 + 1 = 3 kr across the two hours, regardless of what the price
// is at invoice time. The worst-case discretisation error equals the tick
// interval — at 10-min ticks it's ~10 min of consumption priced into the
// neighbouring hour at the hour boundary.
// ──────────────────────────────────────────────
/** Auth-guarded entry point (server action). Cron/webhooks call it inside
 *  runWithApiAuth; in-module callers use tickSessionConsumptionInternal directly. */
export async function tickSessionConsumption(...args: Parameters<typeof tickSessionConsumptionInternal>) {
  await requireAuth();
  return tickSessionConsumptionInternal(...args);
}

async function tickSessionConsumptionInternal(sessionId: number): Promise<{
  addedKwh: number;
  addedElCost: number;
  addedLiters: number;
  addedWaterCost: number;
  elPriceAtTick: number;
  spotPrice: number | null;
  /** Which configured meters answered this tick (checkout shows the rest as offline). */
  read: { el: boolean; heat: boolean; water: boolean };
} | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: { include: { hardware: true } } },
  });
  if (!session || session.status !== "ACTIVE") return null;

  const hw = session.unit.hardware;
  if (!hw) return null;

  const pricing = await getPricing();

  // Effective price right now (honour per-booking override over spot mode)
  let elPrice = pricing.pricePerKwh;
  let spotPrice: number | null = null;
  if (session.pricePerKwhOverride != null) {
    elPrice = session.pricePerKwhOverride;
  } else {
    try {
      const effective = await getEffectiveElPricing();
      elPrice = effective.pricePerKwh;
      spotPrice = effective.spotPrice;
    } catch {
      // Fallback to fixed price — already in elPrice
    }
  }
  const waterPrice = session.pricePerLiterWaterOverride ?? pricing.pricePerLiterWater;

  // Read meters (each isolated — one failing doesn't abort the others)
  let currentKwh: number | null = null;
  let currentHeatingKwh: number | null = null;
  let currentWaterLiters: number | null = null;
  if (hardware.hasElectricityMeter(hw)) {
    currentKwh = await safeReadMeter(hardware.electricityMeterEp(hw), `tick:el session=${sessionId}`);
  }
  if (hardware.hasHeatingMeter(hw)) {
    currentHeatingKwh = await safeReadMeter(hardware.heatingMeterEp(hw), `tick:heat session=${sessionId}`);
  }
  if (hardware.hasWaterMeter(hw)) {
    currentWaterLiters = await safeReadMeter(hardware.waterMeterEp(hw), `tick:water session=${sessionId}`);
  }

  let addElKwh = 0;
  let addElCost = 0;
  let addWaterLiters = 0;
  let addWaterCost = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: Record<string, any> = {};

  // Plausibility cap: a meter can't physically advance faster than the
  // supply allows. Guards against a glitch reading (e.g. HA reporting 0 on
  // restart → baseline resets → next tick would bill the whole counter).
  const hoursSinceTick = Math.max(
    0.05,
    (Date.now() - (session.lastTickAt ?? session.checkInTime).getTime()) / 3_600_000,
  );
  const capDelta = (delta: number, maxPerHour: number, label: string) => {
    const cap = maxPerHour * hoursSinceTick;
    if (delta <= cap) return delta;
    logger.warn("tick", `Session ${sessionId}: ${label} spring på ${delta.toFixed(1)} afvist (max ${cap.toFixed(1)}) — måler-glitch/reset?`);
    return 0;
  };
  const MAX_KW = 11;            // 16 A three-phase
  const MAX_LITERS_PER_HOUR = 1800; // 30 L/min

  // Main electricity
  if (currentKwh !== null) {
    const baseline = session.lastTickKwh ?? session.startKwh;
    if (baseline !== null) {
      const delta = capDelta(Math.max(0, currentKwh - baseline), MAX_KW, "el");
      addElKwh += delta;
      addElCost += delta * elPrice;
    } else {
      // First observation for this session — capture baseline for future ticks
      updateData.startKwh = currentKwh;
    }
    updateData.lastTickKwh = currentKwh;
  }

  // Heating electricity (still electricity — rolls into the same accumulator)
  if (currentHeatingKwh !== null) {
    const baseline = session.lastTickHeatingKwh ?? session.startHeatingKwh;
    if (baseline !== null) {
      const delta = capDelta(Math.max(0, currentHeatingKwh - baseline), MAX_KW, "varme");
      addElKwh += delta;
      addElCost += delta * elPrice;
    } else {
      updateData.startHeatingKwh = currentHeatingKwh;
    }
    updateData.lastTickHeatingKwh = currentHeatingKwh;
  }

  // Water (fixed rate, but accumulated for consistency)
  if (currentWaterLiters !== null) {
    const baseline = session.lastTickWaterLiters ?? session.startWaterLiters;
    if (baseline !== null) {
      const delta = capDelta(Math.max(0, currentWaterLiters - baseline), MAX_LITERS_PER_HOUR, "vand");
      addWaterLiters += delta;
      addWaterCost += delta * waterPrice;
    } else {
      updateData.startWaterLiters = currentWaterLiters;
    }
    updateData.lastTickWaterLiters = currentWaterLiters;
  }

  const meterRead = { el: currentKwh !== null, heat: currentHeatingKwh !== null, water: currentWaterLiters !== null };
  const hasAnyRead = currentKwh !== null || currentHeatingKwh !== null || currentWaterLiters !== null;
  if (hasAnyRead) {
    if (addElKwh > 0) {
      updateData.accumulatedElCost = { increment: addElCost };
      updateData.accumulatedElKwh = { increment: addElKwh };
    }
    if (addWaterLiters > 0) {
      updateData.accumulatedWaterCost = { increment: addWaterCost };
      updateData.accumulatedWaterLiters = { increment: addWaterLiters };
    }
    updateData.lastTickAt = new Date();

    // Optimistic concurrency: only apply the tick if the session's
    // lastTickAt / status are still what we observed when we computed the
    // delta. If another tick (cron, opportunistic UI read, checkOut) raced
    // us, updateMany returns count=0 and we skip — no double-counting.
    const res = await prisma.session.updateMany({
      where: {
        id: sessionId,
        status: "ACTIVE",
        lastTickAt: session.lastTickAt, // null matches null
      },
      data: updateData,
    });
    if (res.count === 0) {
      // Lost the race — discard this tick's contribution.
      return {
        addedKwh: 0,
        addedElCost: 0,
        addedLiters: 0,
        addedWaterCost: 0,
        elPriceAtTick: elPrice,
        spotPrice,
        read: meterRead,
      };
    }
  }

  return {
    addedKwh: addElKwh,
    addedElCost: addElCost,
    addedLiters: addWaterLiters,
    addedWaterCost: addWaterCost,
    elPriceAtTick: elPrice,
    spotPrice,
    read: meterRead,
  };
}

// Tick every active session — invoked from the cron route.
/** Auth-guarded entry point (server action). Cron/webhooks call it inside
 *  runWithApiAuth; in-module callers use tickAllSessionConsumptionInternal directly. */
export async function tickAllSessionConsumption(...args: Parameters<typeof tickAllSessionConsumptionInternal>) {
  await requireAuth();
  return tickAllSessionConsumptionInternal(...args);
}

async function tickAllSessionConsumptionInternal(): Promise<{
  ticked: number;
  totalKwh: number;
  totalElCost: number;
}> {
  const active = await prisma.session.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
  });

  let ticked = 0;
  let totalKwh = 0;
  let totalElCost = 0;
  for (const s of active) {
    try {
      const result = await tickSessionConsumptionInternal(s.id);
      if (result) {
        ticked++;
        totalKwh += result.addedKwh;
        totalElCost += result.addedElCost;
      }
    } catch (e) {
      logger.error("tick", `tickSessionConsumption fejl (session ${s.id})`, e);
    }
  }
  return { ticked, totalKwh, totalElCost };
}

// ──────────────────────────────────────────────
// LIVE CONSUMPTION
//
// Shows what the guest currently owes based on the *accumulated* cost
// (time-weighted against the hourly spot price up to the last tick) plus
// an "ongoing delta" since the last tick at the current spot price — so
// the display stays smooth even between ticks without writing to the DB.
// If `lastTickAt` is older than 60s we opportunistically trigger a tick
// so an operator viewing the booking gets near-live updates.
// ──────────────────────────────────────────────
/**
 * Live consumption for an active session. Guests pass their portal token
 * (session or long-term unit token); without one the caller must be admin/API.
 */
export async function getLiveConsumption(sessionId: number, portalToken?: string) {
  if (portalToken === undefined) await requireAuth();
  const initial = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: { include: { hardware: true } } },
  });

  if (!initial || initial.status !== "ACTIVE") return null;
  if (
    portalToken !== undefined &&
    portalToken !== initial.guestPortalToken &&
    portalToken !== initial.unit.longTermPortalToken
  ) return null;

  // Meters whose Shelly has announced itself offline aren't asked — each
  // read would only wait for a 3 s timeout, on every 30 s poll.
  const initialHw = initial.unit.hardware;
  const meters = [
    hardware.hasElectricityMeter(initialHw) ? { key: "el", label: "El", ep: hardware.electricityMeterEp(initialHw!) } : null,
    hardware.hasHeatingMeter(initialHw) ? { key: "heat", label: "Varme", ep: hardware.heatingMeterEp(initialHw!) } : null,
    hardware.hasWaterMeter(initialHw) ? { key: "water", label: "Vand", ep: hardware.waterMeterEp(initialHw!) } : null,
  ].filter((m) => m !== null);
  const reportedOffline = new Set<string>();
  await Promise.all(meters.map(async (m) => {
    if (await hardware.isReportedOffline(m.ep).catch(() => false)) reportedOffline.add(m.key);
  }));

  // Opportunistic tick — keeps the accumulator fresh when someone is actively
  // viewing the booking. Cron is the guarantee (every 10 min); this is the
  // nicety for the operator UI. Skipped when every meter is offline: the tick
  // couldn't read anything and wouldn't change the stay.
  const STALE_TICK_MS = 60 * 1000;
  const isStale = !initial.lastTickAt || (Date.now() - initial.lastTickAt.getTime() > STALE_TICK_MS);
  const allOffline = meters.length > 0 && reportedOffline.size === meters.length;
  let session = initial;
  if (isStale && !allOffline) {
    try {
      await tickSessionConsumptionInternal(sessionId);
      // Reload with the fresh accumulator values
      const reloaded = await prisma.session.findUnique({
        where: { id: sessionId },
        include: { unit: { include: { hardware: true } } },
      });
      if (reloaded) session = reloaded;
    } catch (e) {
      logger.error("tick", "getLiveConsumption tick fejl", e);
    }
  }

  const hw = session.unit.hardware;
  const pricing = await getPricing();

  // Current effective price for the "ongoing delta" display (since last tick)
  let effectiveElPrice = pricing.pricePerKwh;
  let spotPrice: number | null = null;
  if (session.pricePerKwhOverride != null) {
    effectiveElPrice = session.pricePerKwhOverride;
  } else {
    try {
      const effective = await getEffectiveElPricing();
      effectiveElPrice = effective.pricePerKwh;
      spotPrice = effective.spotPrice;
    } catch {
      // Fallback to fixed price
    }
  }
  const waterRate = session.pricePerLiterWaterOverride ?? pricing.pricePerLiterWater;

  // Read the latest meter values — used to compute the ongoing delta
  let currentKwh: number | null = null;
  let currentHeatingKwh: number | null = null;
  let currentWaterLiters: number | null = null;
  if (hardware.hasElectricityMeter(hw) && !reportedOffline.has("el")) {
    currentKwh = await safeReadMeter(hardware.electricityMeterEp(hw!), `live:el session=${sessionId}`);
  }
  if (hardware.hasHeatingMeter(hw) && !reportedOffline.has("heat")) {
    currentHeatingKwh = await safeReadMeter(hardware.heatingMeterEp(hw!), `live:heat session=${sessionId}`);
  }
  if (hardware.hasWaterMeter(hw) && !reportedOffline.has("water")) {
    currentWaterLiters = await safeReadMeter(hardware.waterMeterEp(hw!), `live:water session=${sessionId}`);
  }

  // Is anything actually being measured? The figures below are only as new
  // as the last tick, so the desk must see when that was.
  const readings: Record<string, number | null> = { el: currentKwh, heat: currentHeatingKwh, water: currentWaterLiters };
  const silent = meters.filter((m) => readings[m.key] === null);
  const meterOnline = meters.length === 0 ? null : silent.length === 0;
  const lastReadingAt = session.lastTickAt ?? session.checkInTime;
  const readingStale = meters.length > 0 && Date.now() - lastReadingAt.getTime() > METER_FRESH_MS;
  // Device names and setup hints are for staff only, not the guest portal
  let offlineReason: string | null = null;
  if (portalToken === undefined && silent.length > 0) {
    const reasons = await Promise.all(silent.map(async (m) => `${m.label} — ${await hardware.explainNoReply(m.ep).catch(() => "ingen svar")}`));
    offlineReason = Array.from(new Set(reasons)).join(" · ");
  }

  // Ongoing deltas since the last tick (priced at the current rate)
  const ongoingMainKwh = (currentKwh !== null && session.lastTickKwh !== null)
    ? Math.max(0, currentKwh - session.lastTickKwh) : 0;
  const ongoingHeatingKwh = (currentHeatingKwh !== null && session.lastTickHeatingKwh !== null)
    ? Math.max(0, currentHeatingKwh - session.lastTickHeatingKwh) : 0;
  const ongoingWaterLiters = (currentWaterLiters !== null && session.lastTickWaterLiters !== null)
    ? Math.max(0, currentWaterLiters - session.lastTickWaterLiters) : 0;
  const ongoingElCost = (ongoingMainKwh + ongoingHeatingKwh) * effectiveElPrice;
  const ongoingWaterCost = ongoingWaterLiters * waterRate;

  // Breakdown for the admin UI: used* are the totals this accumulator has
  // seen so far, split between main and heating. We reconstruct the split
  // using the raw meter start baselines — it's only for display.
  const baselineMain = session.startKwh;
  const baselineHeating = session.startHeatingKwh;
  const baselineWater = session.startWaterLiters;

  const usedKwhMain = (currentKwh !== null && baselineMain !== null)
    ? Math.max(0, currentKwh - baselineMain) : null;
  const usedKwhHeating = (currentHeatingKwh !== null && baselineHeating !== null)
    ? Math.max(0, currentHeatingKwh - baselineHeating) : null;
  const usedWaterLiters = (currentWaterLiters !== null && baselineWater !== null)
    ? Math.max(0, currentWaterLiters - baselineWater) : null;

  // Total used kWh/cost = accumulator (time-weighted) + ongoing delta (live)
  const usedKwh = session.accumulatedElKwh + ongoingMainKwh + ongoingHeatingKwh;
  const electricityCost = session.accumulatedElCost + ongoingElCost;
  const waterUsed = session.accumulatedWaterLiters + ongoingWaterLiters;
  const waterCost = session.accumulatedWaterCost + ongoingWaterCost;

  // Accumulated ON_ACCOUNT service costs (for guest portal display)
  const [onAccLaundry, onAccShower] = await Promise.all([
    prisma.laundrySess.aggregate({ where: { sessionId, paymentStatus: "ON_ACCOUNT" }, _sum: { pricePaid: true } }),
    prisma.showerSess.aggregate({ where: { sessionId, paymentStatus: "ON_ACCOUNT" }, _sum: { pricePaid: true } }),
  ]);
  const servicesCost = (onAccLaundry._sum.pricePaid ?? 0) + (onAccShower._sum.pricePaid ?? 0);

  return {
    currentKwh,
    usedKwh,
    electricityCost,
    usedKwhMain,
    usedKwhHeating,
    currentHeatingKwh,
    hasHeatingMeter: hardware.hasHeatingMeter(hw),
    currentWaterLiters,
    usedWaterLiters: waterUsed > 0 ? waterUsed : usedWaterLiters,
    waterCost,
    servicesCost,
    totalLiveCost: electricityCost + waterCost + servicesCost,
    currency: pricing.currency,
    pricePerKwh: effectiveElPrice,
    spotPrice,
    pricingMode: pricing.pricingMode,
    hasMeters: meters.length > 0,
    meterOnline,
    /** Last successful tick (or check-in when there has been none). */
    lastReadingAt: meters.length > 0 ? lastReadingAt.toISOString() : null,
    readingStale,
    offlineReason,
  };
}

// ──────────────────────────────────────────────
// LIVE POWER DRAW — instantaneous W readings for a unit
// Used by the unit detail page so the operator can see what is currently
// being drawn on the main + heating circuits without opening a booking.
// ──────────────────────────────────────────────
export async function getLivePowerDraw(unitId: number): Promise<{
  electricityW: number | null;
  heatingW: number | null;
  totalW: number | null;
  hasElectricityPower: boolean;
  hasHeatingPower: boolean;
} | null> {
  await requireAuth();
  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: { hardware: true },
  });
  if (!unit?.hardware) return null;
  const hw = unit.hardware;

  const hasElectricityPower = hardware.hasElectricityPower(hw);
  const hasHeatingPower = hardware.hasHeatingPower(hw);
  if (!hasElectricityPower && !hasHeatingPower) return null;

  // Read the power sensors in parallel — each failure is isolated. A Shelly
  // that has announced itself offline isn't asked (5 s polling × 3 s timeout).
  const readW = async (ep: HardwareEndpoint) => {
    if (await hardware.isReportedOffline(ep).catch(() => false)) return null;
    return hardware.readPowerWatts(ep).then((r) => r?.watts ?? null).catch(() => null);
  };
  const [rawElec, rawHeat] = await Promise.all([
    hasElectricityPower ? readW(hardware.electricityPowerEp(hw)) : Promise.resolve(null),
    hasHeatingPower ? readW(hardware.heatingPowerEp(hw)) : Promise.resolve(null),
  ]);

  const totalW = rawElec !== null || rawHeat !== null
    ? (rawElec ?? 0) + (rawHeat ?? 0)
    : null;

  return {
    electricityW: rawElec,
    heatingW: rawHeat,
    totalW,
    hasElectricityPower,
    hasHeatingPower,
  };
}

// ──────────────────────────────────────────────
// HA State helpers
// ──────────────────────────────────────────────

// Read a relay for display. A Shelly that has announced itself offline isn't
// asked (that only waits for a 3 s timeout); when there is no answer the
// reason comes back in the cron's words, e.g. "MQTT: Camping-S001 er offline …".
async function readSwitchForDisplay(ep: HardwareEndpoint): Promise<{ on: boolean | null; ageMs: number | null; reason: string | null }> {
  try {
    if (!(await hardware.isReportedOffline(ep))) {
      const s = await hardware.getSwitchStateWithAge(ep);
      if (s.on !== null) return { on: s.on, ageMs: s.ageMs, reason: null };
    }
    return { on: null, ageMs: null, reason: await hardware.explainNoReply(ep) };
  } catch (e) {
    return { on: null, ageMs: null, reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function getUnitHAStates(unitId: number) {
  await requireAuth();
  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: { hardware: true },
  });

  // Every unit has a hardware row; only switched-on features count, so a
  // pitch without meters never probes Home Assistant or MQTT.
  const hw = unit?.hardware;
  if (!hw || !hasAnyHardware(hw)) return null;

  let powerOn: boolean | null = null;
  let powerAgeMs: number | null = null;
  let heatingOn: boolean | null = null;
  let temperature: number | null = null;
  let locked: boolean | null = null;
  let anySuccess = false;
  const problems: { label: string; reason: string }[] = [];

  const hasPowerSwitch = hardware.hasElectricitySwitch(hw);
  const hasHeatingSwitch = hardware.hasHeatingSwitch(hw);
  const [power, heating] = await Promise.all([
    hasPowerSwitch ? readSwitchForDisplay(hardware.electricitySwitchEp(hw)) : null,
    hasHeatingSwitch ? readSwitchForDisplay(hardware.heatingSwitchEp(hw)) : null,
  ]);
  if (power) {
    if (power.on !== null) { powerOn = power.on; powerAgeMs = power.ageMs; anySuccess = true; }
    else if (power.reason) problems.push({ label: "Strøm", reason: power.reason });
  }
  if (heating) {
    if (heating.on !== null) { heatingOn = heating.on; anySuccess = true; }
    else if (heating.reason) problems.push({ label: "Varme", reason: heating.reason });
  }
  if (hw.hasClimate && hw.climateEntityId) {
    try {
      const state = await ha.getEntityState(hw.climateEntityId);
      temperature = typeof state.attributes.current_temperature === "number"
        ? state.attributes.current_temperature : null;
      anySuccess = true;
    } catch {
      problems.push({ label: "Termostat", reason: await hardware.explainNoReply({ source: "HA", haEntityId: hw.climateEntityId }) });
    }
  }
  if (hw.hasSmartLock && hw.lockEntityId) {
    try {
      const state = await ha.getEntityState(hw.lockEntityId);
      locked = state.state === "locked";
      anySuccess = true;
    } catch {
      problems.push({ label: "Lås", reason: await hardware.explainNoReply({ source: "HA", haEntityId: hw.lockEntityId }) });
    }
  }
  // Meter-only units have no relay to read; a Shelly that has announced
  // itself offline is still worth saying.
  if (!hasPowerSwitch && hardware.hasElectricityMeter(hw)) {
    const ep = hardware.electricityMeterEp(hw);
    if (await hardware.isReportedOffline(ep).catch(() => false)) {
      problems.push({ label: "Elmåler", reason: await hardware.explainNoReply(ep) });
    }
  }

  // The same device behind several features → one line, not one per feature
  const byReason = new Map<string, string[]>();
  for (const p of problems) byReason.set(p.reason, [...(byReason.get(p.reason) ?? []), p.label]);
  const offlineReason = problems.length
    ? Array.from(byReason, ([reason, labels]) => `${labels.join(" og ")} — ${reason}`).join(" · ")
    : null;

  return {
    powerOn,
    powerAgeMs,
    heatingOn,
    winterModeEnabled: hw.winterModeEnabled,
    temperature,
    locked,
    hasPowerSwitch,
    hasHeatingSwitch,
    // Kept for older callers: false only when something should have answered and nothing did
    haReachable: anySuccess || problems.length === 0,
    offlineReason,
  };
}

// ──────────────────────────────────────────────
// Manual HA controls — expected failures come back as Danish text
// ──────────────────────────────────────────────
type ControlResult = { ok: boolean; message?: string };

async function controlFailureText(ep: HardwareEndpoint, e: unknown): Promise<string> {
  const msg = e instanceof Error ? e.message : String(e);
  // No reply from the Shelly: say why (offline, never seen, RPC off …)
  if (ep.source === "MQTT" && /bekræftede ikke/.test(msg)) {
    return (await hardware.explainNoReply(ep).catch(() => null)) ?? msg;
  }
  if (ep.source === "HA") {
    if (!(await ha.isHAConfigured())) return "HA: Home Assistant er ikke sat op";
    // haFetch: "HA API error: 404 Not Found" when HA answered, otherwise a network error
    return /^HA API error/.test(msg)
      ? `HA: ${ep.haEntityId} — Home Assistant svarede med fejl (${msg.replace(/^HA API error:\s*/, "")})`
      : `HA: Home Assistant svarer ikke (${msg})`;
  }
  return msg;
}

export async function togglePower(unitId: number, turnOn: boolean): Promise<ControlResult & { powerOn: boolean | null }> {
  await requireAuth();
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, include: { hardware: true } });
  if (!hardware.hasElectricitySwitch(unit?.hardware)) {
    return { ok: false, powerOn: null, message: "Enheden har intet strømrelæ sat op." };
  }
  const ep = hardware.electricitySwitchEp(unit!.hardware!);
  // A Shelly that has announced itself offline can't receive the command —
  // say so now instead of after a 4 s timeout.
  if (await hardware.isReportedOffline(ep).catch(() => false)) {
    return { ok: false, powerOn: null, message: `Strømmen er ikke ${turnOn ? "tændt" : "slukket"}. ${await hardware.explainNoReply(ep)}` };
  }
  try {
    await hardware.setSwitch(ep, turnOn);
  } catch (e) {
    logger.error("hardware", `togglePower unit=${unitId} on=${turnOn}`, e);
    return {
      ok: false,
      powerOn: null,
      message: `Strømmen er ikke ${turnOn ? "tændt" : "slukket"}. ${await controlFailureText(ep, e)}`,
    };
  }
  revalidatePath(`/admin/units/${unitId}`);
  return { ok: true, powerOn: turnOn };
}

export async function toggleHeating(unitId: number, turnOn: boolean): Promise<ControlResult & { heatingOn: boolean | null }> {
  await requireAuth();
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, include: { hardware: true } });
  if (!hardware.hasHeatingSwitch(unit?.hardware)) {
    return { ok: false, heatingOn: null, message: "Enheden har intet varmerelæ sat op." };
  }
  const ep = hardware.heatingSwitchEp(unit!.hardware!);
  if (await hardware.isReportedOffline(ep).catch(() => false)) {
    return { ok: false, heatingOn: null, message: `Varmen er ikke ${turnOn ? "tændt" : "slukket"}. ${await hardware.explainNoReply(ep)}` };
  }
  try {
    await hardware.setSwitch(ep, turnOn);
  } catch (e) {
    logger.error("hardware", `toggleHeating unit=${unitId} on=${turnOn}`, e);
    return {
      ok: false,
      heatingOn: null,
      message: `Varmen er ikke ${turnOn ? "tændt" : "slukket"}. ${await controlFailureText(ep, e)}`,
    };
  }
  revalidatePath(`/admin/units/${unitId}`);
  return { ok: true, heatingOn: turnOn };
}

export async function toggleLock(unitId: number, lock: boolean): Promise<ControlResult> {
  await requireAuth();
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, include: { hardware: true } });
  if (!unit?.hardware?.lockEntityId) return { ok: false, message: "Enheden har ingen lås sat op." };
  try {
    if (lock) { await ha.lockDoor(unit.hardware.lockEntityId); }
    else { await ha.unlockDoor(unit.hardware.lockEntityId); }
  } catch (e) {
    logger.error("hardware", `toggleLock unit=${unitId} lock=${lock}`, e);
    const reason = await controlFailureText({ source: "HA", haEntityId: unit.hardware.lockEntityId }, e);
    return { ok: false, message: `Døren er ikke ${lock ? "låst" : "låst op"}. ${reason}` };
  }
  revalidatePath(`/admin/units/${unitId}`);
  return { ok: true };
}

export async function setTemperature(unitId: number, temp: number): Promise<ControlResult> {
  await requireAuth();
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, include: { hardware: true } });
  if (!unit?.hardware?.climateEntityId) return { ok: false, message: "Enheden har ingen termostat sat op." };
  if (!Number.isFinite(temp)) return { ok: false, message: "Angiv en temperatur." };
  try {
    await ha.setClimateTemperature(unit.hardware.climateEntityId, temp);
  } catch (e) {
    logger.error("hardware", `setTemperature unit=${unitId} temp=${temp}`, e);
    const reason = await controlFailureText({ source: "HA", haEntityId: unit.hardware.climateEntityId }, e);
    return { ok: false, message: `Temperaturen er ikke ændret. ${reason}` };
  }
  revalidatePath(`/admin/units/${unitId}`);
  return { ok: true };
}

// ──────────────────────────────────────────────
// Guest portal
// ──────────────────────────────────────────────
export async function getSessionByToken(token: string) {
  return prisma.session.findUnique({
    where: { guestPortalToken: token },
    include: { unit: { include: { hardware: true } } },
  });
}

export async function getUnitByPortalToken(token: string) {
  return prisma.unit.findUnique({
    where: { longTermPortalToken: token },
    include: { hardware: true, invoices: { where: { status: { not: "DRAFT" } }, orderBy: { periodEnd: "desc" }, take: 12 } },
  });
}

export async function guestSetTemperature(token: string, temp: number) {
  // Check session-based token first, then long-term token
  let hw: { climateEntityId: string | null } | null = null;

  const session = await prisma.session.findUnique({
    where: { guestPortalToken: token },
    include: { unit: { include: { hardware: true } } },
  });
  if (session?.status === "ACTIVE") hw = session.unit.hardware;

  if (!hw) {
    const unit = await prisma.unit.findUnique({
      where: { longTermPortalToken: token },
      include: { hardware: true },
    });
    if (unit) hw = unit.hardware;
  }

  if (!hw?.climateEntityId) return;
  const clampedTemp = Math.min(25, Math.max(16, temp));
  await ha.setClimateTemperature(hw.climateEntityId, clampedTemp);
}

export async function guestUnlockDoor(token: string) {
  let hw: { lockEntityId: string | null } | null = null;

  const session = await prisma.session.findUnique({
    where: { guestPortalToken: token },
    include: { unit: { include: { hardware: true } } },
  });
  if (session?.status === "ACTIVE") hw = session.unit.hardware;

  if (!hw) {
    const unit = await prisma.unit.findUnique({
      where: { longTermPortalToken: token },
      include: { hardware: true },
    });
    if (unit) hw = unit.hardware;
  }

  if (!hw?.lockEntityId) return;
  await ha.unlockDoor(hw.lockEntityId);
}

export async function guestTogglePower(token: string, turnOn: boolean): Promise<{ ok: boolean; powerOn: boolean }> {
  let hw: hardware.UnitHardwareRow | null = null;

  const session = await prisma.session.findUnique({
    where: { guestPortalToken: token },
    include: { unit: { include: { hardware: true } } },
  });
  if (session?.status === "ACTIVE") hw = session.unit.hardware;

  if (!hw) {
    const unit = await prisma.unit.findUnique({
      where: { longTermPortalToken: token },
      include: { hardware: true },
    });
    if (unit) hw = unit.hardware;
  }

  if (!hardware.hasElectricitySwitch(hw)) return { ok: false, powerOn: false };

  await hardware.setSwitch(hardware.electricitySwitchEp(hw!), turnOn);
  return { ok: true, powerOn: turnOn };
}

export async function guestGetPowerState(token: string): Promise<boolean | null> {
  let hw: hardware.UnitHardwareRow | null = null;

  const session = await prisma.session.findUnique({
    where: { guestPortalToken: token },
    include: { unit: { include: { hardware: true } } },
  });
  if (session?.status === "ACTIVE") hw = session.unit.hardware;

  if (!hw) {
    const unit = await prisma.unit.findUnique({
      where: { longTermPortalToken: token },
      include: { hardware: true },
    });
    if (unit) hw = unit.hardware;
  }

  if (!hardware.hasElectricitySwitch(hw)) return null;
  try {
    return await hardware.getSwitchState(hardware.electricitySwitchEp(hw!));
  } catch {
    return null;
  }
}

export async function getActiveSession(unitId: number) {
  await requireAuth();
  return prisma.session.findFirst({
    where: { unitId, status: "ACTIVE" },
    orderBy: { checkInTime: "desc" },
  });
}

export async function getPendingSession(unitId: number) {
  await requireAuth();
  // Only reservations whose stay hasn't ended — an imported booking that was
  // never checked in must not keep the unit "Reserveret" months later.
  return prisma.session.findFirst({
    where: { unitId, ...openReservationWhere() },
    orderBy: { checkInTime: "asc" },
  });
}

export async function activateBookingSession(
  sessionId: number,
  billingMode: "PREPAID" | "POSTPAID",
  prepaidAmount?: number,
  updates?: {
    guestName?: string;
    guestEmail?: string | null;
    guestPhone?: string | null;
    bookingRef?: string | null;
    expectedCheckOut?: string | null;
  },
): Promise<CheckInResult> {
  await requireAuth();
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: { include: { hardware: true } } },
  });
  if (!session) return { ok: false, message: "Bookingen findes ikke." };
  if (session.status === "ACTIVE") return { ok: false, message: "Gæsten er allerede tjekket ind." };
  if (session.status !== "PENDING") return { ok: false, message: "Opholdet er afsluttet og kan ikke tjekkes ind igen." };
  if (session.cancelledAt) return { ok: false, message: "Reservationen er annulleret og kan ikke tjekkes ind." };

  const unit = session.unit;
  const mode = billingMode === "PREPAID" ? "PREPAID" : "POSTPAID";
  if (mode === "PREPAID") {
    const amountError = prepaidAmountError(prepaidAmount);
    if (amountError) return { ok: false, message: amountError };
  }
  if (updates?.expectedCheckOut !== undefined) {
    const dateError = checkOutDateError(updates.expectedCheckOut, { required: !unit.isLongTerm });
    if (dateError) return { ok: false, message: dateError };
  }

  const finalGuestName = updates?.guestName?.trim() || session.guestName;
  const finalGuestEmail = updates?.guestEmail !== undefined ? (updates.guestEmail?.trim() || null) : session.guestEmail;
  const finalGuestPhone = updates?.guestPhone !== undefined ? (updates.guestPhone?.trim() || null) : session.guestPhone;
  // A booking-system ref ("danplanner:…") is the sync key and stays as it is —
  // same rule as updateSessionDetails.
  const refLocked = !!session.externalBookingId || isProviderBookingRef(session.bookingRef);
  const finalBookingRef = updates?.bookingRef !== undefined && !refLocked
    ? (updates.bookingRef?.trim() || null)
    : session.bookingRef;
  const finalExpectedCheckOut = updates?.expectedCheckOut !== undefined
    ? (updates.expectedCheckOut ? plannedDate(updates.expectedCheckOut) : null)
    : session.expectedCheckOut;

  // Contact details and dates corrected at the desk must survive the next
  // booking sync, so they are recorded as locked fields.
  const changed: string[] = [];
  if (finalGuestName !== session.guestName) changed.push("guestName");
  if (finalGuestEmail !== session.guestEmail) changed.push("guestEmail");
  if (finalGuestPhone !== session.guestPhone) changed.push("guestPhone");
  if ((finalExpectedCheckOut?.getTime() ?? null) !== (session.expectedCheckOut?.getTime() ?? null)) changed.push("expectedCheckOut");
  const lockedFields = changed.length > 0 ? addLockedFields(session.lockedFields, changed) : session.lockedFields;

  // Claim the unit atomically so a double-click can't activate twice.
  const claimed = await prisma.unit.updateMany({
    where: { id: unit.id, status: { not: "OCCUPIED" } },
    data: { status: "OCCUPIED" },
  });
  if (claimed.count === 0) {
    const holder = await prisma.session.findFirst({
      where: { unitId: unit.id, status: "ACTIVE" },
      select: { guestName: true, expectedCheckOut: true },
    });
    const who = holder
      ? `${unitDisplayName(unit.type, unit.name)} er optaget af ${holder.guestName}${holder.expectedCheckOut ? ` (planlagt afrejse ${fmtDate(holder.expectedCheckOut)})` : ""}`
      : `${unitDisplayName(unit.type, unit.name)} står som optaget`;
    return { ok: false, message: `${who}. Tjek den gæst ud først, eller brug 'Skift enhed' på denne booking.` };
  }

  let hwLines: ReceiptLine[];
  let activated: { count: number };
  try {
    const pricing = await getPricing();
    const hw = await startStayHardware(unit.hardware, `activate unit=${unit.id}`, pricing.defaultOccupiedTemp);
    hwLines = hw.lines;
    activated = await prisma.session.updateMany({
      where: { id: sessionId, status: "PENDING" },
      data: {
        status: "ACTIVE",
        billingMode: mode,
        prepaidAmount: mode === "PREPAID" ? prepaidAmount! : null,
        prepaidDeposited: mode === "PREPAID" ? prepaidAmount! : null,
        guestName: finalGuestName,
        guestEmail: finalGuestEmail,
        guestPhone: finalGuestPhone,
        bookingRef: finalBookingRef,
        expectedCheckOut: finalExpectedCheckOut,
        lockedFields,
        checkInTime: new Date(),
        checkInRecordedAt: new Date(),
        startKwh: hw.startKwh,
        startHeatingKwh: hw.startHeatingKwh,
        startWaterLiters: hw.startWaterLiters,
      },
    });
  } catch (e) {
    await prisma.unit.updateMany({ where: { id: unit.id, status: "OCCUPIED" }, data: { status: "VACANT" } }).catch(() => {});
    throw e;
  }
  if (activated.count === 0) {
    await prisma.unit.updateMany({ where: { id: unit.id, status: "OCCUPIED" }, data: { status: "VACANT" } }).catch(() => {});
    return { ok: false, message: "Gæsten er allerede tjekket ind." };
  }

  const updateData: Record<string, unknown> = { status: "OCCUPIED" };
  if (unit.isLongTerm) {
    updateData.longTermGuestName = finalGuestName;
    updateData.longTermGuestEmail = finalGuestEmail;
    updateData.longTermGuestPhone = finalGuestPhone;
    updateData.longTermPortalToken = session.guestPortalToken;
  }
  await prisma.unit.update({ where: { id: unit.id }, data: updateData });

  const dispName = unitDisplayName(unit.type, unit.name);
  const welcome = await sendWelcomeMessage(
    { id: sessionId, guestName: finalGuestName, guestEmail: finalGuestEmail, guestPhone: finalGuestPhone, guestPortalToken: session.guestPortalToken },
    dispName,
  );
  const lines = [...hwLines, welcome.line];

  revalidatePath("/admin");
  revalidatePath(`/admin/units/${unit.id}`);
  revalidatePath(`/admin/bookings/${sessionId}`);
  revalidatePath("/admin/bookings");
  return {
    ok: true,
    message: receiptMessage(lines),
    sessionId,
    guestPortalToken: session.guestPortalToken,
    receipt: {
      sessionId,
      unitId: unit.id,
      unitName: dispName,
      guestName: finalGuestName,
      portalPath: `/guest/${session.guestPortalToken}`,
      lines,
    },
  };
}

// ──────────────────────────────────────────────
// INVOICES — Monthly billing
// ──────────────────────────────────────────────
// Danish messages createMonthlyInvoiceInternal throws on purpose.
const EXPECTED_INVOICE_ERRORS = ["Beløbet skal være mindst 1 DKK", "Enheden har en forudbetalt gæst", "Enhed ikke fundet"];

/** "Ny faktura" on the booking page. Expected problems come back as a message. */
export async function createMonthlyInvoice(
  unitId: number,
): Promise<{ ok: true; invoiceId: number; totalAmount: number } | { ok: false; message: string }> {
  await requireAuth();
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { isLongTerm: true } });
  if (!unit) return { ok: false, message: "Enheden findes ikke." };
  // Without a guest checked in, a short-term unit's invoice would bill the
  // meter since the last invoice — consumption a completed stay already
  // settles on its statement.
  if (!unit.isLongTerm) {
    const active = await prisma.session.findFirst({ where: { unitId, status: "ACTIVE" }, select: { id: true } });
    if (!active) {
      return { ok: false, message: "Der er ingen indtjekket gæst på enheden. Et afsluttet ophold afregnes på opgørelsen." };
    }
  }
  try {
    const invoice = await createMonthlyInvoiceInternal(unitId);
    revalidatePath("/admin/bookings");
    return { ok: true, invoiceId: invoice.id, totalAmount: invoice.totalAmount };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (EXPECTED_INVOICE_ERRORS.some((m) => message.startsWith(m))) return { ok: false, message };
    logger.error("invoice", `createMonthlyInvoice fejl (enhed ${unitId})`, e);
    return { ok: false, message: "Fakturaen kunne ikke oprettes. Prøv igen." };
  }
}

/** Why a stay can't get an interim invoice, or null. */
function stayInvoiceBlocker(s: { status: string; billingMode: string }): string | null {
  if (s.status !== "ACTIVE") return "Kun en indtjekket gæst kan få en mellemfaktura. Et afsluttet ophold afregnes på opgørelsen.";
  if (s.billingMode === "PREPAID") return "En forudbetalt gæst betaler af saldoen og faktureres ikke.";
  return null;
}

/**
 * "Lav mellemfaktura": what an interim invoice for this stay would contain.
 * Ticks first, so metered el/water are as fresh as the meters allow. On a
 * unit without an el meter the desk enters a reading (the previous one comes
 * from the stay's last invoice).
 */
export async function getStayInvoicePreview(
  sessionId: number,
): Promise<{ ok: true; preview: StayInvoicePreview } | { ok: false; message: string }> {
  await requireAuth();
  const initial = await prisma.session.findUnique({ where: { id: sessionId }, include: { unit: { include: { hardware: true } } } });
  if (!initial) return { ok: false, message: "Opholdet findes ikke." };
  const blocker = stayInvoiceBlocker(initial);
  if (blocker) return { ok: false, message: blocker };

  const hw = initial.unit.hardware;
  const metered = hardware.hasElectricityMeter(hw) || hardware.hasHeatingMeter(hw);
  let session = initial;
  if (metered || hardware.hasWaterMeter(hw)) {
    try {
      await tickSessionConsumptionInternal(sessionId);
      session = (await prisma.session.findUnique({ where: { id: sessionId }, include: { unit: { include: { hardware: true } } } })) ?? initial;
    } catch (e) {
      logger.error("invoice", "getStayInvoicePreview: tick fejlede", e);
    }
  }

  const now = new Date();
  const periodStart = await stayInvoicePeriodStart(session.unitId, session);
  const [laundryAgg, showerAgg, invoices, pricing] = await Promise.all([
    prisma.laundrySess.aggregate({
      where: { sessionId, paymentStatus: "ON_ACCOUNT", createdAt: { gte: periodStart, lte: now } },
      _sum: { pricePaid: true },
    }),
    prisma.showerSess.aggregate({
      where: { sessionId, paymentStatus: "ON_ACCOUNT", startedAt: { gte: periodStart, lte: now } },
      _sum: { pricePaid: true },
    }),
    prisma.invoice.findMany({ where: { sessionId }, orderBy: { periodEnd: "desc" }, select: { unitId: true, endKwh: true, createdAt: true } }),
    getPricing(),
  ]);
  let effective: number | null = null;
  try { effective = (await getEffectiveElPricing()).pricePerKwh; } catch { /* fixed price only */ }

  // The previous hand reading must be from this unit's meter.
  const lastOnUnit = invoices.find((i) => i.unitId === session.unitId && i.endKwh != null);
  const previousKwh = metered ? null : lastOnUnit?.endKwh ?? session.startKwh ?? null;
  return {
    ok: true,
    preview: {
      periodStart,
      periodEnd: now,
      metered,
      electricityCost: roundOre(session.accumulatedElCost),
      waterCost: roundOre(session.accumulatedWaterCost),
      servicesCost: roundOre((laundryAgg._sum.pricePaid ?? 0) + (showerAgg._sum.pricePaid ?? 0)),
      previousKwh,
      previousKwhSource: previousKwh == null ? null : lastOnUnit ? "invoice" : "stay",
      fixedPricePerKwh: pricing.pricePerKwh,
      effectivePricePerKwh: effective,
      priceOverride: session.pricePerKwhOverride,
      currency: pricing.currency,
      invoiceCount: invoices.length,
      lastInvoiceAt: invoices[0]?.createdAt ?? null,
    },
  };
}

/** Create the interim invoice previewed above. */
export async function createStayInvoice(
  sessionId: number,
  input: { manualEl?: { startKwh: number; endKwh: number; pricePerKwh: number } } = {},
): Promise<{ ok: true; invoiceId: number; totalAmount: number; message: string } | { ok: false; message: string }> {
  await requireAuth();
  const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { unit: { include: { hardware: true } } } });
  if (!session) return { ok: false, message: "Opholdet findes ikke." };
  const blocker = stayInvoiceBlocker(session);
  if (blocker) return { ok: false, message: blocker };

  const hw = session.unit.hardware;
  const metered = hardware.hasElectricityMeter(hw) || hardware.hasHeatingMeter(hw);
  let manualEl: ManualElReading | undefined;
  if (input.manualEl && !metered) {
    const { startKwh, endKwh, pricePerKwh } = input.manualEl;
    if (![startKwh, endKwh, pricePerKwh].every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0)) {
      return { ok: false, message: "Aflæsninger og pris skal være positive tal." };
    }
    if (endKwh < startKwh) return { ok: false, message: "Den nye aflæsning er lavere end den forrige." };
    if (endKwh - startKwh > MAX_MANUAL_KWH) return { ok: false, message: `Forbruget (${roundOre(endKwh - startKwh)} kWh) er urimeligt stort – tjek aflæsningen.` };
    if (pricePerKwh <= 0 || pricePerKwh > 50) return { ok: false, message: "Prisen pr. kWh skal være mellem 0 og 50 kr." };
    manualEl = { startKwh, endKwh, pricePerKwh };
  }

  try {
    const invoice = await createMonthlyInvoiceInternal(session.unitId, { manualEl });
    logger.info("invoice", `Mellemfaktura ${invoice.id} for ophold ${sessionId}: ${roundOre(invoice.totalAmount)} kr${manualEl ? ` (aflæst ${manualEl.startKwh}→${manualEl.endKwh} kWh à ${manualEl.pricePerKwh})` : ""}`);
    revalidatePath(`/admin/bookings/${sessionId}`);
    revalidatePath("/admin/bookings");
    return {
      ok: true,
      invoiceId: invoice.id,
      totalAmount: invoice.totalAmount,
      message: `Faktura på ${fmtMoney(invoice.totalAmount)} er oprettet.`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (EXPECTED_INVOICE_ERRORS.some((m) => message.startsWith(m))) return { ok: false, message };
    logger.error("invoice", `createStayInvoice fejl (ophold ${sessionId})`, e);
    return { ok: false, message: "Fakturaen kunne ikke oprettes. Prøv igen." };
  }
}

/**
 * Where the next invoice for a checked-in stay starts: check-in, or the end
 * of the last invoice — the stay's own (it may have changed unit) or one on
 * the unit raised during the stay.
 */
async function stayInvoicePeriodStart(unitId: number, stay: { id: number; checkInTime: Date }): Promise<Date> {
  const [lastUnitInvoice, lastStayInvoice] = await Promise.all([
    prisma.invoice.findFirst({ where: { unitId }, orderBy: { id: "desc" }, select: { periodEnd: true } }),
    prisma.invoice.findFirst({ where: { sessionId: stay.id }, orderBy: { periodEnd: "desc" }, select: { periodEnd: true } }),
  ]);
  let start = stay.checkInTime;
  for (const inv of [lastUnitInvoice, lastStayInvoice]) {
    if (inv && inv.periodEnd > start) start = inv.periodEnd;
  }
  return start;
}

/** A reading taken by hand on a unit without an el meter ("Lav mellemfaktura"). */
type ManualElReading = { startKwh: number; endKwh: number; pricePerKwh: number };

// Unauthenticated core — for cron/checkout paths only (not a Server Action).
async function createMonthlyInvoiceInternal(unitId: number, opts: { manualEl?: ManualElReading } = {}) {
  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: { hardware: true },
  });
  if (!unit) throw new Error("Enhed ikke fundet");

  const pricing = await getPricing();
  const now = new Date();

  // Find the active postpaid session first — for short-term bookings the
  // invoice period should span the session (check-in → now), not a calendar
  // month. Long-term (fastligger) keeps calendar-month billing.
  const activeSessionForPeriod = !unit.isLongTerm
    ? await prisma.session.findFirst({
        where: { unitId, status: "ACTIVE", billingMode: { not: "PREPAID" } },
        orderBy: { checkInTime: "desc" },
      })
    : null;

  // Use the last invoice's periodEnd as the start of the new period if it
  // falls after the session check-in — prevents overlapping periods when
  // multiple invoices are created for the same session.
  const lastUnitInvoice = activeSessionForPeriod
    ? null
    : await prisma.invoice.findFirst({
        where: { unitId },
        orderBy: { id: "desc" },
      });

  const periodStart = activeSessionForPeriod
    ? await stayInvoicePeriodStart(unitId, activeSessionForPeriod)
    : (lastUnitInvoice?.periodEnd ?? new Date(now.getFullYear(), now.getMonth() - (now.getDate() <= 7 ? 1 : 0), 1));
  // Without a session (long-term tenant) the invoice covers the time since
  // the last invoice up to now. A calendar-month period labelled the day-1
  // run as the month just starting and excluded last month's services.
  const periodEnd = now;

  const hw = unit.hardware;

  let startKwh: number | null = null;
  let endKwh: number | null = null;
  let startHeatingKwh: number | null = null;
  let endHeatingKwh: number | null = null;
  let startWaterLiters: number | null = null;
  let endWaterLiters: number | null = null;

  const allPrevInvoices = await prisma.invoice.findMany({
    where: { unitId },
    orderBy: { id: "desc" },
    select: { id: true, endKwh: true, endHeatingKwh: true, endWaterLiters: true },
  });
  const hasAnyPrevInvoice = allPrevInvoices.length > 0;
  const lastElecInvoice = allPrevInvoices.find((i) => i.endKwh != null) ?? null;
  const lastHeatingInvoice = allPrevInvoices.find((i) => i.endHeatingKwh != null) ?? null;
  const lastWaterInvoice = allPrevInvoices.find((i) => i.endWaterLiters != null) ?? null;

  const activeSession = await prisma.session.findFirst({
    where: { unitId, status: "ACTIVE" },
    orderBy: { checkInTime: "desc" },
  });
  // A prepaid guest pays from their balance. Invoicing would bill the same
  // consumption again and then (by draining the accumulator) inflate the
  // balance by the invoiced amount.
  if (activeSession?.billingMode === "PREPAID") {
    throw new Error("Enheden har en forudbetalt gæst — forbruget trækkes fra saldoen og faktureres ikke");
  }

  if (hardware.hasElectricityMeter(hw)) {
    endKwh = await safeReadMeter(hardware.electricityMeterEp(hw!), `invoice:el unit=${unitId}`);
    if (lastElecInvoice?.endKwh != null) {
      // Continue from where the last invoice ended
      startKwh = lastElecInvoice.endKwh;
    } else if (hasAnyPrevInvoice) {
      // Prior invoices exist but none captured endKwh — don't re-bill from session start
      startKwh = endKwh;
    } else {
      // First ever invoice for this unit — start from the session baseline
      startKwh = activeSession?.startKwh ?? endKwh;
    }
  }
  if (hardware.hasHeatingMeter(hw)) {
    endHeatingKwh = await safeReadMeter(hardware.heatingMeterEp(hw!), `invoice:heat unit=${unitId}`);
    if (lastHeatingInvoice?.endHeatingKwh != null) {
      startHeatingKwh = lastHeatingInvoice.endHeatingKwh;
    } else if (hasAnyPrevInvoice) {
      startHeatingKwh = endHeatingKwh;
    } else {
      startHeatingKwh = activeSession?.startHeatingKwh ?? endHeatingKwh;
    }
  }
  if (hardware.hasWaterMeter(hw)) {
    endWaterLiters = await safeReadMeter(hardware.waterMeterEp(hw!), `invoice:water unit=${unitId}`);
    if (lastWaterInvoice?.endWaterLiters != null) {
      startWaterLiters = lastWaterInvoice.endWaterLiters;
    } else if (hasAnyPrevInvoice) {
      startWaterLiters = endWaterLiters;
    } else {
      startWaterLiters = activeSession?.startWaterLiters ?? endWaterLiters;
    }
  }

  // Tick the active session first so the accumulator is current right up
  // to this moment — the invoice total will come from that accumulator so
  // spot-price billing is time-weighted, not a snapshot.
  if (activeSession) {
    try {
      await tickSessionConsumptionInternal(activeSession.id);
    } catch (e) {
      logger.error("invoice", "createMonthlyInvoice: tick fejlede", e);
    }
  }
  // Reload the session with fresh accumulator values
  const sessionForBilling = activeSession
    ? await prisma.session.findUnique({ where: { id: activeSession.id } })
    : null;

  // If we have a real accumulator, use it verbatim — it's the
  // time-weighted truth. Otherwise fall back to snapshot pricing. Decided per
  // utility and by whether a tick ever read the meter: a 0 accumulator (just
  // invoiced, or no use) must not trigger a snapshot that re-bills.
  const useElAccumulator = !!sessionForBilling && (
    sessionForBilling.accumulatedElCost > 0 ||
    (sessionForBilling.lastTickAt != null &&
      (sessionForBilling.lastTickKwh != null || sessionForBilling.lastTickHeatingKwh != null))
  );
  const useWaterAccumulator = !!sessionForBilling && (
    sessionForBilling.accumulatedWaterCost > 0 ||
    (sessionForBilling.lastTickAt != null && sessionForBilling.lastTickWaterLiters != null)
  );

  let effectiveElPrice = pricing.pricePerKwh;
  if (!useElAccumulator) {
    try {
      const effective = await getEffectiveElPricing();
      effectiveElPrice = effective.pricePerKwh;
    } catch {
      // Fallback to fixed price
    }
    if (activeSession?.pricePerKwhOverride != null) {
      effectiveElPrice = activeSession.pricePerKwhOverride;
    }
  }
  const waterRate = activeSession?.pricePerLiterWaterOverride ?? pricing.pricePerLiterWater;

  let electricityCost: number;
  if (useElAccumulator) {
    electricityCost = sessionForBilling!.accumulatedElCost;
  } else {
    // Snapshot pricing — units without an active session, or sessions
    // whose meter no tick has read yet.
    const mainElecCost = (endKwh !== null && startKwh !== null)
      ? Math.max(0, endKwh - startKwh) * effectiveElPrice : 0;
    const heatingElecCost = (endHeatingKwh !== null && startHeatingKwh !== null)
      ? Math.max(0, endHeatingKwh - startHeatingKwh) * effectiveElPrice : 0;
    electricityCost = mainElecCost + heatingElecCost;
  }
  const waterCost = useWaterAccumulator
    ? sessionForBilling!.accumulatedWaterCost
    : (endWaterLiters !== null && startWaterLiters !== null)
      ? Math.max(0, endWaterLiters - startWaterLiters) * waterRate : 0;

  // A unit without an el meter: the desk read the meter by hand, at the
  // price it chose (shown in the dialog before the invoice is made).
  const manualEl = opts.manualEl && !hardware.hasElectricityMeter(hw) && !hardware.hasHeatingMeter(hw) ? opts.manualEl : null;
  if (manualEl) {
    electricityCost = roundOre(electricityCost + Math.max(0, manualEl.endKwh - manualEl.startKwh) * manualEl.pricePerKwh);
  }

  // Include ON_ACCOUNT services in invoice period
  let servicesCost = 0;
  if (activeSession) {
    const [laundryAgg, showerAgg] = await Promise.all([
      prisma.laundrySess.aggregate({
        where: { sessionId: activeSession.id, paymentStatus: "ON_ACCOUNT", createdAt: { gte: periodStart, lte: periodEnd } },
        _sum: { pricePaid: true },
      }),
      prisma.showerSess.aggregate({
        where: { sessionId: activeSession.id, paymentStatus: "ON_ACCOUNT", startedAt: { gte: periodStart, lte: periodEnd } },
        _sum: { pricePaid: true },
      }),
    ]);
    servicesCost = (laundryAgg._sum.pricePaid ?? 0) + (showerAgg._sum.pricePaid ?? 0);
  }

  const totalAmount = electricityCost + waterCost + servicesCost;
  if (totalAmount < 1) {
    throw new Error("Beløbet skal være mindst 1 DKK — intet nyt forbrug siden sidste faktura");
  }

  const invoice = await prisma.invoice.create({
    data: {
      unitId,
      // The stay it bills, so it follows the stay if the guest changes unit.
      sessionId: activeSession?.id ?? null,
      periodStart,
      periodEnd,
      startKwh: manualEl ? manualEl.startKwh : startKwh,
      endKwh: manualEl ? manualEl.endKwh : endKwh,
      startHeatingKwh,
      endHeatingKwh,
      startWaterLiters,
      endWaterLiters,
      electricityCost,
      waterCost,
      servicesCost,
      totalAmount,
      status: "PENDING",
      paymentToken: uuidv4(),
    },
  });

  // Services just billed on this invoice must not be billed again at checkout.
  if (activeSession && servicesCost > 0) {
    await Promise.all([
      prisma.laundrySess.updateMany({
        where: { sessionId: activeSession.id, paymentStatus: "ON_ACCOUNT", createdAt: { gte: periodStart, lte: periodEnd } },
        data: { paymentStatus: "INVOICED" },
      }),
      prisma.showerSess.updateMany({
        where: { sessionId: activeSession.id, paymentStatus: "ON_ACCOUNT", startedAt: { gte: periodStart, lte: periodEnd } },
        data: { paymentStatus: "INVOICED" },
      }),
    ]);
  }

  // Subtract exactly what was billed — a tick that committed between our
  // read and this write keeps its (unbilled) contribution instead of being
  // wiped by a reset to 0. lastTick* stay so the next tick's delta is right.
  if (sessionForBilling && (useElAccumulator || useWaterAccumulator)) {
    await prisma.session.update({
      where: { id: sessionForBilling.id },
      data: {
        ...(useElAccumulator ? {
          accumulatedElCost: { decrement: sessionForBilling.accumulatedElCost },
          accumulatedElKwh: { decrement: sessionForBilling.accumulatedElKwh },
        } : {}),
        ...(useWaterAccumulator ? {
          accumulatedWaterCost: { decrement: sessionForBilling.accumulatedWaterCost },
          accumulatedWaterLiters: { decrement: sessionForBilling.accumulatedWaterLiters },
        } : {}),
      },
    });
  }

  revalidatePath(`/admin/units/${unitId}`);
  return invoice;
}

// ──────────────────────────────────────────────
// AUTO INVOICING — cron-triggered for fastliggere
// ──────────────────────────────────────────────
/** Auth-guarded entry point (server action). Cron/webhooks call it inside
 *  runWithApiAuth; in-module callers use autoCreateAndSendInvoicesInternal directly. */
export async function autoCreateAndSendInvoices(...args: Parameters<typeof autoCreateAndSendInvoicesInternal>) {
  await requireAuth();
  return autoCreateAndSendInvoicesInternal(...args);
}

async function autoCreateAndSendInvoicesInternal(): Promise<{ created: number; sent: number }> {
  const settings = await readGlobalSettings();
  if (settings.invoice_email_enabled !== "true") return { created: 0, sent: 0 };

  const invoiceDaySetting = settings.invoice_email_day || "1";
  const today = new Date();
  const todayDate = today.getDate();
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

  let isInvoiceDay = false;
  if (invoiceDaySetting === "last") {
    isInvoiceDay = todayDate === lastDayOfMonth;
  } else {
    isInvoiceDay = todayDate === parseInt(invoiceDaySetting, 10);
  }
  if (!isInvoiceDay) return { created: 0, sent: 0 };

  // Check if already ran today (prevent duplicate invoices)
  // Local date, not toISOString(): between local midnight and UTC midnight the
  // UTC key still names yesterday, so the block would run twice on invoice day.
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (settings._last_auto_invoice_date === todayStr) return { created: 0, sent: 0 };

  // Claim today BEFORE invoicing: if the run dies halfway, the next cron tick
  // must not invoice the units that were already done a second time.
  // Failed units are logged for manual invoicing instead.
  const prevMarker = settings._last_auto_invoice_date;
  const claimed = prevMarker === undefined
    ? await prisma.globalSetting.createMany({ data: [{ key: "_last_auto_invoice_date", value: todayStr }] }).catch(() => ({ count: 0 }))
    : await prisma.globalSetting.updateMany({
        where: { key: "_last_auto_invoice_date", value: prevMarker },
        data: { value: todayStr },
      });
  if (claimed.count === 0) return { created: 0, sent: 0 };

  // Find all seasonal units with tenant info
  const seasonalUnits = await prisma.unit.findMany({
    where: { type: "SEASONAL", isLongTerm: true, longTermGuestName: { not: null } },
    include: { hardware: true },
  });

  let created = 0;
  let sent = 0;

  for (const unit of seasonalUnits) {
    try {
      const invoice = await createMonthlyInvoiceInternal(unit.id);
      created++;

      // Send notification
      if (unit.longTermGuestEmail || unit.longTermGuestPhone) {
        await sendInvoiceToCustomerInternal(invoice.id, unit.id);
        sent++;
      }
    } catch (e) {
      logger.error("invoice", `Auto-faktura fejl for enhed ${unit.id} — opret den manuelt`, e);
    }
  }

  // Long stays on ordinary units billed monthly ("Månedsafregning" on the
  // booking). Only metered units can be invoiced unattended; the others need
  // a reading at the desk ("Lav mellemfaktura").
  const monthlyStays = await prisma.session.findMany({
    where: { status: "ACTIVE", monthlyInvoicing: true, billingMode: { not: "PREPAID" }, unit: { isLongTerm: false } },
    include: { unit: { include: { hardware: true } } },
  });
  for (const stay of monthlyStays) {
    const hw = stay.unit.hardware;
    if (!hardware.hasElectricityMeter(hw) && !hardware.hasHeatingMeter(hw) && !hardware.hasWaterMeter(hw)) {
      logger.info("invoice", `Månedsafregning: ophold ${stay.id} (${stay.unit.name}) har ingen måler — mellemfakturaen laves i skranken med aflæsning`);
      continue;
    }
    try {
      const invoice = await createMonthlyInvoiceInternal(stay.unitId);
      created++;
      if (stay.guestEmail || stay.guestPhone) {
        const res = await sendInvoiceToCustomerInternal(invoice.id, stay.unitId);
        if (res.ok) sent++;
      }
    } catch (e) {
      logger.error("invoice", `Månedsfaktura fejl for ophold ${stay.id} — opret den på bookingen`, e);
    }
  }

  return { created, sent };
}

// Check overdue invoices and optionally cut power
/** Auth-guarded entry point (server action). Cron/webhooks call it inside
 *  runWithApiAuth; in-module callers use checkOverdueInvoicesInternal directly. */
export async function checkOverdueInvoices(...args: Parameters<typeof checkOverdueInvoicesInternal>) {
  await requireAuth();
  return checkOverdueInvoicesInternal(...args);
}

async function checkOverdueInvoicesInternal(): Promise<{ markedOverdue: number; powerOff: number }> {
  const settings = await readGlobalSettings();
  const deadlineDays = parseInt(settings.invoice_payment_deadline_days || "14", 10);
  const autoPowerOff = settings.invoice_auto_power_off === "true";

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - deadlineDays);

  // Find PENDING invoices that have passed the deadline. The deadline runs
  // from when the guest was sent the invoice — one nobody has received
  // (made at the desk, e-mail off) is never overdue and never cuts power.
  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      status: "PENDING",
      sentAt: { lte: cutoffDate },
    },
    include: { unit: { include: { hardware: true } } },
  });

  let markedOverdue = 0;
  let powerOff = 0;

  for (const invoice of overdueInvoices) {
    // Mark as overdue
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "OVERDUE" },
    });
    markedOverdue++;

    // Auto power-off if enabled — but only for the debtor. The invoice is
    // tied to the unit, and the person living there now may be someone else.
    let debtorStillThere = false;
    if (autoPowerOff) {
      const current = await prisma.session.findFirst({
        where: { unitId: invoice.unitId, status: "ACTIVE" },
        orderBy: { checkInTime: "desc" },
      });
      debtorStillThere = current
        ? current.checkInTime <= invoice.periodEnd
        : invoice.unit.isLongTerm;
      if (!debtorStillThere) {
        logger.info("invoice", `Faktura ${invoice.id} forfalden, men ${invoice.unit.name} har en ny gæst/er ledig — strøm ikke afbrudt`);
      }
    }
    if (autoPowerOff && debtorStillThere && hardware.hasElectricitySwitch(invoice.unit.hardware)) {
      try {
        await hardware.setSwitch(hardware.electricitySwitchEp(invoice.unit.hardware!), false);
        powerOff++;
      } catch (e) {
        logger.error("invoice", `Auto power-off failed for unit ${invoice.unit.name}`, e);
      }
    }
  }

  return { markedOverdue, powerOff };
}

// ──────────────────────────────────────────────
// PREPAID AUTO POWER-OFF — when balance depleted
// ──────────────────────────────────────────────
/** Auth-guarded entry point (server action). Cron/webhooks call it inside
 *  runWithApiAuth; in-module callers use checkPrepaidBalancesInternal directly. */
export async function checkPrepaidBalances(...args: Parameters<typeof checkPrepaidBalancesInternal>) {
  await requireAuth();
  return checkPrepaidBalancesInternal(...args);
}

async function checkPrepaidBalancesInternal(): Promise<{ powerOff: number }> {
  const settings = await readGlobalSettings();
  if (settings.prepaid_auto_power_off !== "true") return { powerOff: 0 };

  // Find all active PREPAID sessions
  const sessions = await prisma.session.findMany({
    where: { status: "ACTIVE", billingMode: "PREPAID" },
    include: { unit: { include: { hardware: true } } },
  });

  let powerOff = 0;
  // Bail out if the session tick data is older than this — we don't want to
  // cut off a guest based on meter values captured 30 min ago. The next cron
  // run will re-evaluate with fresh data.
  const STALE_TICK_MS = 20 * 60 * 1000;

  for (const session of sessions) {
    const hw = session.unit.hardware;
    if (session.prepaidAmount == null || !hardware.hasElectricitySwitch(hw)) continue;
    const switchEp = hardware.electricitySwitchEp(hw!);
    const prepaidAmount = session.prepaidAmount;

    // Tick to refresh accumulator against the current spot price — prepaid
    // balance should be measured against the time-weighted real cost, not
    // a snapshot. The cron already ticks, but we do it here too so the
    // cutoff decision uses the freshest possible numbers.
    try {
      await tickSessionConsumptionInternal(session.id);
    } catch (e) {
      logger.error("prepaid", `checkPrepaidBalances: tick fejlede for session ${session.id}`, e);
      // Fall through — we'll still read the accumulator, but the staleness
      // guard below will skip the decision if data is too old.
    }

    // Atomic conditional update: only flip status & record the cutoff if
    // (a) the session is still ACTIVE, (b) the latest tick is not stale,
    // and (c) the time-weighted cost has actually hit the prepaid amount.
    // This closes the TOCTOU window between "read balance" and "act on it".
    const cutoff = new Date(Date.now() - STALE_TICK_MS);
    const decision = await prisma.session.findFirst({
      where: {
        id: session.id,
        status: "ACTIVE",
        lastTickAt: { gte: cutoff },
      },
      select: {
        accumulatedElCost: true,
        accumulatedWaterCost: true,
      },
    });
    if (!decision) continue; // status changed or tick data too stale

    const currentCost = decision.accumulatedElCost + decision.accumulatedWaterCost;
    if (currentCost < prepaidAmount) continue;

    try {
      await hardware.setSwitch(switchEp, false);
      powerOff++;
    } catch (e) {
      logger.error("prepaid", `Prepaid auto power-off failed for session ${session.id}`, e);
    }
  }

  return { powerOff };
}

export async function testSendInvoice(): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  // Find the most recent invoice to test with
  const invoice = await prisma.invoice.findFirst({
    orderBy: { createdAt: "desc" },
    include: { unit: true },
  });
  if (!invoice) return { ok: false, message: "Ingen fakturaer fundet. Opret en faktura først." };

  try {
    const result = await sendInvoiceToCustomerInternal(invoice.id, invoice.unitId);
    return result;
  } catch (e) {
    return { ok: false, message: `Fejl: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function getInvoiceByPaymentToken(token: string) {
  return prisma.invoice.findUnique({
    where: { paymentToken: token },
    include: { unit: true },
  });
}

export async function markInvoicePaid(invoiceId: number, paymentId?: string) {
  await requireAuth();
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: "PAID", paidAt: new Date(), paymentId: paymentId ?? null },
  });
  revalidatePath("/admin");
}

export async function sendInvoiceToCustomer(invoiceId: number, unitId: number): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  return sendInvoiceToCustomerInternal(invoiceId, unitId);
}

// Unauthenticated core — for the cron paths only. Not exported, so it is not
// reachable as a Server Action.
async function sendInvoiceToCustomerInternal(invoiceId: number, unitId: number): Promise<{ ok: boolean; message: string }> {
  const unit = await prisma.unit.findUnique({ where: { id: unitId } });
  if (!unit) return { ok: false, message: "Enhed ikke fundet" };

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { ok: false, message: "Faktura ikke fundet" };

  // Long-term units store guest info on the unit; for short-term bookings
  // we look up the most relevant session (active first, then the newest that
  // overlaps the invoice period) and use its guest info + portal token.
  let guestName = unit.longTermGuestName || "Lejer";
  let guestEmail: string | null = unit.longTermGuestEmail;
  let guestPhone: string | null = unit.longTermGuestPhone;
  let portalToken: string | null = unit.longTermPortalToken;

  if (!unit.isLongTerm) {
    // The stay the invoice bills; older invoices without one: the most
    // relevant stay on the unit.
    const relevantSession = (invoice.sessionId ? await prisma.session.findUnique({ where: { id: invoice.sessionId } }) : null)
      ?? await prisma.session.findFirst({
        where: {
          unitId,
          billingMode: { not: "PREPAID" },
          checkInTime: { lte: invoice.periodEnd },
        },
        orderBy: [{ status: "asc" }, { checkInTime: "desc" }],
      });
    if (relevantSession) {
      guestName = relevantSession.guestName || guestName;
      guestEmail = relevantSession.guestEmail || null;
      guestPhone = relevantSession.guestPhone || null;
      portalToken = relevantSession.guestPortalToken;
    }
  }

  if (!guestEmail && !guestPhone) {
    return { ok: false, message: "Ingen email eller telefon registreret på lejeren" };
  }

  const settings = await readGlobalSettings();
  const baseUrl = getBaseUrl(settings);
  const portalUrl = portalToken ? `${baseUrl}/guest/${portalToken}` : baseUrl;


  const unitName = unitDisplayName(unit.type, unit.name);
  const periodLabel = new Date(invoice.periodStart).toLocaleDateString("da-DK", { month: "long", year: "numeric" });

  try {
    const { sendInvoiceNotification } = await import("./notifications");
    const result = await sendInvoiceNotification(
      guestName, guestPhone, guestEmail, portalUrl, unitName, invoice.totalAmount, periodLabel
    );

    const parts: string[] = [];
    if (result.sms?.ok) parts.push("SMS sendt");
    if (result.email?.ok) parts.push("Email sendt");
    if (result.sms && !result.sms.ok) parts.push(`SMS fejl: ${result.sms.error}`);
    if (result.email && !result.email.ok) parts.push(`Email fejl: ${result.email.error}`);
    // The payment deadline counts from the first time it reached the guest.
    if ((result.sms?.ok || result.email?.ok) && !invoice.sentAt) {
      await prisma.invoice.update({ where: { id: invoiceId }, data: { sentAt: new Date() } }).catch(() => {});
    }

    return {
      ok: parts.some((p) => p.includes("sendt")),
      message: parts.length > 0 ? parts.join(". ") : "Ingen notifikationskanaler er aktiveret",
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Uventet fejl" };
  }
}

// ──────────────────────────────────────────────
// BOOKINGS — Session management
// ──────────────────────────────────────────────
export type BookingListFilter = ListFilter;

export async function getAllSessions(filter: BookingListFilter = "all", search?: string, limit: number = BOOKING_PAGE_SIZE) {
  await requireAuth();
  const now = new Date();
  const q = typeof search === "string" ? search.trim().slice(0, 100) : "";
  const take =Math.min(Math.max(Math.floor(limit) || BOOKING_PAGE_SIZE, 1), BOOKING_MAX_LIMIT);
  const filterWhere = filter === "unpaid" ? { status: "COMPLETED" as const, paymentStatus: "UNPAID" as const }
    : filter === "paid" ? { paymentStatus: "PAID" as const }
    : filter === "active" ? { status: "ACTIVE" as const }
    : filter === "pending" ? openReservationWhere(now)
    : filter === "arrived" ? arrivedNotCheckedInWhere(now)
    : filter === "overdue" ? overdueStayWhere(now)
    : filter === "expired" ? expiredReservationWhere(now)
    : filter === "cancelled" ? cancelledReservationWhere()
    // "Alle" hides expired reservations, but a search covers them too
    : q ? {}
    : { OR: [{ status: { not: "PENDING" as const } }, openReservationWhere(now)] };

  if (q) {
    // SQLite LIKE only folds ASCII case ("ørsted" misses "Ørsted") and can't
    // rank, so match a lean projection in JS and load full rows for one page.
    const candidates = await prisma.session.findMany({
      where: filterWhere,
      select: {
        id: true, status: true, guestName: true, guestEmail: true, guestPhone: true,
        bookingRef: true, externalBookingId: true, checkInTime: true, expectedCheckOut: true, cancelledAt: true,
        unit: { select: { name: true, type: true } },
      },
      orderBy: { checkInTime: "desc" },
      take: BOOKING_SEARCH_SCAN,
    });
    const hits = rankBookingSearch(candidates, q, now);
    const ids = hits.slice(0, take).map((h) => h.id);
    const rows = await prisma.session.findMany({ where: { id: { in: ids } }, include: { unit: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      sessions: ids.flatMap((id) => byId.get(id) ?? []),
      total: hits.length,
      searchCapped: candidates.length >= BOOKING_SEARCH_SCAN,
    };
  }

  // Checked-in stays first (overdue on top), then everything else newest
  // first. There is at most one ACTIVE stay per unit, so that part is small.
  const [total, checkedIn] = await Promise.all([
    prisma.session.count({ where: filterWhere }),
    prisma.session.findMany({ where: { AND: [filterWhere, { status: "ACTIVE" as const }] }, include: { unit: true } }),
  ]);
  checkedIn.sort((a, b) => compareBookingRows(a, b, now));
  const head = checkedIn.slice(0, take);
  const rest = head.length < take
    ? await prisma.session.findMany({
        // AND, not spread: both fragments may carry their own OR.
        where: { AND: [filterWhere, { status: { not: "ACTIVE" as const } }] },
        include: { unit: true },
        orderBy: { checkInTime: "desc" },
        take: take - head.length,
      })
    : [];
  return { sessions: [...head, ...rest], total, searchCapped: false };
}

/** Counts for the bookings list filter chips. */
export async function getBookingListCounts() {
  await requireAuth();
  const now = new Date();
  const [active, pending, expired, cancelled] = await Promise.all([
    prisma.session.count({ where: { status: "ACTIVE" } }),
    prisma.session.count({ where: openReservationWhere(now) }),
    prisma.session.count({ where: expiredReservationWhere(now) }),
    prisma.session.count({ where: cancelledReservationWhere() }),
  ]);
  return { active, pending, expired, cancelled };
}

export async function getSessionById(sessionId: number) {
  await requireAuth();
  return prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      // Invoices that bill this stay — they stay with it if it changes unit.
      invoices: { orderBy: { periodEnd: "desc" }, take: 24 },
      unit: {
        include: {
          hardware: true,
          invoices: {
            orderBy: { periodEnd: "desc" },
            take: 12,
          },
        },
      },
    },
  });
}

/** One line on the guest's running account. */
export interface SessionCharge {
  id: string;
  kind: "LAUNDRY" | "SHOWER";
  /** The LaundrySess/ShowerSess id. */
  rowId: number;
  label: string;
  detail: string | null;
  occurredAt: Date;
  amount: number;
  paymentStatus: string;
  pending: boolean;
  /** How it was paid, for the badge ("Betalt · Kontant", "På regning", "Gratis"…). */
  payment: { label: string; tone: ServiceTone };
  creditUsed: number;
  /** Cancelled and refunded — shown struck through, not in the totals. */
  cancelled: boolean;
  /** What "Annullér og refundér" would give back. */
  refund: RefundPlan;
}

/**
 * Everything the guest has spent during this stay, as it happens — laundry and
 * shower purchases plus the running electricity/water accumulators.
 *
 * Invoices only appear when one is generated, so without this the admin can't
 * see e.g. a wash that was just charged. Metered laundry still running is
 * reported at its reserved amount and flagged as pending, since the final
 * price isn't known until the machine stops.
 */
export async function getSessionCharges(sessionId: number): Promise<{
  charges: SessionCharge[];
  electricity: { kwh: number; cost: number };
  water: { liters: number; cost: number };
  servicesTotal: number;
  total: number;
}> {
  await requireAuth();

  // Cancelled rows: only the ones the desk cancelled (abandoned card payments
  // and metered auto-cancels never cost anything).
  const shownStatus = { OR: [{ status: { not: "CANCELLED" } }, { cancelledAt: { not: null } }] };
  const [session, laundry, showers] = await Promise.all([
    prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        status: true,
        accumulatedElCost: true,
        accumulatedElKwh: true,
        accumulatedWaterCost: true,
        accumulatedWaterLiters: true,
      },
    }),
    prisma.laundrySess.findMany({
      where: { sessionId, ...shownStatus },
      include: { machine: { select: { name: true } } },
      orderBy: { startedAt: "desc" },
    }),
    prisma.showerSess.findMany({
      where: { sessionId, ...shownStatus },
      include: { shower: { select: { name: true } } },
      orderBy: { startedAt: "desc" },
    }),
  ]);
  const stayActive = session?.status === "ACTIVE";

  const charges: SessionCharge[] = [];

  for (const l of laundry) {
    // A metered wash in progress has no final price yet — show what's reserved.
    const running = l.billingMode === "METERED" && l.status === "ACTIVE";
    const amount = running ? (l.reservedAmount ?? 0) : l.pricePaid;
    const detail =
      l.billingMode === "METERED"
        ? running
          ? `Måler kører · ${l.billedMinutes.toFixed(0)} min indtil nu`
          : `${l.billedMinutes.toFixed(0)} min forbrugt`
        : l.programName || (l.durationMinutes ? `${l.durationMinutes} min` : null);

    charges.push({
      id: `laundry-${l.id}`,
      kind: "LAUNDRY",
      rowId: l.id,
      label: l.machine.name,
      detail,
      occurredAt: l.startedAt,
      amount,
      paymentStatus: l.paymentStatus,
      pending: running,
      payment: servicePaymentBadge(l),
      creditUsed: l.creditUsed,
      cancelled: !!l.cancelledAt,
      refund: refundPlan(l, { stayActive }),
    });
  }

  for (const s of showers) {
    charges.push({
      id: `shower-${s.id}`,
      kind: "SHOWER",
      rowId: s.id,
      label: s.shower.name,
      detail: s.minutesPaid ? `${s.minutesPaid} min` : null,
      occurredAt: s.startedAt,
      amount: s.pricePaid,
      paymentStatus: s.paymentStatus,
      pending: s.status === "ACTIVE" || s.status === "PAUSED",
      payment: servicePaymentBadge(s),
      creditUsed: s.creditUsed,
      cancelled: !!s.cancelledAt,
      refund: refundPlan(s, { stayActive }),
    });
  }

  charges.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  const electricity = {
    kwh: session?.accumulatedElKwh ?? 0,
    cost: session?.accumulatedElCost ?? 0,
  };
  const water = {
    liters: session?.accumulatedWaterLiters ?? 0,
    cost: session?.accumulatedWaterCost ?? 0,
  };
  const servicesTotal = charges.reduce((sum, c) => sum + (c.cancelled ? 0 : c.amount), 0);

  return {
    charges,
    electricity,
    water,
    servicesTotal,
    total: servicesTotal + electricity.cost + water.cost,
  };
}

/**
 * "Markér som betalt": records what the guest owes as paid at the desk, so the
 * statement, badge and Økonomi all show it. Open invoices of the stay are
 * paid with it — left open they would keep sending reminders and could cut
 * the power as overdue. Only after check-out: while a stay runs, more
 * consumption is still coming.
 */
export async function markSessionPaid(
  sessionId: number,
  paymentId?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const auth = await requireAuth();
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, billingMode: true },
  });
  if (!session) return { ok: false, message: "Opholdet findes ikke." };
  if (session.status === "PENDING") return { ok: false, message: "Gæsten er ikke tjekket ind." };
  if (session.status === "ACTIVE") {
    return {
      ok: false,
      message: session.billingMode === "PREPAID"
        ? "Gæsten er stadig tjekket ind — brug 'Tilføj indbetaling' på saldoen."
        : "Opholdet er stadig i gang. Betalingen registreres, når gæsten er tjekket ud.",
    };
  }

  const settlement = await computeSettlement(sessionId);
  if (!settlement) return { ok: false, message: "Opholdet findes ikke." };
  const username = auth.username || "admin";
  const now = new Date();
  const openInvoices = settlement.invoices.filter((i) => i.status !== "PAID");
  const openInvoiceTotal = openInvoices.reduce((t, i) => t + i.totalAmount, 0);
  // Pays exactly what is owed; under 1 kr there's nothing to record.
  const rest = settlement.owed > 0 ? roundOre(settlement.owed - openInvoiceTotal) : 0;
  if (rest < 0.005 && openInvoices.length === 0) {
    await syncPaymentStatus(sessionId);
    revalidatePath(`/admin/bookings/${sessionId}`);
    return { ok: true };
  }

  const ALREADY = "Betalingen er allerede registreret. Genindlæs siden.";
  try {
    await prisma.$transaction(async (tx) => {
      // A double click or a second screen must not record the payment twice.
      const fresh = await tx.payment.aggregate({ where: { sessionId, kind: "SETTLEMENT" }, _sum: { amount: true } });
      if (Math.abs((fresh._sum.amount ?? 0) - settlement.paid) > 0.005) throw new Error(ALREADY);
      for (const inv of openInvoices) {
        await tx.invoice.update({ where: { id: inv.id }, data: { status: "PAID", paidAt: now } });
        await tx.payment.create({
          data: { sessionId, invoiceId: inv.id, amount: inv.totalAmount, method: "OTHER", kind: "INVOICE", createdBy: username, note: "Betalt sammen med opholdet" },
        });
      }
      if (rest >= 0.005) {
        await tx.payment.create({
          data: { sessionId, amount: rest, method: "OTHER", kind: "SETTLEMENT", createdBy: username, externalId: paymentId ?? null, note: "Markeret som betalt" },
        });
      }
      await tx.session.update({
        where: { id: sessionId },
        data: { paymentStatus: "PAID", paidAt: now, ...(paymentId ? { paymentId } : {}) },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === ALREADY) return { ok: false, message: ALREADY };
    throw e;
  }
  logger.info("payment", `Ophold ${sessionId} markeret betalt af ${username}: ${fmtMoney(settlement.owed, settlement.currency)}`);

  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/bookings/${sessionId}`);
  return { ok: true };
}

/**
 * "Fortryd betaling": books counter-entries for what markSessionPaid
 * recorded (nothing is deleted) and reopens the stay.
 */
export async function markSessionUnpaid(sessionId: number): Promise<{ ok: true } | { ok: false; message: string }> {
  const auth = await requireAuth();
  const settlement = await computeSettlement(sessionId);
  if (!settlement) return { ok: false, message: "Opholdet findes ikke." };
  const username = auth.username || "admin";
  const open = settlement.payments.filter(
    (p) => (p.kind === "SETTLEMENT" || (p.kind === "INVOICE" && p.note === "Betalt sammen med opholdet"))
      && p.amount > 0 && p.reversesId == null && !p.reversed,
  );

  await prisma.$transaction(async (tx) => {
    for (const p of open) {
      await tx.payment.create({
        data: {
          sessionId,
          invoiceId: p.invoiceId,
          amount: -p.amount,
          method: p.method,
          kind: p.kind,
          reversesId: p.id,
          createdBy: username,
          note: "Betaling fortrudt",
        },
      });
      if (p.invoiceId != null) {
        await tx.invoice.update({ where: { id: p.invoiceId }, data: { status: "PENDING", paidAt: null } });
      }
    }
    await tx.session.update({
      where: { id: sessionId },
      data: { paymentStatus: "UNPAID", paidAt: null, paymentId: null },
    });
  });
  // A stay with nothing (≥ 1 kr) due is settled whatever the button said.
  await syncPaymentStatus(sessionId);
  logger.info("payment", `Betaling på ophold ${sessionId} fortrudt af ${username}`);

  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/bookings/${sessionId}`);
  return { ok: true };
}

/**
 * Add to the live prepaid balance atomically (e.g. cash at reception).
 * Uses increments so a concurrent laundry/shower decrement is never lost,
 * and turns the electricity back on if a prior auto power-off is now funded.
 */
export async function addPrepaidAmount(sessionId: number, delta: number) {
  await requireAuth();
  if (!Number.isFinite(delta) || delta <= 0) throw new Error("Beløb skal være større end 0");
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, prepaidAmount: true, prepaidDeposited: true },
  });
  if (!session) throw new Error("Booking ikke fundet");
  // An increment on a NULL column stays NULL in SQLite, so backfill legacy
  // rows with an absolute value once; afterwards increment.
  const depositedUpdate =
    session.prepaidDeposited != null
      ? { increment: delta }
      : (await resolvePrepaidDeposited(session)) + delta;
  await prisma.session.update({
    where: { id: sessionId },
    data: { prepaidAmount: { increment: delta }, prepaidDeposited: depositedUpdate },
  });
  await restorePrepaidPowerIfFunded(sessionId);
  revalidatePath(`/admin/bookings/${sessionId}`);
  revalidatePath("/admin/bookings");
}

/** Set the prepaid balance to an absolute amount (corrections). Prefer addPrepaidAmount for top-ups. */
export async function adjustPrepaidAmount(sessionId: number, newAmount: number) {
  await requireAuth();
  if (newAmount < 0) throw new Error("Beløb kan ikke være negativt");
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, prepaidAmount: true, prepaidDeposited: true },
  });
  if (!session) throw new Error("Booking ikke fundet");
  // The admin sets the BALANCE; shift the deposited total by the same delta so
  // "Forudbetalt" reflects the extra money without absorbing prior spending.
  const delta = newAmount - (session.prepaidAmount ?? 0);
  const deposited = Math.max(0, (await resolvePrepaidDeposited(session)) + delta);
  await prisma.session.update({
    where: { id: sessionId },
    data: { prepaidAmount: newAmount, prepaidDeposited: deposited },
  });
  if (delta > 0) await restorePrepaidPowerIfFunded(sessionId);
  revalidatePath(`/admin/bookings/${sessionId}`);
  revalidatePath("/admin/bookings");
}

const METER_FIELDS = ["startKwh", "endKwh", "startHeatingKwh", "endHeatingKwh", "startWaterLiters", "endWaterLiters"] as const;
const PRICE_FIELDS = ["pricePerKwhOverride", "pricePerLiterWaterOverride"] as const;
// Guest fields the booking-system sync must leave alone once the desk edits them.
const SYNC_LOCKABLE_FIELDS = ["guestName", "guestEmail", "guestPhone", "expectedCheckOut"];

/**
 * "Redigér booking". Only fields that differ from what is stored are written.
 * Guest/stay fields never touch money. Meter readings and price overrides:
 * - running/reserved stays: never write totals (checkout settles from the
 *   accumulator); a price override applies from the next meter reading;
 * - completed stays: recalculated the way checkout bills (accumulator +
 *   corrected difference, on-account services), and only after the operator
 *   confirms the before/after amount (call again with confirm: true).
 */
export async function updateSessionDetails(
  sessionId: number,
  data: SessionDetailsInput,
  opts: { confirm?: boolean } = {},
): Promise<UpdateSessionResult> {
  const auth = await requireAuth();
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return { ok: false, message: "Opholdet findes ikke." };

  const updateData: Record<string, unknown> = {};
  const changedGuestFields: string[] = [];
  const setGuest = (field: string, value: unknown) => {
    updateData[field] = value;
    changedGuestFields.push(field);
  };

  // ── Gæst og ophold ──
  if (data.guestName !== undefined) {
    const v = data.guestName.trim();
    if (!v) return { ok: false, message: "Gæstenavn må ikke være tomt." };
    if (v !== session.guestName) setGuest("guestName", v);
  }
  if (data.guestEmail !== undefined) {
    const v = data.guestEmail.trim() || null;
    if (v !== session.guestEmail) setGuest("guestEmail", v);
  }
  if (data.guestPhone !== undefined) {
    const v = data.guestPhone.trim() || null;
    if (v !== session.guestPhone) setGuest("guestPhone", v);
  }
  if (data.bookingRef !== undefined) {
    const v = data.bookingRef.trim() || null;
    if (v !== session.bookingRef) {
      // The provider ref is the sync key — editing it made the next sync
      // import the booking again as a duplicate.
      if (session.externalBookingId || parseBookingRef(session.bookingRef)) {
        return { ok: false, message: "Booking nr. kommer fra booking-systemet og kan ikke ændres her." };
      }
      updateData.bookingRef = v;
    }
  }
  if (data.notes !== undefined) {
    const v = data.notes.trim() ? data.notes : null;
    if (v !== session.notes) updateData.notes = v;
  }
  if (data.expectedCheckOut !== undefined) {
    const v = data.expectedCheckOut.trim();
    const current = session.expectedCheckOut ? session.expectedCheckOut.toISOString().slice(0, 10) : "";
    if (v !== current) {
      if (!v) {
        setGuest("expectedCheckOut", null);
      } else {
        // Noon local time, like imported bookings — a date-only value at UTC
        // midnight lands on the previous evening in Denmark.
        const d = new Date(`${v}T12:00:00`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime())) {
          return { ok: false, message: "Ugyldig dato for forventet checkout." };
        }
        setGuest("expectedCheckOut", d);
      }
    }
  }

  // ── Målerstande og pris ──
  const before = {
    startKwh: session.startKwh,
    endKwh: session.endKwh,
    startHeatingKwh: session.startHeatingKwh,
    endHeatingKwh: session.endHeatingKwh,
    startWaterLiters: session.startWaterLiters,
    endWaterLiters: session.endWaterLiters,
    pricePerKwhOverride: session.pricePerKwhOverride,
    pricePerLiterWaterOverride: session.pricePerLiterWaterOverride,
  };
  const after = { ...before };
  const changedMoneyFields: string[] = [];
  for (const key of [...METER_FIELDS, ...PRICE_FIELDS]) {
    const v = data[key];
    if (v === undefined) continue;
    if (v !== null && (!Number.isFinite(v) || v < 0)) {
      return { ok: false, message: "Målerstande og priser skal være positive tal." };
    }
    if (v !== before[key]) {
      after[key] = v;
      changedMoneyFields.push(key);
    }
  }

  let message: string | undefined;
  let amountChange: { before: number; after: number } | null = null;
  if (changedMoneyFields.length > 0) {
    const pairs: Array<[number | null, number | null, string]> = [
      [after.startKwh, after.endKwh, "El"],
      [after.startHeatingKwh, after.endHeatingKwh, "Varme"],
      [after.startWaterLiters, after.endWaterLiters, "Vand"],
    ];
    for (const [start, end, label] of pairs) {
      if (start != null && end != null && end < start) {
        return { ok: false, message: `${label}: slutaflæsningen kan ikke være lavere end startaflæsningen.` };
      }
    }

    if (session.status === "COMPLETED") {
      const settlement = await computeSettlement(sessionId);
      if (settlement?.state === "PAID") {
        return { ok: false, message: "Opholdet er betalt. Fortryd betalingen, før målerstande eller pris rettes." };
      }
      const pricing = await getPricing();
      let elPrice = pricing.pricePerKwh;
      try { elPrice = (await getEffectiveElPricing()).pricePerKwh; } catch { /* fixed price */ }
      const recalc = recalcCompletedCosts({
        before: { ...before, totalElectricityCost: session.totalElectricityCost, totalWaterCost: session.totalWaterCost },
        after: { ...after, totalElectricityCost: session.totalElectricityCost, totalWaterCost: session.totalWaterCost },
        accumulatedElCost: session.accumulatedElCost,
        accumulatedElKwh: session.accumulatedElKwh,
        accumulatedWaterCost: session.accumulatedWaterCost,
        accumulatedWaterLiters: session.accumulatedWaterLiters,
        elTicked: session.lastTickKwh != null || session.lastTickHeatingKwh != null || session.accumulatedElKwh > 0,
        waterTicked: session.lastTickWaterLiters != null || session.accumulatedWaterLiters > 0,
        elPrice,
        waterPrice: pricing.pricePerLiterWater,
      });
      // Same total checkout stores: el + water + on-account services.
      const [laundryAgg, showerAgg] = await Promise.all([
        prisma.laundrySess.aggregate({ where: { sessionId, paymentStatus: "ON_ACCOUNT" }, _sum: { pricePaid: true } }),
        prisma.showerSess.aggregate({ where: { sessionId, paymentStatus: "ON_ACCOUNT" }, _sum: { pricePaid: true } }),
      ]);
      const onAccount = (laundryAgg._sum.pricePaid ?? 0) + (showerAgg._sum.pricePaid ?? 0);
      const oldElWater = (session.totalElectricityCost ?? 0) + (session.totalWaterCost ?? 0);
      const newElWater = (recalc.electricityCost ?? 0) + (recalc.waterCost ?? 0);
      const totalBefore = settlement?.totals.totalCost ?? roundOre(oldElWater + onAccount);
      const totalAfter = roundOre(totalBefore - oldElWater + newElWater);

      if (Math.abs(totalAfter - totalBefore) >= 0.005) {
        if (!opts.confirm) {
          return {
            ok: false,
            needsConfirmation: true,
            before: totalBefore,
            after: totalAfter,
            message: `Beløbet for opholdet ændres fra ${fmtMoney(totalBefore)} til ${fmtMoney(totalAfter)}.`,
          };
        }
        amountChange = { before: totalBefore, after: totalAfter };
      }
      if (recalc.elChanged) updateData.totalElectricityCost = recalc.electricityCost;
      if (recalc.waterChanged) updateData.totalWaterCost = recalc.waterCost;
      Object.assign(updateData, recalc.accumulators);
      updateData.totalCost = roundOre(newElWater + onAccount);
    } else {
      // A running or reserved stay is settled at checkout from the meter's
      // own readings; totals stay unset so every screen keeps the live figure.
      const endFields = changedMoneyFields.filter((k) => k.startsWith("end"));
      if (endFields.length > 0) {
        return { ok: false, message: "Slutaflæsning sættes ved udtjek. Brug 'Indtast slutaflæsning' i udtjek-dialogen." };
      }
      const startTicked: Record<string, boolean> = {
        startKwh: session.lastTickKwh != null,
        startHeatingKwh: session.lastTickHeatingKwh != null,
        startWaterLiters: session.lastTickWaterLiters != null,
      };
      if (changedMoneyFields.some((k) => startTicked[k])) {
        return { ok: false, message: "Startaflæsningen kan ikke rettes, når måleren allerede afregner løbende." };
      }
      if (changedMoneyFields.some((k) => k.startsWith("price"))) {
        message = "Den nye pris gælder fra næste måleraflæsning. Allerede målt forbrug ændres ikke.";
      }
    }
    for (const key of changedMoneyFields) updateData[key] = after[key as keyof typeof after];
  }

  if (Object.keys(updateData).length === 0) return { ok: true, message: "Ingen ændringer at gemme." };

  // Fields corrected by hand on an imported booking are locked against the
  // booking-system sync, so the next sync doesn't silently undo them.
  const lockable = changedGuestFields.filter((f) => SYNC_LOCKABLE_FIELDS.includes(f));
  if (lockable.length > 0 && (session.externalBookingId || parseBookingRef(session.bookingRef))) {
    updateData.lockedFields = addLockedFields(session.lockedFields, lockable);
  }

  await prisma.session.update({ where: { id: sessionId }, data: updateData });
  if (amountChange) {
    logger.info(
      "booking",
      `Ophold ${sessionId}: beløb rettet af ${auth.username || "admin"} fra ${fmtMoney(amountChange.before)} til ${fmtMoney(amountChange.after)} (${changedMoneyFields.join(", ")})`,
    );
  }
  if (session.status === "COMPLETED" && changedMoneyFields.length > 0) await syncPaymentStatus(sessionId);

  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${sessionId}`);
  return { ok: true, message };
}

export async function resendGuestNotification(sessionId: number): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: true },
  });
  if (!session) return { ok: false, message: "Bookingen findes ikke." };
  // The template says "du er checket ind" — only true for an active stay.
  if (session.status !== "ACTIVE") {
    return { ok: false, message: "Portal-linket kan kun sendes til en gæst, der er tjekket ind." };
  }

  const dispName = unitDisplayName(session.unit.type, session.unit.name);
  const { sent, line } = await sendWelcomeMessage(session, dispName);
  return { ok: sent, message: line.text };
}

/** Completed stays that still owe ≥ 1 kr — same rule as the statement and Økonomi. */
export async function getUnpaidCount() {
  await requireAuth();
  return (await listUnpaidSettlements()).length;
}

// ──────────────────────────────────────────────
// SYSTEM STATUS
// ──────────────────────────────────────────────
export async function getSystemStatus() {
  await requireAuth();
  const settings = await readGlobalSettings();
  const logCount = await prisma.consumptionLog.count();
  const latestLog = await prisma.consumptionLog.findFirst({ orderBy: { recordedAt: "desc" } });
  const unitCount = await prisma.unit.count();
  const sessionCount = await prisma.session.count();
  const invoiceCount = await prisma.invoice.count();

  return {
    cronLastRun: settings._cron_last_run || null,
    cronLastStatus: settings._cron_last_status || null,
    // Meter logging, invoices etc. only run on the "heavy" tick (every 10 min);
    // the 2-minute calls in between just handle showers/laundry/booking sync.
    cronLastFullRun: settings._cron_last_full_run || null,
    // Outcome of the last heavy run — kept separate from _cron_last_status,
    // which the next 2-minute tick overwrites with "ok".
    cronHeavyStatus: settings._cron_heavy_status || null,
    cronLogSummary: (() => {
      try { return settings._cron_log_summary ? JSON.parse(settings._cron_log_summary) as { withMeters: number; logged: number; noReading: string[]; reasons?: { unit: string; reason: string }[] } : null; }
      catch { return null; }
    })(),
    cronAlerts: settings._cron_alerts || "0",
    totalLogs: logCount,
    latestLogTime: latestLog?.recordedAt?.toISOString() || null,
    unitCount,
    sessionCount,
    invoiceCount,
    alarmEnabled: settings.alarm_enabled === "true",
    smsEnabled: settings.notifications_sms_enabled === "true",
    emailEnabled: settings.notifications_email_enabled === "true",
    invoiceEmailEnabled: settings.invoice_email_enabled === "true",
    autoPowerOff: settings.auto_power_off_on_checkout === "true",
    apiKey: settings.api_key || "",
    meterFailures: Object.keys(settings)
      .filter((k) => k.startsWith("_meter_fail_") && settings[k] > new Date(Date.now() - 3600_000).toISOString())
      .map((k) => ({ context: k.replace("_meter_fail_", "").replace(/_/g, " "), lastFail: settings[k] })),
  };
}

// ──────────────────────────────────────────────
// CONSUMPTION LOGGING — periodic meter readings
// ──────────────────────────────────────────────
/** Auth-guarded entry point (server action). Cron/webhooks call it inside
 *  runWithApiAuth; in-module callers use logAllConsumptionInternal directly. */
export async function logAllConsumption(...args: Parameters<typeof logAllConsumptionInternal>) {
  await requireAuth();
  return logAllConsumptionInternal(...args);
}

async function logAllConsumptionInternal(): Promise<{
  withMeters: number;
  logged: number;
  noReading: string[];
  reasons: { unit: string; reason: string }[];
}> {
  const units = await prisma.unit.findMany({
    include: { hardware: true },
  });

  let withMeters = 0;
  let logged = 0;
  // A meter that returns no value is not an exception — it used to vanish
  // silently. Collect them so the admin can see which units aren't logging.
  const noReading: string[] = [];
  const reasons: { unit: string; reason: string }[] = [];

  // Each unit is read on its own; one failing meter never stops the rest.
  for (const unit of units) {
    const hw = unit.hardware;
    if (!hw) continue;
    const hasEl = hardware.hasElectricityMeter(hw);
    const hasWater = hardware.hasWaterMeter(hw);
    if (!hasEl && !hasWater) continue;
    withMeters++;
    const label = unitDisplayName(unit.type, unit.name);

    let electricityKwh: number | null = null;
    let waterLiters: number | null = null;

    try {
      if (hasEl) {
        const r = await hardware.readEnergyKwhWithReason(hardware.electricityMeterEp(hw));
        electricityKwh = r.kwh;
        if (r.reason) reasons.push({ unit: label, reason: `El — ${r.reason}` });
      }
      if (hasWater) {
        const r = await hardware.readEnergyKwhWithReason(hardware.waterMeterEp(hw));
        waterLiters = r.kwh;
        if (r.reason) reasons.push({ unit: label, reason: `Vand — ${r.reason}` });
      }
    } catch (e) {
      reasons.push({ unit: label, reason: e instanceof Error ? e.message : String(e) });
    }

    if (electricityKwh !== null || waterLiters !== null) {
      await prisma.consumptionLog.create({
        data: { unitId: unit.id, electricityKwh, waterLiters },
      });
      logged++;
    } else {
      noReading.push(label);
    }
  }

  return { withMeters, logged, noReading, reasons };
}

export async function getConsumptionLogs(unitId: number, days: number = 7) {
  await requireAuth();
  const since = new Date();
  since.setDate(since.getDate() - days);
  return prisma.consumptionLog.findMany({
    where: { unitId, recordedAt: { gte: since } },
    orderBy: { recordedAt: "asc" },
  });
}

/**
 * Consumption logs plus the context the chart needs to explain an empty state:
 * whether the unit has any meter configured at all, and when logging started.
 * Without this the chart can't tell "no meters wired up" (never going to show
 * data) apart from "meters fine, still collecting" (data on the way).
 */
export async function getConsumptionChartData(unitId: number, days: number = 7) {
  await requireAuth();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const [logs, hw, firstLog] = await Promise.all([
    prisma.consumptionLog.findMany({
      where: { unitId, recordedAt: { gte: since } },
      orderBy: { recordedAt: "asc" },
    }),
    prisma.unitHardware.findUnique({ where: { unitId } }),
    prisma.consumptionLog.findFirst({
      where: { unitId },
      orderBy: { recordedAt: "asc" },
      select: { recordedAt: true },
    }),
  ]);

  return {
    logs,
    hasMeters: hardware.hasElectricityMeter(hw) || hardware.hasWaterMeter(hw),
    firstLoggedAt: firstLog?.recordedAt ?? null,
  };
}

// ──────────────────────────────────────────────
// TOTAL CONSUMPTION HISTORY — aggregated across all units
// ──────────────────────────────────────────────
export async function getTotalConsumptionHistory(period: "week" | "month" = "week", weeks = 13) {
  await requireAuth();
  const since = new Date();
  if (period === "week") {
    // Callers that only need a few bars (the dashboard sparkline) pass a
    // smaller window — this reads every unit's logs, so don't over-fetch.
    since.setDate(since.getDate() - weeks * 7);
  } else {
    since.setFullYear(since.getFullYear() - 1); // last 12 months
  }

  const logs = await prisma.consumptionLog.findMany({
    where: { recordedAt: { gte: since } },
    orderBy: { recordedAt: "asc" },
    select: { unitId: true, electricityKwh: true, waterLiters: true, recordedAt: true },
  });

  // We need to calculate delta (consumption used) per unit between readings
  // Group logs by unitId first
  const byUnit = new Map<number, { electricityKwh: number | null; waterLiters: number | null; recordedAt: Date }[]>();
  for (const log of logs) {
    if (!byUnit.has(log.unitId)) byUnit.set(log.unitId, []);
    byUnit.get(log.unitId)!.push(log);
  }

  // Calculate deltas for each unit, grouped by period bucket
  const buckets = new Map<string, { el: number; water: number }>();

  for (const [, unitLogs] of byUnit) {
    for (let i = 1; i < unitLogs.length; i++) {
      const prev = unitLogs[i - 1];
      const curr = unitLogs[i];
      const date = curr.recordedAt;

      let bucketKey: string;
      if (period === "week") {
        // ISO week: get Monday of the week
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        bucketKey = d.toISOString().slice(0, 10);
      } else {
        bucketKey = date.toISOString().slice(0, 7);
      }

      if (!buckets.has(bucketKey)) buckets.set(bucketKey, { el: 0, water: 0 });
      const b = buckets.get(bucketKey)!;

      if (curr.electricityKwh !== null && prev.electricityKwh !== null) {
        const delta = curr.electricityKwh - prev.electricityKwh;
        if (delta >= 0 && delta < 10000) b.el += delta; // sanity check
      }
      if (curr.waterLiters !== null && prev.waterLiters !== null) {
        const delta = curr.waterLiters - prev.waterLiters;
        if (delta >= 0 && delta < 100000) b.water += delta;
      }
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, val]) => ({
      period: key,
      el: Math.round(val.el * 100) / 100,
      water: Math.round(val.water),
    }));
}

// ──────────────────────────────────────────────
// TOTAL USAGE — current consumption rate per hour
// ──────────────────────────────────────────────
export async function getTotalUsage() {
  await requireAuth();
  const units = await prisma.unit.findMany({
    select: { id: true, name: true, type: true, hardware: true },
  });

  let totalKwhPerHour = 0;
  let totalWaterLitersPerHour = 0;
  let unitCount = 0;
  let latestReadingAt: Date | null = null;
  const now = Date.now();

  // Only units with a meter or power sensor can contribute; the rest are
  // listed with null rates without touching the database.
  const isMetered = (hw: (typeof units)[number]["hardware"]) =>
    hardware.hasElectricityMeter(hw) || hardware.hasWaterMeter(hw) || hardware.hasElectricityPower(hw);
  const metered = units.filter((u) => isMetered(u.hardware));

  const rates = new Map<number, { kwhPerHour: number | null; waterPerHour: number | null }>();
  await Promise.all(metered.map(async (unit) => {
    // Rate from the two most recent consumption logs — but only while the
    // newest one is recent. A meter that went offline hours ago must not show
    // its last rate as "now".
    const logs = await prisma.consumptionLog.findMany({
      where: { unitId: unit.id },
      orderBy: { recordedAt: "desc" },
      take: 2,
    });
    if (logs[0] && (!latestReadingAt || logs[0].recordedAt > latestReadingAt)) latestReadingAt = logs[0].recordedAt;

    let kwhPerHour: number | null = null;
    let waterPerHour: number | null = null;

    if (logs.length >= 2 && now - logs[0].recordedAt.getTime() <= METER_FRESH_MS) {
      const [latest, previous] = logs;
      const hoursDiff = (new Date(latest.recordedAt).getTime() - new Date(previous.recordedAt).getTime()) / 3600000;
      if (hoursDiff > 0 && hoursDiff < 4) {
        if (latest.electricityKwh !== null && previous.electricityKwh !== null) {
          kwhPerHour = Math.max(0, latest.electricityKwh - previous.electricityKwh) / hoursDiff;
        }
        if (latest.waterLiters !== null && previous.waterLiters !== null) {
          waterPerHour = Math.max(0, latest.waterLiters - previous.waterLiters) / hoursDiff;
        }
      }
    }

    // Fallback: read live power (W) from the configured power sensor
    if (kwhPerHour === null && hardware.hasElectricityPower(unit.hardware)) {
      const ep = hardware.electricityPowerEp(unit.hardware!);
      try {
        if (!(await hardware.isReportedOffline(ep))) {
          const res = await hardware.readPowerWatts(ep);
          if (res && res.watts >= 0 && res.ageMs <= METER_FRESH_MS) {
            kwhPerHour = res.watts / 1000; // W to kW
          }
        }
      } catch {
        // endpoint unreachable
      }
    }

    // If still no rate, try computing from meter endpoint + recent log
    if (kwhPerHour === null && hardware.hasElectricityMeter(unit.hardware)) {
      const ep = hardware.electricityMeterEp(unit.hardware!);
      try {
        if (!(await hardware.isReportedOffline(ep))) {
          const currentKwh = await hardware.readEnergyKwh(ep);
          if (currentKwh !== null && logs.length >= 1 && logs[0].electricityKwh !== null) {
            const hoursSinceLog = (Date.now() - new Date(logs[0].recordedAt).getTime()) / 3600000;
            if (hoursSinceLog > 0 && hoursSinceLog < 4) {
              kwhPerHour = Math.max(0, currentKwh - logs[0].electricityKwh) / hoursSinceLog;
            }
          }
        }
      } catch {
        // endpoint unreachable
      }
    }

    rates.set(unit.id, { kwhPerHour, waterPerHour });
  }));

  const perUnit: { unitId: number; name: string; type: string; kwhPerHour: number | null; waterPerHour: number | null }[] = [];
  for (const unit of units) {
    const r = rates.get(unit.id) ?? { kwhPerHour: null, waterPerHour: null };
    if (r.kwhPerHour !== null) {
      totalKwhPerHour += r.kwhPerHour;
      unitCount++;
    }
    if (r.waterPerHour !== null) {
      totalWaterLitersPerHour += r.waterPerHour;
    }
    perUnit.push({ unitId: unit.id, name: unit.name, type: unit.type, ...r });
  }

  return {
    totalKwhPerHour,
    totalWaterLitersPerHour,
    /** Units with a fresh electricity rate right now. */
    unitCount,
    /** Units that have a meter or power sensor at all. */
    meteredUnits: metered.length,
    latestReadingAt: (latestReadingAt as Date | null)?.toISOString() ?? null,
    perUnit,
  };
}

// ──────────────────────────────────────────────
// CSV EXPORT — accounting
// ──────────────────────────────────────────────
export async function exportSessionsCSV(filter?: "all" | "unpaid" | "paid") {
  await requireAuth();
  const where = filter === "unpaid" ? { status: "COMPLETED" as const, paymentStatus: "UNPAID" as const }
    : filter === "paid" ? { paymentStatus: "PAID" as const }
    : {};

  const sessions = await prisma.session.findMany({
    where,
    include: { unit: true },
    orderBy: { checkInTime: "desc" },
  });

  // CSV-escape a cell: wrap in quotes if it contains semicolons, newlines
  // or quotes, and double-quote any embedded quotes.
  const esc = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(";") || s.includes("\n") || s.includes('"')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };


  const header = [
    "ID",
    "Enhed",
    "Type",
    "Status",
    "Gæst",
    "Email",
    "Telefon",
    "Check-in",
    "Check-out",
    "Forventet check-out",
    "El hoved (kWh)",
    "Varme (kWh)",
    "El total (kWh)",
    "El (DKK)",
    "Vand (L)",
    "Vand (DKK)",
    "Total forbrug (DKK)",
    "Ekstern pris (DKK)",
    "Ekstern beskrivelse",
    "Ubrugt servicekredit (DKK)",
    "Grand total (DKK)",
    "Afregningsmåde",
    "Forudbetalt (DKK)",
    "Pris override (DKK/kWh)",
    "Pris override (DKK/L vand)",
    "Betaling",
    "Betalings-ID",
    "Betalt dato",
    "Booking nr.",
    "Notat",
  ].join(";") + "\n";

  const rows = sessions.map((s) => {
    const type = typeLabels[s.unit.type] || s.unit.type;

    // Use real end readings for COMPLETED sessions; for ACTIVE sessions the
    // accumulator tracks consumption continuously so we report the running
    // totals rather than empty cells.
    const isActive = s.status === "ACTIVE";
    const mainKwhDelta = (s.endKwh !== null && s.startKwh !== null)
      ? (s.endKwh - s.startKwh)
      : (isActive && s.lastTickKwh !== null && s.startKwh !== null)
        ? (s.lastTickKwh - s.startKwh)
        : null;
    const heatKwhDelta = (s.endHeatingKwh !== null && s.startHeatingKwh !== null)
      ? (s.endHeatingKwh - s.startHeatingKwh)
      : (isActive && s.lastTickHeatingKwh !== null && s.startHeatingKwh !== null)
        ? (s.lastTickHeatingKwh - s.startHeatingKwh)
        : null;
    const totalKwh = (mainKwhDelta ?? 0) + (heatKwhDelta ?? 0);
    const hasKwh = mainKwhDelta !== null || heatKwhDelta !== null;

    const waterDelta = (s.endWaterLiters !== null && s.startWaterLiters !== null)
      ? (s.endWaterLiters - s.startWaterLiters)
      : (isActive && s.lastTickWaterLiters !== null && s.startWaterLiters !== null)
        ? (s.lastTickWaterLiters - s.startWaterLiters)
        : null;

    // Costs: prefer the completed totals; fall back to the accumulator for
    // in-progress sessions so the export is actually useful.
    const elCost = s.totalElectricityCost ?? (isActive && s.accumulatedElCost > 0 ? s.accumulatedElCost : null);
    const waterCost = s.totalWaterCost ?? (isActive && s.accumulatedWaterCost > 0 ? s.accumulatedWaterCost : null);
    const totalCost = s.totalCost ?? (elCost !== null || waterCost !== null ? (elCost ?? 0) + (waterCost ?? 0) : null);

    // Grand total = forbrug + ekstern pris. Unused service credit is credit the
    // guest still holds, not a payment against the stay — don't subtract it.
    const grandTotal = (totalCost ?? 0) + (s.externalPrice ?? 0);

    return [
      esc(s.id),
      esc(`${type} ${s.unit.name}`),
      esc(type),
      esc(s.status),
      esc(s.guestName),
      esc(s.guestEmail),
      esc(s.guestPhone),
      esc(s.checkInTime.toISOString().slice(0, 10)),
      esc(s.checkOutTime?.toISOString().slice(0, 10)),
      esc(s.expectedCheckOut?.toISOString().slice(0, 10)),
      esc(mainKwhDelta !== null ? mainKwhDelta.toFixed(2) : ""),
      esc(heatKwhDelta !== null ? heatKwhDelta.toFixed(2) : ""),
      esc(hasKwh ? totalKwh.toFixed(2) : ""),
      esc(elCost !== null ? elCost.toFixed(2) : ""),
      esc(waterDelta !== null ? waterDelta.toFixed(0) : ""),
      esc(waterCost !== null ? waterCost.toFixed(2) : ""),
      esc(totalCost !== null ? totalCost.toFixed(2) : ""),
      esc(s.externalPrice?.toFixed(2)),
      esc(s.externalDescription),
      esc(s.laundryCredit > 0 ? s.laundryCredit.toFixed(2) : ""),
      esc(grandTotal !== 0 ? grandTotal.toFixed(2) : ""),
      esc(s.billingMode),
      esc(s.prepaidAmount?.toFixed(2)),
      esc(s.pricePerKwhOverride?.toFixed(4)),
      esc(s.pricePerLiterWaterOverride?.toFixed(4)),
      esc(s.paymentStatus),
      esc(s.paymentId),
      esc(s.paidAt?.toISOString().slice(0, 10)),
      esc(s.bookingRef),
      esc(s.notes),
    ].join(";");
  });

  return header + rows.join("\n");
}

export async function exportInvoicesCSV() {
  await requireAuth();
  const invoices = await prisma.invoice.findMany({
    include: { unit: true },
    orderBy: { periodEnd: "desc" },
  });

  const esc = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(";") || s.includes("\n") || s.includes('"')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };


  const header = [
    "ID",
    "Enhed",
    "Type",
    "Periode start",
    "Periode slut",
    "El start (kWh)",
    "El slut (kWh)",
    "El forbrug (kWh)",
    "Varme start (kWh)",
    "Varme slut (kWh)",
    "Varme forbrug (kWh)",
    "El+varme total (kWh)",
    "El+varme (DKK)",
    "Vand start (L)",
    "Vand slut (L)",
    "Vand forbrug (L)",
    "Vand (DKK)",
    "Total (DKK)",
    "Status",
    "Betalings-ID",
    "Betalt dato",
    "Betalings-link",
  ].join(";") + "\n";

  const rows = invoices.map((inv) => {
    const type = typeLabels[inv.unit.type] || inv.unit.type;
    const elDelta = (inv.endKwh !== null && inv.startKwh !== null)
      ? (inv.endKwh - inv.startKwh) : null;
    const heatDelta = (inv.endHeatingKwh !== null && inv.startHeatingKwh !== null)
      ? (inv.endHeatingKwh - inv.startHeatingKwh) : null;
    const totalElKwh = (elDelta ?? 0) + (heatDelta ?? 0);
    const hasAnyEl = elDelta !== null || heatDelta !== null;
    const waterDelta = (inv.endWaterLiters !== null && inv.startWaterLiters !== null)
      ? (inv.endWaterLiters - inv.startWaterLiters) : null;

    return [
      esc(inv.id),
      esc(`${type} ${inv.unit.name}`),
      esc(type),
      esc(inv.periodStart.toISOString().slice(0, 10)),
      esc(inv.periodEnd.toISOString().slice(0, 10)),
      esc(inv.startKwh?.toFixed(2)),
      esc(inv.endKwh?.toFixed(2)),
      esc(elDelta !== null ? elDelta.toFixed(2) : ""),
      esc(inv.startHeatingKwh?.toFixed(2)),
      esc(inv.endHeatingKwh?.toFixed(2)),
      esc(heatDelta !== null ? heatDelta.toFixed(2) : ""),
      esc(hasAnyEl ? totalElKwh.toFixed(2) : ""),
      esc(inv.electricityCost.toFixed(2)),
      esc(inv.startWaterLiters?.toFixed(0)),
      esc(inv.endWaterLiters?.toFixed(0)),
      esc(waterDelta !== null ? waterDelta.toFixed(0) : ""),
      esc(inv.waterCost.toFixed(2)),
      esc(inv.totalAmount.toFixed(2)),
      esc(inv.status),
      esc(inv.paymentId),
      esc(inv.paidAt?.toISOString().slice(0, 10)),
      esc(inv.paymentToken),
    ].join(";");
  });

  return header + rows.join("\n");
}

// ──────────────────────────────────────────────
// CONSUMPTION ALARM — check for excessive usage
// ──────────────────────────────────────────────
/** Auth-guarded entry point (server action). Cron/webhooks call it inside
 *  runWithApiAuth; in-module callers use checkConsumptionAlarmsInternal directly. */
export async function checkConsumptionAlarms(...args: Parameters<typeof checkConsumptionAlarmsInternal>) {
  await requireAuth();
  return checkConsumptionAlarmsInternal(...args);
}

async function checkConsumptionAlarmsInternal(): Promise<{
  alerts: { unitId: number; unitName: string; type: "electricity" | "water"; usage: number; threshold: number }[];
}> {
  const settings = await readGlobalSettings();
  if (settings.alarm_enabled !== "true") return { alerts: [] };

  const kwhThreshold = parseFloat(settings.alarm_kwh_threshold || "10");
  const waterThreshold = parseFloat(settings.alarm_water_threshold || "500");
  const hoursWindow = parseInt(settings.alarm_hours_window || "24", 10);

  const since = new Date();
  since.setHours(since.getHours() - hoursWindow);

  const units = await prisma.unit.findMany({ include: { hardware: true } });
  const alerts: { unitId: number; unitName: string; type: "electricity" | "water"; usage: number; threshold: number }[] = [];



  for (const unit of units) {
    const logs = await prisma.consumptionLog.findMany({
      where: { unitId: unit.id, recordedAt: { gte: since } },
      orderBy: { recordedAt: "asc" },
    });

    if (logs.length < 2) continue;

    const firstLog = logs[0];
    const lastLog = logs[logs.length - 1];
    const unitName = unitDisplayName(unit.type, unit.name);

    if (firstLog.electricityKwh !== null && lastLog.electricityKwh !== null) {
      const usage = lastLog.electricityKwh - firstLog.electricityKwh;
      if (usage > kwhThreshold) {
        alerts.push({ unitId: unit.id, unitName, type: "electricity", usage, threshold: kwhThreshold });
      }
    }

    if (firstLog.waterLiters !== null && lastLog.waterLiters !== null) {
      const usage = lastLog.waterLiters - firstLog.waterLiters;
      if (usage > waterThreshold) {
        alerts.push({ unitId: unit.id, unitName, type: "water", usage, threshold: waterThreshold });
      }
    }
  }

  // Main meter leak detection (continuous consumption alarm)
  if (settings.main_meter_leak_enabled === "true" && settings.main_meter_water_entity) {
    const leakThreshold = parseFloat(settings.main_meter_leak_threshold_liters || "10");
    const leakHours = parseInt(settings.main_meter_leak_hours || "3", 10);

    try {
      const history = await ha.getEntityHistory(settings.main_meter_water_entity, leakHours + 1);
      if (history && history.length >= 2) {
        // Check if consumption is constant (above threshold) for every hour
        let continuousHours = 0;
        for (let i = 1; i < history.length; i++) {
          const prev = parseFloat(history[i - 1].state);
          const curr = parseFloat(history[i].state);
          if (!isNaN(prev) && !isNaN(curr)) {
            const diff = curr - prev;
            if (diff >= leakThreshold) {
              continuousHours++;
            } else {
              continuousHours = 0;
            }
          }
        }
        if (continuousHours >= leakHours) {
          alerts.push({
            unitId: 0,
            unitName: "Hovedmåler vand",
            type: "water",
            usage: continuousHours,
            threshold: leakHours,
          });
        }
      }
    } catch (e) {
      logger.error("meter", "Leak detection error", e);
    }
  }

  return { alerts };
}

// ──────────────────────────────────────────────
// SPOT PRICES — daily hourly prices for chart
// ──────────────────────────────────────────────
export async function getLatestSpotPriceDate() {
  await requireAuth();
  const pricing = await getPricing();
  const { getAvailableDateRange } = await import("./energi-data-service");
  return getAvailableDateRange(pricing.edsPriceArea);
}

export async function testEdsApi() {
  await requireAuth();
  const pricing = await getPricing();
  const { getAvailableDateRange, fetchSpotPricesForDate } = await import("./energi-data-service");
  try {
    const range = await getAvailableDateRange(pricing.edsPriceArea);
    const prices = await fetchSpotPricesForDate(range.latest, pricing.edsPriceArea);
    return {
      ok: true,
      area: pricing.edsPriceArea,
      latestDate: range.latest,
      priceCount: prices.length,
      samplePrice: prices[0] ? `${prices[0].pricePerKwh.toFixed(4)} kr/kWh kl. ${prices[0].hour.slice(11, 16)}` : null,
      message: `Forbindelse OK — ${prices.length} timepriser for ${range.latest}`,
    };
  } catch (e) {
    return {
      ok: false,
      area: pricing.edsPriceArea,
      latestDate: null,
      priceCount: 0,
      samplePrice: null,
      message: `Fejl: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function getSpotPricesForDate(date: string) {
  await requireAuth();
  const pricing = await getPricing();
  const { fetchSpotPricesForDate } = await import("./energi-data-service");
  const prices = await fetchSpotPricesForDate(date, pricing.edsPriceArea);
  return {
    prices,
    pricingMode: pricing.pricingMode,
    fixedPrice: pricing.pricePerKwh,
    surcharge: pricing.elSurcharge,
    area: pricing.edsPriceArea,
  };
}

// Get hourly consumption rate for a given date (from consumption logs)
export async function getHourlyConsumptionForDate(date: string) {
  await requireAuth();
  const startOfDay = new Date(`${date}T00:00:00`);
  const endOfDay = new Date(`${date}T23:59:59`);

  const logs = await prisma.consumptionLog.findMany({
    where: {
      recordedAt: { gte: startOfDay, lte: endOfDay },
    },
    orderBy: { recordedAt: "asc" },
  });

  // Group by hour and sum electricity across all units
  const hourlyMap = new Map<string, { totalKwh: number; count: number }>();

  // We need pairs of consecutive logs per unit to compute rate
  const byUnit = new Map<number, typeof logs>();
  for (const log of logs) {
    const arr = byUnit.get(log.unitId) || [];
    arr.push(log);
    byUnit.set(log.unitId, arr);
  }

  for (const [, unitLogs] of byUnit) {
    for (let i = 1; i < unitLogs.length; i++) {
      const prev = unitLogs[i - 1];
      const curr = unitLogs[i];
      if (prev.electricityKwh === null || curr.electricityKwh === null) continue;

      const diffHours = (curr.recordedAt.getTime() - prev.recordedAt.getTime()) / 3600000;
      if (diffHours <= 0 || diffHours > 2) continue; // skip gaps

      const kwhRate = (curr.electricityKwh - prev.electricityKwh) / diffHours;
      const hourKey = curr.recordedAt.toISOString().slice(0, 13) + ":00:00";

      const existing = hourlyMap.get(hourKey) || { totalKwh: 0, count: 0 };
      existing.totalKwh += Math.max(0, kwhRate);
      existing.count++;
      hourlyMap.set(hourKey, existing);
    }
  }

  return Array.from(hourlyMap.entries())
    .map(([hour, { totalKwh }]) => ({ hour, kwhPerHour: parseFloat(totalKwh.toFixed(3)) }))
    .sort((a, b) => a.hour.localeCompare(b.hour));
}

// Get average hourly consumption over last N days (for estimated overlay)
export async function getAverageHourlyConsumption(days: number = 7) {
  await requireAuth();
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const logs = await prisma.consumptionLog.findMany({
    where: {
      recordedAt: { gte: startDate, lte: endDate },
    },
    orderBy: { recordedAt: "asc" },
  });

  // Group by unit, compute hourly rates, then average by hour-of-day
  const byUnit = new Map<number, typeof logs>();
  for (const log of logs) {
    const arr = byUnit.get(log.unitId) || [];
    arr.push(log);
    byUnit.set(log.unitId, arr);
  }

  // hourOfDay -> { totalKwh, count } across all days
  const hourlyAvg = new Map<number, { totalKwh: number; count: number }>();

  for (const [, unitLogs] of byUnit) {
    for (let i = 1; i < unitLogs.length; i++) {
      const prev = unitLogs[i - 1];
      const curr = unitLogs[i];
      if (prev.electricityKwh === null || curr.electricityKwh === null) continue;

      const diffHours = (curr.recordedAt.getTime() - prev.recordedAt.getTime()) / 3600000;
      if (diffHours <= 0 || diffHours > 2) continue;

      const kwhRate = Math.max(0, (curr.electricityKwh - prev.electricityKwh) / diffHours);
      const hour = curr.recordedAt.getHours();

      const existing = hourlyAvg.get(hour) || { totalKwh: 0, count: 0 };
      existing.totalKwh += kwhRate;
      existing.count++;
      hourlyAvg.set(hour, existing);
    }
  }

  return Array.from(hourlyAvg.entries())
    .map(([hour, { totalKwh, count }]) => ({
      hour,
      avgKwhPerHour: parseFloat((totalKwh / count).toFixed(3)),
    }))
    .sort((a, b) => a.hour - b.hour);
}

// ──────────────────────────────────────────────
// QUICKPAY — Payment
// ──────────────────────────────────────────────
export async function createSessionPayment(sessionId: number, portalToken: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: true },
  });
  if (!session) throw new Error("Session ikke fundet");
  if (session.guestPortalToken !== portalToken) throw new Error("Ugyldigt token");
  if (session.paymentStatus === "PAID") throw new Error("Allerede betalt");

  // Prepaid: only the part el/water ran past the balance — the rest was
  // already drawn from the deposit. Postpaid: the whole stay.
  const amount = session.billingMode === "PREPAID"
    ? prepaidShortfall(session)
    : (session.totalCost || 0) + (session.externalPrice || 0);
  if (amount <= 0) throw new Error("Intet beløb at betale");

  const settings = await readGlobalSettings();
  const baseUrl = getBaseUrl(settings);

  const { createPaymentLink, generateOrderId } = await import("./quickpay");
  const orderId = generateOrderId("S", sessionId);

  const { paymentId, paymentLink } = await createPaymentLink({
    orderId,
    amount,
    currency: settings.currency || "DKK",
    continueUrl: `${baseUrl}/guest/${portalToken}?paid=1`,
    cancelUrl: `${baseUrl}/guest/${portalToken}?cancelled=1`,
    callbackUrl: `${baseUrl}/api/quickpay/callback`,
  });

  // Store the QuickPay payment ID on the session
  await prisma.session.update({
    where: { id: sessionId },
    data: { paymentId: String(paymentId) },
  });

  return { paymentLink };
}

export async function createInvoicePayment(invoiceId: number, guestToken: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { unit: true },
  });
  if (!invoice || !guestToken) throw new Error("Faktura ikke fundet");
  // The guest may only pay invoices for the unit their portal link belongs to.
  const ownsInvoice =
    invoice.unit.longTermPortalToken === guestToken ||
    (await prisma.session.count({ where: { unitId: invoice.unitId, guestPortalToken: guestToken } })) > 0;
  if (!ownsInvoice) throw new Error("Faktura ikke fundet");
  if (invoice.status === "PAID") throw new Error("Allerede betalt");
  if (invoice.totalAmount <= 0) throw new Error("Intet beløb at betale");

  const settings = await readGlobalSettings();
  const baseUrl = getBaseUrl(settings);
  let portalToken: string | null = invoice.unit.longTermPortalToken;

  // For short-term invoices the unit has no longTermPortalToken — fall back
  // to the session whose period overlaps the invoice.
  if (!portalToken) {
    const relevantSession = await prisma.session.findFirst({
      where: {
        unitId: invoice.unitId,
        billingMode: { not: "PREPAID" },
        checkInTime: { lte: invoice.periodEnd },
      },
      orderBy: [{ status: "asc" }, { checkInTime: "desc" }],
    });
    if (relevantSession) portalToken = relevantSession.guestPortalToken;
  }

  const { createPaymentLink, generateOrderId } = await import("./quickpay");
  const orderId = generateOrderId("I", invoiceId);

  const { paymentId, paymentLink } = await createPaymentLink({
    orderId,
    amount: invoice.totalAmount,
    currency: settings.currency || "DKK",
    continueUrl: `${baseUrl}/guest/${portalToken}?paid=1`,
    cancelUrl: `${baseUrl}/guest/${portalToken}?cancelled=1`,
    callbackUrl: `${baseUrl}/api/quickpay/callback`,
  });

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { paymentId: String(paymentId) },
  });

  return { paymentLink };
}

export async function testQuickPay() {
  await requireAuth();
  const { testQuickPayConnection } = await import("./quickpay");
  return testQuickPayConnection();
}

// ──────────────────────────────────────────────
// ECONOMY — Monthly overview
// ──────────────────────────────────────────────
export interface MonthlyEconomySummary {
  month: string; // "2026-01"
  sessionsCount: number;
  invoicesCount: number;
  totalRevenue: number;
  totalPaid: number;
  totalUnpaid: number;
  totalElectricity: number;
  totalWater: number;
  totalKwhUsed: number;
  totalWaterUsed: number;
  /** Laundry used this month (value, any payment channel, cancelled excluded). */
  totalLaundry: number;
  laundryCount: number;
  totalShowers: number;
  showerCount: number;
  /**
   * Service money counted in totalRevenue/totalPaid: card, prepaid balance and
   * the desk (SERVICE payments, net of refunds). On-account/invoiced services
   * are already inside the stay's or invoice's total and are not added again.
   */
  servicesRevenue: number;
  servicesOnBill: number;
  /** Old PAID rows with no payment behind them (card payments were off) — not counted. */
  servicesUnverified: number;
}

export async function getEconomySummary(): Promise<{
  months: MonthlyEconomySummary[];
  unpaidSessions: { id: number; unitName: string; guestName: string; total: number; checkOut: string }[];
  unpaidInvoices: { id: number; unitName: string; total: number; periodEnd: string }[];
  laundryTotals: { total: number; count: number; paid: number };
}> {
  await requireAuth();


  const serviceSelect = {
    startedAt: true, status: true, pricePaid: true, creditUsed: true,
    paymentStatus: true, paymentMethod: true, paymentId: true,
  } as const;
  const [sessions, invoices, laundrySessions, showerSessions, deskServicePayments] = await Promise.all([
    prisma.session.findMany({
      where: { status: "COMPLETED" },
      include: { unit: true },
      orderBy: { checkOutTime: "desc" },
    }),
    prisma.invoice.findMany({
      include: { unit: true },
      orderBy: { periodEnd: "desc" },
    }),
    prisma.laundrySess.findMany({
      where: { status: { in: ["ACTIVE", "COMPLETED"] } },
      select: serviceSelect,
    }),
    prisma.showerSess.findMany({
      where: { status: { in: ["ACTIVE", "PAUSED", "COMPLETED"] } },
      select: serviceSelect,
    }),
    // Money taken/refunded at the desk for laundry, showers and service credit
    prisma.payment.findMany({ where: { kind: "SERVICE" }, select: { amount: true, createdAt: true } }),
  ]);

  // Group by month
  const monthMap = new Map<string, MonthlyEconomySummary>();

  function getOrCreate(month: string): MonthlyEconomySummary {
    if (!monthMap.has(month)) {
      monthMap.set(month, {
        month,
        sessionsCount: 0,
        invoicesCount: 0,
        totalRevenue: 0,
        totalPaid: 0,
        totalUnpaid: 0,
        totalElectricity: 0,
        totalWater: 0,
        totalKwhUsed: 0,
        totalWaterUsed: 0,
        totalLaundry: 0,
        laundryCount: 0,
        totalShowers: 0,
        showerCount: 0,
        servicesRevenue: 0,
        servicesOnBill: 0,
        servicesUnverified: 0,
      });
    }
    return monthMap.get(month)!;
  }

  for (const s of sessions) {
    const date = s.checkOutTime || s.checkInTime;
    const month = date.toISOString().slice(0, 7);
    const m = getOrCreate(month);
    m.sessionsCount++;
    const cost = s.totalCost ?? 0;
    m.totalRevenue += cost;
    if (s.paymentStatus === "PAID") m.totalPaid += cost;
    else m.totalUnpaid += cost;
    m.totalElectricity += s.totalElectricityCost ?? 0;
    m.totalWater += s.totalWaterCost ?? 0;
    if (s.endKwh !== null && s.startKwh !== null) m.totalKwhUsed += Math.max(0, s.endKwh - s.startKwh);
    if (s.endWaterLiters !== null && s.startWaterLiters !== null) m.totalWaterUsed += Math.max(0, s.endWaterLiters - s.startWaterLiters);
  }

  for (const inv of invoices) {
    const month = inv.periodEnd.toISOString().slice(0, 7);
    const m = getOrCreate(month);
    m.invoicesCount++;
    m.totalRevenue += inv.totalAmount;
    if (inv.status === "PAID") m.totalPaid += inv.totalAmount;
    else m.totalUnpaid += inv.totalAmount;
    m.totalElectricity += inv.electricityCost;
    m.totalWater += inv.waterCost;
    if (inv.endKwh !== null && inv.startKwh !== null) m.totalKwhUsed += Math.max(0, inv.endKwh - inv.startKwh);
    if (inv.endWaterLiters !== null && inv.startWaterLiters !== null) m.totalWaterUsed += Math.max(0, inv.endWaterLiters - inv.startWaterLiters);
  }

  // Laundry and showers. Only money that isn't already in a stay's totalCost
  // or an invoice is added to revenue: card and prepaid-balance uses here, desk
  // payments (incl. credit sold, minus refunds) from the payments ledger below.
  // On-account/invoiced uses were counted twice before; old PAID rows without
  // any payment behind them (card payments off) were counted as paid.
  for (const [rows, isLaundry] of [[laundrySessions, true], [showerSessions, false]] as const) {
    for (const r of rows) {
      const m = getOrCreate(r.startedAt.toISOString().slice(0, 7));
      const price = r.pricePaid ?? 0;
      if (isLaundry) { m.laundryCount++; m.totalLaundry += price; }
      else { m.showerCount++; m.totalShowers += price; }
      const channel = serviceChannel(r);
      if (countsAsServiceRevenue(channel)) {
        m.servicesRevenue += price;
        m.totalRevenue += price;
        m.totalPaid += price;
      } else if (channel === "ACCOUNT" || channel === "INVOICED") {
        m.servicesOnBill += price;
      } else if (channel === "UNVERIFIED") {
        m.servicesUnverified += price;
      }
    }
  }
  for (const p of deskServicePayments) {
    const m = getOrCreate(p.createdAt.toISOString().slice(0, 7));
    m.servicesRevenue += p.amount;
    m.totalRevenue += p.amount;
    m.totalPaid += p.amount;
  }

  const months = [...monthMap.values()].sort((a, b) => b.month.localeCompare(a.month));

  // Unpaid sessions — what the guest still owes per the settlement (the same
  // figure as the statement and the unpaid badge), not the raw stay total.
  const unpaidSettlements = await computeSettlements(
    sessions.filter((s) => s.paymentStatus === "UNPAID").map((s) => s.id),
  );
  const unpaidSessions = sessions
    .filter((s) => (unpaidSettlements.get(s.id)?.owed ?? 0) > 0)
    .map((s) => ({
      id: s.id,
      unitName: unitDisplayName(s.unit.type, s.unit.name),
      guestName: s.guestName,
      total: unpaidSettlements.get(s.id)!.owed,
      checkOut: s.checkOutTime?.toISOString().slice(0, 10) || "",
    }));

  // Unpaid invoices
  const unpaidInvoices = invoices
    .filter((inv) => inv.status !== "PAID" && inv.totalAmount > 0)
    .map((inv) => ({
      id: inv.id,
      unitName: unitDisplayName(inv.unit.type, inv.unit.name),
      total: inv.totalAmount,
      periodEnd: inv.periodEnd.toISOString().slice(0, 10),
    }));

  const laundryTotals = {
    total: laundrySessions.reduce((sum, ls) => sum + (ls.pricePaid ?? 0), 0),
    count: laundrySessions.length,
    paid: laundrySessions
      .filter((ls) => countsAsServiceRevenue(serviceChannel(ls)))
      .reduce((sum, ls) => sum + (ls.pricePaid ?? 0), 0),
  };

  return { months, unpaidSessions, unpaidInvoices, laundryTotals };
}

// ──────────────────────────────────────────────
// ADD SHELLY DEVICE via HA Config Flow
// ──────────────────────────────────────────────
export async function addShellyDevice(host: string, port: number = 80): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  if (!host.trim()) return { ok: false, message: "Angiv en IP-adresse eller hostname" };

  try {
    const { url, token } = await getHAConfigInternal();

    // Step 1: Initiate config flow for Shelly integration
    const initRes = await fetch(`${url}/api/config/config_entries/flow`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        handler: "shelly",
        show_advanced_options: false,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!initRes.ok) {
      const errText = await initRes.text();
      return { ok: false, message: `HA svarede med fejl: ${initRes.status} — ${errText}` };
    }

    const initData = await initRes.json();
    const flowId = initData.flow_id;

    if (!flowId) return { ok: false, message: "Kunne ikke starte Shelly config flow" };

    // Step 2: Submit host/port to the flow
    const submitRes = await fetch(`${url}/api/config/config_entries/flow/${flowId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ host: host.trim(), port }),
      signal: AbortSignal.timeout(30000),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      return { ok: false, message: `Kunne ikke tilføje enhed: ${submitRes.status} — ${errText}` };
    }

    const result = await submitRes.json();

    if (result.type === "create_entry") {
      return { ok: true, message: `Shelly enhed tilføjet: ${result.title || host}` };
    }

    if (result.type === "form") {
      // Maybe needs more info or auth
      if (result.errors && Object.keys(result.errors).length > 0) {
        const errMsg = Object.values(result.errors).join(", ");
        return { ok: false, message: `Fejl: ${errMsg}` };
      }
      // Might need additional step (e.g. firmware update or auth)
      return { ok: false, message: result.description_placeholders?.message || "Enheden kræver yderligere konfiguration i Home Assistant" };
    }

    if (result.type === "abort") {
      const reason = result.reason || "ukendt";
      if (reason === "already_configured") {
        return { ok: false, message: "Denne Shelly enhed er allerede konfigureret i Home Assistant" };
      }
      return { ok: false, message: `Afbrudt: ${reason}` };
    }

    return { ok: true, message: `Enhed tilføjet` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("timeout") || msg.includes("AbortError")) {
      return { ok: false, message: "Timeout — enheden svarer ikke. Tjek at IP-adressen er korrekt og enheden er på netværket." };
    }
    return { ok: false, message: `Fejl: ${msg}` };
  }
}

async function getHAConfigInternal(): Promise<{ url: string; token: string }> {
  const [urlSetting, tokenSetting] = await Promise.all([
    prisma.globalSetting.findUnique({ where: { key: "ha_url" } }),
    prisma.globalSetting.findUnique({ where: { key: "ha_token" } }),
  ]);
  if (!urlSetting?.value || !tokenSetting?.value) {
    throw new Error("Home Assistant URL or Token not configured");
  }
  return { url: urlSetting.value, token: tokenSetting.value };
}

// ──────────────────────────────────────────────
// LAUNDRY MACHINES — shared facility management
// ──────────────────────────────────────────────
export async function getLaundryMachines() {
  await requireAuth();
  return prisma.laundryMachine.findMany({
    orderBy: { name: "asc" },
    include: {
      sessions: {
        where: { status: "ACTIVE" },
        take: 1,
      },
      programs: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
    },
  });
}

export async function createLaundryMachine(data: {
  name: string;
  kind: string;
  source?: "HA" | "MQTT";
  switchEntityId?: string | null;
  mqttPrefix?: string | null;
  mqttComponent?: string | null;
  durationMinutes: number;
  pricePerUse: number;
  code?: string | null;
  location?: string | null;
  billingMode?: string;
  pricePerMinute?: number;
  powerThresholdW?: number;
  idleTimeoutMinutes?: number;
  maxReservationDKK?: number;
  powerEntityId?: string | null;
}) {
  await requireAuth();
  await prisma.laundryMachine.create({
    data: {
      name: data.name,
      kind: data.kind,
      source: data.source || "HA",
      switchEntityId: data.switchEntityId || null,
      mqttPrefix: data.mqttPrefix || null,
      mqttComponent: data.mqttComponent || null,
      durationMinutes: data.durationMinutes,
      pricePerUse: data.pricePerUse,
      code: data.code || null,
      location: data.location || null,
      billingMode: data.billingMode || "FIXED",
      pricePerMinute: data.pricePerMinute ?? 1,
      powerThresholdW: data.powerThresholdW ?? 10,
      idleTimeoutMinutes: data.idleTimeoutMinutes ?? 5,
      maxReservationDKK: data.maxReservationDKK ?? 150,
      powerEntityId: data.powerEntityId || null,
    },
  });
  revalidatePath("/admin/settings");
}

export async function updateLaundryMachine(id: number, data: {
  name: string;
  kind: string;
  source?: "HA" | "MQTT";
  switchEntityId?: string | null;
  mqttPrefix?: string | null;
  mqttComponent?: string | null;
  durationMinutes: number;
  pricePerUse: number;
  enabled: boolean;
  code?: string | null;
  location?: string | null;
  billingMode?: string;
  pricePerMinute?: number;
  powerThresholdW?: number;
  idleTimeoutMinutes?: number;
  maxReservationDKK?: number;
  powerEntityId?: string | null;
}) {
  await requireAuth();
  await prisma.laundryMachine.update({
    where: { id },
    data: {
      name: data.name,
      kind: data.kind,
      source: data.source || "HA",
      switchEntityId: data.switchEntityId || null,
      mqttPrefix: data.mqttPrefix || null,
      mqttComponent: data.mqttComponent || null,
      durationMinutes: data.durationMinutes,
      pricePerUse: data.pricePerUse,
      enabled: data.enabled,
      code: data.code || null,
      location: data.location || null,
      billingMode: data.billingMode || "FIXED",
      pricePerMinute: data.pricePerMinute ?? 1,
      powerThresholdW: data.powerThresholdW ?? 10,
      idleTimeoutMinutes: data.idleTimeoutMinutes ?? 5,
      maxReservationDKK: data.maxReservationDKK ?? 150,
      powerEntityId: data.powerEntityId || null,
    },
  });
  revalidatePath("/admin/settings");
}

export async function deleteLaundryMachine(id: number) {
  await requireAuth();
  await prisma.laundryMachine.delete({ where: { id } });
  revalidatePath("/admin/settings");
}

// ── Laundry Programs ───────────────────────────────────────────
export async function getLaundryPrograms(machineId: number) {
  await requireAuth();
  return prisma.laundryProgram.findMany({
    where: { machineId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
}

export async function createLaundryProgram(data: {
  machineId: number;
  name: string;
  durationMinutes: number;
  pricePerUse: number;
}) {
  await requireAuth();
  const last = await prisma.laundryProgram.findFirst({
    where: { machineId: data.machineId },
    orderBy: { sortOrder: "desc" },
  });
  await prisma.laundryProgram.create({
    data: {
      machineId: data.machineId,
      name: data.name,
      durationMinutes: data.durationMinutes,
      pricePerUse: data.pricePerUse,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
  revalidatePath("/admin/services");
}

export async function updateLaundryProgram(id: number, data: {
  name: string;
  durationMinutes: number;
  pricePerUse: number;
  enabled: boolean;
}) {
  await requireAuth();
  await prisma.laundryProgram.update({
    where: { id },
    data: {
      name: data.name,
      durationMinutes: data.durationMinutes,
      pricePerUse: data.pricePerUse,
      enabled: data.enabled,
    },
  });
  revalidatePath("/admin/services");
}

export async function deleteLaundryProgram(id: number) {
  await requireAuth();
  await prisma.laundryProgram.delete({ where: { id } });
  revalidatePath("/admin/services");
}

// Get laundry machines with status for guest portal
export async function getGuestLaundryMachines() {
  // Auto-expire stale PENDING sessions (older than 5 minutes)
  const pendingCutoff = new Date(Date.now() - PENDING_PAYMENT_TTL_MS);
  await prisma.laundrySess.updateMany({
    where: { status: "PENDING", createdAt: { lte: pendingCutoff } },
    data: { status: "CANCELLED" },
  });

  const machines = await prisma.laundryMachine.findMany({
    where: { enabled: true },
    orderBy: { name: "asc" },
    include: {
      sessions: {
        where: { status: "ACTIVE" },
        orderBy: { startedAt: "desc" },
        take: 1,
      },
      programs: {
        where: { enabled: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
    },
  });

  return machines.map((m) => {
    const activeSession = m.sessions[0] || null;
    const now = new Date();
    // Check if active session has expired
    const isRunning = activeSession && new Date(activeSession.endsAt) > now;
    const minutesLeft = isRunning
      ? Math.max(0, Math.round((new Date(activeSession.endsAt).getTime() - now.getTime()) / 60000))
      : 0;

    return {
      id: m.id,
      name: m.name,
      kind: (m.kind || "WASHER") as "WASHER" | "DRYER",
      location: m.location,
      durationMinutes: m.durationMinutes,
      pricePerUse: m.pricePerUse,
      billingMode: m.billingMode as "FIXED" | "METERED",
      pricePerMinute: m.pricePerMinute,
      maxReservationDKK: m.maxReservationDKK,
      available: !isRunning,
      minutesLeft,
      endsAt: isRunning ? activeSession.endsAt.toISOString() : null,
      startedAt: isRunning ? activeSession.startedAt.toISOString() : null,
      programs: m.programs.map((p) => ({
        id: p.id,
        name: p.name,
        durationMinutes: p.durationMinutes,
        pricePerUse: p.pricePerUse,
      })),
    };
  });
}

export async function getGuestShowers() {
  await expireStaleShowerPendings();

  const showers = await prisma.shower.findMany({
    where: { enabled: true },
    orderBy: [{ location: "asc" }, { name: "asc" }],
    include: {
      sessions: {
        where: { status: { in: ["ACTIVE", "PAUSED"] } },
        take: 1,
        orderBy: { startedAt: "desc" },
      },
    },
  });

  const now = new Date();
  return showers.map((s) => {
    const active = s.sessions[0] || null;
    const isBusy = !!active && new Date(active.endsAt) > now;
    const minutesLeft = isBusy
      ? Math.max(0, Math.round((new Date(active!.endsAt).getTime() - now.getTime()) / 60000))
      : 0;
    return {
      id: s.id,
      name: s.name,
      location: s.location,
      pricePerMinute: s.pricePerMinute,
      minMinutes: s.minMinutes,
      maxMinutes: s.maxMinutes,
      available: !isBusy,
      minutesLeft,
    };
  });
}

// Guest initiates laundry — creates payment, then starts after payment
export async function createLaundryPayment(
  machineId: number,
  guestPortalToken: string,
  programId?: number | null,
): Promise<{ ok: boolean; message: string; paymentLink?: string }> {
  // Auto-expire stale PENDING sessions before checking availability
  const pendingCutoff = new Date(Date.now() - PENDING_PAYMENT_TTL_MS);
  await prisma.laundrySess.updateMany({
    where: { machineId, status: "PENDING", createdAt: { lte: pendingCutoff } },
    data: { status: "CANCELLED" },
  });

  const machine = await prisma.laundryMachine.findUnique({
    where: { id: machineId },
    include: {
      sessions: { where: { status: "ACTIVE" }, take: 1 },
      programs: { where: { enabled: true } },
    },
  });

  if (!machine) return { ok: false, message: "Maskine ikke fundet" };
  if (!machine.enabled) return { ok: false, message: "Maskine er deaktiveret" };

  // Check if currently running
  const activeSession = machine.sessions[0];
  if (activeSession && new Date(activeSession.endsAt) > new Date()) {
    return { ok: false, message: "Maskinen er allerede i brug" };
  }

  // If old active session expired, mark it completed
  if (activeSession) {
    await prisma.laundrySess.update({
      where: { id: activeSession.id },
      data: { status: "COMPLETED" },
    });
  }

  // ── METERED billing mode — delegate to metered flow ──
  if (machine.billingMode === "METERED") {
    const settings = await readGlobalSettings();
    const baseUrl = getBaseUrl(settings);
    const returnPath = `/guest/${guestPortalToken}`;
    return createMeteredLaundryPaymentPortal(machine, guestPortalToken, returnPath, baseUrl, settings);
  }

  // ── FIXED billing mode (existing logic) ──
  let chosenProgram: { id: number; name: string; durationMinutes: number; pricePerUse: number } | null = null;
  if (machine.programs.length > 0) {
    if (!programId) return { ok: false, message: "Vælg et program" };
    const p = machine.programs.find((pp) => pp.id === programId);
    if (!p) return { ok: false, message: "Ugyldigt program" };
    chosenProgram = { id: p.id, name: p.name, durationMinutes: p.durationMinutes, pricePerUse: p.pricePerUse };
  }

  const guestSession = await prisma.session.findUnique({
    where: { guestPortalToken },
  });
  const price = chosenProgram ? chosenProgram.pricePerUse : machine.pricePerUse;
  const duration = chosenProgram ? chosenProgram.durationMinutes : machine.durationMinutes;

  // Credit first, then balance (PREPAID) or the stay's bill (ON_ACCOUNT),
  // otherwise card. Without card payments the guest pays at the desk — a
  // start is never recorded as paid when nothing was collected.
  const settings = await readGlobalSettings();
  const funding = planGuestFunding(price, guestSession, {
    cardEnabled: settings.quickpay_enabled === "true",
    servicesOnAccount: settings.postpaid_services_mode === "ON_ACCOUNT",
    payAtDeskMessage: `Betal i receptionen — så starter vi ${machine.name} for dig.`,
  });
  if (funding.kind === "BLOCKED") return { ok: false, message: funding.message };

  if (funding.kind !== "CARD") {
    return startFundedGuestLaundry(machine, {
      stayId: guestSession?.id ?? null,
      guestPortalToken,
      funding,
      duration,
      program: chosenProgram,
    });
  }

  // Card: PENDING until the QuickPay callback activates it. The credit part is
  // taken on activation, so an abandoned payment doesn't eat the guest's credit.
  const endsAt = new Date(Date.now() + duration * 60_000);
  const laundrySess = await prisma.laundrySess.create({
    data: {
      machineId,
      sessionId: guestSession?.id || null,
      guestPortalToken,
      endsAt,
      pricePaid: funding.amount,
      creditUsed: funding.creditUsed,
      durationMinutes: duration,
      programId: chosenProgram?.id ?? null,
      programName: chosenProgram?.name ?? null,
      status: "PENDING",
      paymentStatus: "UNPAID",
      paymentMethod: "QUICKPAY",
      // The QuickPay link is for price minus laundry credit; the callback
      // validates the paid amount against this, not the full price.
      chargedAmount: funding.amount,
    },
  });

  const baseUrl = getBaseUrl(settings);
  try {
    const { createPaymentLink, generateOrderId } = await import("./quickpay");
    const orderId = generateOrderId("L", laundrySess.id);

    const { paymentId, paymentLink } = await createPaymentLink({
      orderId,
      amount: funding.amount,
      currency: settings.currency || "DKK",
      continueUrl: `${baseUrl}/guest/${guestPortalToken}?laundry_paid=1`,
      cancelUrl: `${baseUrl}/guest/${guestPortalToken}?laundry_cancelled=1`,
      callbackUrl: `${baseUrl}/api/quickpay/callback`,
    });

    await prisma.laundrySess.update({
      where: { id: laundrySess.id },
      data: { paymentId: String(paymentId) },
    });

    const creditLabel = funding.creditUsed > 0 ? ` (${funding.creditUsed.toFixed(0)} DKK kredit brugt)` : "";
    return { ok: true, message: `Betaler ${funding.amount.toFixed(0)} DKK${creditLabel}...`, paymentLink };
  } catch (e) {
    await prisma.laundrySess.delete({ where: { id: laundrySess.id } });
    return { ok: false, message: `Betaling kunne ikke oprettes: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Start a guest laundry use that needs no card payment (credit, balance, on
 * the stay's bill, or a 0 DKK program). The relay is switched on first: a
 * machine that doesn't start must not cost anything. Money is then drawn and
 * the row created in one transaction; if that fails, the relay goes off again.
 */
async function startFundedGuestLaundry(
  machine: { id: number; name: string; source: string; switchEntityId: string | null; mqttPrefix: string | null; mqttComponent: string | null },
  p: {
    stayId: number | null;
    guestPortalToken: string;
    funding: Exclude<FundedGuestFunding, { kind: "CARD" }>;
    duration: number;
    program: { id: number; name: string } | null;
  },
): Promise<{ ok: boolean; message: string }> {
  const ep = hardware.switchRowEp(machine);
  const programLabel = p.program ? ` (${p.program.name})` : "";
  try {
    await hardware.setSwitchTimed(ep, p.duration * 60 + 120);
  } catch (e) {
    logger.error("laundry", `${machine.name}: kunne ikke tænde ved gæstestart`, e);
    return { ok: false, message: `${machine.name} kunne ikke startes — kontakt receptionen. Der er ikke trukket noget.` };
  }

  const f = p.funding;
  try {
    await prisma.$transaction(async (tx) => {
      if (p.stayId) await drawStayFunds(tx, p.stayId, f);
      const row = await tx.laundrySess.create({
        data: {
          machineId: machine.id,
          sessionId: p.stayId,
          guestPortalToken: p.guestPortalToken,
          endsAt: new Date(Date.now() + p.duration * 60_000),
          pricePaid: f.amount,
          creditUsed: f.creditUsed,
          durationMinutes: p.duration,
          programId: p.program?.id ?? null,
          programName: p.program?.name ?? null,
          status: "ACTIVE",
          ...fundingPaymentFields(f),
        },
      });
      if (p.stayId) await logCreditUse(tx, p.stayId, f.creditUsed, `laundry:${row.id}`, `${machine.name}${programLabel}`);
    });
  } catch (e) {
    try { await hardware.setSwitch(ep, false); } catch { /* best effort — the device timer still ends it */ }
    if (e instanceof InsufficientFunds) return { ok: false, message: "Saldoen eller kreditten slår ikke til længere — prøv igen" };
    logger.error("laundry", `${machine.name}: gæstestart kunne ikke gemmes`, e);
    return { ok: false, message: "Maskinen kunne ikke startes — prøv igen" };
  }

  return { ok: true, message: `${machine.name}${programLabel} startet — kører i ${p.duration} minutter (${fundingNote(f)})` };
}

// Start a laundry machine after payment is confirmed (called from callback)
/** Auth-guarded entry point (server action). Cron/webhooks call it inside
 *  runWithApiAuth; in-module callers use activateLaundrySessionInternal directly. */
export async function activateLaundrySession(...args: Parameters<typeof activateLaundrySessionInternal>) {
  await requireAuth();
  return activateLaundrySessionInternal(...args);
}

async function activateLaundrySessionInternal(laundrySessionId: number) {
  const sess = await prisma.laundrySess.findUnique({
    where: { id: laundrySessionId },
    include: { machine: true },
  });
  if (!sess || sess.status !== "PENDING") return;

  if (sess.billingMode === "METERED") {
    // Metered: relay opens, max 4h hardware safety, cron monitors power
    const maxHours = 4;
    const endsAt = new Date(Date.now() + maxHours * 60 * 60 * 1000);
    await prisma.laundrySess.update({
      where: { id: laundrySessionId },
      // startedAt = activation, so the "no power within 10 min" auto-cancel
      // doesn't count the time the guest spent on the payment page.
      data: { status: "ACTIVE", paymentStatus: "PAID", paymentMethod: "QUICKPAY", endsAt, startedAt: new Date() },
    });
    try {
      await hardware.setSwitchTimed(hardware.switchRowEp(sess.machine), maxHours * 3600);
    } catch (e) {
      logger.error("laundry", "Failed to turn on metered laundry machine", e);
    }
    return;
  }

  // Fixed: use snapshotted duration from the session
  const duration = sess.durationMinutes > 0 ? sess.durationMinutes : sess.machine.durationMinutes;
  const endsAt = new Date();
  endsAt.setMinutes(endsAt.getMinutes() + duration);

  await prisma.laundrySess.update({
    where: { id: laundrySessionId },
    data: { status: "ACTIVE", paymentStatus: "PAID", paymentMethod: "QUICKPAY", endsAt },
  });
  await takeCreditOnCardActivation("laundry", sess.id, sess.sessionId, sess.creditUsed, sess.machine.name);

  try {
    const autoOffSec = duration * 60 + 120;
    await hardware.setSwitchTimed(hardware.switchRowEp(sess.machine), autoOffSec);
  } catch (e) {
    logger.error("laundry", "Failed to turn on laundry machine", e);
  }
}

/**
 * A card start that also used service credit: the credit is taken once the
 * card payment is through, not when the link was made, so an abandoned
 * payment doesn't cost the guest their credit.
 */
async function takeCreditOnCardActivation(
  kind: "laundry" | "shower",
  rowId: number,
  stayId: number | null,
  creditUsed: number,
  label: string,
) {
  if (!stayId || creditUsed <= 0) return;
  try {
    await prisma.$transaction(async (tx) => {
      await drawStayFunds(tx, stayId, { kind: "CREDIT", creditUsed, amount: 0 });
      await logCreditUse(tx, stayId, creditUsed, `${kind}:${rowId}`, label);
    });
  } catch (e) {
    logger.warn(kind, `${kind}:${rowId}: ${creditUsed} DKK kredit kunne ikke trækkes ved kortaktivering`, e instanceof Error ? e.message : e);
  }
}

// Prepaid top-up: guest buys extra power
export async function createPrepaidTopUp(
  sessionId: number,
  portalToken: string,
  amount: number,
): Promise<{ ok: boolean; message: string; paymentLink?: string }> {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return { ok: false, message: "Session ikke fundet" };
  if (session.guestPortalToken !== portalToken) return { ok: false, message: "Ugyldigt token" };
  if (session.billingMode !== "PREPAID") return { ok: false, message: "Kun for forudbetalte ophold" };
  if (amount <= 0) return { ok: false, message: "Ugyldigt beløb" };

  const settings = await readGlobalSettings();
  if (settings.quickpay_enabled !== "true") {
    return { ok: false, message: "Online betaling er ikke aktiveret" };
  }

  const baseUrl = getBaseUrl(settings);

  try {
    const { createPaymentLink, generateOrderId } = await import("./quickpay");
    const orderId = generateOrderId("T", sessionId); // T for Top-up

    const { paymentId, paymentLink } = await createPaymentLink({
      orderId,
      amount,
      currency: settings.currency || "DKK",
      continueUrl: `${baseUrl}/guest/${portalToken}?topup_paid=1`,
      cancelUrl: `${baseUrl}/guest/${portalToken}?topup_cancelled=1`,
      callbackUrl: `${baseUrl}/api/quickpay/callback`,
    });

    // Store the top-up payment ID temporarily in notes (we'll process in callback)
    // We prefix with TOPUP: so callback can identify it
    await prisma.session.update({
      where: { id: sessionId },
      data: { notes: `${session.notes || ""}${session.notes ? "\n" : ""}TOPUP:${paymentId}:${amount}` },
    });

    return { ok: true, message: "Videresendes til betaling...", paymentLink };
  } catch (e) {
    return { ok: false, message: `Betaling kunne ikke oprettes: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// Called by cron to turn off expired laundry machines
/** Auth-guarded entry point (server action). Cron/webhooks call it inside
 *  runWithApiAuth; in-module callers use checkLaundryMachinesInternal directly. */
export async function checkLaundryMachines(...args: Parameters<typeof checkLaundryMachinesInternal>) {
  await requireAuth();
  return checkLaundryMachinesInternal(...args);
}

/**
 * Housekeeping (cron, nightly): ConsumptionLog gets a row per metered unit
 * every 10 minutes and `_meter_fail_<context>` keys are created per session,
 * so both grow without bound otherwise.
 */
export async function cleanupOldData() {
  await requireAuth();
  const logCutoff = new Date(Date.now() - 400 * 24 * 3600_000);
  const failCutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const logs = await prisma.consumptionLog.deleteMany({ where: { recordedAt: { lt: logCutoff } } });
  const fails = await prisma.globalSetting.deleteMany({
    where: { key: { startsWith: "_meter_fail_" }, value: { lt: failCutoff } },
  });
  // Last, so a failure here can't stop the cleanup above.
  const mcp = await cleanupMcpOAuth();
  return {
    consumptionLogs: logs.count,
    meterFailKeys: fails.count,
    mcpCodes: mcp.codes,
    mcpTokens: mcp.tokens,
    mcpClients: mcp.clients,
  };
}

// How long an expiry sweep keeps retrying a relay that won't switch off
// before completing the session anyway (and logging it for manual action).
const RELAY_OFF_RETRY_MS = 30 * 60_000;

async function checkLaundryMachinesInternal() {
  // Fixed-mode sessions: turn off when endsAt passes
  const expired = await prisma.laundrySess.findMany({
    where: {
      status: "ACTIVE",
      billingMode: "FIXED",
      endsAt: { lte: new Date() },
    },
    include: { machine: true },
  });

  for (const session of expired) {
    try {
      await hardware.setSwitch(hardware.switchRowEp(session.machine), false);
    } catch (e) {
      // Leave it ACTIVE so the next sweep retries — HA relays have no
      // on-device safety timer. Give up after RELAY_OFF_RETRY_MS.
      const overdueMs = Date.now() - session.endsAt.getTime();
      logger.error("laundry", `Failed to turn off laundry machine ${session.machine.name}${overdueMs < RELAY_OFF_RETRY_MS ? " — prøver igen" : " — giver op, sluk manuelt"}`, e);
      if (overdueMs < RELAY_OFF_RETRY_MS) continue;
    }
    await prisma.laundrySess.updateMany({
      where: { id: session.id, status: "ACTIVE" },
      data: { status: "COMPLETED" },
    });
  }

  // Metered sessions: tick power monitoring
  const meteredResult = await tickMeteredLaundryInternal();

  // Safety: force-complete metered sessions past their 4h safety timeout
  const meteredExpired = await prisma.laundrySess.findMany({
    where: {
      status: "ACTIVE",
      billingMode: "METERED",
      endsAt: { lte: new Date() },
    },
    include: { machine: true },
  });
  for (const sess of meteredExpired) {
    await completeMeteredSession(sess);
  }

  // Auto-expire PENDING laundry sessions older than 5 minutes
  const pendingCutoff = new Date(Date.now() - PENDING_PAYMENT_TTL_MS);
  const expiredPending = await prisma.laundrySess.updateMany({
    where: {
      status: "PENDING",
      createdAt: { lte: pendingCutoff },
    },
    data: { status: "CANCELLED" },
  });

  return { turned_off: expired.length, expired_pending: expiredPending.count, metered: meteredResult };
}

// ──────────────────────────────────────────────
// SERVICES — Admin control (overview, "Start for gæst", refunds and history
// live in service-actions.ts)
// ──────────────────────────────────────────────
/**
 * "Forlæng" from the desk. A fixed wash runs on the Shelly's own auto-off
 * timer, so moving endsAt alone cut the power at the original time while the
 * card still said "Kører" — re-arm the device first, and only extend if it
 * confirmed. Free of charge (a courtesy, like the old button).
 */
export async function adminExtendLaundry(laundrySessionId: number, extraMinutes: number) {
  const auth = await requireAuth();
  const extra = Math.round(Number(extraMinutes));
  if (!Number.isFinite(extra) || extra < 1 || extra > 240) return { ok: false, message: "Ugyldigt antal minutter" };
  const sess = await prisma.laundrySess.findUnique({ where: { id: laundrySessionId }, include: { machine: true } });
  if (!sess || sess.status !== "ACTIVE") return { ok: false, message: "Ingen aktiv session" };
  if (sess.billingMode === "METERED") {
    return { ok: false, message: "En målt vask kører til maskinen er færdig — den skal ikke forlænges" };
  }

  // From now if the end has already passed (the sweep may not have run yet).
  const base = Math.max(Date.now(), sess.endsAt.getTime());
  const newEndsAt = new Date(base + extra * 60_000);
  const remainingSec = Math.ceil((newEndsAt.getTime() - Date.now()) / 1000);
  try {
    await hardware.setSwitchTimed(hardware.switchRowEp(sess.machine), remainingSec + 120);
  } catch (e) {
    return {
      ok: false,
      message: `Kunne ikke forlænge — ${sess.machine.name} svarede ikke (${e instanceof Error ? e.message : "offline?"}). Sluttiden er uændret.`,
    };
  }

  const res = await prisma.laundrySess.updateMany({
    where: { id: laundrySessionId, status: "ACTIVE" },
    data: { endsAt: newEndsAt, durationMinutes: sess.durationMinutes + extra },
  });
  if (res.count === 0) return { ok: false, message: "Vasken er afsluttet imens" };
  logger.info("laundry", `${sess.machine.name} (laundry:${sess.id}) forlænget ${extra} min af ${auth.username ?? "?"}`);
  return { ok: true, message: `Forlænget med ${extra} minutter` };
}

export async function adminStopLaundry(laundrySessionId: number) {
  const auth = await requireAuth();
  const sess = await prisma.laundrySess.findUnique({
    where: { id: laundrySessionId },
    include: { machine: true },
  });
  if (!sess) return { ok: false, message: "Session ikke fundet" };

  // A metered wash is settled on completion (final price, refund of the rest).
  if (sess.billingMode === "METERED" && sess.status === "ACTIVE") {
    await completeMeteredSession(sess);
    logger.info("laundry", `${sess.machine.name} (laundry:${sess.id}) stoppet af ${auth.username ?? "?"}`);
    return { ok: true, message: "Maskine stoppet — forbruget er afregnet" };
  }
  // Only a running wash — never turn a cancelled (refunded) one into COMPLETED.
  const res = await prisma.laundrySess.updateMany({
    where: { id: laundrySessionId, status: "ACTIVE" },
    data: { status: "COMPLETED", endsAt: new Date() },
  });
  if (res.count === 0) return { ok: false, message: "Maskinen kører ikke" };
  logger.info("laundry", `${sess.machine.name} (laundry:${sess.id}) stoppet af ${auth.username ?? "?"}`);

  try {
    await hardware.setSwitch(hardware.switchRowEp(sess.machine), false);
  } catch (e) {
    return { ok: false, message: `Stoppet — men relæet svarede ikke, sluk manuelt (${e instanceof Error ? e.message : String(e)})` };
  }

  return { ok: true, message: "Maskine stoppet" };
}

// Service credit (laundry and showers) is added/removed with a trace in
// service-actions.ts (addServiceCredit / removeServiceCredit).

export async function getSessionLaundryCredit(sessionId: number): Promise<number> {
  await requireAuth();
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { laundryCredit: true } });
  return session?.laundryCredit ?? 0;
}

// ══════════════════════════════════════════════
//  Laundry Groups — QR code grouping
// ══════════════════════════════════════════════

export async function getLaundryGroups() {
  await requireAuth();
  return prisma.laundryGroup.findMany({
    include: { machines: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function createLaundryGroup(name: string, machineIds: number[]) {
  "use server";
  await requireAuth();
  const token = uuidv4().replace(/-/g, "").slice(0, 12);
  const group = await prisma.laundryGroup.create({
    data: { name, token },
  });
  if (machineIds.length > 0) {
    await prisma.laundryMachine.updateMany({
      where: { id: { in: machineIds } },
      data: { groupId: group.id },
    });
  }
  return group;
}

export async function updateLaundryGroup(groupId: number, name: string, machineIds: number[]) {
  "use server";
  await requireAuth();
  await prisma.laundryGroup.update({
    where: { id: groupId },
    data: { name },
  });
  // Remove all machines from this group first
  await prisma.laundryMachine.updateMany({
    where: { groupId },
    data: { groupId: null },
  });
  // Assign selected machines
  if (machineIds.length > 0) {
    await prisma.laundryMachine.updateMany({
      where: { id: { in: machineIds } },
      data: { groupId },
    });
  }
}

export async function deleteLaundryGroup(groupId: number) {
  "use server";
  await requireAuth();
  // Unlink machines first
  await prisma.laundryMachine.updateMany({
    where: { groupId },
    data: { groupId: null },
  });
  await prisma.laundryGroup.delete({ where: { id: groupId } });
}

// Public: get machines in a group by token (no auth needed)
export async function getPublicLaundryGroup(token: string) {
  // Auto-expire stale PENDING sessions (older than 5 minutes)
  const pendingCutoff = new Date(Date.now() - PENDING_PAYMENT_TTL_MS);
  await prisma.laundrySess.updateMany({
    where: { status: "PENDING", createdAt: { lte: pendingCutoff } },
    data: { status: "CANCELLED" },
  });

  const group = await prisma.laundryGroup.findUnique({
    where: { token },
    include: {
      machines: {
        where: { enabled: true },
        include: {
          sessions: { where: { status: "ACTIVE" }, take: 1 },
          programs: {
            where: { enabled: true },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!group) return null;

  const now = new Date();
  return {
    id: group.id,
    name: group.name,
    // QR guests have no stay to charge: without card payments they pay at the desk
    cardPayment: (await readGlobalSettings()).quickpay_enabled === "true",
    machines: group.machines.map((m) => {
      const active = m.sessions[0];
      const isRunning = active && new Date(active.endsAt) > now;
      const minutesLeft = isRunning ? Math.max(0, Math.ceil((new Date(active.endsAt).getTime() - now.getTime()) / 60000)) : 0;
      return {
        id: m.id,
        name: m.name,
        kind: m.kind,
        durationMinutes: m.durationMinutes,
        pricePerUse: m.pricePerUse,
        billingMode: m.billingMode as "FIXED" | "METERED",
        pricePerMinute: m.pricePerMinute,
        maxReservationDKK: m.maxReservationDKK,
        available: !isRunning,
        minutesLeft,
        endsAt: isRunning ? active!.endsAt.toISOString() : null,
        programs: m.programs.map((p) => ({
          id: p.id,
          name: p.name,
          durationMinutes: p.durationMinutes,
          pricePerUse: p.pricePerUse,
        })),
      };
    }),
  };
}

// Public: get a single machine for the per-machine QR flow
export async function getPublicLaundryMachine(machineId: number) {
  // Auto-expire stale PENDING sessions older than 5 minutes
  const pendingCutoff = new Date(Date.now() - PENDING_PAYMENT_TTL_MS);
  await prisma.laundrySess.updateMany({
    where: { machineId, status: "PENDING", createdAt: { lte: pendingCutoff } },
    data: { status: "CANCELLED" },
  });

  const machine = await prisma.laundryMachine.findUnique({
    where: { id: machineId },
    include: {
      sessions: { where: { status: "ACTIVE" }, take: 1 },
      programs: {
        where: { enabled: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!machine || !machine.enabled) return null;

  const now = new Date();
  const active = machine.sessions[0];
  const isRunning = active && new Date(active.endsAt) > now;
  const minutesLeft = isRunning ? Math.max(0, Math.ceil((new Date(active.endsAt).getTime() - now.getTime()) / 60000)) : 0;

  return {
    id: machine.id,
    name: machine.name,
    kind: machine.kind,
    location: machine.location,
    durationMinutes: machine.durationMinutes,
    pricePerUse: machine.pricePerUse,
    billingMode: machine.billingMode as "FIXED" | "METERED",
    pricePerMinute: machine.pricePerMinute,
    maxReservationDKK: machine.maxReservationDKK,
    available: !isRunning,
    minutesLeft,
    endsAt: isRunning ? active!.endsAt.toISOString() : null,
    programs: machine.programs.map((p) => ({
      id: p.id,
      name: p.name,
      durationMinutes: p.durationMinutes,
      pricePerUse: p.pricePerUse,
    })),
    cardPayment: (await readGlobalSettings()).quickpay_enabled === "true",
  };
}

// Public: start a laundry machine from QR page (no guest session required).
// `returnToken` is a free-form string used both as the QR identifier on the
// session (for traceability) and to build the QuickPay continue/cancel URLs.
// Pass `"machine:<id>"` for the per-machine QR route.
export async function createPublicLaundryPayment(
  machineId: number,
  returnToken: string,
  programId?: number | null,
): Promise<{ ok: boolean; message: string; paymentLink?: string }> {
  // Auto-expire stale PENDING sessions before checking availability
  const pendingCutoff = new Date(Date.now() - PENDING_PAYMENT_TTL_MS);
  await prisma.laundrySess.updateMany({
    where: { machineId, status: "PENDING", createdAt: { lte: pendingCutoff } },
    data: { status: "CANCELLED" },
  });

  const machine = await prisma.laundryMachine.findUnique({
    where: { id: machineId },
    include: {
      sessions: { where: { status: "ACTIVE" }, take: 1 },
      programs: { where: { enabled: true } },
    },
  });

  if (!machine) return { ok: false, message: "Maskine ikke fundet" };
  if (!machine.enabled) return { ok: false, message: "Maskine er deaktiveret" };

  // Check if currently running
  const activeSession = machine.sessions[0];
  if (activeSession && new Date(activeSession.endsAt) > new Date()) {
    return { ok: false, message: "Maskinen er allerede i brug" };
  }

  // Clean up expired active sessions
  if (activeSession) {
    await prisma.laundrySess.update({
      where: { id: activeSession.id },
      data: { status: "COMPLETED" },
    });
  }

  const settings = await readGlobalSettings();
  const baseUrl = getBaseUrl(settings);
  const returnPath = returnToken.startsWith("machine:")
    ? `/laundry/machine/${returnToken.slice("machine:".length)}`
    : `/laundry/${returnToken}`;

  // ── METERED billing mode ──
  if (machine.billingMode === "METERED") {
    return createMeteredLaundryPayment(machine, returnToken, returnPath, baseUrl, settings);
  }

  // ── FIXED billing mode (existing logic) ──
  let chosenProgram: { id: number; name: string; durationMinutes: number; pricePerUse: number } | null = null;
  if (machine.programs.length > 0) {
    if (!programId) return { ok: false, message: "Vælg et program" };
    const p = machine.programs.find((pp) => pp.id === programId);
    if (!p) return { ok: false, message: "Ugyldigt program" };
    chosenProgram = { id: p.id, name: p.name, durationMinutes: p.durationMinutes, pricePerUse: p.pricePerUse };
  }

  const price = chosenProgram ? chosenProgram.pricePerUse : machine.pricePerUse;
  const duration = chosenProgram ? chosenProgram.durationMinutes : machine.durationMinutes;
  const endsAt = new Date();
  endsAt.setMinutes(endsAt.getMinutes() + duration);

  // No stay behind a QR scan: card, or pay at the desk.
  const funding = planGuestFunding(price, null, {
    cardEnabled: settings.quickpay_enabled === "true",
    servicesOnAccount: false,
    payAtDeskMessage: `Betal i receptionen — så starter vi ${machine.name} for dig.`,
  });
  if (funding.kind === "BLOCKED") return { ok: false, message: funding.message };
  if (funding.kind !== "CARD") {
    return startFundedGuestLaundry(machine, {
      stayId: null,
      guestPortalToken: `qr:${returnToken}`,
      funding,
      duration,
      program: chosenProgram,
    });
  }

  const laundrySess = await prisma.laundrySess.create({
    data: {
      machineId,
      guestPortalToken: `qr:${returnToken}`,
      endsAt,
      pricePaid: price,
      durationMinutes: duration,
      programId: chosenProgram?.id ?? null,
      programName: chosenProgram?.name ?? null,
      status: "PENDING",
      paymentStatus: "UNPAID",
      paymentMethod: "QUICKPAY",
    },
  });

  try {
    const { createPaymentLink, generateOrderId } = await import("./quickpay");
    const orderId = generateOrderId("L", laundrySess.id);

    const { paymentId, paymentLink } = await createPaymentLink({
      orderId,
      amount: price,
      currency: settings.currency || "DKK",
      continueUrl: `${baseUrl}${returnPath}?paid=1`,
      cancelUrl: `${baseUrl}${returnPath}?cancelled=1`,
      callbackUrl: `${baseUrl}/api/quickpay/callback`,
    });

    await prisma.laundrySess.update({
      where: { id: laundrySess.id },
      data: { paymentId: String(paymentId) },
    });

    return { ok: true, message: "Går til betaling...", paymentLink };
  } catch (e) {
    await prisma.laundrySess.delete({ where: { id: laundrySess.id } });
    return { ok: false, message: `Betaling kunne ikke oprettes: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// Metered: create a pre-authorized payment for max reservation, relay opens after payment
async function createMeteredLaundryPayment(
  machine: { id: number; name: string; pricePerMinute: number; maxReservationDKK: number; source: string; switchEntityId: string | null; mqttPrefix: string | null; mqttComponent: string | null },
  returnToken: string,
  returnPath: string,
  baseUrl: string,
  settings: Record<string, string>,
): Promise<{ ok: boolean; message: string; paymentLink?: string }> {
  const { randomUUID } = await import("crypto");
  const accessToken = randomUUID().replace(/-/g, "");
  const maxHours = 4;
  const endsAt = new Date(Date.now() + maxHours * 60 * 60 * 1000);

  // Without card payments a QR guest has no way to pay — never start for free.
  if (settings.quickpay_enabled !== "true") {
    return { ok: false, message: `Betal i receptionen — så starter vi ${machine.name} for dig.` };
  }

  const sess = await prisma.laundrySess.create({
    data: {
      machineId: machine.id,
      guestPortalToken: `qr:${returnToken}`,
      accessToken,
      endsAt,
      pricePaid: 0,
      billingMode: "METERED",
      pricePerMinute: machine.pricePerMinute,
      reservedAmount: machine.maxReservationDKK,
      status: "PENDING",
      paymentStatus: "UNPAID",
      paymentMethod: "QUICKPAY",
    },
  });

  try {
    const { createAuthPaymentLink, generateOrderId } = await import("./quickpay");
    const orderId = generateOrderId("M", sess.id);

    const { paymentId, paymentLink } = await createAuthPaymentLink({
      orderId,
      amount: machine.maxReservationDKK,
      currency: settings.currency || "DKK",
      continueUrl: `${baseUrl}/laundry/meter/${accessToken}`,
      cancelUrl: `${baseUrl}${returnPath}?cancelled=1`,
      callbackUrl: `${baseUrl}/api/quickpay/callback`,
    });

    await prisma.laundrySess.update({
      where: { id: sess.id },
      data: { paymentId: String(paymentId) },
    });

    return { ok: true, message: "Går til betaling...", paymentLink };
  } catch (e) {
    await prisma.laundrySess.delete({ where: { id: sess.id } });
    return { ok: false, message: `Betaling kunne ikke oprettes: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// Metered: create payment from guest portal (linked to guest session)
async function createMeteredLaundryPaymentPortal(
  machine: { id: number; name: string; pricePerMinute: number; maxReservationDKK: number; source: string; switchEntityId: string | null; mqttPrefix: string | null; mqttComponent: string | null },
  guestPortalToken: string,
  returnPath: string,
  baseUrl: string,
  settings: Record<string, string>,
): Promise<{ ok: boolean; message: string; paymentLink?: string }> {
  const { randomUUID } = await import("crypto");
  const accessToken = randomUUID().replace(/-/g, "");
  const maxHours = 4;
  const endsAt = new Date(Date.now() + maxHours * 60 * 60 * 1000);

  const guestSession = await prisma.session.findUnique({ where: { guestPortalToken } });
  const stay = guestSession?.status === "ACTIVE" ? guestSession : null;

  // PREPAID guests reserve from balance instead of QuickPay pre-auth; a
  // POSTPAID stay with services on account gets the final price on its bill.
  // The reservation is refunded (partially) in completeMeteredSession.
  const reserve = machine.maxReservationDKK;
  const viaStay: "PREPAID" | "ON_ACCOUNT" | null =
    stay?.billingMode === "PREPAID" ? "PREPAID"
      : stay && settings.postpaid_services_mode === "ON_ACCOUNT" ? "ON_ACCOUNT"
      : null;
  if (stay && viaStay) {
    const remaining = stay.prepaidAmount ?? 0;
    if (viaStay === "PREPAID" && remaining < reserve) {
      return { ok: false, message: `Utilstrækkelig saldo — behøver ${reserve.toFixed(0)} DKK reservation, har ${remaining.toFixed(0)} DKK` };
    }
    // Relay first — a machine that doesn't start must not hold the guest's money.
    const ep = hardware.switchRowEp(machine);
    try {
      await hardware.setSwitchTimed(ep, maxHours * 3600);
    } catch (e) {
      logger.error("laundry", `${machine.name}: kunne ikke tænde (målt vask)`, e);
      return { ok: false, message: `${machine.name} kunne ikke startes — kontakt receptionen. Der er ikke trukket noget.` };
    }
    // Reservation and session row in one transaction: a failed create must
    // not leave the balance decremented with nothing to refund it.
    const sess = await prisma.$transaction(async (tx) => {
      if (viaStay === "PREPAID") {
        const res = await tx.session.updateMany({
          where: { id: stay.id, prepaidAmount: { gte: reserve } },
          data: { prepaidAmount: { decrement: reserve } },
        });
        if (res.count === 0) return null;
      }
      return tx.laundrySess.create({
        data: {
          machineId: machine.id,
          sessionId: stay.id,
          guestPortalToken,
          accessToken,
          endsAt,
          pricePaid: 0,
          billingMode: "METERED",
          pricePerMinute: machine.pricePerMinute,
          reservedAmount: reserve,
          status: "ACTIVE",
          paymentStatus: viaStay,
          paymentMethod: viaStay === "PREPAID" ? "BALANCE" : "ACCOUNT",
        },
      });
    });
    if (!sess) {
      try { await hardware.setSwitch(ep, false); } catch { /* device timer still ends it */ }
      return { ok: false, message: `Utilstrækkelig saldo — behøver ${reserve.toFixed(0)} DKK reservation, har ${remaining.toFixed(0)} DKK` };
    }
    const how = viaStay === "PREPAID" ? `${reserve.toFixed(0)} DKK reserveret fra saldo` : "prisen skrives på regningen";
    return { ok: true, message: `${machine.name} startet — ${how}`, paymentLink: `${baseUrl}/laundry/meter/${sess.accessToken}` };
  }

  if (settings.quickpay_enabled !== "true") {
    return { ok: false, message: `Betal i receptionen — så starter vi ${machine.name} for dig.` };
  }

  const sess = await prisma.laundrySess.create({
    data: {
      machineId: machine.id,
      sessionId: guestSession?.id ?? null,
      guestPortalToken,
      accessToken,
      endsAt,
      pricePaid: 0,
      billingMode: "METERED",
      pricePerMinute: machine.pricePerMinute,
      reservedAmount: machine.maxReservationDKK,
      status: "PENDING",
      paymentStatus: "UNPAID",
      paymentMethod: "QUICKPAY",
    },
  });

  try {
    const { createAuthPaymentLink, generateOrderId } = await import("./quickpay");
    const orderId = generateOrderId("M", sess.id);

    const { paymentId, paymentLink } = await createAuthPaymentLink({
      orderId,
      amount: machine.maxReservationDKK,
      currency: settings.currency || "DKK",
      continueUrl: `${baseUrl}/laundry/meter/${accessToken}`,
      cancelUrl: `${baseUrl}${returnPath}?laundry_cancelled=1`,
      callbackUrl: `${baseUrl}/api/quickpay/callback`,
    });

    await prisma.laundrySess.update({
      where: { id: sess.id },
      data: { paymentId: String(paymentId) },
    });

    return { ok: true, message: "Går til betaling...", paymentLink };
  } catch (e) {
    await prisma.laundrySess.delete({ where: { id: sess.id } });
    return { ok: false, message: `Betaling kunne ikke oprettes: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ══════════════════════════════════════════════════════════════════
//  SHOWERS — Shared facility with per-minute billing + pause timer
// ══════════════════════════════════════════════════════════════════

const PAUSE_MAX_MS = 5 * 60 * 1000;      // 5 minutes max pause
const PAUSE_COOLDOWN_MS = 10 * 1000;     // 10 s between pauses
const SHOWER_WARMUP_MS = 10 * 1000;      // 10 s warmup before relay turns on

// ── Admin CRUD ────────────────────────────────────────────────
export async function getShowers() {
  await requireAuth();
  return prisma.shower.findMany({
    orderBy: { name: "asc" },
    include: {
      sessions: {
        where: { status: { in: ["ACTIVE", "PAUSED", "PENDING"] } },
        take: 1,
        orderBy: { startedAt: "desc" },
      },
    },
  });
}

export async function createShower(data: {
  name: string;
  source?: "HA" | "MQTT";
  switchEntityId?: string | null;
  mqttPrefix?: string | null;
  mqttComponent?: string | null;
  pricePerMinute: number;
  minMinutes: number;
  maxMinutes: number;
  code: string | null;
  location: string | null;
}) {
  await requireAuth();
  await prisma.shower.create({
    data: {
      name: data.name,
      source: data.source || "HA",
      switchEntityId: data.switchEntityId || null,
      mqttPrefix: data.mqttPrefix || null,
      mqttComponent: data.mqttComponent || null,
      pricePerMinute: data.pricePerMinute,
      minMinutes: data.minMinutes,
      maxMinutes: data.maxMinutes,
      code: data.code,
      location: data.location,
    },
  });
  revalidatePath("/admin/settings");
  revalidatePath("/admin/services");
}

export async function updateShower(id: number, data: {
  name: string;
  source?: "HA" | "MQTT";
  switchEntityId?: string | null;
  mqttPrefix?: string | null;
  mqttComponent?: string | null;
  pricePerMinute: number;
  minMinutes: number;
  maxMinutes: number;
  enabled: boolean;
  code: string | null;
  location: string | null;
}) {
  await requireAuth();
  await prisma.shower.update({
    where: { id },
    data: {
      name: data.name,
      source: data.source || "HA",
      switchEntityId: data.switchEntityId || null,
      mqttPrefix: data.mqttPrefix || null,
      mqttComponent: data.mqttComponent || null,
      pricePerMinute: data.pricePerMinute,
      minMinutes: data.minMinutes,
      maxMinutes: data.maxMinutes,
      enabled: data.enabled,
      code: data.code,
      location: data.location,
    },
  });
  revalidatePath("/admin/settings");
  revalidatePath("/admin/services");
}

export async function deleteShower(id: number) {
  await requireAuth();
  await prisma.shower.delete({ where: { id } });
  revalidatePath("/admin/settings");
  revalidatePath("/admin/services");
}

// ── Public lookup ─────────────────────────────────────────────
export async function getPublicShower(showerId: number) {
  await expireStaleShowerPendings();
  const shower = await prisma.shower.findUnique({
    where: { id: showerId },
    include: {
      sessions: {
        where: { status: { in: ["ACTIVE", "PAUSED"] } },
        take: 1,
        orderBy: { startedAt: "desc" },
      },
    },
  });
  if (!shower || !shower.enabled) return null;

  const now = new Date();
  const active = shower.sessions[0];
  const isBusy = !!active && (
    (active.status === "ACTIVE" && new Date(active.endsAt) > now) ||
    active.status === "PAUSED"
  );

  return {
    id: shower.id,
    name: shower.name,
    location: shower.location,
    pricePerMinute: shower.pricePerMinute,
    minMinutes: shower.minMinutes,
    maxMinutes: shower.maxMinutes,
    available: !isBusy,
    // Without card payments only a guest with a stay (portal link) can start one
    cardPayment: (await readGlobalSettings()).quickpay_enabled === "true",
  };
}

// Public overview of every service, grouped
export async function getPublicServices() {
  const [showers, laundry] = await Promise.all([
    prisma.shower.findMany({ where: { enabled: true }, orderBy: [{ location: "asc" }, { name: "asc" }] }),
    prisma.laundryMachine.findMany({ where: { enabled: true }, orderBy: [{ location: "asc" }, { name: "asc" }], include: { group: true } }),
  ]);
  return {
    showers: showers.map((s) => ({
      id: s.id,
      name: s.name,
      location: s.location,
      pricePerMinute: s.pricePerMinute,
      minMinutes: s.minMinutes,
      maxMinutes: s.maxMinutes,
      code: s.code,
    })),
    washers: laundry.filter((m) => m.kind === "WASHER").map((m) => ({
      id: m.id,
      name: m.name,
      location: m.location,
      pricePerUse: m.pricePerUse,
      durationMinutes: m.durationMinutes,
      code: m.code,
      groupToken: m.group?.token ?? null,
    })),
    dryers: laundry.filter((m) => m.kind === "DRYER").map((m) => ({
      id: m.id,
      name: m.name,
      location: m.location,
      pricePerUse: m.pricePerUse,
      durationMinutes: m.durationMinutes,
      code: m.code,
      groupToken: m.group?.token ?? null,
    })),
  };
}

// Resolve a 4-digit code to a target route. Returns null if unknown.
export async function resolveServiceCode(code: string): Promise<{ type: "shower" | "washer" | "dryer"; id: number; groupToken: string | null } | null> {
  const trimmed = code.trim();
  if (!/^\d{4}$/.test(trimmed)) return null;

  const shower = await prisma.shower.findUnique({ where: { code: trimmed } });
  if (shower) return { type: "shower", id: shower.id, groupToken: null };

  const machine = await prisma.laundryMachine.findUnique({
    where: { code: trimmed },
    include: { group: true },
  });
  if (machine) {
    return {
      type: machine.kind === "DRYER" ? "dryer" : "washer",
      id: machine.id,
      groupToken: machine.group?.token ?? null,
    };
  }
  return null;
}

// ── Shower session core flow ──────────────────────────────────

async function expireStaleShowerPendings() {
  const pendingCutoff = new Date(Date.now() - PENDING_PAYMENT_TTL_MS);
  await prisma.showerSess.updateMany({
    where: { status: "PENDING", createdAt: { lte: pendingCutoff } },
    data: { status: "CANCELLED" },
  });
}

/**
 * Create a pending shower session + QuickPay link. Valve is turned on
 * only after the payment callback resolves.
 *
 * Day guests leave `guestPortalToken` undefined.
 */
export async function createShowerPayment(
  showerId: number,
  minutes: number,
  guestPortalToken?: string,
): Promise<{ ok: boolean; message: string; paymentLink?: string; showerSessionId?: number; accessToken?: string }> {
  await expireStaleShowerPendings();

  const shower = await prisma.shower.findUnique({
    where: { id: showerId },
    include: {
      sessions: {
        where: { status: { in: ["ACTIVE", "PAUSED"] } },
        take: 1,
        orderBy: { startedAt: "desc" },
      },
    },
  });
  if (!shower) return { ok: false, message: "Bad ikke fundet" };
  if (!shower.enabled) return { ok: false, message: "Badet er deaktiveret" };

  const mins = Math.round(minutes);
  if (mins < shower.minMinutes || mins > shower.maxMinutes) {
    return { ok: false, message: `Vælg mellem ${shower.minMinutes} og ${shower.maxMinutes} minutter` };
  }

  // Reject if shower is currently occupied (question 9)
  const existing = shower.sessions[0];
  if (existing && existing.status !== "COMPLETED" && existing.status !== "CANCELLED") {
    if (existing.status === "PAUSED" || new Date(existing.endsAt) > new Date()) {
      return { ok: false, message: "Badet er optaget — prøv igen senere" };
    }
  }

  const guestSession = guestPortalToken
    ? await prisma.session.findUnique({ where: { guestPortalToken } })
    : null;

  const price = +(mins * shower.pricePerMinute).toFixed(2);
  const endsAt = new Date(Date.now() + mins * 60 * 1000);

  const settings = await readGlobalSettings();
  const baseUrl = getBaseUrl(settings);

  // Same rules as laundry: credit, then balance / the stay's bill, else card —
  // and without card payments the guest pays at the desk instead.
  const funding = planGuestFunding(price, guestSession, {
    cardEnabled: settings.quickpay_enabled === "true",
    servicesOnAccount: settings.postpaid_services_mode === "ON_ACCOUNT",
    payAtDeskMessage: `Betal i receptionen — så starter vi ${shower.name} for dig.`,
  });
  if (funding.kind === "BLOCKED") return { ok: false, message: funding.message };

  // The valve only opens after the warm-up, so a dead Shelly would otherwise
  // be found after the money is taken — refuse up front when it's known offline.
  if ((await serviceDeviceOnline(shower)) === false) {
    return { ok: false, message: `${shower.name} er ude af drift lige nu — kontakt receptionen.` };
  }

  if (funding.kind !== "CARD") {
    let sess;
    try {
      sess = await prisma.$transaction(async (tx) => {
        if (guestSession) await drawStayFunds(tx, guestSession.id, funding);
        const s = await tx.showerSess.create({
          data: {
            showerId,
            sessionId: guestSession?.id ?? null,
            endsAt,
            status: "PENDING",
            pricePaid: funding.amount,
            creditUsed: funding.creditUsed,
            minutesPaid: mins,
            pendingMinutes: mins,
            ...fundingPaymentFields(funding),
          },
        });
        if (guestSession) await logCreditUse(tx, guestSession.id, funding.creditUsed, `shower:${s.id}`, shower.name);
        return s;
      });
    } catch (e) {
      if (e instanceof InsufficientFunds) return { ok: false, message: "Saldoen eller kreditten slår ikke til længere — prøv igen" };
      throw e;
    }
    await activateShowerSessionInternal(sess.id);
    return { ok: true, message: `Bad startet i ${mins} min (${fundingNote(funding)})`, showerSessionId: sess.id, accessToken: sess.accessToken };
  }

  // Card: the credit part is taken when the payment comes through.
  const pending = await prisma.showerSess.create({
    data: {
      showerId,
      sessionId: guestSession?.id ?? null,
      endsAt,
      status: "PENDING",
      pricePaid: funding.amount,
      creditUsed: funding.creditUsed,
      minutesPaid: 0,
      pendingMinutes: mins,
      paymentStatus: "UNPAID",
      paymentMethod: "QUICKPAY",
    },
  });

  try {
    const { createPaymentLink, generateOrderId } = await import("./quickpay");
    const orderId = generateOrderId("S", pending.id);

    const { paymentId, paymentLink } = await createPaymentLink({
      orderId,
      amount: funding.amount,
      currency: settings.currency || "DKK",
      continueUrl: `${baseUrl}/shower/active/${pending.id}?token=${pending.accessToken}&paid=1`,
      cancelUrl: `${baseUrl}/shower/${showerId}?cancelled=1`,
      callbackUrl: `${baseUrl}/api/quickpay/callback`,
    });

    await prisma.showerSess.update({
      where: { id: pending.id },
      data: { paymentId: String(paymentId) },
    });

    return { ok: true, message: "Går til betaling...", paymentLink, showerSessionId: pending.id, accessToken: pending.accessToken };
  } catch (e) {
    await prisma.showerSess.delete({ where: { id: pending.id } });
    return { ok: false, message: `Betaling kunne ikke oprettes: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Called when the QuickPay callback accepts the payment, or right after a
 * start paid from credit / balance / the stay's bill. Flips the status; the
 * client opens the valve after the warm-up.
 */
/** Auth-guarded entry point (server action). Cron/webhooks call it inside
 *  runWithApiAuth; in-module callers use activateShowerSessionInternal directly. */
export async function activateShowerSession(...args: Parameters<typeof activateShowerSessionInternal>) {
  await requireAuth();
  return activateShowerSessionInternal(...args);
}

async function activateShowerSessionInternal(pendingId: number) {
  const sess = await prisma.showerSess.findUnique({
    where: { id: pendingId },
    include: { shower: true },
  });
  if (!sess) return;
  if (sess.status !== "PENDING") return;

  const mins = sess.pendingMinutes ?? 0;
  // Add warmup time so purchased minutes start AFTER the 10s warmup
  const endsAt = new Date(Date.now() + SHOWER_WARMUP_MS + mins * 60 * 1000);
  const fromCard = sess.paymentStatus === "UNPAID";

  await prisma.showerSess.update({
    where: { id: pendingId },
    data: {
      status: "ACTIVE",
      // Card payments arrive as UNPAID → PAID; ON_ACCOUNT / PREPAID rows keep
      // their marker, otherwise they'd never be billed (or double-counted).
      paymentStatus: fromCard ? "PAID" : sess.paymentStatus,
      ...(fromCard && { paymentMethod: "QUICKPAY" }),
      startedAt: new Date(),
      endsAt,
      // pricePaid is set when the row is created (card: what the link was
      // for, net of credit). Rows from before that kept 0 here.
      pricePaid: sess.pricePaid > 0 || sess.creditUsed > 0 ? sess.pricePaid : +(mins * sess.shower.pricePerMinute).toFixed(2),
      minutesPaid: mins,
      pendingMinutes: null,
    },
  });
  if (fromCard) await takeCreditOnCardActivation("shower", sess.id, sess.sessionId, sess.creditUsed, sess.shower.name);

  // Relay is NOT turned on here — client calls startShowerRelay() after the 10s warmup countdown
}

/** Turn on the shower relay after warmup countdown. Called by the client. */
export async function startShowerRelay(showerSessionId: number, accessToken?: string): Promise<{ ok: boolean; message: string }> {
  const sess = await prisma.showerSess.findUnique({
    where: { id: showerSessionId },
    include: { shower: true },
  });
  if (!sess) return { ok: false, message: "Session ikke fundet" };
  if (!accessToken || sess.accessToken !== accessToken) return { ok: false, message: "Ugyldig adgang" };
  if (sess.status !== "ACTIVE") return { ok: false, message: "Session er ikke aktiv" };

  const remainingSec = Math.max(0, Math.ceil((new Date(sess.endsAt).getTime() - Date.now()) / 1000));
  if (remainingSec <= 0) return { ok: false, message: "Tiden er udløbet" };

  try {
    // Turn on relay with hardware auto-off safety net (remaining time + 60s buffer)
    await hardware.setSwitchTimed(hardware.switchRowEp(sess.shower), remainingSec + 60);
  } catch (e) {
    logger.error("shower", "Shower relay start failed", e);
    // No water, no charge: cancel and put the money back where it came from.
    await cancelAndRefundService("SHOWER", sess.id, {
      reason: "Bruseren kunne ikke tændes (relæet svarede ikke)",
      by: null,
      auto: true,
    });
    return {
      ok: false,
      message: serviceChannel(sess) === "CARD"
        ? "Bruseren kunne ikke tændes — kontakt receptionen for at få pengene tilbage."
        : "Bruseren kunne ikke tændes — der er ikke trukket noget. Kontakt receptionen.",
    };
  }

  return { ok: true, message: "Bruser startet" };
}

/**
 * Called when an extension payment resolves: adds the purchased
 * minutes on top of the existing timer.
 */
/** Auth-guarded entry point (server action). Cron/webhooks call it inside
 *  runWithApiAuth; in-module callers use applyShowerExtensionInternal directly. */
export async function applyShowerExtension(...args: Parameters<typeof applyShowerExtensionInternal>) {
  await requireAuth();
  return applyShowerExtensionInternal(...args);
}

async function applyShowerExtensionInternal(showerSessionId: number, opts: { viaCredit?: number } = {}): Promise<boolean> {
  const sess = await prisma.showerSess.findUnique({
    where: { id: showerSessionId },
    include: { shower: true },
  });
  if (!sess) return false;
  const extra = sess.pendingMinutes ?? 0;
  if (extra <= 0) return false;

  // Active → extend endsAt. Paused → inflate the frozen remaining time.
  let newEndsAt = sess.endsAt;
  let newPauseRemainingMs = sess.pauseRemainingMs;
  if (sess.status === "PAUSED" && sess.pauseRemainingMs !== null) {
    newPauseRemainingMs = sess.pauseRemainingMs + extra * 60 * 1000;
  } else {
    const base = new Date(Math.max(Date.now(), new Date(sess.endsAt).getTime()));
    newEndsAt = new Date(base.getTime() + extra * 60 * 1000);
  }

  // Only an ACTIVE/PAUSED session can be extended — if the cron completed it
  // between the purchase and this call, report it so the caller can refund.
  const applied = await prisma.showerSess.updateMany({
    where: { id: showerSessionId, status: { in: ["ACTIVE", "PAUSED"] } },
    data: {
      endsAt: newEndsAt,
      pauseRemainingMs: newPauseRemainingMs,
      minutesPaid: sess.minutesPaid + extra,
      // Paid from service credit: the price goes on creditUsed, not pricePaid.
      ...(opts.viaCredit
        ? { creditUsed: +(sess.creditUsed + opts.viaCredit).toFixed(2) }
        : {
            pricePaid: +(sess.pricePaid + extra * sess.shower.pricePerMinute).toFixed(2),
            // A credit-paid shower topped up by card is now partly a card payment.
            ...(sess.paymentMethod === "CREDIT" && { paymentMethod: "QUICKPAY" }),
          }),
      pendingMinutes: null,
      paymentStatus: sess.paymentStatus === "UNPAID" ? "PAID" : sess.paymentStatus,
    },
  });
  if (applied.count === 0) return false;

  // Re-arm hardware auto-off with the new total remaining time
  if (sess.status === "ACTIVE" && newEndsAt) {
    const remainingSec = Math.ceil((new Date(newEndsAt).getTime() - Date.now()) / 1000);
    if (remainingSec > 0) {
      try {
        await hardware.setSwitchTimed(hardware.switchRowEp(sess.shower), remainingSec + 60);
      } catch (e) {
        logger.error("shower", "Shower extension re-arm auto-off", e);
      }
    }
  }
  return true;
}

/**
 * Guest-side state query for the active timer page.
 * Returns seconds left + whether the session is paused + pause metadata.
 */
export async function getShowerSessionState(showerSessionId: number, accessToken?: string) {
  const sess = await prisma.showerSess.findUnique({
    where: { id: showerSessionId },
    include: { shower: true },
  });
  if (!sess) return null;
  // The access token from the shower link is the only credential guests have
  if (!accessToken || sess.accessToken !== accessToken) return null;

  const now = Date.now();
  let secondsLeft = 0;
  let pauseSecondsLeft = 0;

  if (sess.status === "ACTIVE") {
    secondsLeft = Math.max(0, Math.ceil((new Date(sess.endsAt).getTime() - now) / 1000));
  } else if (sess.status === "PAUSED" && sess.pauseRemainingMs !== null && sess.pausedAt) {
    secondsLeft = Math.max(0, Math.ceil(sess.pauseRemainingMs / 1000));
    const pauseUsed = now - new Date(sess.pausedAt).getTime();
    pauseSecondsLeft = Math.max(0, Math.ceil((PAUSE_MAX_MS - pauseUsed) / 1000));
  }

  let pauseCooldownSeconds = 0;
  if (sess.pauseResumedAt) {
    const diff = now - new Date(sess.pauseResumedAt).getTime();
    if (diff < PAUSE_COOLDOWN_MS) {
      pauseCooldownSeconds = Math.ceil((PAUSE_COOLDOWN_MS - diff) / 1000);
    }
  }

  // Warmup: first 10s after activation, relay is off so guest can get ready
  let warmupSecondsLeft = 0;
  if (sess.status === "ACTIVE" && sess.startedAt) {
    const warmupEnd = new Date(sess.startedAt).getTime() + SHOWER_WARMUP_MS;
    if (now < warmupEnd) {
      warmupSecondsLeft = Math.max(0, Math.ceil((warmupEnd - now) / 1000));
    }
  }

  return {
    id: sess.id,
    accessToken: sess.accessToken,
    showerId: sess.showerId,
    showerName: sess.shower.name,
    location: sess.shower.location,
    pricePerMinute: sess.shower.pricePerMinute,
    minMinutes: sess.shower.minMinutes,
    maxMinutes: sess.shower.maxMinutes,
    status: sess.status,
    secondsLeft,
    pauseSecondsLeft,
    pauseCooldownSeconds,
    warmupSecondsLeft,
    minutesPaid: sess.minutesPaid,
    pricePaid: sess.pricePaid,
    paymentStatus: sess.paymentStatus,
    // Cancelled by the desk or because the valve never opened (money refunded)
    cancelled: !!sess.cancelledAt,
    cardPayment: (await readGlobalSettings()).quickpay_enabled === "true",
  };
}

/** Pause an active shower — closes the valve and freezes the remaining time. */
export async function pauseShower(showerSessionId: number, accessToken?: string): Promise<{ ok: boolean; message: string }> {
  const sess = await prisma.showerSess.findUnique({
    where: { id: showerSessionId },
    include: { shower: true },
  });
  if (!sess) return { ok: false, message: "Session ikke fundet" };
  if (!accessToken || sess.accessToken !== accessToken) return { ok: false, message: "Ugyldig adgang" };
  if (sess.status !== "ACTIVE") return { ok: false, message: "Kan ikke pause nu" };

  if (sess.pauseResumedAt) {
    const diff = Date.now() - new Date(sess.pauseResumedAt).getTime();
    if (diff < PAUSE_COOLDOWN_MS) {
      const remain = Math.ceil((PAUSE_COOLDOWN_MS - diff) / 1000);
      return { ok: false, message: `Vent ${remain}s før du kan pause igen` };
    }
  }

  const remainingMs = Math.max(0, new Date(sess.endsAt).getTime() - Date.now());
  if (remainingMs <= 0) return { ok: false, message: "Tiden er allerede udløbet" };

  await prisma.showerSess.update({
    where: { id: showerSessionId },
    data: {
      status: "PAUSED",
      pausedAt: new Date(),
      pauseRemainingMs: remainingMs,
    },
  });

  try { await hardware.setSwitch(hardware.switchRowEp(sess.shower), false); } catch (e) { logger.error("shower", "Shower pause off", e); }

  return { ok: true, message: "Pause" };
}

/** Manually resume a paused shower. Also used by the auto-resume sweep. */
export async function resumeShower(showerSessionId: number, accessToken?: string): Promise<{ ok: boolean; message: string }> {
  const sess = await prisma.showerSess.findUnique({
    where: { id: showerSessionId },
    include: { shower: true },
  });
  if (!sess) return { ok: false, message: "Session ikke fundet" };
  if (!accessToken || sess.accessToken !== accessToken) return { ok: false, message: "Ugyldig adgang" };
  if (sess.status !== "PAUSED") return { ok: false, message: "Ikke på pause" };

  const remainingMs = sess.pauseRemainingMs ?? 0;
  const newEndsAt = new Date(Date.now() + remainingMs);

  await prisma.showerSess.update({
    where: { id: showerSessionId },
    data: {
      status: "ACTIVE",
      endsAt: newEndsAt,
      pausedAt: null,
      pauseRemainingMs: null,
      pauseResumedAt: new Date(),
    },
  });

  try {
    // Re-arm hardware auto-off for the remaining time + buffer
    const autoOffSec = Math.ceil(remainingMs / 1000) + 60;
    await hardware.setSwitchTimed(hardware.switchRowEp(sess.shower), autoOffSec);
  } catch (e) { logger.error("shower", "Shower resume on", e); }

  return { ok: true, message: "Fortsat" };
}

/**
 * Buy more minutes while a session is active/paused.
 * Returns paymentLink that the client must redirect to.
 */
export async function extendShowerPayment(
  showerSessionId: number,
  extraMinutes: number,
  accessToken?: string,
): Promise<{ ok: boolean; message: string; paymentLink?: string }> {
  const sess = await prisma.showerSess.findUnique({
    where: { id: showerSessionId },
    include: { shower: true },
  });
  if (!sess) return { ok: false, message: "Session ikke fundet" };
  if (!accessToken || sess.accessToken !== accessToken) return { ok: false, message: "Ugyldig adgang" };
  if (sess.status !== "ACTIVE" && sess.status !== "PAUSED") {
    return { ok: false, message: "Kan kun forlænge en aktiv session" };
  }

  const extra = Math.round(extraMinutes);
  if (extra < sess.shower.minMinutes || extra > sess.shower.maxMinutes) {
    return { ok: false, message: `Køb mellem ${sess.shower.minMinutes} og ${sess.shower.maxMinutes} minutter` };
  }

  const price = +(extra * sess.shower.pricePerMinute).toFixed(2);

  const settings = await readGlobalSettings();
  const baseUrl = getBaseUrl(settings);

  // Extra minutes are paid the same way as the shower itself.
  const channel = serviceChannel(sess);
  const stay = sess.sessionId ? await prisma.session.findUnique({ where: { id: sess.sessionId } }) : null;
  const stayActive = stay?.status === "ACTIVE";

  // On the stay's bill: add the minutes, the price follows on pricePaid.
  if (channel === "ACCOUNT" && stayActive) {
    await prisma.showerSess.update({ where: { id: showerSessionId }, data: { pendingMinutes: extra } });
    const applied = await applyShowerExtensionInternal(showerSessionId);
    if (!applied) return { ok: false, message: "Badet er ikke længere aktivt" };
    return { ok: true, message: `Forlænget med ${extra} minutter (${price.toFixed(0)} DKK på regning)` };
  }

  // PREPAID guests extend from their balance — same rules as the initial
  // purchase: deduct if it covers the price, otherwise reject. Never card.
  if (stay && (channel === "BALANCE" || stay.billingMode === "PREPAID")) {
    const remaining = stay.prepaidAmount ?? 0;
    if (!stayActive) return { ok: false, message: "Køb mere tid i receptionen" };
    // Conditional decrement — closes the race between concurrent extensions
    const res = await prisma.session.updateMany({
      where: { id: stay.id, prepaidAmount: { gte: price } },
      data: { prepaidAmount: { decrement: price } },
    });
    if (res.count === 0) {
      return { ok: false, message: `Utilstrækkelig saldo — behøver ${price.toFixed(0)} DKK, har ${remaining.toFixed(0)} DKK` };
    }
    await prisma.showerSess.update({
      where: { id: showerSessionId },
      data: { pendingMinutes: extra },
    });
    const applied = await applyShowerExtensionInternal(showerSessionId);
    if (!applied) {
      await prisma.session.update({ where: { id: stay.id }, data: { prepaidAmount: { increment: price } } });
      return { ok: false, message: "Badet er ikke længere aktivt — beløbet er ført tilbage til din saldo" };
    }
    return { ok: true, message: `Forlænget med ${extra} minutter (trukket fra saldo)` };
  }

  // Paid with service credit: more credit if there is enough of it.
  if (stay && stayActive && channel === "CREDIT" && stay.laundryCredit >= price) {
    try {
      await prisma.$transaction(async (tx) => {
        await drawStayFunds(tx, stay.id, { kind: "CREDIT", creditUsed: price, amount: 0 });
        await logCreditUse(tx, stay.id, price, `shower:${sess.id}`, `${sess.shower.name} +${extra} min`);
      });
    } catch (e) {
      if (e instanceof InsufficientFunds) return { ok: false, message: "Kreditten slår ikke til længere — prøv igen" };
      throw e;
    }
    await prisma.showerSess.update({ where: { id: showerSessionId }, data: { pendingMinutes: extra } });
    const applied = await applyShowerExtensionInternal(showerSessionId, { viaCredit: price });
    if (!applied) {
      await prisma.$transaction([
        prisma.session.update({ where: { id: stay.id }, data: { laundryCredit: { increment: price } } }),
        prisma.serviceCreditEntry.create({
          data: { sessionId: stay.id, amount: price, reason: "REFUNDED", note: `${sess.shower.name}: badet var slut`, serviceRef: `shower:${sess.id}` },
        }),
      ]);
      return { ok: false, message: "Badet er ikke længere aktivt — kreditten er ført tilbage" };
    }
    return { ok: true, message: `Forlænget med ${extra} minutter (${price.toFixed(0)} DKK kredit)` };
  }

  // Without card payments, more time is bought at the desk — never for free.
  // A card top-up only goes on a card/credit shower, so one row never mixes
  // card money with desk money or the stay's bill.
  if (settings.quickpay_enabled !== "true" || (channel !== "CARD" && channel !== "CREDIT")) {
    return { ok: false, message: "Køb mere tid i receptionen" };
  }

  try {
    const { createPaymentLink, generateOrderId } = await import("./quickpay");
    const orderId = generateOrderId("SX", showerSessionId);

    const { paymentId, paymentLink } = await createPaymentLink({
      orderId,
      amount: price,
      currency: settings.currency || "DKK",
      continueUrl: `${baseUrl}/shower/active/${showerSessionId}?token=${sess.accessToken}&extended=1`,
      cancelUrl: `${baseUrl}/shower/active/${showerSessionId}?token=${sess.accessToken}&extend_cancelled=1`,
      callbackUrl: `${baseUrl}/api/quickpay/callback`,
    });

    await prisma.showerSess.update({
      where: { id: showerSessionId },
      data: { pendingMinutes: extra, paymentId: String(paymentId) },
    });

    return { ok: true, message: "Går til betaling...", paymentLink };
  } catch (e) {
    return { ok: false, message: `Betaling kunne ikke oprettes: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Admin manual stop. */
export async function adminStopShower(showerSessionId: number) {
  const auth = await requireAuth();
  const sess = await prisma.showerSess.findUnique({
    where: { id: showerSessionId },
    include: { shower: true },
  });
  if (!sess) return { ok: false, message: "Session ikke fundet" };

  // Only a running/paused shower — never turn a cancelled (refunded) one into COMPLETED.
  const res = await prisma.showerSess.updateMany({
    where: { id: showerSessionId, status: { in: ["ACTIVE", "PAUSED"] } },
    data: { status: "COMPLETED", endsAt: new Date(), pausedAt: null, pauseRemainingMs: null },
  });
  if (res.count === 0) return { ok: false, message: "Badet kører ikke" };
  logger.info("shower", `${sess.shower.name} (shower:${sess.id}) stoppet af ${auth.username ?? "?"}`);

  try { await hardware.setSwitch(hardware.switchRowEp(sess.shower), false); } catch (e) {
    return { ok: false, message: `Stoppet — men relæet svarede ikke, luk vandet manuelt (${e instanceof Error ? e.message : String(e)})` };
  }
  return { ok: true, message: "Bad stoppet" };
}

/**
 * Called from the guest's browser when the shower timer hits 0.
 * Only completes if the session is actually expired (endsAt <= now).
 * Idempotent — safe to call multiple times or concurrently with the cron.
 */
export async function completeExpiredShower(showerSessionId: number) {
  const sess = await prisma.showerSess.findUnique({
    where: { id: showerSessionId },
    include: { shower: true },
  });
  if (!sess || sess.status === "COMPLETED" || sess.status === "CANCELLED") return;
  if (sess.status === "ACTIVE" && new Date(sess.endsAt) > new Date()) return; // not expired yet

  // Use updateMany with a status guard so concurrent calls are harmless
  const res = await prisma.showerSess.updateMany({
    where: { id: showerSessionId, status: { in: ["ACTIVE", "PAUSED"] } },
    data: { status: "COMPLETED", endsAt: new Date(), pausedAt: null, pauseRemainingMs: null },
  });
  if (res.count === 0) return; // already handled by cron or another call

  try {
    await hardware.setSwitch(hardware.switchRowEp(sess.shower), false);
  } catch (e) {
    logger.error("shower", "completeExpiredShower relay off", e);
  }
}

/**
 * Called from the guest's browser when a laundry timer hits 0.
 * Only completes if the session is actually expired (endsAt <= now).
 * Idempotent — safe to call multiple times or concurrently with the cron.
 */
export async function completeExpiredLaundry(laundrySessionId: number) {
  const sess = await prisma.laundrySess.findUnique({
    where: { id: laundrySessionId },
    include: { machine: true },
  });
  if (!sess || sess.status !== "ACTIVE") return;
  if (sess.billingMode === "METERED") return; // metered sessions handled by tickMeteredLaundry
  if (new Date(sess.endsAt) > new Date()) return; // not expired yet

  const res = await prisma.laundrySess.updateMany({
    where: { id: laundrySessionId, status: "ACTIVE" },
    data: { status: "COMPLETED" },
  });
  if (res.count === 0) return;

  try {
    await hardware.setSwitch(hardware.switchRowEp(sess.machine), false);
  } catch (e) {
    logger.error("laundry", "completeExpiredLaundry relay off", e);
  }
}

// ──────────────────────────────────────────────
// Metered Laundry — server-side power monitoring tick
// Called by cron every 2 minutes. Reads power consumption from Shelly/HA,
// tracks billing timer start/stop based on power threshold.
// ──────────────────────────────────────────────
/** Auth-guarded entry point (server action). Cron/webhooks call it inside
 *  runWithApiAuth; in-module callers use tickMeteredLaundryInternal directly. */
export async function tickMeteredLaundry(...args: Parameters<typeof tickMeteredLaundryInternal>) {
  await requireAuth();
  return tickMeteredLaundryInternal(...args);
}

async function tickMeteredLaundryInternal() {
  const sessions = await prisma.laundrySess.findMany({
    where: { status: "ACTIVE", billingMode: "METERED" },
    include: { machine: true },
  });

  let monitored = 0;
  let completed = 0;

  for (const sess of sessions) {
    try {
      // Auto-cancel if 10 minutes elapsed since activation with no power detected
      if (!sess.meterStartedAt) {
        const elapsed = Date.now() - new Date(sess.startedAt).getTime();
        if (elapsed > 10 * 60 * 1000) {
          await cancelMeteredSession(sess);
          completed++;
          continue;
        }
      }

      const ep = buildPowerEndpoint(sess.machine);
      if (!ep) {
        logger.warn("laundry", `Metered session ${sess.id}: no power endpoint configured`);
        continue;
      }

      const reading = await hardware.readPowerWatts(ep);
      const now = new Date();

      // If reading fails — or is a stale cached value from a device that
      // stopped answering — skip this session: don't bill on an old "running"
      // value and don't trigger false idle on an old 0 W.
      if (!reading || (reading.ageMs ?? 0) > 3 * 60_000) {
        logger.warn("laundry", `Metered session ${sess.id}: power reading ${reading ? "stale" : "failed"}, skipping tick`);
        continue;
      }

      const watts = reading.watts;
      const threshold = sess.machine.powerThresholdW;
      const idleTimeout = sess.machine.idleTimeoutMinutes;

      const updates: Record<string, unknown> = {
        lastPowerW: watts,
        lastPowerAt: now,
      };

      if (watts >= threshold) {
        if (sess.idleSince) {
          // Resuming from idle (e.g. spin cycle after pause) — don't bill the idle gap
          updates.idleSince = null;
          logger.info("laundry", `Metered session ${sess.id}: resumed from idle (${watts.toFixed(1)}W)`);
        } else {
          updates.idleSince = null;
        }

        if (!sess.meterStartedAt) {
          updates.meterStartedAt = now;
          logger.info("laundry", `Metered session ${sess.id}: billing started (${watts.toFixed(1)}W)`);
        } else if (!sess.idleSince) {
          // Only accumulate if we weren't idle (idle gap is not billed)
          const lastAt = sess.lastPowerAt ?? sess.meterStartedAt;
          const deltaMin = Math.max(0, (now.getTime() - lastAt.getTime()) / 60000);
          updates.billedMinutes = sess.billedMinutes + deltaMin;
        }
      } else {
        // Power below threshold
        if (sess.meterStartedAt) {
          if (!sess.idleSince) {
            // First tick below threshold — accumulate remaining time, mark idle start
            const lastAt = sess.lastPowerAt ?? sess.meterStartedAt;
            const deltaMin = Math.max(0, (now.getTime() - lastAt.getTime()) / 60000);
            updates.billedMinutes = sess.billedMinutes + deltaMin;
            updates.idleSince = now;
            logger.info("laundry", `Metered session ${sess.id}: idle detected (${watts.toFixed(1)}W)`);
          } else {
            const idleMinutes = (now.getTime() - new Date(sess.idleSince).getTime()) / 60000;
            if (idleMinutes >= idleTimeout) {
              await completeMeteredSession(sess);
              completed++;
              continue;
            }
          }
        }
      }

      // Optimistic concurrency: only apply if lastPowerAt hasn't changed
      const applied = await prisma.laundrySess.updateMany({
        where: { id: sess.id, status: "ACTIVE", lastPowerAt: sess.lastPowerAt },
        data: updates,
      });
      if (applied.count > 0) monitored++;
    } catch (e) {
      logger.error("laundry", `tickMeteredLaundry error (session ${sess.id})`, e);
    }
  }

  return { monitored, completed };
}

function buildPowerEndpoint(machine: {
  source: string;
  powerEntityId: string | null;
  mqttPrefix: string | null;
  mqttComponent: string | null;
  switchEntityId: string | null;
}): hardware.HardwareEndpoint | null {
  const source = machine.source === "MQTT" ? "MQTT" as const : "HA" as const;
  if (source === "MQTT") {
    if (!machine.mqttPrefix || !machine.mqttComponent) return null;
    return { source, mqttPrefix: machine.mqttPrefix, mqttComponent: machine.mqttComponent };
  }
  // A switch entity reports "on"/"off", never watts — falling back to it made
  // every reading fail and auto-cancelled every metered wash after 10 min.
  if (!machine.powerEntityId) return null;
  return { source, haEntityId: machine.powerEntityId };
}

async function cancelMeteredSession(sess: {
  id: number;
  sessionId: number | null;
  paymentId: string | null;
  paymentStatus: string;
  reservedAmount: number | null;
  machine: { id: number; name: string; source: string; switchEntityId: string | null; mqttPrefix: string | null; mqttComponent: string | null; idleTimeoutMinutes: number };
}) {
  const res = await prisma.laundrySess.updateMany({
    where: { id: sess.id, status: "ACTIVE" },
    data: { status: "CANCELLED", meterEndedAt: new Date(), pricePaid: 0 },
  });
  if (res.count === 0) return;

  // PREPAID: refund the full reservation since machine never ran
  if (sess.paymentStatus === "PREPAID" && sess.sessionId && sess.reservedAmount) {
    await prisma.session.updateMany({
      where: { id: sess.sessionId },
      data: { prepaidAmount: { increment: sess.reservedAmount } },
    });
    logger.info("laundry", `Metered session ${sess.id}: refunded full ${sess.reservedAmount.toFixed(2)} DKK to prepaid balance`);
  } else if (sess.paymentId) {
    try {
      const { cancelPayment } = await import("./quickpay");
      await cancelPayment(sess.paymentId);
    } catch (e) {
      logger.error("laundry", `Metered session ${sess.id}: cancel payment failed`, e);
    }
  }

  try {
    await hardware.setSwitch(hardware.switchRowEp(sess.machine), false);
  } catch (e) {
    logger.error("laundry", `Metered session ${sess.id}: relay off failed`, e);
  }

  logger.info("laundry", `Metered session ${sess.id}: auto-cancelled (no power detected within 10 min)`);
}

async function completeMeteredSession(sess: {
  id: number;
  sessionId: number | null;
  billedMinutes: number;
  pricePerMinute: number | null;
  reservedAmount: number | null;
  paymentId: string | null;
  paymentStatus: string;
  meterStartedAt: Date | null;
  idleSince: Date | null;
  lastPowerAt: Date | null;
  machine: { id: number; name: string; source: string; switchEntityId: string | null; mqttPrefix: string | null; mqttComponent: string | null; idleTimeoutMinutes: number };
}) {
  // Atomic guard: only complete if still ACTIVE (prevents double-completion)
  const res = await prisma.laundrySess.updateMany({
    where: { id: sess.id, status: "ACTIVE" },
    data: { status: "COMPLETED" },
  });
  if (res.count === 0) return; // already completed by another tick

  const now = new Date();
  const rate = sess.pricePerMinute ?? 0;
  const finalMinutes = sess.billedMinutes;
  const finalCost = Math.min(finalMinutes * rate, sess.reservedAmount ?? Infinity);

  // PREPAID: refund unused portion of the reservation back to guest balance
  if (sess.paymentStatus === "PREPAID" && sess.sessionId) {
    const refund = Math.max(0, (sess.reservedAmount ?? 0) - finalCost);
    if (refund > 0) {
      await prisma.session.updateMany({
        where: { id: sess.sessionId },
        data: { prepaidAmount: { increment: refund } },
      });
      logger.info("laundry", `Metered session ${sess.id}: refunded ${refund.toFixed(2)} DKK to prepaid balance`);
    }
  } else if (sess.paymentId) {
    // QuickPay: capture actual amount or void the pre-auth if 0 DKK
    try {
      if (finalCost > 0) {
        const { capturePayment } = await import("./quickpay");
        await capturePayment(sess.paymentId, finalCost);
        logger.info("laundry", `Metered session ${sess.id}: captured ${finalCost.toFixed(2)} DKK`);
      } else {
        const { cancelPayment } = await import("./quickpay");
        await cancelPayment(sess.paymentId);
        logger.info("laundry", `Metered session ${sess.id}: voided (0 DKK usage)`);
      }
    } catch (e) {
      logger.error("laundry", `Metered session ${sess.id}: payment finalization failed`, e);
    }
  }

  await prisma.laundrySess.update({
    where: { id: sess.id },
    data: {
      meterEndedAt: now,
      billedMinutes: finalMinutes,
      pricePaid: finalCost,
      // On the stay's bill the final price is charged at checkout/invoice.
      paymentStatus: sess.paymentStatus === "PREPAID" || sess.paymentStatus === "ON_ACCOUNT" ? sess.paymentStatus : "PAID",
    },
  });

  try {
    await hardware.setSwitch(hardware.switchRowEp(sess.machine), false);
  } catch (e) {
    logger.error("laundry", `Metered session ${sess.id}: relay off failed`, e);
  }

  logger.info("laundry", `Metered session ${sess.id} completed: ${finalMinutes.toFixed(1)} min, ${finalCost.toFixed(2)} DKK`);
}

// Get metered session status for guest live view
export async function getMeteredLaundryStatus(accessToken: string) {
  const sess = await prisma.laundrySess.findUnique({
    where: { accessToken },
    include: { machine: { select: { name: true, kind: true, location: true, powerThresholdW: true } } },
  });
  if (!sess) return null;

  const rate = sess.pricePerMinute ?? 0;
  const now = new Date();
  let currentMinutes = sess.billedMinutes;

  // If actively billing (meterStarted, not idle, not completed), add time since last tick
  if (sess.status === "ACTIVE" && sess.meterStartedAt && !sess.idleSince && sess.lastPowerAt) {
    const sinceTick = Math.max(0, (now.getTime() - sess.lastPowerAt.getTime()) / 60000);
    currentMinutes += sinceTick;
  }

  const currentCost = Math.min(currentMinutes * rate, sess.reservedAmount ?? Infinity);

  let phase: "waiting" | "billing" | "idle" | "done" | "cancelled";
  if (sess.status === "COMPLETED") phase = "done";
  else if (sess.status === "CANCELLED") phase = "cancelled";
  else if (!sess.meterStartedAt) phase = "waiting";
  else if (sess.idleSince) phase = "idle";
  else phase = "billing";

  return {
    sessionId: sess.id,
    machineName: sess.machine.name,
    machineKind: sess.machine.kind,
    machineLocation: sess.machine.location,
    phase,
    billedMinutes: currentMinutes,
    currentCost,
    reservedAmount: sess.reservedAmount ?? 0,
    pricePerMinute: rate,
    lastPowerW: sess.lastPowerW,
    meterStartedAt: sess.meterStartedAt?.toISOString() ?? null,
    meterEndedAt: sess.meterEndedAt?.toISOString() ?? null,
    pricePaid: sess.pricePaid,
    createdAt: sess.createdAt.toISOString(),
  };
}

/**
 * Background sweep — runs every 5s from the scheduler.
 *  - Auto-resume paused sessions after 5 min
 *  - Close expired active sessions (turn off valve)
 *  - Cancel old pending sessions
 */
/** Auth-guarded entry point (server action). Cron/webhooks call it inside
 *  runWithApiAuth; in-module callers use checkShowerSessionsInternal directly. */
export async function checkShowerSessions(...args: Parameters<typeof checkShowerSessionsInternal>) {
  await requireAuth();
  return checkShowerSessionsInternal(...args);
}

async function checkShowerSessionsInternal() {
  const now = new Date();

  // 1) Auto-resume pauses that hit the 5 min cap
  const cutoff = new Date(now.getTime() - PAUSE_MAX_MS);
  const expiredPauses = await prisma.showerSess.findMany({
    where: { status: "PAUSED", pausedAt: { lte: cutoff } },
    include: { shower: true },
  });
  for (const sess of expiredPauses) {
    const remainingMs = sess.pauseRemainingMs ?? 0;
    const newEndsAt = new Date(Date.now() + remainingMs);
    await prisma.showerSess.update({
      where: { id: sess.id },
      data: {
        status: "ACTIVE",
        endsAt: newEndsAt,
        pausedAt: null,
        pauseRemainingMs: null,
        pauseResumedAt: new Date(),
      },
    });
    try {
      const autoOffSec = Math.ceil(remainingMs / 1000) + 60; // +60s safety margin
      await hardware.setSwitchTimed(hardware.switchRowEp(sess.shower), autoOffSec);
    } catch (e) { logger.error("shower", "Auto-resume on", e); }
  }

  // 2) Expire active sessions whose endsAt has passed
  const expired = await prisma.showerSess.findMany({
    where: { status: "ACTIVE", endsAt: { lte: now } },
    include: { shower: true },
  });
  let completedCount = 0;
  for (const sess of expired) {
    try {
      await hardware.setSwitch(hardware.switchRowEp(sess.shower), false);
    } catch (e) {
      // Keep it ACTIVE so the next sweep retries (HA valves have no
      // on-device auto-off). Give up after RELAY_OFF_RETRY_MS.
      const overdueMs = Date.now() - sess.endsAt.getTime();
      logger.error("shower", `Shower close${overdueMs < RELAY_OFF_RETRY_MS ? " — prøver igen" : " — giver op, sluk manuelt"}`, e);
      if (overdueMs < RELAY_OFF_RETRY_MS) continue;
    }
    // Conditional: an extension paid meanwhile moved endsAt forward — then
    // the session must stay ACTIVE (and its relay was switched back on).
    const res = await prisma.showerSess.updateMany({
      where: { id: sess.id, status: "ACTIVE", endsAt: { lte: new Date() } },
      data: { status: "COMPLETED" },
    });
    completedCount += res.count;
    if (res.count === 0) {
      // Extended while we were switching off — switch it back on.
      const fresh = await prisma.showerSess.findUnique({ where: { id: sess.id } });
      if (fresh?.status === "ACTIVE" && fresh.endsAt > new Date()) {
        const remainingSec = Math.ceil((fresh.endsAt.getTime() - Date.now()) / 1000);
        try { await hardware.setSwitchTimed(hardware.switchRowEp(sess.shower), remainingSec + 60); }
        catch (e) { logger.error("shower", "Re-open after extension race", e); }
      }
    }
  }

  // 3) Clean up stale pending sessions
  await expireStaleShowerPendings();

  return {
    autoResumed: expiredPauses.length,
    completed: completedCount,
  };
}

// ─── Accounting Sync ───────────────────────────────────────────────

export async function testAccountingConnection(): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  const settings = await readGlobalSettings();
  const providerType = (settings.accounting_provider || "none") as import("./accounting").AccountingProviderType;
  const { getAccountingProvider } = await import("./accounting");
  const provider = getAccountingProvider(providerType, settings);
  if (!provider) return { ok: false, message: "Ingen bogføringssystem valgt" };
  return provider.testConnection();
}

export async function syncInvoicesToAccounting(): Promise<{
  synced: number;
  skipped: number;
  errors: { invoiceId: number; error: string }[];
}> {
  await requireAuth();
  const settings = await readGlobalSettings();
  const providerType = (settings.accounting_provider || "none") as import("./accounting").AccountingProviderType;
  const { getAccountingProvider } = await import("./accounting");
  const provider = getAccountingProvider(providerType, settings);
  if (!provider) return { synced: 0, skipped: 0, errors: [{ invoiceId: 0, error: "Ingen bogføringssystem konfigureret" }] };

  const invoices = await prisma.invoice.findMany({
    where: {
      accountingSyncId: null,
      status: { in: ["PENDING", "PAID", "OVERDUE"] },
    },
    include: { unit: true },
    orderBy: { periodEnd: "asc" },
  });

  const currency = settings.currency || "DKK";
  let synced = 0;
  let skipped = 0;
  const errors: { invoiceId: number; error: string }[] = [];

  for (const inv of invoices) {
    const lines: import("./accounting").AccountingInvoiceLine[] = [];

    if (inv.electricityCost > 0) {
      const kwh = inv.endKwh != null && inv.startKwh != null
        ? Math.max(0, inv.endKwh - inv.startKwh) : 0;
      lines.push({
        description: `Elektricitet — ${inv.unit.name} (${kwh.toFixed(2)} kWh)`,
        quantity: 1,
        unitPrice: inv.electricityCost,
        unit: "stk",
      });
    }

    if (inv.waterCost > 0) {
      const liters = inv.endWaterLiters != null && inv.startWaterLiters != null
        ? Math.max(0, inv.endWaterLiters - inv.startWaterLiters) : 0;
      lines.push({
        description: `Vand — ${inv.unit.name} (${liters.toFixed(0)} liter)`,
        quantity: 1,
        unitPrice: inv.waterCost,
        unit: "stk",
      });
    }

    if (lines.length === 0) {
      skipped++;
      continue;
    }

    const guestName = inv.unit.longTermGuestName || inv.unit.name;
    const guestEmail = inv.unit.longTermGuestEmail || undefined;

    const result = await provider.syncInvoice({
      internalId: inv.id,
      customerName: guestName,
      customerEmail: guestEmail,
      unitName: inv.unit.name,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      lines,
      totalAmount: inv.totalAmount,
      currency,
      paidAt: inv.paidAt || undefined,
      paymentId: inv.paymentId || undefined,
    });

    if (result.ok && result.externalId) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { accountingSyncId: result.externalId, accountingSyncAt: new Date() },
      });
      synced++;
    } else {
      errors.push({ invoiceId: inv.id, error: result.error || "Ukendt fejl" });
    }
  }

  logger.info("accounting", "Invoice sync completed", { synced, skipped, errors: errors.length });
  revalidatePath("/admin/economy");
  return { synced, skipped, errors };
}

export async function syncSessionsToAccounting(): Promise<{
  synced: number;
  skipped: number;
  errors: { sessionId: number; error: string }[];
}> {
  await requireAuth();
  const settings = await readGlobalSettings();
  const providerType = (settings.accounting_provider || "none") as import("./accounting").AccountingProviderType;
  const { getAccountingProvider } = await import("./accounting");
  const provider = getAccountingProvider(providerType, settings);
  if (!provider) return { synced: 0, skipped: 0, errors: [{ sessionId: 0, error: "Ingen bogføringssystem konfigureret" }] };

  const sessions = await prisma.session.findMany({
    where: {
      accountingSyncId: null,
      status: "COMPLETED",
      totalCost: { not: null },
    },
    include: { unit: true },
    orderBy: { checkOutTime: "asc" },
  });

  const currency = settings.currency || "DKK";
  let synced = 0;
  let skipped = 0;
  const errors: { sessionId: number; error: string }[] = [];

  for (const sess of sessions) {
    const lines: import("./accounting").AccountingInvoiceLine[] = [];

    if (sess.totalElectricityCost && sess.totalElectricityCost > 0) {
      const kwh = sess.endKwh != null && sess.startKwh != null
        ? Math.max(0, sess.endKwh - sess.startKwh) : 0;
      lines.push({
        description: `Elektricitet — ${sess.unit.name} (${kwh.toFixed(2)} kWh)`,
        quantity: 1,
        unitPrice: sess.totalElectricityCost,
      });
    }

    if (sess.totalWaterCost && sess.totalWaterCost > 0) {
      lines.push({
        description: `Vand — ${sess.unit.name}`,
        quantity: 1,
        unitPrice: sess.totalWaterCost,
      });
    }

    if (sess.externalPrice && sess.externalPrice > 0) {
      lines.push({
        description: sess.externalDescription || `Ophold — ${sess.unit.name}`,
        quantity: 1,
        unitPrice: sess.externalPrice,
      });
    }

    if (lines.length === 0) {
      skipped++;
      continue;
    }

    const result = await provider.syncInvoice({
      internalId: sess.id,
      customerName: sess.guestName,
      customerEmail: sess.guestEmail || undefined,
      unitName: sess.unit.name,
      periodStart: sess.checkInTime,
      periodEnd: sess.checkOutTime || new Date(),
      lines,
      totalAmount: (sess.totalCost || 0) + (sess.externalPrice || 0),
      currency,
      paidAt: sess.paidAt || undefined,
      paymentId: sess.paymentId || undefined,
    });

    if (result.ok && result.externalId) {
      await prisma.session.update({
        where: { id: sess.id },
        data: { accountingSyncId: result.externalId, accountingSyncAt: new Date() },
      });
      synced++;
    } else {
      errors.push({ sessionId: sess.id, error: result.error || "Ukendt fejl" });
    }
  }

  logger.info("accounting", "Session sync completed", { synced, skipped, errors: errors.length });
  revalidatePath("/admin/economy");
  return { synced, skipped, errors };
}

// ──────────────────────────────────────────────
// BOOKING SYSTEM (Danplanner etc.)
// ──────────────────────────────────────────────

export async function initBookingLogin(creds?: { url?: string; username?: string; password?: string; provider?: string }) {
  await requireAuth();

  if (creds) {
    const updates: Array<{ key: string; value: string }> = [];
    if (creds.provider !== undefined) updates.push({ key: "booking_provider", value: creds.provider });
    if (creds.url !== undefined) updates.push({ key: "danplanner_url", value: creds.url });
    if (creds.username !== undefined) updates.push({ key: "danplanner_username", value: creds.username });
    if (creds.password !== undefined) updates.push({ key: "danplanner_password", value: creds.password });
    for (const u of updates) {
      await prisma.globalSetting.upsert({
        where: { key: u.key },
        create: u,
        update: { value: u.value },
      });
    }
  }

  const settings = await readGlobalSettings();
  const result = await danplannerLogin({
    baseUrl: settings.danplanner_url || "https://admin.danplanner.dk",
    username: settings.danplanner_username || "",
    password: settings.danplanner_password || "",
  });

  if (result.sessionToken) {
    await prisma.globalSetting.upsert({
      where: { key: "danplanner_cookies" },
      create: { key: "danplanner_cookies", value: result.sessionToken },
      update: { value: result.sessionToken },
    });
  }

  if (result.approveFormData) {
    await prisma.globalSetting.upsert({
      where: { key: "danplanner_approve_form" },
      create: {
        key: "danplanner_approve_form",
        value: JSON.stringify({ action: result.approveFormAction, fields: result.approveFormData }),
      },
      update: {
        value: JSON.stringify({ action: result.approveFormAction, fields: result.approveFormData }),
      },
    });
  } else if (result.success) {
    await prisma.globalSetting.deleteMany({ where: { key: "danplanner_approve_form" } });
  }

  return { success: result.success, needs2FA: result.needs2FA, error: result.error };
}

export async function verifyBooking2FA(code: string) {
  await requireAuth();
  const settings = await readGlobalSettings();
  const baseUrl = settings.danplanner_url || "https://admin.danplanner.dk";
  const cookies = settings.danplanner_cookies || "";

  let cachedForm: { action: string; fields: Record<string, string> } | undefined;
  if (settings.danplanner_approve_form) {
    try {
      cachedForm = JSON.parse(settings.danplanner_approve_form);
    } catch {
      cachedForm = undefined;
    }
  }

  const result = await danplannerVerify2FA(baseUrl, cookies, code, cachedForm);

  if (result.sessionToken) {
    await prisma.globalSetting.upsert({
      where: { key: "danplanner_cookies" },
      create: { key: "danplanner_cookies", value: result.sessionToken },
      update: { value: result.sessionToken },
    });
  }

  if (result.success) {
    await prisma.globalSetting.deleteMany({ where: { key: "danplanner_approve_form" } });
  }

  return { success: result.success, error: result.error };
}

/**
 * Store a Danplanner session that the provider refreshed on its own after the
 * old one expired, so the next call reuses it instead of logging in again.
 * Not a server action itself — passed as a callback into getBookingProvider.
 */
async function persistRefreshedBookingSession(cookies: string): Promise<void> {
  await prisma.globalSetting.upsert({
    where: { key: "danplanner_cookies" },
    create: { key: "danplanner_cookies", value: cookies },
    update: { value: cookies },
  });
  logger.info("danplanner", "Persisted refreshed session cookies");
}

export async function testBookingConnection() {
  await requireAuth();
  const settings = await readGlobalSettings();
  const provider = getBookingProvider(
    (settings.booking_provider || "none") as "danplanner" | "none",
    settings,
    persistRefreshedBookingSession,
  );
  if (!provider) return { ok: false, error: "Ingen booking-udbyder konfigureret" };
  return provider.testConnection();
}

export async function fetchBookingResourceTypes() {
  await requireAuth();
  const settings = await readGlobalSettings();
  const provider = getBookingProvider(
    (settings.booking_provider || "none") as "danplanner" | "none",
    settings,
    persistRefreshedBookingSession,
  );
  if (!provider) return [];
  return provider.getResourceTypes();
}

export async function fetchBookingResources(typeId: string) {
  await requireAuth();
  const settings = await readGlobalSettings();
  const provider = getBookingProvider(
    (settings.booking_provider || "none") as "danplanner" | "none",
    settings,
    persistRefreshedBookingSession,
  );
  if (!provider) return [];
  return provider.getResources(typeId);
}

export async function syncBookingResources() {
  await requireAuth();
  await ensureResourceTypes();

  const settings = await readGlobalSettings();
  const provider = getBookingProvider(
    (settings.booking_provider || "none") as "danplanner" | "none",
    settings,
    persistRefreshedBookingSession,
  );
  if (!provider) return { synced: 0, error: "Ingen booking-udbyder konfigureret" };

  const providerName = settings.booking_provider || "danplanner";

  const mappedResourceTypes = await prisma.resourceType.findMany({
    where: { externalProvider: providerName, externalId: { not: null } },
  });

  if (mappedResourceTypes.length === 0) {
    return { synced: 0, error: "Ingen ressourcetyper er mappet til " + providerName + ". Konfigurér det først." };
  }

  let synced = 0;

  for (const rt of mappedResourceTypes) {
    if (!rt.externalId) continue;

    const resources = await provider.getResources(rt.externalId);
    const maxAgg = await prisma.unit.aggregate({
      where: { resourceTypeId: rt.id },
      _max: { sortOrder: true },
    });
    let nextSortOrder = (maxAgg._max.sortOrder ?? -1) + 1;

    for (const res of resources) {
      const existing = await prisma.unit.findFirst({
        where: { externalId: res.externalId, externalProvider: providerName },
      });

      if (existing) {
        const updates: Record<string, unknown> = {};
        if (existing.name !== res.name) updates.name = res.name;
        if (!existing.resourceTypeId) {
          updates.resourceTypeId = rt.id;
          updates.sortOrder = nextSortOrder++;
        }
        if (Object.keys(updates).length > 0) {
          await prisma.unit.update({ where: { id: existing.id }, data: updates });
        }
      } else {
        await prisma.unit.create({
          data: {
            name: res.name,
            type: rt.defaultUnitType as "CABIN" | "SEASONAL" | "CARAVAN" | "PITCH",
            isLongTerm: rt.defaultUnitType === "SEASONAL",
            externalId: res.externalId,
            externalProvider: providerName,
            resourceTypeId: rt.id,
            sortOrder: nextSortOrder++,
            hardware: { create: {} },
          },
        });
      }
      synced++;
    }
  }

  revalidatePath("/admin");
  revalidatePath("/admin/map");
  revalidatePath("/admin/settings");
  return { synced };
}

export async function syncBookings(productType: "all" | "tourist" | "seasonal" = "all") {
  await requireAuth();
  const settings = await readGlobalSettings();
  const provider = getBookingProvider(
    (settings.booking_provider || "none") as "danplanner" | "none",
    settings,
    persistRefreshedBookingSession,
  );
  if (!provider) {
    return {
      created: 0, updated: 0, skipped: [] as Array<{ booking: string; reason: string }>,
      conflicts: 0, missing: 0, total: 0, error: "Ingen booking-udbyder konfigureret",
    };
  }

  // Matching, desk-edit protection and status recording: src/lib/booking/sync.ts
  const result = await syncBookingsWithProvider(provider, settings.booking_provider || "danplanner", productType);

  revalidatePath("/admin");
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/map");
  return result;
}

/**
 * "Hent nu" on the status line: a sync right away, sharing the cron's slot
 * so it can't overlap the automatic one. Returns Danish text for the toast.
 */
export async function syncBookingsNow(): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  const settings = await readGlobalSettings();
  if (!settings.booking_provider || settings.booking_provider === "none") {
    return { ok: false, message: "Intet bookingsystem er sat op — se Indstillinger → Booking" };
  }
  if (!(await claimBookingSyncSlot(20_000))) {
    return { ok: false, message: "Der hentes allerede gæster — prøv igen om et øjeblik" };
  }
  const productType = (settings.booking_sync_product_type || "all") as "all" | "tourist" | "seasonal";
  try {
    const r = await syncBookings(productType);
    if (r.error) return { ok: false, message: `Hentning fejlede: ${r.error}` };
    const parts: string[] = [];
    if (r.created) parts.push(`${r.created} ${r.created === 1 ? "ny" : "nye"}`);
    if (r.updated) parts.push(`${r.updated} opdateret`);
    if (r.conflicts) parts.push(`${r.conflicts} med forskelle at tage stilling til`);
    if (r.missing) parts.push(`${r.missing} ikke længere i bookingsystemet`);
    return { ok: true, message: `Hentet ${r.total} gæster${parts.length ? ` — ${parts.join(", ")}` : " — ingen ændringer"}` };
  } catch (e) {
    logger.error("danplanner", "Manual sync threw", e instanceof Error ? e.message : e);
    return { ok: false, message: "Hentning fejlede — prøv igen" };
  }
}

/** The desk's answer to "Danplanner siger: …": take theirs or keep ours. */
export async function resolveBookingSyncConflict(
  sessionId: number,
  field: string,
  choice: "booking" | "mine",
): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  if (!Number.isInteger(sessionId) || (choice !== "booking" && choice !== "mine")) {
    return { ok: false, message: "Ugyldig forespørgsel" };
  }
  const r = await resolveSyncConflictInternal(sessionId, String(field), choice);
  if (r.ok) {
    revalidatePath(`/admin/bookings/${sessionId}`);
    revalidatePath("/admin/bookings");
    revalidatePath("/admin");
  }
  return r;
}

/**
 * Automatic booking sync, driven by the cron job.
 *
 * Runs `syncBookings` at most once per configured interval. Enabled with the
 * `booking_auto_sync` setting; the cadence comes from
 * `booking_sync_interval_minutes` (default 30, min 5).
 *
 * Uses the same atomic check-and-set lock as the cron's heavy tasks so two
 * overlapping cron invocations can't sync at the same time. Outcome is stored
 * in `_booking_last_sync` / `_booking_last_sync_status` for display in the
 * admin UI.
 *
 * Must be called inside `runWithApiAuth` — `syncBookings` requires auth.
 */
/** Auth-guarded entry point (server action). Cron/webhooks call it inside
 *  runWithApiAuth; in-module callers use autoSyncBookingsInternal directly. */
export async function autoSyncBookings(...args: Parameters<typeof autoSyncBookingsInternal>) {
  await requireAuth();
  return autoSyncBookingsInternal(...args);
}

async function autoSyncBookingsInternal(): Promise<{
  ran: boolean;
  reason?: string;
  created?: number;
  updated?: number;
  skipped?: number;
  error?: string;
}> {
  const settings = await readGlobalSettings();

  if (settings.booking_auto_sync !== "true") return { ran: false, reason: "disabled" };
  if (!settings.booking_provider || settings.booking_provider === "none") {
    return { ran: false, reason: "no provider" };
  }

  const intervalMin = Math.max(5, parseInt(settings.booking_sync_interval_minutes || "30", 10) || 30);
  const intervalMs = intervalMin * 60_000;

  const lastRunRaw = settings._booking_last_sync_attempt || "";
  const lastRun = lastRunRaw ? new Date(lastRunRaw).getTime() : 0;
  if (Date.now() - lastRun < intervalMs) return { ran: false, reason: "not due" };

  // Atomic claim: only one cron invocation may proceed past this point.
  const lockValue = new Date().toISOString();
  try {
    if (lastRunRaw) {
      const locked = await prisma.globalSetting.updateMany({
        where: { key: "_booking_last_sync_attempt", value: lastRunRaw },
        data: { value: lockValue },
      });
      if (locked.count === 0) return { ran: false, reason: "locked" };
    } else {
      await prisma.globalSetting.upsert({
        where: { key: "_booking_last_sync_attempt" },
        create: { key: "_booking_last_sync_attempt", value: lockValue },
        update: { value: lockValue },
      });
    }
  } catch {
    return { ran: false, reason: "lock failed" };
  }

  const productType = (settings.booking_sync_product_type || "all") as "all" | "tourist" | "seasonal";

  try {
    // syncBookings records the outcome in _booking_last_sync* itself.
    const r = await syncBookings(productType);

    if (r.error) {
      logger.error("danplanner", "Auto-sync failed", r.error);
      return { ran: true, error: r.error };
    }

    logger.info("danplanner", "Auto-sync completed", {
      created: r.created,
      updated: r.updated,
      conflicts: r.conflicts,
      missing: r.missing,
      skipped: r.skipped.length,
    });
    return { ran: true, created: r.created, updated: r.updated, skipped: r.skipped.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateMultipleSettings([
      { key: "_booking_last_sync", value: new Date().toISOString() },
      { key: "_booking_last_sync_status", value: `fejl: ${msg}` },
    ]);
    logger.error("danplanner", "Auto-sync threw", msg);
    return { ran: true, error: msg };
  }
}

// ──────────────────────────────────────────────
// SITE MAP
// ──────────────────────────────────────────────

export async function updateUnitMapPosition(unitId: number, mapX: number, mapY: number) {
  await requireAuth();
  await prisma.unit.update({
    where: { id: unitId },
    data: { mapX, mapY },
  });
  revalidatePath("/admin/map");
}

export async function getMapUnits() {
  await requireAuth();
  await ensureResourceTypes();
  const now = new Date();
  const [units, activeStays, openReservations] = await Promise.all([
    prisma.unit.findMany({
      include: { hardware: true, resourceType: true },
      orderBy: { name: "asc" },
    }),
    prisma.session.findMany({ where: { status: "ACTIVE" }, select: { unitId: true, guestName: true } }),
    // One query for every unit's open reservation (earliest first), so a pitch
    // with a booked guest is never drawn as "Ledig".
    prisma.session.findMany({
      where: openReservationWhere(now),
      select: { unitId: true, guestName: true, status: true, checkInTime: true, expectedCheckOut: true },
      orderBy: { checkInTime: "asc" },
    }),
  ]);
  const activeByUnit = new Map(activeStays.map((s) => [s.unitId, s]));
  const pendingByUnit = new Map<number, (typeof openReservations)[number]>();
  for (const r of openReservations) if (!pendingByUnit.has(r.unitId)) pendingByUnit.set(r.unitId, r);

  const unitData = await Promise.all(
    units.map(async (unit) => {
      // Units without meters/relays have nothing to ask
      const haStates = hasAnyHardware(unit.hardware)
        ? await getUnitHAStates(unit.id).catch(() => null)
        : null;
      const active = activeByUnit.get(unit.id) ?? null;
      const pending = active ? null : pendingByUnit.get(unit.id) ?? null;
      const pendingArrived = !!pending && hasArrivedNotCheckedIn(pending, now);

      return {
        id: unit.id,
        name: unit.name,
        type: unit.type,
        status: unit.status,
        isLongTerm: unit.isLongTerm,
        longTermGuestName: unit.longTermGuestName,
        externalId: unit.externalId,
        mapX: unit.mapX,
        mapY: unit.mapY,
        resourceTypeId: unit.resourceTypeId,
        resourceTypeIcon: unit.resourceType?.icon ?? null,
        resourceTypeName: unit.resourceType?.name ?? null,
        state: unitStateKey(unit.status, !!pending, pendingArrived),
        powerOn: haStates?.powerOn ?? null,
        haReachable: haStates?.haReachable ?? false,
        offlineReason: haStates?.offlineReason ?? null,
        activeGuestName: active?.guestName ?? null,
        pendingGuestName: pending?.guestName ?? null,
        pendingCheckIn: pending?.checkInTime.toISOString() ?? null,
        hasPowerSwitch: haStates?.hasPowerSwitch ?? false,
      };
    }),
  );

  return unitData;
}

export async function getBookingLogs(limit = 50) {
  await requireAuth();
  const fs = await import("fs");
  const path = await import("path");
  const logFile = path.join(process.env.LOG_DIR || path.join(process.cwd(), "logs"), "campsense.log");

  try {
    if (!fs.existsSync(logFile)) return [];
    const content = fs.readFileSync(logFile, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const entries: Array<{ timestamp: string; level: string; context: string; message: string; data?: unknown }> = [];

    for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.context === "danplanner") {
          entries.push(entry);
        }
      } catch {
        // skip malformed lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}
