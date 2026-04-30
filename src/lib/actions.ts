"use server";

import { revalidatePath } from "next/cache";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "./prisma";
import * as ha from "./homeassistant";
import * as hardware from "./hardware";
import type { HardwareEndpoint } from "./hardware";
import { mqttClient, testMqttBroker } from "./mqtt-client";
import { requireAuth } from "./auth";
import { logger } from "./logger";
import { danplannerLogin, danplannerVerify2FA, getBookingProvider } from "./booking";

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
  const settings = await prisma.globalSetting.findMany();
  return Object.fromEntries(settings.map((s) => [s.key, s.value]));
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
}): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  // If no cfg passed, use the currently-saved settings
  let host: string;
  let port: number;
  let username: string;
  let password: string;

  if (cfg) {
    ({ host, port, username, password } = cfg);
  } else {
    const settings = await prisma.globalSetting.findMany({
      where: { key: { in: ["mqtt_host", "mqtt_port", "mqtt_username", "mqtt_password"] } },
    });
    const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
    host = map.mqtt_host || "localhost";
    port = parseInt(map.mqtt_port || "1883", 10);
    username = map.mqtt_username || "";
    password = map.mqtt_password || "";
  }

  if (!host.trim()) return { ok: false, message: "MQTT host er tom" };
  return testMqttBroker({ host, port, username, password });
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

  const typeLabels: Record<string, string> = { CABIN: "Hytte", SEASONAL: "Fastligger", CARAVAN: "Campingvogn", PITCH: "Plads" };
  const map = new Map<string, string>();

  for (const row of allHw) {
    const unitName = `${typeLabels[row.unit.type] || ""} ${row.unit.name}`.trim();
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
  let unit = await prisma.unit.findUnique({ where: { id: unitId } });
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
export async function checkIn(unitId: number, guestName: string, guestEmail?: string, guestPhone?: string, bookingRef?: string, expectedCheckOut?: string, billingMode?: "PREPAID" | "POSTPAID", prepaidAmount?: number) {
  await requireAuth();
  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: { hardware: true },
  });

  if (!unit) throw new Error("Enhed ikke fundet");
  if (unit.status === "OCCUPIED") throw new Error("Enheden er allerede optaget");

  const hw = unit.hardware;
  const pricing = await getPricing();

  let startKwh: number | null = null;
  let startHeatingKwh: number | null = null;
  let startWaterLiters: number | null = null;

  if (hardware.hasElectricityMeter(hw)) {
    startKwh = await safeReadMeter(hardware.electricityMeterEp(hw!), `checkIn:el unit=${unitId}`);
  }
  if (hardware.hasHeatingMeter(hw)) {
    startHeatingKwh = await safeReadMeter(hardware.heatingMeterEp(hw!), `checkIn:heat unit=${unitId}`);
  }
  if (hardware.hasWaterMeter(hw)) {
    startWaterLiters = await safeReadMeter(hardware.waterMeterEp(hw!), `checkIn:water unit=${unitId}`);
  }

  // Turn on electricity
  if (hardware.hasElectricitySwitch(hw)) {
    try { await hardware.setSwitch(hardware.electricitySwitchEp(hw!), true); } catch (e) { logger.error("hardware", "checkIn el on", e); }
  }
  // Turn on heating relay
  if (hardware.hasHeatingSwitch(hw)) {
    try { await hardware.setSwitch(hardware.heatingSwitchEp(hw!), true); } catch (e) { logger.error("hardware", "checkIn heat on", e); }
  }
  // Set climate (HA only)
  if (hw?.hasClimate && hw.climateEntityId) {
    try { await ha.setClimateTemperature(hw.climateEntityId, pricing.defaultOccupiedTemp); } catch (e) { logger.error("hardware", "HA climate set occupied temp", e); }
  }
  // Unlock door (HA only)
  if (hw?.hasSmartLock && hw.lockEntityId) {
    try { await ha.unlockDoor(hw.lockEntityId); } catch (e) { logger.error("hardware", "HA unlock", e); }
  }

  const guestPortalToken = uuidv4();
  const session = await prisma.session.create({
    data: { unitId, guestName, guestEmail: guestEmail || null, guestPhone: guestPhone || null, bookingRef: bookingRef || null, expectedCheckOut: expectedCheckOut ? new Date(expectedCheckOut) : null, billingMode: billingMode || "POSTPAID", prepaidAmount: billingMode === "PREPAID" ? (prepaidAmount ?? null) : null, guestPortalToken, startKwh, startHeatingKwh, startWaterLiters, status: "ACTIVE" },
  });

  // Update unit status; for long-term units also store tenant info for invoicing/portal
  const updateData: Record<string, unknown> = { status: "OCCUPIED" };
  if (unit.isLongTerm) {
    updateData.longTermGuestName = guestName;
    updateData.longTermGuestEmail = guestEmail || null;
    updateData.longTermGuestPhone = guestPhone || null;
    updateData.longTermPortalToken = guestPortalToken;
  }
  await prisma.unit.update({ where: { id: unitId }, data: updateData });

  // Send notifications (non-blocking)
  const typeLabels: Record<string, string> = { CABIN: "Hytte", SEASONAL: "Fastligger", CARAVAN: "Campingvogn", PITCH: "Plads" };
  const unitDisplayName = `${typeLabels[unit.type] || ""} ${unit.name}`.trim();
  sendCheckInNotificationAsync(guestName, guestPhone, guestEmail, guestPortalToken, unitDisplayName);

  revalidatePath("/admin");
  revalidatePath(`/admin/units/${unitId}`);
  return { session, guestPortalToken };
}

async function sendCheckInNotificationAsync(
  guestName: string,
  guestPhone?: string,
  guestEmail?: string,
  portalToken?: string,
  unitName?: string,
) {
  try {
    const { sendCheckInNotification } = await import("./notifications");
    const settings = await getGlobalSettings();
    const baseUrl = settings.site_url || "http://localhost:3000";
    const portalUrl = `${baseUrl}/guest/${portalToken}`;
    await sendCheckInNotification(guestName, guestPhone, guestEmail, portalUrl, unitName || "");
  } catch (e) {
    logger.error("notify", "Notification fejl", e);
  }
}

