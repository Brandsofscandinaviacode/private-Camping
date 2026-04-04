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
// Unit CRUD
// ──────────────────────────────────────────────
export async function createUnit(
  name: string,
  type: "CABIN" | "CARAVAN" | "PITCH" = "CABIN"
) {
  const unit = await prisma.unit.create({
    data: {
      name,
      type,
      isLongTerm: type === "CARAVAN",
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
export async function checkIn(unitId: number, guestName: string, guestEmail?: string, bookingRef?: string) {
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
    data: { unitId, guestName, guestEmail: guestEmail || null, bookingRef: bookingRef || null, guestPortalToken, startKwh, startWaterLiters, status: "ACTIVE" },
  });

  await prisma.unit.update({ where: { id: unitId }, data: { status: "OCCUPIED" } });

  revalidatePath("/admin");
  revalidatePath(`/admin/units/${unitId}`);
  return { session, guestPortalToken };
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

  // Turn off
  if (hw?.hasElectricity && hw.electricitySwitchEntityId) {
    try { await ha.turnOff(hw.electricitySwitchEntityId); } catch (e) { console.error("HA:", e); }
  }
  if (hw?.hasClimate && hw.climateEntityId) {
    try { await ha.setClimateTemperature(hw.climateEntityId, pricing.defaultVacantTemp); } catch (e) { console.error("HA:", e); }
  }
  if (hw?.hasSmartLock && hw.lockEntityId) {
    try { await ha.lockDoor(hw.lockEntityId); } catch (e) { console.error("HA:", e); }
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

  try {
    if (hw.hasElectricity && hw.electricitySwitchEntityId) {
      const state = await ha.getEntityState(hw.electricitySwitchEntityId);
      powerOn = state.state === "on";
    }
    if (hw.hasClimate && hw.climateEntityId) {
      const state = await ha.getEntityState(hw.climateEntityId);
      temperature = typeof state.attributes.current_temperature === "number"
        ? state.attributes.current_temperature : null;
    }
    if (hw.hasSmartLock && hw.lockEntityId) {
      const state = await ha.getEntityState(hw.lockEntityId);
      locked = state.state === "locked";
    }
    return { powerOn, temperature, locked, haReachable: true };
  } catch {
    return { powerOn: null, temperature: null, locked: null, haReachable: false };
  }
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
