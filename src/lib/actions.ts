"use server";

import { revalidatePath } from "next/cache";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "./prisma";
import * as ha from "./homeassistant";

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
// HA Entity Browser
// ──────────────────────────────────────────────
export type EntityCategory = "switch" | "sensor_energy" | "sensor_water" | "sensor_other" | "climate" | "lock" | "other";

export interface BrowsableEntity {
  entity_id: string;
  friendly_name: string;
  state: string;
  unit_of_measurement: string | null;
  category: EntityCategory;
  usedBy: string | null; // unit name if already assigned, null if free
}

export async function browseHAEntities(): Promise<BrowsableEntity[]> {
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
        } else if (e.device_class === "water" || e.unit_of_measurement === "L" || e.unit_of_measurement === "m³") {
          category = "sensor_water";
        } else if (e.device_class === "power" || e.unit_of_measurement === "W") {
          category = "sensor_energy";
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

  for (const hw of allHw) {
    const unitName = `${typeLabels[hw.unit.type] || ""} ${hw.unit.name}`.trim();
    const ids = [
      hw.electricitySwitchEntityId,
      hw.electricityMeterEntityId,
      hw.heatingSwitchEntityId,
      hw.heatingMeterEntityId,
      hw.waterMeterEntityId,
      hw.climateEntityId,
      hw.lockEntityId,
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
// Unit CRUD
// ──────────────────────────────────────────────
export async function createUnit(
  name: string,
  type: "CABIN" | "SEASONAL" | "CARAVAN" | "PITCH" = "CABIN"
) {
  const unit = await prisma.unit.create({
    data: {
      name,
      type,
      isLongTerm: type === "SEASONAL",
      hardware: { create: {} },
    },
  });
  revalidatePath("/admin");
  return unit;
}

export async function deleteUnit(unitId: number) {
  await prisma.unit.delete({ where: { id: unitId } });
  revalidatePath("/admin");
}

export async function getUnits() {
  return prisma.unit.findMany({
    include: { hardware: true },
    orderBy: { name: "asc" },
  });
}

export async function getUnitWithDetails(unitId: number) {
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
    electricitySwitchEntityId: string | null;
    electricityMeterEntityId: string | null;
    hasHeating: boolean;
    heatingSwitchEntityId: string | null;
    heatingMeterEntityId: string | null;
    winterModeEnabled: boolean;
    hasWater: boolean;
    waterMeterEntityId: string | null;
    hasClimate: boolean;
    climateEntityId: string | null;
    hasSmartLock: boolean;
    lockEntityId: string | null;
  }
) {
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
  await prisma.unitHardware.update({
    where: { unitId },
    data: { winterModeEnabled: enabled },
  });

  // If enabling winter mode, turn on heating immediately
  const hw = await prisma.unitHardware.findUnique({ where: { unitId } });
  if (hw?.heatingSwitchEntityId) {
    try {
      if (enabled) {
        await ha.turnOn(hw.heatingSwitchEntityId);
      }
      // Don't turn off here — that's handled by check-out logic
    } catch (e) {
      console.error("Winter mode toggle HA error:", e);
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
export async function checkIn(unitId: number, guestName: string, guestEmail?: string, guestPhone?: string, bookingRef?: string, expectedCheckOut?: string) {
  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: { hardware: true },
  });

  if (!unit) throw new Error("Enhed ikke fundet");
  if (unit.status === "OCCUPIED") throw new Error("Enheden er allerede optaget");

  const hw = unit.hardware;
  const pricing = await getPricing();

  let startKwh: number | null = null;
  let startWaterLiters: number | null = null;

  if (hw?.hasElectricity && hw.electricityMeterEntityId) {
    startKwh = await ha.getEntityNumericState(hw.electricityMeterEntityId);
  }
  if (hw?.hasWater && hw.waterMeterEntityId) {
    startWaterLiters = await ha.getEntityNumericState(hw.waterMeterEntityId);
  }

  // Turn on electricity
  if (hw?.hasElectricity && hw.electricitySwitchEntityId) {
    try { await ha.turnOn(hw.electricitySwitchEntityId); } catch (e) { console.error("HA:", e); }
  }
  // Turn on heating relay
  if (hw?.hasHeating && hw.heatingSwitchEntityId) {
    try { await ha.turnOn(hw.heatingSwitchEntityId); } catch (e) { console.error("HA:", e); }
  }
  // Set climate
  if (hw?.hasClimate && hw.climateEntityId) {
    try { await ha.setClimateTemperature(hw.climateEntityId, pricing.defaultOccupiedTemp); } catch (e) { console.error("HA:", e); }
  }
  // Unlock door
  if (hw?.hasSmartLock && hw.lockEntityId) {
    try { await ha.unlockDoor(hw.lockEntityId); } catch (e) { console.error("HA:", e); }
  }

  const guestPortalToken = uuidv4();
  const session = await prisma.session.create({
    data: { unitId, guestName, guestEmail: guestEmail || null, guestPhone: guestPhone || null, bookingRef: bookingRef || null, expectedCheckOut: expectedCheckOut ? new Date(expectedCheckOut) : null, guestPortalToken, startKwh, startWaterLiters, status: "ACTIVE" },
  });

  await prisma.unit.update({ where: { id: unitId }, data: { status: "OCCUPIED" } });

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
    console.error("Notification fejl:", e);
  }
}

// ──────────────────────────────────────────────
// CHECK-OUT FLOW
// ──────────────────────────────────────────────
export async function checkOut(sessionId: number) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: { include: { hardware: true } } },
  });

  if (!session) throw new Error("Session ikke fundet");
  if (session.status === "COMPLETED") throw new Error("Session allerede afsluttet");

  const hw = session.unit.hardware;
  const pricing = await getPricing();

  // Get effective electricity price at checkout time
  let effectiveElPrice = pricing.pricePerKwh;
  try {
    const effective = await getEffectiveElPricing();
    effectiveElPrice = effective.pricePerKwh;
  } catch {
    // Fallback to fixed price
  }

  let endKwh: number | null = null;
  let endWaterLiters: number | null = null;

  if (hw?.hasElectricity && hw.electricityMeterEntityId) {
    endKwh = await ha.getEntityNumericState(hw.electricityMeterEntityId);
  }
  if (hw?.hasWater && hw.waterMeterEntityId) {
    endWaterLiters = await ha.getEntityNumericState(hw.waterMeterEntityId);
  }

  let totalElectricityCost: number | null = null;
  let totalWaterCost: number | null = null;

  if (endKwh !== null && session.startKwh !== null) {
    totalElectricityCost = Math.max(0, endKwh - session.startKwh) * effectiveElPrice;
  }
  if (endWaterLiters !== null && session.startWaterLiters !== null) {
    totalWaterCost = Math.max(0, endWaterLiters - session.startWaterLiters) * pricing.pricePerLiterWater;
  }

  const totalCost = (totalElectricityCost ?? 0) + (totalWaterCost ?? 0);

  // Turn off devices based on auto_power_off setting
  const globalSettings = await getGlobalSettings();
  const autoPowerOff = globalSettings.auto_power_off_on_checkout === "true";

  if (autoPowerOff) {
    if (hw?.hasElectricity && hw.electricitySwitchEntityId) {
      try { await ha.turnOff(hw.electricitySwitchEntityId); } catch (e) { console.error("HA:", e); }
    }
    // Turn off heating unless winter mode is enabled (protect cabin from frost)
    if (hw?.hasHeating && hw.heatingSwitchEntityId && !hw.winterModeEnabled) {
      try { await ha.turnOff(hw.heatingSwitchEntityId); } catch (e) { console.error("HA:", e); }
    }
    if (hw?.hasSmartLock && hw.lockEntityId) {
      try { await ha.lockDoor(hw.lockEntityId); } catch (e) { console.error("HA:", e); }
    }
  }
  // Always set climate to vacant temp
  if (hw?.hasClimate && hw.climateEntityId) {
    try { await ha.setClimateTemperature(hw.climateEntityId, pricing.defaultVacantTemp); } catch (e) { console.error("HA:", e); }
  }

  await prisma.session.update({
    where: { id: sessionId },
    data: { status: "COMPLETED", checkOutTime: new Date(), endKwh, endWaterLiters, totalElectricityCost, totalWaterCost, totalCost },
  });

  // Only mark vacant for non-long-term
  if (!session.unit.isLongTerm) {
    await prisma.unit.update({ where: { id: session.unitId }, data: { status: "VACANT" } });
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/units/${session.unitId}`);
  return { totalElectricityCost, totalWaterCost, totalCost };
}

// ──────────────────────────────────────────────
// LIVE CONSUMPTION
// ──────────────────────────────────────────────
export async function getLiveConsumption(sessionId: number) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: { include: { hardware: true } } },
  });

  if (!session || session.status !== "ACTIVE") return null;

  const hw = session.unit.hardware;
  const pricing = await getPricing();

  // Get effective electricity price (spot/minimum/fixed)
  let effectiveElPrice = pricing.pricePerKwh;
  let spotPrice: number | null = null;
  try {
    const effective = await getEffectiveElPricing();
    effectiveElPrice = effective.pricePerKwh;
    spotPrice = effective.spotPrice;
  } catch {
    // Fallback to fixed price
  }

  let currentKwh: number | null = null;
  let usedKwh: number | null = null;
  let electricityCost: number | null = null;
  let currentWaterLiters: number | null = null;
  let usedWaterLiters: number | null = null;
  let waterCost: number | null = null;

  if (hw?.hasElectricity && hw.electricityMeterEntityId) {
    currentKwh = await ha.getEntityNumericState(hw.electricityMeterEntityId);
    if (currentKwh !== null && session.startKwh !== null) {
      usedKwh = Math.max(0, currentKwh - session.startKwh);
      electricityCost = usedKwh * effectiveElPrice;
    }
  }

  if (hw?.hasWater && hw.waterMeterEntityId) {
    currentWaterLiters = await ha.getEntityNumericState(hw.waterMeterEntityId);
    if (currentWaterLiters !== null && session.startWaterLiters !== null) {
      usedWaterLiters = Math.max(0, currentWaterLiters - session.startWaterLiters);
      waterCost = usedWaterLiters * pricing.pricePerLiterWater;
    }
  }

  return {
    currentKwh, usedKwh, electricityCost,
    currentWaterLiters, usedWaterLiters, waterCost,
    totalLiveCost: (electricityCost ?? 0) + (waterCost ?? 0),
    currency: pricing.currency,
    pricePerKwh: effectiveElPrice,
    spotPrice,
    pricingMode: pricing.pricingMode,
  };
}

// ──────────────────────────────────────────────
// HA State helpers
// ──────────────────────────────────────────────
export async function getUnitHAStates(unitId: number) {
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

  if (hw.hasElectricity && hw.electricitySwitchEntityId) {
    try {
      const state = await ha.getEntityState(hw.electricitySwitchEntityId);
      powerOn = state.state === "on";
      anySuccess = true;
    } catch { /* entity unavailable */ }
  }
  if (hw.hasHeating && hw.heatingSwitchEntityId) {
    try {
      const state = await ha.getEntityState(hw.heatingSwitchEntityId);
      heatingOn = state.state === "on";
      anySuccess = true;
    } catch { /* entity unavailable */ }
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

  // If no entities are configured, check basic HA connectivity
  if (!anySuccess) {
    const reachable = await ha.checkHAConnection();
    return { powerOn, heatingOn, winterModeEnabled: hw.winterModeEnabled, temperature, locked, haReachable: reachable };
  }

  return { powerOn, heatingOn, winterModeEnabled: hw.winterModeEnabled, temperature, locked, haReachable: true };
}

// ──────────────────────────────────────────────
// Manual HA controls
// ──────────────────────────────────────────────
export async function togglePower(unitId: number, turnOn: boolean) {
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, include: { hardware: true } });
  if (!unit?.hardware?.electricitySwitchEntityId) return;
  if (turnOn) { await ha.turnOn(unit.hardware.electricitySwitchEntityId); }
  else { await ha.turnOff(unit.hardware.electricitySwitchEntityId); }
  revalidatePath(`/admin/units/${unitId}`);
}

export async function toggleHeating(unitId: number, turnOn: boolean) {
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, include: { hardware: true } });
  if (!unit?.hardware?.heatingSwitchEntityId) return;
  if (turnOn) { await ha.turnOn(unit.hardware.heatingSwitchEntityId); }
  else { await ha.turnOff(unit.hardware.heatingSwitchEntityId); }
  revalidatePath(`/admin/units/${unitId}`);
}

export async function toggleLock(unitId: number, lock: boolean) {
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, include: { hardware: true } });
  if (!unit?.hardware?.lockEntityId) return;
  if (lock) { await ha.lockDoor(unit.hardware.lockEntityId); }
  else { await ha.unlockDoor(unit.hardware.lockEntityId); }
  revalidatePath(`/admin/units/${unitId}`);
}

export async function setTemperature(unitId: number, temp: number) {
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

export async function getActiveSession(unitId: number) {
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
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const hw = unit.hardware;

  let startKwh: number | null = null;
  let endKwh: number | null = null;
  let startWaterLiters: number | null = null;
  let endWaterLiters: number | null = null;

  // For now, get current readings as end values
  // Start values come from previous invoice's end, or current if first invoice
  const prevInvoice = await prisma.invoice.findFirst({
    where: { unitId },
    orderBy: { periodEnd: "desc" },
  });

  if (hw?.hasElectricity && hw.electricityMeterEntityId) {
    endKwh = await ha.getEntityNumericState(hw.electricityMeterEntityId);
    startKwh = prevInvoice?.endKwh ?? endKwh;
  }
  if (hw?.hasWater && hw.waterMeterEntityId) {
    endWaterLiters = await ha.getEntityNumericState(hw.waterMeterEntityId);
    startWaterLiters = prevInvoice?.endWaterLiters ?? endWaterLiters;
  }

  // Get effective electricity price for invoice
  let effectiveElPrice = pricing.pricePerKwh;
  try {
    const effective = await getEffectiveElPricing();
    effectiveElPrice = effective.pricePerKwh;
  } catch {
    // Fallback to fixed price
  }

  const electricityCost = (endKwh !== null && startKwh !== null)
    ? Math.max(0, endKwh - startKwh) * effectiveElPrice : 0;
  const waterCost = (endWaterLiters !== null && startWaterLiters !== null)
    ? Math.max(0, endWaterLiters - startWaterLiters) * pricing.pricePerLiterWater : 0;

  const invoice = await prisma.invoice.create({
    data: {
      unitId,
      periodStart,
      periodEnd,
      startKwh,
      endKwh,
      startWaterLiters,
      endWaterLiters,
      electricityCost,
      waterCost,
      totalAmount: electricityCost + waterCost,
      status: "PENDING",
      paymentToken: uuidv4(),
    },
  });

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
      console.error(`Auto-faktura fejl for enhed ${unit.id}:`, e);
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

export async function testSendInvoice(): Promise<{ ok: boolean; message: string }> {
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

  const guestName = unit.longTermGuestName || "Lejer";
  const guestEmail = unit.longTermGuestEmail;
  const guestPhone = unit.longTermGuestPhone;

  if (!guestEmail && !guestPhone) {
    return { ok: false, message: "Ingen email eller telefon registreret på lejeren" };
  }

  const settings = await getGlobalSettings();
  const baseUrl = settings.site_url || "http://localhost:3000";
  const portalUrl = unit.longTermPortalToken
    ? `${baseUrl}/guest/${unit.longTermPortalToken}`
    : baseUrl;

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
export async function getAllSessions(filter?: "all" | "unpaid" | "paid" | "active") {
  const where = filter === "unpaid" ? { status: "COMPLETED" as const, paymentStatus: "UNPAID" as const }
    : filter === "paid" ? { paymentStatus: "PAID" as const }
    : filter === "active" ? { status: "ACTIVE" as const }
    : {};

  return prisma.session.findMany({
    where,
    include: { unit: true },
    orderBy: { checkInTime: "desc" },
    take: 100,
  });
}

export async function getSessionById(sessionId: number) {
  return prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: { include: { hardware: true } } },
  });
}

export async function markSessionPaid(sessionId: number, paymentId?: string) {
  await prisma.session.update({
    where: { id: sessionId },
    data: { paymentStatus: "PAID", paidAt: new Date(), paymentId: paymentId ?? null },
  });
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${sessionId}`);
}