// ──────────────────────────────────────────────
// CHECK-OUT FLOW
// ──────────────────────────────────────────────
export async function checkOut(sessionId: number) {
  await requireAuth();
  // Final tick first — ensures the accumulator captures every second of
  // consumption up to this instant at the correct hourly spot prices.
  // The tick uses optimistic concurrency, so if a cron tick is racing
  // us it's handled safely — we just re-read the session below and pick
  // up the freshest accumulator state either way.
  try {
    await tickSessionConsumption(sessionId);
  } catch (e) {
    logger.error("checkout", "checkOut: final tick fejlede", e);
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: { include: { hardware: true } } },
  });

  if (!session) throw new Error("Session ikke fundet");
  if (session.status === "COMPLETED") throw new Error("Session allerede afsluttet");

  const hw = session.unit.hardware;
  const pricing = await getPricing();

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

  // Block checkout if a configured meter failed to read and we have no accumulator
  const meterFailures: string[] = [];
  if (hardware.hasElectricityMeter(hw) && endKwh === null && session.accumulatedElCost === 0) {
    meterFailures.push("el-måler");
  }
  if (hardware.hasWaterMeter(hw) && endWaterLiters === null && session.accumulatedWaterCost === 0) {
    meterFailures.push("vandmåler");
  }
  if (meterFailures.length > 0) {
    logger.error("checkout", `Meter read failed at checkout for session ${sessionId}`, meterFailures);
    throw new Error(`Kan ikke checke ud — ${meterFailures.join(" og ")} kunne ikke aflæses. Prøv igen eller kontakt support.`);
  }

  // Costs come straight from the accumulator — that's the time-weighted
  // sum of (delta × hourly spot price) across every tick, which is the
  // correct billable amount regardless of what the price is right now.
  // If the accumulator is zero (e.g. legacy session pre-dating the feature),
  // fall back to the old snapshot calculation so we never undercount.
  let totalElectricityCost: number | null = session.accumulatedElCost > 0
    ? session.accumulatedElCost : null;
  let totalWaterCost: number | null = session.accumulatedWaterCost > 0
    ? session.accumulatedWaterCost : null;

  if (totalElectricityCost === null || totalWaterCost === null) {
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

  const totalCost = (totalElectricityCost ?? 0) + (totalWaterCost ?? 0);

  // Turn off devices based on auto_power_off setting
  const globalSettings = await getGlobalSettings();
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

  // For prepaid: mark as PAID since amount was collected upfront, no refund
  const isPrepaid = session.billingMode === "PREPAID";
  const updateData: Record<string, unknown> = {
    status: "COMPLETED",
    checkOutTime: new Date(),
    endKwh,
    endHeatingKwh,
    endWaterLiters,
    totalElectricityCost,
    totalWaterCost,
    totalCost,
  };
  if (isPrepaid) {
    updateData.paymentStatus = "PAID";
    updateData.paidAt = new Date();
  }

  // Conditional update: fail if status changed between our read and write
  // (concurrent checkOut call, admin double-click, etc.). Prevents double
  // check-out and ensures concurrent cron ticks can no longer mutate this
  // session via tickSessionConsumption's own status=ACTIVE guard.
  const res = await prisma.session.updateMany({
    where: { id: sessionId, status: "ACTIVE" },
    data: updateData,
  });
  if (res.count === 0) {
    throw new Error("Session allerede afsluttet eller ændret af en anden proces");
  }

  // Only mark vacant for non-long-term
  if (!session.unit.isLongTerm) {
    await prisma.unit.update({ where: { id: session.unitId }, data: { status: "VACANT" } });
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/units/${session.unitId}`);
  return { totalElectricityCost, totalWaterCost, totalCost, isPrepaid, prepaidAmount: session.prepaidAmount };
}

// ──────────────────────────────────────────────
// SESSION STATEMENT — breakdown per billing period for a booking
// Used by the printable /admin/bookings/[id]/statement page.
// Combines prior invoices + any un-invoiced remainder into one consolidated
// list of periods with cost + paid amount, so the admin can hand the guest
// a complete overview of their stay.
// ──────────────────────────────────────────────
export interface StatementPeriod {
  label: string;                 // "April 2026" or date range
  periodStart: Date;
  periodEnd: Date;
  electricityKwh: number | null;
  electricityCost: number;
  waterLiters: number | null;
  waterCost: number;
  totalAmount: number;
  paidAmount: number;            // 0 or totalAmount
  paymentStatus: "PAID" | "PENDING" | "OVERDUE" | "DRAFT" | "UNINVOICED";
  invoiceId: number | null;      // null for the un-invoiced remainder
}

export interface SessionStatement {
  session: {
    id: number;
    guestName: string;
    guestEmail: string | null;
    guestPhone: string | null;
    bookingRef: string | null;
    checkInTime: Date;
    checkOutTime: Date | null;
    status: "ACTIVE" | "COMPLETED";
    isLongTerm: boolean;
  };
  unit: {
    id: number;
    name: string;
    type: string;
  };
  periods: StatementPeriod[];
  totals: {
    electricityCost: number;
    waterCost: number;
    totalCost: number;
    totalPaid: number;
    owed: number;            // total - paid, clamped; amounts < 1 DKK are treated as 0
  };
  generatedAt: Date;
  currency: string;
}

export async function getSessionStatement(sessionId: number): Promise<SessionStatement | null> {
  await requireAuth();
  const initial = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: { include: { hardware: true } } },
  });
  if (!initial) return null;

  // For ACTIVE sessions, tick first so the "remainder" reflects time-weighted
  // spot-price billing up to now (same numbers as /api/cron would produce).
  let session = initial;
  if (initial.status === "ACTIVE") {
    try {
      await tickSessionConsumption(sessionId);
      const reloaded = await prisma.session.findUnique({
        where: { id: sessionId },
        include: { unit: { include: { hardware: true } } },
      });
      if (reloaded) session = reloaded;
    } catch (e) {
      logger.error("tick", "getSessionStatement: tick fejl", e);
    }
  }

  const pricing = await getPricing();

  // Effective rates (honor per-booking overrides)
  let effectiveElPrice = pricing.pricePerKwh;
  try {
    const effective = await getEffectiveElPricing();
    effectiveElPrice = effective.pricePerKwh;
  } catch {
    // Fallback to fixed price
  }
  if (session.pricePerKwhOverride != null) effectiveElPrice = session.pricePerKwhOverride;
  const waterRate = session.pricePerLiterWaterOverride ?? pricing.pricePerLiterWater;

  // Load invoices that overlap this session's timespan. For long-term tenants
  // we still scope by session period so a statement covers just this stay.
  const sessionStart = session.checkInTime;
  const sessionEnd = session.checkOutTime ?? new Date();
  const invoices = await prisma.invoice.findMany({
    where: {
      unitId: session.unitId,
      periodEnd: { gte: sessionStart },
      periodStart: { lte: sessionEnd },
    },
    orderBy: { periodStart: "asc" },
  });

  const fmtMonth = (d: Date) => d.toLocaleDateString("da-DK", { month: "long", year: "numeric" });
  const fmtRange = (a: Date, b: Date) => {
    const sameMonth = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
    if (sameMonth) return fmtMonth(a);
    return `${a.toLocaleDateString("da-DK")} – ${b.toLocaleDateString("da-DK")}`;
  };

  const periods: StatementPeriod[] = invoices.map((inv) => {
    const elKwh = (inv.endKwh != null && inv.startKwh != null)
      ? Math.max(0, inv.endKwh - inv.startKwh) : null;
    const heatKwh = (inv.endHeatingKwh != null && inv.startHeatingKwh != null)
      ? Math.max(0, inv.endHeatingKwh - inv.startHeatingKwh) : null;
    const combinedKwh = (elKwh !== null || heatKwh !== null)
      ? (elKwh ?? 0) + (heatKwh ?? 0) : null;
    const waterL = (inv.endWaterLiters != null && inv.startWaterLiters != null)
      ? Math.max(0, inv.endWaterLiters - inv.startWaterLiters) : null;
    const status = inv.status as "PAID" | "PENDING" | "OVERDUE" | "DRAFT";
    return {
      label: fmtRange(inv.periodStart, inv.periodEnd),
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      electricityKwh: combinedKwh,
      electricityCost: inv.electricityCost,
      waterLiters: waterL,
      waterCost: inv.waterCost,
      totalAmount: inv.totalAmount,
      paidAmount: status === "PAID" ? inv.totalAmount : 0,
      paymentStatus: status,
      invoiceId: inv.id,
    };
  });

  // Compute the "remainder" period — consumption since the last invoice (or
  // since check-in if none) that has not yet been billed. For ACTIVE sessions
  // we read live meters; for COMPLETED sessions we use session.endKwh.
  const hw = session.unit.hardware;
  const lastInvoice = invoices.length > 0 ? invoices[invoices.length - 1] : null;
  const remainderStart = lastInvoice ? lastInvoice.periodEnd : session.checkInTime;
  const remainderEnd = session.checkOutTime ?? new Date();

  let remainderStartKwh: number | null = null;
  let remainderEndKwh: number | null = null;
  let remainderStartHeating: number | null = null;
  let remainderEndHeating: number | null = null;
  let remainderStartWater: number | null = null;
  let remainderEndWater: number | null = null;

  if (session.status === "ACTIVE") {
    if (hardware.hasElectricityMeter(hw)) {
      remainderStartKwh = lastInvoice?.endKwh ?? session.startKwh;
      remainderEndKwh = await safeReadMeter(hardware.electricityMeterEp(hw!), `statement:el session=${session.id}`);
    }
    if (hardware.hasHeatingMeter(hw)) {
      remainderStartHeating = lastInvoice?.endHeatingKwh ?? session.startHeatingKwh;
      remainderEndHeating = await safeReadMeter(hardware.heatingMeterEp(hw!), `statement:heat session=${session.id}`);
    }
    if (hardware.hasWaterMeter(hw)) {
      remainderStartWater = lastInvoice?.endWaterLiters ?? session.startWaterLiters;
      remainderEndWater = await safeReadMeter(hardware.waterMeterEp(hw!), `statement:water session=${session.id}`);
    }
  } else {
    // COMPLETED — use stored readings
    remainderStartKwh = lastInvoice?.endKwh ?? session.startKwh;
    remainderEndKwh = session.endKwh;
    remainderStartHeating = lastInvoice?.endHeatingKwh ?? session.startHeatingKwh;
    remainderEndHeating = session.endHeatingKwh;
    remainderStartWater = lastInvoice?.endWaterLiters ?? session.startWaterLiters;
    remainderEndWater = session.endWaterLiters;
  }

  const remMainKwh = (remainderEndKwh != null && remainderStartKwh != null)
    ? Math.max(0, remainderEndKwh - remainderStartKwh) : null;
  const remHeatKwh = (remainderEndHeating != null && remainderStartHeating != null)
    ? Math.max(0, remainderEndHeating - remainderStartHeating) : null;
  const remCombinedKwh = (remMainKwh !== null || remHeatKwh !== null)
    ? (remMainKwh ?? 0) + (remHeatKwh ?? 0) : null;
  const remWaterL = (remainderEndWater != null && remainderStartWater != null)
    ? Math.max(0, remainderEndWater - remainderStartWater) : null;

  // Prefer the time-weighted accumulator (populated by 10-min cron ticks) so
  // the remainder is billed against the actual hourly spot price in effect
  // when each kWh was consumed. Fall back to snapshot pricing for sessions
  // pre-dating the accumulator or with no tick history.
  const useAccumulatorForRemainder =
    session.accumulatedElCost > 0 || session.accumulatedWaterCost > 0;
  const remElectricityCost = useAccumulatorForRemainder
    ? session.accumulatedElCost
    : (remCombinedKwh ?? 0) * effectiveElPrice;
  const remWaterCost = useAccumulatorForRemainder
    ? session.accumulatedWaterCost
    : (remWaterL ?? 0) * waterRate;
  const remTotal = remElectricityCost + remWaterCost;

  // Only include the remainder as a period if it has > 0 consumption
  if (remCombinedKwh != null || remWaterL != null) {
    const hasAny = (remCombinedKwh ?? 0) > 0 || (remWaterL ?? 0) > 0;
    if (hasAny) {
      periods.push({
        label: session.status === "ACTIVE"
          ? `Ikke-faktureret forbrug (indtil nu)`
          : fmtRange(remainderStart, remainderEnd),
        periodStart: remainderStart,
        periodEnd: remainderEnd,
        electricityKwh: remCombinedKwh,
        electricityCost: remElectricityCost,
        waterLiters: remWaterL,
        waterCost: remWaterCost,
        totalAmount: remTotal,
        paidAmount: 0,
        paymentStatus: "UNINVOICED",
        invoiceId: null,
      });
    }
  }

  const totalElectricity = periods.reduce((s, p) => s + p.electricityCost, 0);
  const totalWater = periods.reduce((s, p) => s + p.waterCost, 0);
  const totalCost = periods.reduce((s, p) => s + p.totalAmount, 0);
  const totalPaid = periods.reduce((s, p) => s + p.paidAmount, 0);
  const rawOwed = totalCost - totalPaid;
  // Amounts under 1 DKK are considered rounding noise and ignored
  const owed = rawOwed < 1 ? 0 : rawOwed;

  return {
    session: {
      id: session.id,
      guestName: session.guestName,
      guestEmail: session.guestEmail,
      guestPhone: session.guestPhone,
      bookingRef: session.bookingRef,
      checkInTime: session.checkInTime,
      checkOutTime: session.checkOutTime,
      status: session.status as "ACTIVE" | "COMPLETED",
      isLongTerm: session.unit.isLongTerm,
    },
    unit: {
      id: session.unit.id,
      name: session.unit.name,
      type: session.unit.type,
    },
    periods,
    totals: {
      electricityCost: totalElectricity,
      waterCost: totalWater,
      totalCost,
      totalPaid,
      owed,
    },
    generatedAt: new Date(),
    currency: pricing.currency,
  };
}

// ──────────────────────────────────────────────
// CHECK-OUT WITH STATEMENT — wraps checkOut() and, for postpaid bookings,
// attempts to generate a final invoice for any un-invoiced remainder so the
// printed statement fully reflects what the guest is being charged. If the
// remainder is below 1 DKK we silently skip invoice creation.
// ──────────────────────────────────────────────
export async function checkOutWithStatement(sessionId: number) {
  await requireAuth();
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { unitId: true, billingMode: true, status: true },
  });
  if (!session) throw new Error("Session ikke fundet");

  if (session.status === "ACTIVE") {
    await checkOut(sessionId);
  }

  // For postpaid bookings, try to create a closing invoice covering any
  // consumption since the last invoice. Ignored if under the 1 DKK threshold.
  if (session.billingMode !== "PREPAID") {
    try {
      await createMonthlyInvoice(session.unitId);
    } catch (e) {
      // Expected when there's no un-invoiced consumption or it's < 1 DKK.
      if (!(e instanceof Error) || !e.message.includes("mindst 1 DKK")) {
        logger.error("invoice", "checkOutWithStatement invoice fejl", e);
      }
    }
  }

  revalidatePath(`/admin/bookings/${sessionId}`);
  revalidatePath(`/admin/bookings/${sessionId}/statement`);
  return { ok: true };
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
export async function tickSessionConsumption(sessionId: number): Promise<{
  addedKwh: number;
  addedElCost: number;
  addedLiters: number;
  addedWaterCost: number;
  elPriceAtTick: number;
  spotPrice: number | null;
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

  // Main electricity
  if (currentKwh !== null) {
    const baseline = session.lastTickKwh ?? session.startKwh;
    if (baseline !== null) {
      const delta = Math.max(0, currentKwh - baseline);
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
      const delta = Math.max(0, currentHeatingKwh - baseline);
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
      const delta = Math.max(0, currentWaterLiters - baseline);
      addWaterLiters += delta;
      addWaterCost += delta * waterPrice;
    } else {
      updateData.startWaterLiters = currentWaterLiters;
    }
    updateData.lastTickWaterLiters = currentWaterLiters;
  }

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
  };
}

// Tick every active session — invoked from the cron route.
export async function tickAllSessionConsumption(): Promise<{
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
      const result = await tickSessionConsumption(s.id);
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
export async function getLiveConsumption(sessionId: number) {
  const initial = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: { include: { hardware: true } } },
  });

  if (!initial || initial.status !== "ACTIVE") return null;

  // Opportunistic tick — keeps the accumulator fresh when someone is actively
  // viewing the booking. Cron is the guarantee (every 10 min); this is the
  // nicety for the operator UI.
  const STALE_TICK_MS = 60 * 1000;
  const isStale = !initial.lastTickAt || (Date.now() - initial.lastTickAt.getTime() > STALE_TICK_MS);
  let session = initial;
  if (isStale) {
    try {
      await tickSessionConsumption(sessionId);
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
  if (hardware.hasElectricityMeter(hw)) {
    currentKwh = await safeReadMeter(hardware.electricityMeterEp(hw!), `live:el session=${sessionId}`);
  }
  if (hardware.hasHeatingMeter(hw)) {
    currentHeatingKwh = await safeReadMeter(hardware.heatingMeterEp(hw!), `live:heat session=${sessionId}`);
  }
  if (hardware.hasWaterMeter(hw)) {
    currentWaterLiters = await safeReadMeter(hardware.waterMeterEp(hw!), `live:water session=${sessionId}`);
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

  return {
    currentKwh,
    usedKwh,
    electricityCost,
    // Split for admin UI (raw "since check-in" values — for display only)
    usedKwhMain,
    usedKwhHeating,
    currentHeatingKwh,
    hasHeatingMeter: hardware.hasHeatingMeter(hw),
    currentWaterLiters,
    usedWaterLiters: waterUsed > 0 ? waterUsed : usedWaterLiters,
    waterCost,
    totalLiveCost: electricityCost + waterCost,
    currency: pricing.currency,
    pricePerKwh: effectiveElPrice,
    spotPrice,
    pricingMode: pricing.pricingMode,
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

  // Read the power sensors in parallel — each failure is isolated
  const [rawElec, rawHeat] = await Promise.all([
    hasElectricityPower
      ? hardware.readPowerWatts(hardware.electricityPowerEp(hw)).then((r) => r?.watts ?? null).catch(() => null)
      : Promise.resolve(null),
    hasHeatingPower
      ? hardware.readPowerWatts(hardware.heatingPowerEp(hw)).then((r) => r?.watts ?? null).catch(() => null)
      : Promise.resolve(null),
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
export async function getUnitHAStates(unitId: number) {
  await requireAuth();
  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: { hardware: true },
  });

  if (!unit?.hardware) return null;
  const hw = unit.hardware;

  let powerOn: boolean | null = null;
  let heatingOn: boolean | null = null;
  let temperature: number | null = null;
  let locked: boolean | null = null;
  let anySuccess = false;

  if (hardware.hasElectricitySwitch(hw)) {
    try {
      const s = await hardware.getSwitchState(hardware.electricitySwitchEp(hw));
      if (s !== null) { powerOn = s; anySuccess = true; }
    } catch { /* endpoint unavailable */ }
  }
  if (hardware.hasHeatingSwitch(hw)) {
    try {
      const s = await hardware.getSwitchState(hardware.heatingSwitchEp(hw));
      if (s !== null) { heatingOn = s; anySuccess = true; }
    } catch { /* endpoint unavailable */ }
  }
  if (hw.hasClimate && hw.climateEntityId) {
    try {
      const state = await ha.getEntityState(hw.climateEntityId);
      temperature = typeof state.attributes.current_temperature === "number"
        ? state.attributes.current_temperature : null;
      anySuccess = true;
    } catch { /* entity unavailable */ }
  }
  if (hw.hasSmartLock && hw.lockEntityId) {
    try {
      const state = await ha.getEntityState(hw.lockEntityId);
      locked = state.state === "locked";
      anySuccess = true;
    } catch { /* entity unavailable */ }
  }

  // If no endpoints were reachable, probe connectivity — prefer HA when any
  // field is HA-sourced, otherwise report MQTT broker state.
  if (!anySuccess) {
    const anyHA = [
      hw.electricitySource, hw.heatingSource, hw.waterSource,
    ].some((s) => s !== "MQTT") || hw.hasClimate || hw.hasSmartLock;
    const reachable = anyHA ? await ha.checkHAConnection() : mqttClient.isConnected();
    return { powerOn, heatingOn, winterModeEnabled: hw.winterModeEnabled, temperature, locked, haReachable: reachable };
  }

  return { powerOn, heatingOn, winterModeEnabled: hw.winterModeEnabled, temperature, locked, haReachable: true };
}

// ──────────────────────────────────────────────
// Manual HA controls
// ──────────────────────────────────────────────
export async function togglePower(unitId: number, turnOn: boolean) {
  await requireAuth();
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, include: { hardware: true } });
  if (!hardware.hasElectricitySwitch(unit?.hardware)) return;
  await hardware.setSwitch(hardware.electricitySwitchEp(unit!.hardware!), turnOn);
  revalidatePath(`/admin/units/${unitId}`);
}

export async function toggleHeating(unitId: number, turnOn: boolean) {
  await requireAuth();
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, include: { hardware: true } });
  if (!hardware.hasHeatingSwitch(unit?.hardware)) return;
  await hardware.setSwitch(hardware.heatingSwitchEp(unit!.hardware!), turnOn);
  revalidatePath(`/admin/units/${unitId}`);
}

export async function toggleLock(unitId: number, lock: boolean) {
  await requireAuth();
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, include: { hardware: true } });
  if (!unit?.hardware?.lockEntityId) return;
  if (lock) { await ha.lockDoor(unit.hardware.lockEntityId); }
  else { await ha.unlockDoor(unit.hardware.lockEntityId); }
  revalidatePath(`/admin/units/${unitId}`);
}

export async function setTemperature(unitId: number, temp: number) {
  await requireAuth();
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, include: { hardware: true } });
  if (!unit?.hardware?.climateEntityId) return;
  await ha.setClimateTemperature(unit.hardware.climateEntityId, temp);
  revalidatePath(`/admin/units/${unitId}`);
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
    include: { hardware: true, invoices: { orderBy: { periodEnd: "desc" }, take: 12 } },
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

// ──────────────────────────────────────────────
// INVOICES — Monthly billing
// ──────────────────────────────────────────────
export async function createMonthlyInvoice(unitId: number) {
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
  const lastInvoiceForPeriod = activeSessionForPeriod
    ? await prisma.invoice.findFirst({
        where: { unitId },
        orderBy: { id: "desc" },
      })
    : null;

  const periodStart = activeSessionForPeriod
    ? (lastInvoiceForPeriod && lastInvoiceForPeriod.periodEnd > activeSessionForPeriod.checkInTime
        ? lastInvoiceForPeriod.periodEnd
        : activeSessionForPeriod.checkInTime)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = activeSessionForPeriod
    ? now
    : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

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
      await tickSessionConsumption(activeSession.id);
    } catch (e) {
      logger.error("invoice", "createMonthlyInvoice: tick fejlede", e);
    }
  }
  // Reload the session with fresh accumulator values
  const sessionForBilling = activeSession
    ? await prisma.session.findUnique({ where: { id: activeSession.id } })
    : null;

  // If we have a real accumulator, use it verbatim — it's the
  // time-weighted truth. Otherwise fall back to snapshot pricing.
  let electricityCost: number;
  let waterCost: number;
  const useAccumulator = sessionForBilling && sessionForBilling.accumulatedElCost > 0;

  if (useAccumulator) {
    electricityCost = sessionForBilling.accumulatedElCost;
    waterCost = sessionForBilling.accumulatedWaterCost;
  } else {
    // Legacy snapshot pricing — used for units without an active session
    // or for brand-new sessions where no tick has accumulated anything.
    let effectiveElPrice = pricing.pricePerKwh;
    try {
      const effective = await getEffectiveElPricing();
      effectiveElPrice = effective.pricePerKwh;
    } catch {
      // Fallback to fixed price
    }
    if (activeSession?.pricePerKwhOverride != null) {
      effectiveElPrice = activeSession.pricePerKwhOverride;
    }
    const waterRate = activeSession?.pricePerLiterWaterOverride ?? pricing.pricePerLiterWater;

    const mainElecCost = (endKwh !== null && startKwh !== null)
      ? Math.max(0, endKwh - startKwh) * effectiveElPrice : 0;
    const heatingElecCost = (endHeatingKwh !== null && startHeatingKwh !== null)
      ? Math.max(0, endHeatingKwh - startHeatingKwh) * effectiveElPrice : 0;
    electricityCost = mainElecCost + heatingElecCost;
    waterCost = (endWaterLiters !== null && startWaterLiters !== null)
      ? Math.max(0, endWaterLiters - startWaterLiters) * waterRate : 0;
  }

  const totalAmount = electricityCost + waterCost;
  if (totalAmount < 1) {
    throw new Error("Beløbet skal være mindst 1 DKK — intet nyt forbrug siden sidste faktura");
  }

  const invoice = await prisma.invoice.create({
    data: {
      unitId,
      periodStart,
      periodEnd,
      startKwh,
      endKwh,
      startHeatingKwh,
      endHeatingKwh,
      startWaterLiters,
      endWaterLiters,
      electricityCost,
      waterCost,
      totalAmount,
      status: "PENDING",
      paymentToken: uuidv4(),
    },
  });

  // Reset the accumulator — that consumption is now billed on the invoice.
  // Keep lastTick* values so the *next* tick computes delta from the same
  // meter reading and we don't double-charge the hour this tick happened in.
  if (useAccumulator && sessionForBilling) {
    await prisma.session.update({
      where: { id: sessionForBilling.id },
      data: {
        accumulatedElCost: 0,
        accumulatedElKwh: 0,
        accumulatedWaterCost: 0,
        accumulatedWaterLiters: 0,
      },
    });
  }

  revalidatePath(`/admin/units/${unitId}`);
  return invoice;
}

// ──────────────────────────────────────────────
// AUTO INVOICING — cron-triggered for fastliggere
// ──────────────────────────────────────────────
export async function autoCreateAndSendInvoices(): Promise<{ created: number; sent: number }> {
  const settings = await getGlobalSettings();
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
  const todayStr = today.toISOString().slice(0, 10);
  if (settings._last_auto_invoice_date === todayStr) return { created: 0, sent: 0 };

  // Find all seasonal units with tenant info
  const seasonalUnits = await prisma.unit.findMany({
    where: { type: "SEASONAL", isLongTerm: true, longTermGuestName: { not: null } },
    include: { hardware: true },
  });

  let created = 0;
  let sent = 0;

  for (const unit of seasonalUnits) {
    try {
      const invoice = await createMonthlyInvoice(unit.id);
      created++;

      // Send notification
      if (unit.longTermGuestEmail || unit.longTermGuestPhone) {
        await sendInvoiceToCustomer(invoice.id, unit.id);
        sent++;
      }
    } catch (e) {
      logger.error("invoice", `Auto-faktura fejl for enhed ${unit.id}`, e);
    }
  }

  // Mark as done for today
  await prisma.globalSetting.upsert({
    where: { key: "_last_auto_invoice_date" },
    update: { value: todayStr },
    create: { key: "_last_auto_invoice_date", value: todayStr },
  });

  return { created, sent };
}

// Check overdue invoices and optionally cut power
export async function checkOverdueInvoices(): Promise<{ markedOverdue: number; powerOff: number }> {
  const settings = await getGlobalSettings();
  const deadlineDays = parseInt(settings.invoice_payment_deadline_days || "14", 10);
  const autoPowerOff = settings.invoice_auto_power_off === "true";

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - deadlineDays);

  // Find PENDING invoices that have passed the deadline
  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      status: "PENDING",
      createdAt: { lte: cutoffDate },
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

    // Auto power-off if enabled
    if (autoPowerOff && hardware.hasElectricitySwitch(invoice.unit.hardware)) {
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
export async function checkPrepaidBalances(): Promise<{ powerOff: number }> {
  const settings = await getGlobalSettings();
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
    if (!session.prepaidAmount || !hardware.hasElectricitySwitch(hw)) continue;
    const switchEp = hardware.electricitySwitchEp(hw!);
    const prepaidAmount = session.prepaidAmount;

    // Tick to refresh accumulator against the current spot price — prepaid
    // balance should be measured against the time-weighted real cost, not
    // a snapshot. The cron already ticks, but we do it here too so the
    // cutoff decision uses the freshest possible numbers.
    try {
      await tickSessionConsumption(session.id);
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
    const result = await sendInvoiceToCustomer(invoice.id, invoice.unitId);
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
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: "PAID", paidAt: new Date(), paymentId: paymentId ?? null },
  });
  revalidatePath("/admin");
}

export async function sendInvoiceToCustomer(invoiceId: number, unitId: number): Promise<{ ok: boolean; message: string }> {
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
    const relevantSession = await prisma.session.findFirst({
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

  const settings = await getGlobalSettings();
  const baseUrl = settings.site_url || "http://localhost:3000";
  const portalUrl = portalToken ? `${baseUrl}/guest/${portalToken}` : baseUrl;

  const typeLabels: Record<string, string> = { CABIN: "Hytte", SEASONAL: "Fastligger", CARAVAN: "Campingvogn", PITCH: "Plads" };
  const unitName = `${typeLabels[unit.type] || ""} ${unit.name}`.trim();
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
export async function getAllSessions(filter?: "all" | "unpaid" | "paid" | "active", search?: string) {
  await requireAuth();
  const filterWhere = filter === "unpaid" ? { status: "COMPLETED" as const, paymentStatus: "UNPAID" as const }
    : filter === "paid" ? { paymentStatus: "PAID" as const }
    : filter === "active" ? { status: "ACTIVE" as const }
    : {};

  const searchWhere = search && search.trim()
    ? {
        OR: [
          { guestName: { contains: search.trim() } },
          { bookingRef: { contains: search.trim() } },
          { guestEmail: { contains: search.trim() } },
          { guestPhone: { contains: search.trim() } },
        ],
      }
    : {};

  return prisma.session.findMany({
    where: { ...filterWhere, ...searchWhere },
    include: { unit: true },
    orderBy: { checkInTime: "desc" },
    take: 100,
  });
}

export async function getSessionById(sessionId: number) {
  await requireAuth();
  return prisma.session.findUnique({
    where: { id: sessionId },
    include: {
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

export async function markSessionPaid(sessionId: number, paymentId?: string) {
  await requireAuth();
  await prisma.session.update({
    where: { id: sessionId },
    data: { paymentStatus: "PAID", paidAt: new Date(), paymentId: paymentId ?? null },
  });
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${sessionId}`);
}

