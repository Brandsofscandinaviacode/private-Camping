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
  };
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
export async function checkIn(unitId: number, guestName: string, guestEmail?: string, guestPhone?: string, bookingRef?: string) {
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
    data: { unitId, guestName, guestEmail: guestEmail || null, guestPhone: guestPhone || null, bookingRef: bookingRef || null, guestPortalToken, startKwh, startWaterLiters, status: "ACTIVE" },
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
    totalElectricityCost = Math.max(0, endKwh - session.startKwh) * pricing.pricePerKwh;
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
      electricityCost = usedKwh * pricing.pricePerKwh;
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
    return { powerOn, temperature, locked, haReachable: reachable };
  }

  return { powerOn, temperature, locked, haReachable: true };
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

  const electricityCost = (endKwh !== null && startKwh !== null)
    ? Math.max(0, endKwh - startKwh) * pricing.pricePerKwh : 0;
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

  const targetDay = parseInt(settings.invoice_email_day || "1", 10);
  const today = new Date();
  if (today.getDate() !== targetDay) return { created: 0, sent: 0 };

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
  data: { guestName?: string; guestEmail?: string; bookingRef?: string; notes?: string }
) {
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      ...(data.guestName !== undefined && { guestName: data.guestName }),
      ...(data.guestEmail !== undefined && { guestEmail: data.guestEmail || null }),
      ...(data.bookingRef !== undefined && { bookingRef: data.bookingRef || null }),
      ...(data.notes !== undefined && { notes: data.notes || null }),
    },
  });
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${sessionId}`);
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
  const units = await prisma.unit.findMany({ select: { id: true, name: true, type: true } });

  let totalKwhPerHour = 0;
  let totalWaterLitersPerHour = 0;
  let unitCount = 0;
  const perUnit: { unitId: number; name: string; type: string; kwhPerHour: number | null; waterPerHour: number | null }[] = [];

  for (const unit of units) {
    // Get the 2 most recent logs to compute rate
    const logs = await prisma.consumptionLog.findMany({
      where: { unitId: unit.id },
      orderBy: { recordedAt: "desc" },
      take: 2,
    });

    if (logs.length < 2) {
      perUnit.push({ unitId: unit.id, name: unit.name, type: unit.type, kwhPerHour: null, waterPerHour: null });
      continue;
    }

    const [latest, previous] = logs;
    const hoursDiff = (new Date(latest.recordedAt).getTime() - new Date(previous.recordedAt).getTime()) / 3600000;
    if (hoursDiff <= 0) continue;

    let kwhPerHour: number | null = null;
    let waterPerHour: number | null = null;

    if (latest.electricityKwh !== null && previous.electricityKwh !== null) {
      kwhPerHour = Math.max(0, latest.electricityKwh - previous.electricityKwh) / hoursDiff;
      totalKwhPerHour += kwhPerHour;
    }
    if (latest.waterLiters !== null && previous.waterLiters !== null) {
      waterPerHour = Math.max(0, latest.waterLiters - previous.waterLiters) / hoursDiff;
      totalWaterLitersPerHour += waterPerHour;
    }

    if (kwhPerHour !== null || waterPerHour !== null) unitCount++;
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

  return { alerts };
}