export async function markSessionUnpaid(sessionId: number) {
  await prisma.session.update({
    where: { id: sessionId },
    data: { paymentStatus: "UNPAID", paidAt: null, paymentId: null },
  });
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${sessionId}`);
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
    startWaterLiters?: number | null;
    endWaterLiters?: number | null;
  }
) {
  const updateData: Record<string, unknown> = {};
  if (data.guestName !== undefined) updateData.guestName = data.guestName;
  if (data.guestEmail !== undefined) updateData.guestEmail = data.guestEmail || null;
  if (data.guestPhone !== undefined) updateData.guestPhone = data.guestPhone || null;
  if (data.bookingRef !== undefined) updateData.bookingRef = data.bookingRef || null;
  if (data.notes !== undefined) updateData.notes = data.notes || null;
  if (data.expectedCheckOut !== undefined) updateData.expectedCheckOut = data.expectedCheckOut ? new Date(data.expectedCheckOut) : null;
  if (data.startKwh !== undefined) updateData.startKwh = data.startKwh;
  if (data.endKwh !== undefined) updateData.endKwh = data.endKwh;
  if (data.startWaterLiters !== undefined) updateData.startWaterLiters = data.startWaterLiters;
  if (data.endWaterLiters !== undefined) updateData.endWaterLiters = data.endWaterLiters;

  // If consumption was manually edited, recalculate costs
  if (data.startKwh !== undefined || data.endKwh !== undefined || data.startWaterLiters !== undefined || data.endWaterLiters !== undefined) {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (session) {
      const pricing = await getPricing();
      const startKwh = data.startKwh !== undefined ? data.startKwh : session.startKwh;
      const endKwh = data.endKwh !== undefined ? data.endKwh : session.endKwh;
      const startWater = data.startWaterLiters !== undefined ? data.startWaterLiters : session.startWaterLiters;
      const endWater = data.endWaterLiters !== undefined ? data.endWaterLiters : session.endWaterLiters;

      if (startKwh != null && endKwh != null) {
        const usedKwh = Math.max(0, endKwh - startKwh);
        updateData.totalElectricityCost = parseFloat((usedKwh * pricing.pricePerKwh).toFixed(2));
      }
      if (startWater != null && endWater != null) {
        const usedWater = Math.max(0, endWater - startWater);
        updateData.totalWaterCost = parseFloat((usedWater * pricing.pricePerLiterWater).toFixed(2));
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
  return prisma.session.count({
    where: { status: "COMPLETED", paymentStatus: "UNPAID" },
  });
}

// ──────────────────────────────────────────────
// SYSTEM STATUS
// ──────────────────────────────────────────────
export async function getSystemStatus() {
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

    if (hw.hasElectricity && hw.electricityMeterEntityId) {
      try { electricityKwh = await ha.getEntityNumericState(hw.electricityMeterEntityId); } catch {}
    }
    if (hw.hasWater && hw.waterMeterEntityId) {
      try { waterLiters = await ha.getEntityNumericState(hw.waterMeterEntityId); } catch {}
    }

    if (electricityKwh !== null || waterLiters !== null) {
      await prisma.consumptionLog.create({
        data: { unitId: unit.id, electricityKwh, waterLiters },
      });
    }
  }
}

export async function getConsumptionLogs(unitId: number, days: number = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return prisma.consumptionLog.findMany({
    where: { unitId, recordedAt: { gte: since } },
    orderBy: { recordedAt: "asc" },
  });
}

// ──────────────────────────────────────────────
// TOTAL USAGE — current consumption rate per hour
// ──────────────────────────────────────────────
export async function getTotalUsage() {
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

    // Fallback: read live power (W) from HA if no log-based rate available
    if (kwhPerHour === null && unit.hardware?.hasElectricity && unit.hardware.electricityMeterEntityId) {
      try {
        // Try to get instantaneous power (W) from the switch entity
        const switchId = unit.hardware.electricitySwitchEntityId;
        if (switchId) {
          // Shelly devices often expose power as an attribute or companion sensor
          const powerEntityId = switchId.replace("switch.", "sensor.") + "_power";
          try {
            const watts = await ha.getEntityNumericState(powerEntityId);
            if (watts !== null && watts >= 0) {
              kwhPerHour = watts / 1000; // W to kW
            }
          } catch {
            // Power sensor might not exist with that naming — fall back to meter diff
          }
        }

        // If still no rate, try computing from meter entity + recent session
        if (kwhPerHour === null) {
          const currentKwh = await ha.getEntityNumericState(unit.hardware.electricityMeterEntityId);
          // Use the single log entry we have + current reading to estimate rate
          if (currentKwh !== null && logs.length >= 1 && logs[0].electricityKwh !== null) {
            const hoursSinceLog = (Date.now() - new Date(logs[0].recordedAt).getTime()) / 3600000;
            if (hoursSinceLog > 0 && hoursSinceLog < 4) {
              kwhPerHour = Math.max(0, currentKwh - logs[0].electricityKwh) / hoursSinceLog;
            }
          }
        }
      } catch {
        // HA unreachable
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
  const where = filter === "unpaid" ? { status: "COMPLETED" as const, paymentStatus: "UNPAID" as const }
    : filter === "paid" ? { paymentStatus: "PAID" as const }
    : {};

  const sessions = await prisma.session.findMany({
    where,
    include: { unit: true },
    orderBy: { checkInTime: "desc" },
  });

  const typeLabels: Record<string, string> = { CABIN: "Hytte", SEASONAL: "Fastligger", CARAVAN: "Campingvogn", PITCH: "Plads" };
  const header = "ID;Enhed;Type;Gæst;Email;Telefon;Check-in;Check-out;El (kWh);El (DKK);Vand (L);Vand (DKK);Total (DKK);Betaling;Betalt dato;Booking nr.\n";
  const rows = sessions.map((s) => {
    const type = typeLabels[s.unit.type] || s.unit.type;
    const usedKwh = (s.endKwh !== null && s.startKwh !== null) ? (s.endKwh - s.startKwh).toFixed(2) : "";
    const usedWater = (s.endWaterLiters !== null && s.startWaterLiters !== null) ? (s.endWaterLiters - s.startWaterLiters).toFixed(0) : "";
    return [
      s.id,
      `${type} ${s.unit.name}`,
      type,
      s.guestName,
      s.guestEmail || "",
      s.guestPhone || "",
      s.checkInTime.toISOString().slice(0, 10),
      s.checkOutTime?.toISOString().slice(0, 10) || "",
      usedKwh,
      s.totalElectricityCost?.toFixed(2) || "",
      usedWater,
      s.totalWaterCost?.toFixed(2) || "",
      s.totalCost?.toFixed(2) || "",
      s.paymentStatus,
      s.paidAt?.toISOString().slice(0, 10) || "",
      s.bookingRef || "",
    ].join(";");
  });

  return header + rows.join("\n");
}

export async function exportInvoicesCSV() {
  const invoices = await prisma.invoice.findMany({
    include: { unit: true },
    orderBy: { periodEnd: "desc" },
  });

  const typeLabels: Record<string, string> = { CABIN: "Hytte", SEASONAL: "Fastligger", CARAVAN: "Campingvogn", PITCH: "Plads" };
  const header = "ID;Enhed;Type;Periode start;Periode slut;El start (kWh);El slut (kWh);El forbrug (kWh);El (DKK);Vand start (L);Vand slut (L);Vand forbrug (L);Vand (DKK);Total (DKK);Status;Betalt dato\n";
  const rows = invoices.map((inv) => {
    const type = typeLabels[inv.unit.type] || inv.unit.type;
    const elUsed = (inv.endKwh !== null && inv.startKwh !== null) ? (inv.endKwh - inv.startKwh).toFixed(2) : "";
    const waterUsed = (inv.endWaterLiters !== null && inv.startWaterLiters !== null) ? (inv.endWaterLiters - inv.startWaterLiters).toFixed(0) : "";
    return [
      inv.id,
      `${type} ${inv.unit.name}`,
      type,
      inv.periodStart.toISOString().slice(0, 10),
      inv.periodEnd.toISOString().slice(0, 10),
      inv.startKwh?.toFixed(2) || "",
      inv.endKwh?.toFixed(2) || "",
      elUsed,
      inv.electricityCost.toFixed(2),
      inv.startWaterLiters?.toFixed(0) || "",
      inv.endWaterLiters?.toFixed(0) || "",
      waterUsed,
      inv.waterCost.toFixed(2),
      inv.totalAmount.toFixed(2),
      inv.status,
      inv.paidAt?.toISOString().slice(0, 10) || "",
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
      console.error("Leak detection error:", e);
    }
  }

  return { alerts };
}

// ──────────────────────────────────────────────
// SPOT PRICES — daily hourly prices for chart
// ──────────────────────────────────────────────
export async function getLatestSpotPriceDate() {
  const pricing = await getPricing();
  const { getAvailableDateRange } = await import("./energi-data-service");
  return getAvailableDateRange(pricing.edsPriceArea);
}

export async function testEdsApi() {
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
  const portalToken = invoice.unit.longTermPortalToken;

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
}

export async function getEconomySummary(): Promise<{
  months: MonthlyEconomySummary[];
  unpaidSessions: { id: number; unitName: string; guestName: string; total: number; checkOut: string }[];
  unpaidInvoices: { id: number; unitName: string; total: number; periodEnd: string }[];
}> {
  const typeLabels: Record<string, string> = { CABIN: "Hytte", SEASONAL: "Fastligger", CARAVAN: "Campingvogn", PITCH: "Plads" };

  const [sessions, invoices] = await Promise.all([
    prisma.session.findMany({
      where: { status: "COMPLETED" },
      include: { unit: true },
      orderBy: { checkOutTime: "desc" },
    }),
    prisma.invoice.findMany({
      include: { unit: true },
      orderBy: { periodEnd: "desc" },
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

  return { months, unpaidSessions, unpaidInvoices };
}

// ──────────────────────────────────────────────
// ADD SHELLY DEVICE via HA Config Flow
// ──────────────────────────────────────────────
export async function addShellyDevice(host: string, port: number = 80): Promise<{ ok: boolean; message: string }> {
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