export async function markSessionUnpaid(sessionId: number) {
  await requireAuth();
  await prisma.session.update({
    where: { id: sessionId },
    data: { paymentStatus: "UNPAID", paidAt: null, paymentId: null },
  });
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${sessionId}`);
}

/** Adjust the prepaid amount for a booking (e.g. guest pays extra cash at reception). */
export async function adjustPrepaidAmount(sessionId: number, newAmount: number) {
  await requireAuth();
  if (newAmount < 0) throw new Error("Beløb kan ikke være negativt");
  await prisma.session.update({
    where: { id: sessionId },
    data: { prepaidAmount: newAmount },
  });
  revalidatePath(`/admin/bookings/${sessionId}`);
  revalidatePath("/admin/bookings");
}

export async function updateSessionDetails(
  sessionId: number,
  data: {
    guestName?: string;
    guestEmail?: string;
    guestPhone?: string;
    bookingRef?: string;
    notes?: string;
    expectedCheckOut?: string;
    startKwh?: number | null;
    endKwh?: number | null;
    startHeatingKwh?: number | null;
    endHeatingKwh?: number | null;
    startWaterLiters?: number | null;
    endWaterLiters?: number | null;
    pricePerKwhOverride?: number | null;
    pricePerLiterWaterOverride?: number | null;
  }
) {
  await requireAuth();
  const updateData: Record<string, unknown> = {};
  if (data.guestName !== undefined) updateData.guestName = data.guestName;
  if (data.guestEmail !== undefined) updateData.guestEmail = data.guestEmail || null;
  if (data.guestPhone !== undefined) updateData.guestPhone = data.guestPhone || null;
  if (data.bookingRef !== undefined) updateData.bookingRef = data.bookingRef || null;
  if (data.notes !== undefined) updateData.notes = data.notes || null;
  if (data.expectedCheckOut !== undefined) updateData.expectedCheckOut = data.expectedCheckOut ? new Date(data.expectedCheckOut) : null;
  if (data.startKwh !== undefined) updateData.startKwh = data.startKwh;
  if (data.endKwh !== undefined) updateData.endKwh = data.endKwh;
  if (data.startHeatingKwh !== undefined) updateData.startHeatingKwh = data.startHeatingKwh;
  if (data.endHeatingKwh !== undefined) updateData.endHeatingKwh = data.endHeatingKwh;
  if (data.startWaterLiters !== undefined) updateData.startWaterLiters = data.startWaterLiters;
  if (data.endWaterLiters !== undefined) updateData.endWaterLiters = data.endWaterLiters;
  if (data.pricePerKwhOverride !== undefined) updateData.pricePerKwhOverride = data.pricePerKwhOverride;
  if (data.pricePerLiterWaterOverride !== undefined) updateData.pricePerLiterWaterOverride = data.pricePerLiterWaterOverride;

  // If consumption OR any price override was manually edited, recalculate costs
  const needsRecalc = data.startKwh !== undefined || data.endKwh !== undefined
    || data.startHeatingKwh !== undefined || data.endHeatingKwh !== undefined
    || data.startWaterLiters !== undefined || data.endWaterLiters !== undefined
    || data.pricePerKwhOverride !== undefined || data.pricePerLiterWaterOverride !== undefined;

  if (needsRecalc) {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (session) {
      const pricing = await getPricing();
      const startKwh = data.startKwh !== undefined ? data.startKwh : session.startKwh;
      const endKwh = data.endKwh !== undefined ? data.endKwh : session.endKwh;
      const startHeatingKwh = data.startHeatingKwh !== undefined ? data.startHeatingKwh : session.startHeatingKwh;
      const endHeatingKwh = data.endHeatingKwh !== undefined ? data.endHeatingKwh : session.endHeatingKwh;
      const startWater = data.startWaterLiters !== undefined ? data.startWaterLiters : session.startWaterLiters;
      const endWater = data.endWaterLiters !== undefined ? data.endWaterLiters : session.endWaterLiters;

      // Use per-booking override when set, otherwise fall back to the global price
      const kwhRate = (data.pricePerKwhOverride !== undefined ? data.pricePerKwhOverride : session.pricePerKwhOverride)
        ?? pricing.pricePerKwh;
      const waterRate = (data.pricePerLiterWaterOverride !== undefined ? data.pricePerLiterWaterOverride : session.pricePerLiterWaterOverride)
        ?? pricing.pricePerLiterWater;

      let elCostCalc = 0;
      let hasElCalc = false;
      if (startKwh != null && endKwh != null) {
        const usedKwh = Math.max(0, endKwh - startKwh);
        elCostCalc += usedKwh * kwhRate;
        hasElCalc = true;
      }
      if (startHeatingKwh != null && endHeatingKwh != null) {
        const usedHeating = Math.max(0, endHeatingKwh - startHeatingKwh);
        elCostCalc += usedHeating * kwhRate;
        hasElCalc = true;
      }
      if (hasElCalc) {
        updateData.totalElectricityCost = parseFloat(elCostCalc.toFixed(2));
      }
      if (startWater != null && endWater != null) {
        const usedWater = Math.max(0, endWater - startWater);
        updateData.totalWaterCost = parseFloat((usedWater * waterRate).toFixed(2));
      }
      const elCost = (updateData.totalElectricityCost as number | undefined) ?? session.totalElectricityCost ?? 0;
      const waterCost = (updateData.totalWaterCost as number | undefined) ?? session.totalWaterCost ?? 0;
      updateData.totalCost = parseFloat(((elCost as number) + (waterCost as number)).toFixed(2));
    }
  }

  await prisma.session.update({ where: { id: sessionId }, data: updateData });
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${sessionId}`);
}

export async function resendGuestNotification(sessionId: number) {
  await requireAuth();
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: true },
  });
  if (!session) throw new Error("Session ikke fundet");

  const typeLabels: Record<string, string> = { CABIN: "Hytte", SEASONAL: "Fastligger", CARAVAN: "Campingvogn", PITCH: "Plads" };
  const unitDisplayName = `${typeLabels[session.unit.type] || ""} ${session.unit.name}`.trim();

  const { sendCheckInNotification } = await import("./notifications");
  const settings = await getGlobalSettings();
  const baseUrl = settings.site_url || "http://localhost:3000";
  const portalUrl = `${baseUrl}/guest/${session.guestPortalToken}`;

  await sendCheckInNotification(
    session.guestName,
    session.guestPhone || undefined,
    session.guestEmail || undefined,
    portalUrl,
    unitDisplayName,
  );

  return { ok: true };
}

export async function getUnpaidCount() {
  await requireAuth();
  return prisma.session.count({
    where: { status: "COMPLETED", paymentStatus: "UNPAID" },
  });
}

// ──────────────────────────────────────────────
// SYSTEM STATUS
// ──────────────────────────────────────────────
export async function getSystemStatus() {
  await requireAuth();
  const settings = await getGlobalSettings();
  const logCount = await prisma.consumptionLog.count();
  const latestLog = await prisma.consumptionLog.findFirst({ orderBy: { recordedAt: "desc" } });
  const unitCount = await prisma.unit.count();
  const sessionCount = await prisma.session.count();
  const invoiceCount = await prisma.invoice.count();

  return {
    cronLastRun: settings._cron_last_run || null,
    cronLastStatus: settings._cron_last_status || null,
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
export async function logAllConsumption() {
  const units = await prisma.unit.findMany({
    include: { hardware: true },
  });

  for (const unit of units) {
    const hw = unit.hardware;
    if (!hw) continue;

    let electricityKwh: number | null = null;
    let waterLiters: number | null = null;

    if (hardware.hasElectricityMeter(hw)) {
      electricityKwh = await safeReadMeter(hardware.electricityMeterEp(hw), `logAll:el unit=${unit.id}`);
    }
    if (hardware.hasWaterMeter(hw)) {
      waterLiters = await safeReadMeter(hardware.waterMeterEp(hw), `logAll:water unit=${unit.id}`);
    }

    if (electricityKwh !== null || waterLiters !== null) {
      await prisma.consumptionLog.create({
        data: { unitId: unit.id, electricityKwh, waterLiters },
      });
    }
  }
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

// ──────────────────────────────────────────────
// TOTAL CONSUMPTION HISTORY — aggregated across all units
// ──────────────────────────────────────────────
export async function getTotalConsumptionHistory(period: "week" | "month" = "week") {
  await requireAuth();
  const since = new Date();
  if (period === "week") {
    since.setDate(since.getDate() - 90); // last ~13 weeks
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
  const perUnit: { unitId: number; name: string; type: string; kwhPerHour: number | null; waterPerHour: number | null }[] = [];

  for (const unit of units) {
    // Try consumption log rate first (2 most recent logs)
    const logs = await prisma.consumptionLog.findMany({
      where: { unitId: unit.id },
      orderBy: { recordedAt: "desc" },
      take: 2,
    });

    let kwhPerHour: number | null = null;
    let waterPerHour: number | null = null;

    if (logs.length >= 2) {
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
      try {
        const res = await hardware.readPowerWatts(hardware.electricityPowerEp(unit.hardware!));
        if (res && res.watts >= 0) {
          kwhPerHour = res.watts / 1000; // W to kW
        }
      } catch {
        // endpoint unreachable
      }
    }

    // If still no rate, try computing from meter endpoint + recent log
    if (kwhPerHour === null && hardware.hasElectricityMeter(unit.hardware)) {
      try {
        const currentKwh = await hardware.readEnergyKwh(hardware.electricityMeterEp(unit.hardware!));
        if (currentKwh !== null && logs.length >= 1 && logs[0].electricityKwh !== null) {
          const hoursSinceLog = (Date.now() - new Date(logs[0].recordedAt).getTime()) / 3600000;
          if (hoursSinceLog > 0 && hoursSinceLog < 4) {
            kwhPerHour = Math.max(0, currentKwh - logs[0].electricityKwh) / hoursSinceLog;
          }
        }
      } catch {
        // endpoint unreachable
      }
    }

    if (kwhPerHour !== null) {
      totalKwhPerHour += kwhPerHour;
      unitCount++;
    }
    if (waterPerHour !== null) {
      totalWaterLitersPerHour += waterPerHour;
    }

    perUnit.push({ unitId: unit.id, name: unit.name, type: unit.type, kwhPerHour, waterPerHour });
  }

  return { totalKwhPerHour, totalWaterLitersPerHour, unitCount, perUnit };
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

  const typeLabels: Record<string, string> = { CABIN: "Hytte", SEASONAL: "Fastligger", CARAVAN: "Campingvogn", PITCH: "Plads" };
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
    "Vaskerikredit (DKK)",
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

    // Grand total = forbrug + ekstern pris − vaskerikredit. This matches how
    // the booking detail page computes the amount to charge the guest.
    const grandTotal = (totalCost ?? 0) + (s.externalPrice ?? 0) - s.laundryCredit;

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

  const typeLabels: Record<string, string> = { CABIN: "Hytte", SEASONAL: "Fastligger", CARAVAN: "Campingvogn", PITCH: "Plads" };
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
export async function checkConsumptionAlarms(): Promise<{
  alerts: { unitId: number; unitName: string; type: "electricity" | "water"; usage: number; threshold: number }[];
}> {
  const settings = await getGlobalSettings();
  if (settings.alarm_enabled !== "true") return { alerts: [] };

  const kwhThreshold = parseFloat(settings.alarm_kwh_threshold || "10");
  const waterThreshold = parseFloat(settings.alarm_water_threshold || "500");
  const hoursWindow = parseInt(settings.alarm_hours_window || "24", 10);

  const since = new Date();
  since.setHours(since.getHours() - hoursWindow);

  const units = await prisma.unit.findMany({ include: { hardware: true } });
  const alerts: { unitId: number; unitName: string; type: "electricity" | "water"; usage: number; threshold: number }[] = [];

  const typeLabels: Record<string, string> = { CABIN: "Hytte", SEASONAL: "Fastligger", CARAVAN: "Campingvogn", PITCH: "Plads" };

  for (const unit of units) {
    const logs = await prisma.consumptionLog.findMany({
      where: { unitId: unit.id, recordedAt: { gte: since } },
      orderBy: { recordedAt: "asc" },
    });

    if (logs.length < 2) continue;

    const firstLog = logs[0];
    const lastLog = logs[logs.length - 1];
    const unitName = `${typeLabels[unit.type] || ""} ${unit.name}`.trim();

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

  const amount = (session.totalCost || 0) + (session.externalPrice || 0);
  if (amount <= 0) throw new Error("Intet beløb at betale");

  const settings = await getGlobalSettings();
  const baseUrl = settings.site_url || "http://localhost:3000";

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

export async function createInvoicePayment(invoiceId: number) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { unit: true },
  });
  if (!invoice) throw new Error("Faktura ikke fundet");
  if (invoice.status === "PAID") throw new Error("Allerede betalt");
  if (invoice.totalAmount <= 0) throw new Error("Intet beløb at betale");

  const settings = await getGlobalSettings();
  const baseUrl = settings.site_url || "http://localhost:3000";
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
  totalLaundry: number;
  laundryCount: number;
}

export async function getEconomySummary(): Promise<{
  months: MonthlyEconomySummary[];
  unpaidSessions: { id: number; unitName: string; guestName: string; total: number; checkOut: string }[];
  unpaidInvoices: { id: number; unitName: string; total: number; periodEnd: string }[];
  laundryTotals: { total: number; count: number; paid: number };
}> {
  await requireAuth();
  const typeLabels: Record<string, string> = { CABIN: "Hytte", SEASONAL: "Fastligger", CARAVAN: "Campingvogn", PITCH: "Plads" };

  const [sessions, invoices, laundrySessions] = await Promise.all([
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
      include: { machine: true },
    }),
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

  // Laundry revenue
  for (const ls of laundrySessions) {
    const date = ls.startedAt || ls.createdAt;
    if (!date) continue;
    const month = (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 7);
    const m = getOrCreate(month);
    m.laundryCount++;
    const price = ls.pricePaid ?? 0;
    m.totalLaundry += price;
    m.totalRevenue += price;
    if (ls.paymentStatus === "PAID") m.totalPaid += price;
    else m.totalUnpaid += price;
  }

  const months = [...monthMap.values()].sort((a, b) => b.month.localeCompare(a.month));

  // Unpaid sessions
  const unpaidSessions = sessions
    .filter((s) => s.paymentStatus === "UNPAID" && (s.totalCost ?? 0) > 0)
    .map((s) => ({
      id: s.id,
      unitName: `${typeLabels[s.unit.type] || ""} ${s.unit.name}`.trim(),
      guestName: s.guestName,
      total: s.totalCost ?? 0,
      checkOut: s.checkOutTime?.toISOString().slice(0, 10) || "",
    }));

  // Unpaid invoices
  const unpaidInvoices = invoices
    .filter((inv) => inv.status !== "PAID" && inv.totalAmount > 0)
    .map((inv) => ({
      id: inv.id,
      unitName: `${typeLabels[inv.unit.type] || ""} ${inv.unit.name}`.trim(),
      total: inv.totalAmount,
      periodEnd: inv.periodEnd.toISOString().slice(0, 10),
    }));

  const laundryTotals = {
    total: laundrySessions.reduce((sum, ls) => sum + (ls.pricePaid ?? 0), 0),
    count: laundrySessions.length,
    paid: laundrySessions.filter((ls) => ls.paymentStatus === "PAID").reduce((sum, ls) => sum + (ls.pricePaid ?? 0), 0),
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
    },
  });
  revalidatePath("/admin/settings");
}

export async function deleteLaundryMachine(id: number) {
  await requireAuth();
  await prisma.laundryMachine.delete({ where: { id } });
  revalidatePath("/admin/settings");
}

// Get laundry machines with status for guest portal
export async function getGuestLaundryMachines() {
  // Auto-expire stale PENDING sessions (older than 5 minutes)
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  await prisma.laundrySess.updateMany({
    where: { status: "PENDING", createdAt: { lte: fiveMinutesAgo } },
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
      available: !isRunning,
      minutesLeft,
      endsAt: isRunning ? activeSession.endsAt.toISOString() : null,
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
): Promise<{ ok: boolean; message: string; paymentLink?: string }> {
  // Auto-expire stale PENDING sessions before checking availability
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  await prisma.laundrySess.updateMany({
    where: { machineId, status: "PENDING", createdAt: { lte: fiveMinutesAgo } },
    data: { status: "CANCELLED" },
  });

  const machine = await prisma.laundryMachine.findUnique({
    where: { id: machineId },
    include: { sessions: { where: { status: "ACTIVE" }, take: 1 } },
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

  // Find guest session and check laundry credit
  const guestSession = await prisma.session.findUnique({
    where: { guestPortalToken },
  });
  let credit = guestSession?.laundryCredit ?? 0;
  const price = machine.pricePerUse;

  // If prepaid credit for services is enabled and guest is PREPAID,
  // allow them to pay from their prepaid balance as extra credit.
  const globalSettings = await getGlobalSettings();
  const prepaidForServices = globalSettings.prepaid_credit_for_services === "true";
  let prepaidCreditUsed = 0;
  if (prepaidForServices && guestSession?.billingMode === "PREPAID" && guestSession.prepaidAmount) {
    const prepaidRemaining = guestSession.prepaidAmount;
    const shortfall = Math.max(0, price - credit);
    prepaidCreditUsed = Math.min(prepaidRemaining, shortfall);
    credit += prepaidCreditUsed;
  }

  const amountToPay = Math.max(0, price - credit);
  const creditUsed = Math.min(guestSession?.laundryCredit ?? 0, price);

  const endsAt = new Date();
  endsAt.setMinutes(endsAt.getMinutes() + machine.durationMinutes);

  // If guest has enough credit, start immediately (no payment needed)
  if (amountToPay <= 0) {
    // Deduct laundry credit and/or prepaid balance
    if (guestSession) {
      const newLaundryCredit = Math.max(0, (guestSession.laundryCredit ?? 0) - creditUsed);
      const newPrepaid = prepaidCreditUsed > 0
        ? Math.max(0, (guestSession.prepaidAmount ?? 0) - prepaidCreditUsed)
        : undefined;
      await prisma.session.update({
        where: { id: guestSession.id },
        data: {
          laundryCredit: newLaundryCredit,
          ...(newPrepaid !== undefined && { prepaidAmount: newPrepaid }),
        },
      });
    }

    const laundrySess = await prisma.laundrySess.create({
      data: {
        machineId,
        sessionId: guestSession?.id || null,
        guestPortalToken,
        endsAt,
        pricePaid: price,
        status: "ACTIVE",
        paymentStatus: "PAID",
      },
    });

    try { await hardware.setSwitch(hardware.switchRowEp(machine), true); } catch (e) { logger.error("laundry", "laundry on", e); }
    return { ok: true, message: `${machine.name} startet med kredit — kører i ${machine.durationMinutes} minutter` };
  }

  // Create laundry session in PENDING state (waiting for payment)
  const laundrySess = await prisma.laundrySess.create({
    data: {
      machineId,
      sessionId: guestSession?.id || null,
      guestPortalToken,
      endsAt,
      pricePaid: price,
      status: "PENDING",
      paymentStatus: "UNPAID",
    },
  });

  // Create QuickPay payment for remaining amount
  const settings = await getGlobalSettings();
  const baseUrl = settings.site_url || "http://localhost:3000";

  if (settings.quickpay_enabled !== "true") {
    // No payment configured — start directly
    if (guestSession && creditUsed > 0) {
      await prisma.session.update({
        where: { id: guestSession.id },
        data: { laundryCredit: Math.max(0, credit - creditUsed) },
      });
    }
    await prisma.laundrySess.update({
      where: { id: laundrySess.id },
      data: { status: "ACTIVE", paymentStatus: "PAID" },
    });
    try { await hardware.setSwitch(hardware.switchRowEp(machine), true); } catch (e) { logger.error("laundry", "laundry on", e); }
    return { ok: true, message: `${machine.name} startet — kører i ${machine.durationMinutes} minutter` };
  }

  try {
    const { createPaymentLink, generateOrderId } = await import("./quickpay");
    const orderId = generateOrderId("L", laundrySess.id);

    const { paymentId, paymentLink } = await createPaymentLink({
      orderId,
      amount: amountToPay,
      currency: settings.currency || "DKK",
      continueUrl: `${baseUrl}/guest/${guestPortalToken}?laundry_paid=1`,
      cancelUrl: `${baseUrl}/guest/${guestPortalToken}?laundry_cancelled=1`,
      callbackUrl: `${baseUrl}/api/quickpay/callback`,
    });

    // Store credit info so callback can deduct it
    await prisma.laundrySess.update({
      where: { id: laundrySess.id },
      data: { paymentId: String(paymentId) },
    });

    // Deduct credit now (it will be used regardless of payment)
    if (guestSession && creditUsed > 0) {
      await prisma.session.update({
        where: { id: guestSession.id },
        data: { laundryCredit: Math.max(0, credit - creditUsed) },
      });
    }

    return { ok: true, message: `Betaler ${amountToPay.toFixed(0)} DKK (${creditUsed.toFixed(0)} DKK kredit brugt)...`, paymentLink };
  } catch (e) {
    await prisma.laundrySess.delete({ where: { id: laundrySess.id } });
    return { ok: false, message: `Betaling kunne ikke oprettes: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// Start a laundry machine after payment is confirmed (called from callback)
export async function activateLaundrySession(laundrySessionId: number) {
  const sess = await prisma.laundrySess.findUnique({
    where: { id: laundrySessionId },
    include: { machine: true },
  });
  if (!sess || sess.status !== "PENDING") return;

  // Recalculate endsAt from now (since guest just paid)
  const endsAt = new Date();
  endsAt.setMinutes(endsAt.getMinutes() + sess.machine.durationMinutes);

  await prisma.laundrySess.update({
    where: { id: laundrySessionId },
    data: { status: "ACTIVE", paymentStatus: "PAID", endsAt },
  });

  // Turn on the Shelly relay with hardware auto-off safety net.
  // Add 120s buffer so the cron/client stop fires first under normal conditions.
  try {
    const autoOffSec = sess.machine.durationMinutes * 60 + 120;
    await hardware.setSwitchTimed(hardware.switchRowEp(sess.machine), autoOffSec);
  } catch (e) {
    logger.error("laundry", "Failed to turn on laundry machine", e);
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

  const settings = await getGlobalSettings();
  if (settings.quickpay_enabled !== "true") {
    return { ok: false, message: "Online betaling er ikke aktiveret" };
  }

  const baseUrl = settings.site_url || "http://localhost:3000";

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
export async function checkLaundryMachines() {
  const expired = await prisma.laundrySess.findMany({
    where: {
      status: "ACTIVE",
      endsAt: { lte: new Date() },
    },
    include: { machine: true },
  });

  for (const session of expired) {
    // Turn off relay (HA or MQTT)
    try {
      await hardware.setSwitch(hardware.switchRowEp(session.machine), false);
    } catch (e) {
      logger.error("laundry", `Failed to turn off laundry machine ${session.machine.name}`, e);
    }

    // Mark completed
    await prisma.laundrySess.update({
      where: { id: session.id },
      data: { status: "COMPLETED" },
    });
  }

  // Auto-expire PENDING laundry sessions older than 5 minutes
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const expiredPending = await prisma.laundrySess.updateMany({
    where: {
      status: "PENDING",
      createdAt: { lte: fiveMinutesAgo },
    },
    data: { status: "CANCELLED" },
  });

  return { turned_off: expired.length, expired_pending: expiredPending.count };
}

// ──────────────────────────────────────────────
// SERVICES — Admin overview & control
// ──────────────────────────────────────────────
export async function getServiceStatus() {
  await requireAuth();
  // Auto-expire stale PENDING sessions (older than 5 minutes)
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  await prisma.laundrySess.updateMany({
    where: { status: "PENDING", createdAt: { lte: fiveMinutesAgo } },
    data: { status: "CANCELLED" },
  });

  const machines = await prisma.laundryMachine.findMany({
    include: {
      sessions: {
        where: { status: { in: ["ACTIVE", "PENDING"] } },
        orderBy: { startedAt: "desc" },
        take: 1,
        include: { session: { select: { guestName: true, unit: { select: { name: true } } } } },
      },
    },
    orderBy: { name: "asc" },
  });

  return machines.map((m) => {
    const active = m.sessions[0];
    const now = new Date();
    const isRunning = active?.status === "ACTIVE" && new Date(active.endsAt) > now;
    const minutesLeft = isRunning ? Math.max(0, Math.round((new Date(active.endsAt).getTime() - now.getTime()) / 60000)) : 0;

    return {
      id: m.id,
      name: m.name,
      switchEntityId: m.switchEntityId,
      durationMinutes: m.durationMinutes,
      pricePerUse: m.pricePerUse,
      enabled: m.enabled,
      isRunning,
      isPending: active?.status === "PENDING",
      minutesLeft,
      endsAt: isRunning ? active.endsAt.toISOString() : null,
      activeSession: active ? {
        id: active.id,
        guestName: active.session?.guestName || null,
        unitName: active.session?.unit?.name || null,
        pricePaid: active.pricePaid,
        paymentStatus: active.paymentStatus,
        startedAt: active.startedAt.toISOString(),
      } : null,
    };
  });
}

export async function adminStartLaundry(machineId: number, durationMinutes: number) {
  await requireAuth();
  const machine = await prisma.laundryMachine.findUnique({ where: { id: machineId } });
  if (!machine) return { ok: false, message: "Maskine ikke fundet" };

  // Mark any expired active session as completed
  await prisma.laundrySess.updateMany({
    where: { machineId, status: "ACTIVE", endsAt: { lte: new Date() } },
    data: { status: "COMPLETED" },
  });

  // Check if already running
  const running = await prisma.laundrySess.findFirst({
    where: { machineId, status: "ACTIVE", endsAt: { gt: new Date() } },
  });
  if (running) return { ok: false, message: "Maskinen kører allerede" };

  const endsAt = new Date();
  endsAt.setMinutes(endsAt.getMinutes() + durationMinutes);

  await prisma.laundrySess.create({
    data: {
      machineId,
      endsAt,
      status: "ACTIVE",
      pricePaid: 0,
      paymentStatus: "PAID",
    },
  });

  try {
    const autoOffSec = durationMinutes * 60 + 120;
    await hardware.setSwitchTimed(hardware.switchRowEp(machine), autoOffSec);
  } catch (e) {
    return { ok: false, message: `Kunne ikke tænde: ${e instanceof Error ? e.message : String(e)}` };
  }

  return { ok: true, message: `Startet i ${durationMinutes} minutter` };
}

export async function adminExtendLaundry(laundrySessionId: number, extraMinutes: number) {
  await requireAuth();
  const sess = await prisma.laundrySess.findUnique({ where: { id: laundrySessionId } });
  if (!sess || sess.status !== "ACTIVE") return { ok: false, message: "Ingen aktiv session" };

  const newEndsAt = new Date(sess.endsAt);
  newEndsAt.setMinutes(newEndsAt.getMinutes() + extraMinutes);

  await prisma.laundrySess.update({
    where: { id: laundrySessionId },
    data: { endsAt: newEndsAt },
  });

  return { ok: true, message: `Forlænget med ${extraMinutes} minutter` };
}

export async function adminStopLaundry(laundrySessionId: number) {
  await requireAuth();
  const sess = await prisma.laundrySess.findUnique({
    where: { id: laundrySessionId },
    include: { machine: true },
  });
  if (!sess) return { ok: false, message: "Session ikke fundet" };

  await prisma.laundrySess.update({
    where: { id: laundrySessionId },
    data: { status: "COMPLETED", endsAt: new Date() },
  });

  try {
    await hardware.setSwitch(hardware.switchRowEp(sess.machine), false);
  } catch (e) {
    return { ok: false, message: `Stoppet i DB men kunne ikke slukke relæ: ${e instanceof Error ? e.message : String(e)}` };
  }

  return { ok: true, message: "Maskine stoppet" };
}

// ──────────────────────────────────────────────
// LAUNDRY CREDIT — Admin adds credit to booking
// ──────────────────────────────────────────────
export async function addLaundryCredit(sessionId: number, amount: number) {
  await requireAuth();
  if (amount <= 0) return { ok: false, message: "Beløb skal være positivt" };
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return { ok: false, message: "Booking ikke fundet" };

  await prisma.session.update({
    where: { id: sessionId },
    data: { laundryCredit: (session.laundryCredit ?? 0) + amount },
  });

  return { ok: true, message: `${amount.toFixed(2)} DKK kredit tilføjet` };
}

export async function removeLaundryCredit(sessionId: number, amount: number) {
  "use server";
  await requireAuth();
  if (amount <= 0) return { ok: false, message: "Beløb skal være positivt" };
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return { ok: false, message: "Booking ikke fundet" };

  const currentCredit = session.laundryCredit ?? 0;
  const newCredit = Math.max(0, currentCredit - amount);

  await prisma.session.update({
    where: { id: sessionId },
    data: { laundryCredit: newCredit },
  });

  const removed = currentCredit - newCredit;
  return { ok: true, message: `${removed.toFixed(2)} DKK kredit fjernet` };
}

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
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  await prisma.laundrySess.updateMany({
    where: { status: "PENDING", createdAt: { lte: fiveMinutesAgo } },
    data: { status: "CANCELLED" },
  });

  const group = await prisma.laundryGroup.findUnique({
    where: { token },
    include: {
      machines: {
        where: { enabled: true },
        include: { sessions: { where: { status: "ACTIVE" }, take: 1 } },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!group) return null;

  const now = new Date();
  return {
    id: group.id,
    name: group.name,
    machines: group.machines.map((m) => {
      const active = m.sessions[0];
      const isRunning = active && new Date(active.endsAt) > now;
      const minutesLeft = isRunning ? Math.max(0, Math.ceil((new Date(active.endsAt).getTime() - now.getTime()) / 60000)) : 0;
      return {
        id: m.id,
        name: m.name,
        durationMinutes: m.durationMinutes,
        pricePerUse: m.pricePerUse,
        available: !isRunning,
        minutesLeft,
        endsAt: isRunning ? active!.endsAt.toISOString() : null,
      };
    }),
  };
}

// Public: start a laundry machine from QR page (no guest session required)
export async function createPublicLaundryPayment(
  machineId: number,
  groupToken: string,
): Promise<{ ok: boolean; message: string; paymentLink?: string }> {
  // Auto-expire stale PENDING sessions before checking availability
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  await prisma.laundrySess.updateMany({
    where: { machineId, status: "PENDING", createdAt: { lte: fiveMinutesAgo } },
    data: { status: "CANCELLED" },
  });

  const machine = await prisma.laundryMachine.findUnique({
    where: { id: machineId },
    include: { sessions: { where: { status: "ACTIVE" }, take: 1 } },
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

  const price = machine.pricePerUse;
  const endsAt = new Date();
  endsAt.setMinutes(endsAt.getMinutes() + machine.durationMinutes);

  const settings = await getGlobalSettings();
  const baseUrl = settings.site_url || "http://localhost:3000";

  if (settings.quickpay_enabled !== "true") {
    // No payment configured — start directly
    await prisma.laundrySess.create({
      data: {
        machineId,
        guestPortalToken: `qr:${groupToken}`,
        endsAt,
        pricePaid: price,
        status: "ACTIVE",
        paymentStatus: "PAID",
      },
    });
    try { await hardware.setSwitch(hardware.switchRowEp(machine), true); } catch (e) { logger.error("laundry", "laundry on", e); }
    return { ok: true, message: `${machine.name} startet — kører i ${machine.durationMinutes} minutter` };
  }

  // Create pending session
  const laundrySess = await prisma.laundrySess.create({
    data: {
      machineId,
      guestPortalToken: `qr:${groupToken}`,
      endsAt,
      pricePaid: price,
      status: "PENDING",
      paymentStatus: "UNPAID",
    },
  });

  try {
    const { createPaymentLink, generateOrderId } = await import("./quickpay");
    const orderId = generateOrderId("L", laundrySess.id);

    const { paymentId, paymentLink } = await createPaymentLink({
      orderId,
      amount: price,
      currency: settings.currency || "DKK",
      continueUrl: `${baseUrl}/laundry/${groupToken}?paid=1`,
      cancelUrl: `${baseUrl}/laundry/${groupToken}?cancelled=1`,
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

// Admin view of all showers with status
export async function getShowerStatus() {
  await requireAuth();
  await expireStaleShowerPendings();
  const showers = await prisma.shower.findMany({
    orderBy: { name: "asc" },
    include: {
      sessions: {
        where: { status: { in: ["ACTIVE", "PAUSED", "PENDING"] } },
        take: 1,
        orderBy: { startedAt: "desc" },
      },
    },
  });

  const now = new Date();
  return showers.map((s) => {
    const active = s.sessions[0];
    const isRunning = !!active && active.status === "ACTIVE" && new Date(active.endsAt) > now;
    const isPaused = !!active && active.status === "PAUSED";
    const isPending = !!active && active.status === "PENDING";
    const secondsLeft = isRunning
      ? Math.max(0, Math.ceil((new Date(active.endsAt).getTime() - now.getTime()) / 1000))
      : isPaused && active.pauseRemainingMs
      ? Math.max(0, Math.ceil(active.pauseRemainingMs / 1000))
      : 0;

    return {
      id: s.id,
      name: s.name,
      location: s.location,
      switchEntityId: s.switchEntityId,
      pricePerMinute: s.pricePerMinute,
      minMinutes: s.minMinutes,
      maxMinutes: s.maxMinutes,
      enabled: s.enabled,
      code: s.code,
      isRunning,
      isPaused,
      isPending,
      secondsLeft,
      activeSession: active ? {
        id: active.id,
        status: active.status,
        minutesPaid: active.minutesPaid,
        pricePaid: active.pricePaid,
        endsAt: active.endsAt.toISOString(),
      } : null,
    };
  });
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
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  await prisma.showerSess.updateMany({
    where: { status: "PENDING", createdAt: { lte: fiveMinutesAgo } },
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

  const pending = await prisma.showerSess.create({
    data: {
      showerId,
      sessionId: guestSession?.id ?? null,
      endsAt,
      status: "PENDING",
      pricePaid: 0,
      minutesPaid: 0,
      pendingMinutes: mins,
      paymentStatus: "UNPAID",
    },
  });

  const settings = await getGlobalSettings();
  const baseUrl = settings.site_url || "http://localhost:3000";

  // No QuickPay configured → start immediately (dev / free mode)
  if (settings.quickpay_enabled !== "true") {
    await activateShowerSession(pending.id);
    return { ok: true, message: `Bad startet i ${mins} minutter`, showerSessionId: pending.id, accessToken: pending.accessToken };
  }

  try {
    const { createPaymentLink, generateOrderId } = await import("./quickpay");
    const orderId = generateOrderId("S", pending.id);

    const { paymentId, paymentLink } = await createPaymentLink({
      orderId,
      amount: price,
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
 * Called when the QuickPay callback accepts the payment, OR when QuickPay
 * is disabled and we start immediately. Opens the valve + flips status.
 */
export async function activateShowerSession(pendingId: number) {
  const sess = await prisma.showerSess.findUnique({
    where: { id: pendingId },
    include: { shower: true },
  });
  if (!sess) return;
  if (sess.status !== "PENDING") return;

  const mins = sess.pendingMinutes ?? 0;
  // Add warmup time so purchased minutes start AFTER the 10s warmup
  const endsAt = new Date(Date.now() + SHOWER_WARMUP_MS + mins * 60 * 1000);

  await prisma.showerSess.update({
    where: { id: pendingId },
    data: {
      status: "ACTIVE",
      paymentStatus: "PAID",
      startedAt: new Date(),
      endsAt,
      pricePaid: +(mins * sess.shower.pricePerMinute).toFixed(2),
      minutesPaid: mins,
      pendingMinutes: null,
    },
  });

  // Relay is NOT turned on here — client calls startShowerRelay() after the 10s warmup countdown
}

/** Turn on the shower relay after warmup countdown. Called by the client. */
export async function startShowerRelay(showerSessionId: number, accessToken?: string): Promise<{ ok: boolean; message: string }> {
  const sess = await prisma.showerSess.findUnique({
    where: { id: showerSessionId },
    include: { shower: true },
  });
  if (!sess) return { ok: false, message: "Session ikke fundet" };
  if (accessToken !== undefined && sess.accessToken !== accessToken) return { ok: false, message: "Ugyldig adgang" };
  if (sess.status !== "ACTIVE") return { ok: false, message: "Session er ikke aktiv" };

  const remainingSec = Math.max(0, Math.ceil((new Date(sess.endsAt).getTime() - Date.now()) / 1000));
  if (remainingSec <= 0) return { ok: false, message: "Tiden er udløbet" };

  try {
    // Turn on relay with hardware auto-off safety net (remaining time + 60s buffer)
    await hardware.setSwitchTimed(hardware.switchRowEp(sess.shower), remainingSec + 60);
  } catch (e) {
    logger.error("shower", "Shower relay start failed", e);
    return { ok: false, message: "Kunne ikke tænde bruser" };
  }

  return { ok: true, message: "Bruser startet" };
}

/**
 * Called when an extension payment resolves: adds the purchased
 * minutes on top of the existing timer.
 */
export async function applyShowerExtension(showerSessionId: number) {
  const sess = await prisma.showerSess.findUnique({
    where: { id: showerSessionId },
    include: { shower: true },
  });
  if (!sess) return;
  const extra = sess.pendingMinutes ?? 0;
  if (extra <= 0) return;

  // Active → extend endsAt. Paused → inflate the frozen remaining time.
  let newEndsAt = sess.endsAt;
  let newPauseRemainingMs = sess.pauseRemainingMs;
  if (sess.status === "PAUSED" && sess.pauseRemainingMs !== null) {
    newPauseRemainingMs = sess.pauseRemainingMs + extra * 60 * 1000;
  } else {
    const base = new Date(Math.max(Date.now(), new Date(sess.endsAt).getTime()));
    newEndsAt = new Date(base.getTime() + extra * 60 * 1000);
  }

  await prisma.showerSess.update({
    where: { id: showerSessionId },
    data: {
      endsAt: newEndsAt,
      pauseRemainingMs: newPauseRemainingMs,
      minutesPaid: sess.minutesPaid + extra,
      pricePaid: +(sess.pricePaid + extra * sess.shower.pricePerMinute).toFixed(2),
      pendingMinutes: null,
      paymentStatus: "PAID",
    },
  });

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
  // Validate access token (skip for internal/cron callers that don't pass one)
  if (accessToken !== undefined && sess.accessToken !== accessToken) return null;

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
  };
}

/** Pause an active shower — closes the valve and freezes the remaining time. */
export async function pauseShower(showerSessionId: number, accessToken?: string): Promise<{ ok: boolean; message: string }> {
  const sess = await prisma.showerSess.findUnique({
    where: { id: showerSessionId },
    include: { shower: true },
  });
  if (!sess) return { ok: false, message: "Session ikke fundet" };
  if (accessToken !== undefined && sess.accessToken !== accessToken) return { ok: false, message: "Ugyldig adgang" };
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
  if (accessToken !== undefined && sess.accessToken !== accessToken) return { ok: false, message: "Ugyldig adgang" };
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
  if (accessToken !== undefined && sess.accessToken !== accessToken) return { ok: false, message: "Ugyldig adgang" };
  if (sess.status !== "ACTIVE" && sess.status !== "PAUSED") {
    return { ok: false, message: "Kan kun forlænge en aktiv session" };
  }

  const extra = Math.round(extraMinutes);
  if (extra < sess.shower.minMinutes || extra > sess.shower.maxMinutes) {
    return { ok: false, message: `Køb mellem ${sess.shower.minMinutes} og ${sess.shower.maxMinutes} minutter` };
  }

  const price = +(extra * sess.shower.pricePerMinute).toFixed(2);

  const settings = await getGlobalSettings();
  const baseUrl = settings.site_url || "http://localhost:3000";

  if (settings.quickpay_enabled !== "true") {
    await prisma.showerSess.update({
      where: { id: showerSessionId },
      data: { pendingMinutes: extra },
    });
    await applyShowerExtension(showerSessionId);
    return { ok: true, message: `Forlænget med ${extra} minutter` };
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
  await requireAuth();
  const sess = await prisma.showerSess.findUnique({
    where: { id: showerSessionId },
    include: { shower: true },
  });
  if (!sess) return { ok: false, message: "Session ikke fundet" };

  await prisma.showerSess.update({
    where: { id: showerSessionId },
    data: { status: "COMPLETED", endsAt: new Date(), pausedAt: null, pauseRemainingMs: null },
  });

  try { await hardware.setSwitch(hardware.switchRowEp(sess.shower), false); } catch (e) {
    return { ok: false, message: `Stoppet i DB men kunne ikke slukke relæ: ${e instanceof Error ? e.message : String(e)}` };
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

/**
 * Background sweep — runs every 5s from the scheduler.
 *  - Auto-resume paused sessions after 5 min
 *  - Close expired active sessions (turn off valve)
 *  - Cancel old pending sessions
 */
export async function checkShowerSessions() {
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
  for (const sess of expired) {
    try { await hardware.setSwitch(hardware.switchRowEp(sess.shower), false); } catch (e) { logger.error("shower", "Shower close", e); }
    await prisma.showerSess.update({
      where: { id: sess.id },
      data: { status: "COMPLETED" },
    });
  }

  // 3) Clean up stale pending sessions
  await expireStaleShowerPendings();

  return {
    autoResumed: expiredPauses.length,
    completed: expired.length,
  };
}

// ─── Accounting Sync ───────────────────────────────────────────────

export async function testAccountingConnection(): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  const settings = await getGlobalSettings();
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
  const settings = await getGlobalSettings();
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
  const settings = await getGlobalSettings();
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

  const settings = await getGlobalSettings();
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
  const settings = await getGlobalSettings();
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

export async function testBookingConnection() {
  await requireAuth();
  const settings = await getGlobalSettings();
  const provider = getBookingProvider(
    (settings.booking_provider || "none") as "danplanner" | "none",
    settings,
  );
  if (!provider) return { ok: false, error: "Ingen booking-udbyder konfigureret" };
  return provider.testConnection();
}

export async function fetchBookingResourceTypes() {
  await requireAuth();
  const settings = await getGlobalSettings();
  const provider = getBookingProvider(
    (settings.booking_provider || "none") as "danplanner" | "none",
    settings,
  );
  if (!provider) return [];
  return provider.getResourceTypes();
}

export async function fetchBookingResources(typeId: string) {
  await requireAuth();
  const settings = await getGlobalSettings();
  const provider = getBookingProvider(
    (settings.booking_provider || "none") as "danplanner" | "none",
    settings,
  );
  if (!provider) return [];
  return provider.getResources(typeId);
}

export async function syncBookingResources() {
  await requireAuth();
  await ensureResourceTypes();

  const settings = await getGlobalSettings();
  const provider = getBookingProvider(
    (settings.booking_provider || "none") as "danplanner" | "none",
    settings,
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
  const settings = await getGlobalSettings();
  const provider = getBookingProvider(
    (settings.booking_provider || "none") as "danplanner" | "none",
    settings,
  );
  if (!provider) return { created: 0, updated: 0, skipped: [] as Array<{ booking: string; reason: string }>, error: "Ingen booking-udbyder konfigureret" };

  const providerName = settings.booking_provider || "danplanner";

  let bookings;
  try {
    bookings = await provider.getBookings(productType);
  } catch (err) {
    return {
      created: 0,
      updated: 0,
      skipped: [] as Array<{ booking: string; reason: string }>,
      error: (err as Error).message,
    };
  }

  let created = 0;
  let updated = 0;
  const skipped: Array<{ booking: string; reason: string }> = [];

  // Cache units by name for fast lookup
  const allUnits = await prisma.unit.findMany({ select: { id: true, name: true } });
  const unitsByName = new Map(allUnits.map((u) => [u.name.toLowerCase().trim(), u.id]));

  for (const booking of bookings) {
    const unitId = unitsByName.get(booking.unitName.toLowerCase().trim());
    if (!unitId) {
      skipped.push({ booking: `${booking.bookingNumber} (${booking.unitName})`, reason: "Enhed findes ikke" });
      continue;
    }

    const checkInDate = new Date(booking.checkIn + "T12:00:00");
    const checkOutDate = new Date(booking.checkOut + "T12:00:00");
    const externalRef = `${providerName}:${booking.externalBookingId}`;

    // Look up by externalRef (stored in bookingRef field with prefix)
    const existing = await prisma.session.findFirst({
      where: { bookingRef: externalRef },
    });

    const guestName = booking.customerName || booking.guestNames || "Ukendt gæst";
    const guestEmail = booking.email || null;
    const guestPhone = booking.phone || null;

    if (existing) {
      const changes: Record<string, unknown> = {};
      if (existing.unitId !== unitId) changes.unitId = unitId;
      if (existing.guestName !== guestName) changes.guestName = guestName;
      if (existing.guestEmail !== guestEmail) changes.guestEmail = guestEmail;
      if (existing.guestPhone !== guestPhone) changes.guestPhone = guestPhone;
      if (existing.checkInTime.getTime() !== checkInDate.getTime()) changes.checkInTime = checkInDate;
      if (!existing.expectedCheckOut || existing.expectedCheckOut.getTime() !== checkOutDate.getTime()) {
        changes.expectedCheckOut = checkOutDate;
      }
      if (Object.keys(changes).length > 0) {
        await prisma.session.update({ where: { id: existing.id }, data: changes });
        updated++;
      }
    } else {
      await prisma.session.create({
        data: {
          unitId,
          guestName,
          guestEmail,
          guestPhone,
          bookingRef: externalRef,
          guestPortalToken: uuidv4(),
          status: "ACTIVE",
          paymentStatus: "UNPAID",
          checkInTime: checkInDate,
          expectedCheckOut: checkOutDate,
          billingMode: "POSTPAID",
        },
      });
      // Mark unit as occupied
      await prisma.unit.update({ where: { id: unitId }, data: { status: "OCCUPIED" } });
      created++;
    }
  }

  logger.info("danplanner", "Booking sync completed", {
    created,
    updated,
    skippedCount: skipped.length,
    totalFromProvider: bookings.length,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/map");
  return { created, updated, skipped };
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
  const units = await prisma.unit.findMany({
    include: { hardware: true, resourceType: true },
    orderBy: { name: "asc" },
  });

  const unitData = await Promise.all(
    units.map(async (unit) => {
      let haStates: { powerOn: boolean | null; temperature: number | null; locked: boolean | null; haReachable: boolean } | null = null;
      let activeGuestName: string | null = null;

      try {
        haStates = await getUnitHAStates(unit.id);
      } catch { /* ignore */ }

      try {
        const session = await prisma.session.findFirst({
          where: { unitId: unit.id, status: "ACTIVE" },
          select: { guestName: true },
        });
        activeGuestName = session?.guestName ?? null;
      } catch { /* ignore */ }

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
        powerOn: haStates?.powerOn ?? null,
        haReachable: haStates?.haReachable ?? false,
        activeGuestName,
        hasElectricity: unit.hardware?.hasElectricity ?? false,
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
