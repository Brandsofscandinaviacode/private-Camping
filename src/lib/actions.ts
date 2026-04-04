"use server";

import { revalidatePath } from "next/cache";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "./prisma";
import * as ha from "./homeassistant";

// ──────────────────────────────────────────────
// Helper: get pricing from global settings
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
// Cabin CRUD
// ──────────────────────────────────────────────
export async function createCabin(name: string) {
  const cabin = await prisma.cabin.create({
    data: {
      name,
      hardware: { create: {} },
    },
  });
  revalidatePath("/admin");
  return cabin;
}

export async function deleteCabin(cabinId: number) {
  await prisma.cabin.delete({ where: { id: cabinId } });
  revalidatePath("/admin");
}

export async function getCabins() {
  return prisma.cabin.findMany({
    include: { hardware: true },
    orderBy: { name: "asc" },
  });
}

export async function getCabinWithDetails(cabinId: number) {
  return prisma.cabin.findUnique({
    where: { id: cabinId },
    include: {
      hardware: true,
      sessions: {
        orderBy: { checkInTime: "desc" },
        take: 10,
      },
    },
  });
}

// ──────────────────────────────────────────────
// Cabin Hardware Configuration
// ──────────────────────────────────────────────
export async function updateCabinHardware(
  cabinId: number,
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
  await prisma.cabinHardware.upsert({
    where: { cabinId },
    update: data,
    create: { cabinId, ...data },
  });
  revalidatePath("/admin");
  revalidatePath(`/admin/cabins/${cabinId}`);
}

// ──────────────────────────────────────────────
// Global Settings
// ──────────────────────────────────────────────
export async function updateGlobalSetting(key: string, value: string) {
  await prisma.globalSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
  revalidatePath("/admin/settings");
}

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
export async function checkIn(cabinId: number, guestName: string) {
  const cabin = await prisma.cabin.findUnique({
    where: { id: cabinId },
    include: { hardware: true },
  });

  if (!cabin) throw new Error("Cabin not found");
  if (cabin.status === "OCCUPIED") throw new Error("Cabin is already occupied");

  const hw = cabin.hardware;
  const pricing = await getPricing();

  // Read baseline meter values from HA
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
    try {
      await ha.turnOn(hw.electricitySwitchEntityId);
    } catch (e) {
      console.error("Failed to turn on electricity:", e);
    }
  }

  // Set climate to occupied temperature
  if (hw?.hasClimate && hw.climateEntityId) {
    try {
      await ha.setClimateTemperature(
        hw.climateEntityId,
        pricing.defaultOccupiedTemp
      );
    } catch (e) {
      console.error("Failed to set climate:", e);
    }
  }

  // Unlock door
  if (hw?.hasSmartLock && hw.lockEntityId) {
    try {
      await ha.unlockDoor(hw.lockEntityId);
    } catch (e) {
      console.error("Failed to unlock door:", e);
    }
  }

  // Create session
  const guestPortalToken = uuidv4();
  const session = await prisma.session.create({
    data: {
      cabinId,
      guestName,
      guestPortalToken,
      startKwh,
      startWaterLiters,
      status: "ACTIVE",
    },
  });

  // Mark cabin as occupied
  await prisma.cabin.update({
    where: { id: cabinId },
    data: { status: "OCCUPIED" },
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/cabins/${cabinId}`);

  return { session, guestPortalToken };
}

// ──────────────────────────────────────────────
// CHECK-OUT FLOW
// ──────────────────────────────────────────────
export async function checkOut(sessionId: number) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { cabin: { include: { hardware: true } } },
  });

  if (!session) throw new Error("Session not found");
  if (session.status === "COMPLETED")
    throw new Error("Session already completed");

  const hw = session.cabin.hardware;
  const pricing = await getPricing();

  // Read end meter values from HA
  let endKwh: number | null = null;
  let endWaterLiters: number | null = null;

  if (hw?.hasElectricity && hw.electricityMeterEntityId) {
    endKwh = await ha.getEntityNumericState(hw.electricityMeterEntityId);
  }

  if (hw?.hasWater && hw.waterMeterEntityId) {
    endWaterLiters = await ha.getEntityNumericState(hw.waterMeterEntityId);
  }

  // Calculate costs
  let totalElectricityCost: number | null = null;
  let totalWaterCost: number | null = null;

  if (endKwh !== null && session.startKwh !== null) {
    const usedKwh = endKwh - session.startKwh;
    totalElectricityCost = Math.max(0, usedKwh) * pricing.pricePerKwh;
  }

  if (endWaterLiters !== null && session.startWaterLiters !== null) {
    const usedLiters = endWaterLiters - session.startWaterLiters;
    totalWaterCost = Math.max(0, usedLiters) * pricing.pricePerLiterWater;
  }

  const totalCost = (totalElectricityCost ?? 0) + (totalWaterCost ?? 0);

  // Turn off electricity
  if (hw?.hasElectricity && hw.electricitySwitchEntityId) {
    try {
      await ha.turnOff(hw.electricitySwitchEntityId);
    } catch (e) {
      console.error("Failed to turn off electricity:", e);
    }
  }

  // Set climate to vacant temperature
  if (hw?.hasClimate && hw.climateEntityId) {
    try {
      await ha.setClimateTemperature(
        hw.climateEntityId,
        pricing.defaultVacantTemp
      );
    } catch (e) {
      console.error("Failed to set climate:", e);
    }
  }

  // Lock door
  if (hw?.hasSmartLock && hw.lockEntityId) {
    try {
      await ha.lockDoor(hw.lockEntityId);
    } catch (e) {
      console.error("Failed to lock door:", e);
    }
  }

  // Update session
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      status: "COMPLETED",
      checkOutTime: new Date(),
      endKwh,
      endWaterLiters,
      totalElectricityCost,
      totalWaterCost,
      totalCost,
    },
  });

  // Mark cabin as vacant
  await prisma.cabin.update({
    where: { id: session.cabinId },
    data: { status: "VACANT" },
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/cabins/${session.cabinId}`);

  return { totalElectricityCost, totalWaterCost, totalCost };
}

// ──────────────────────────────────────────────
// LIVE CONSUMPTION (for active sessions)
// ──────────────────────────────────────────────
export async function getLiveConsumption(sessionId: number) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { cabin: { include: { hardware: true } } },
  });

  if (!session || session.status !== "ACTIVE") return null;

  const hw = session.cabin.hardware;
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
      usedWaterLiters = Math.max(
        0,
        currentWaterLiters - session.startWaterLiters
      );
      waterCost = usedWaterLiters * pricing.pricePerLiterWater;
    }
  }

  return {
    currentKwh,
    usedKwh,
    electricityCost,
    currentWaterLiters,
    usedWaterLiters,
    waterCost,
    totalLiveCost: (electricityCost ?? 0) + (waterCost ?? 0),
    currency: pricing.currency,
  };
}

// ──────────────────────────────────────────────
// HA State helpers (for dashboard cards)
// ──────────────────────────────────────────────
export async function getCabinHAStates(cabinId: number) {
  const cabin = await prisma.cabin.findUnique({
    where: { id: cabinId },
    include: { hardware: true },
  });

  if (!cabin?.hardware) return null;
  const hw = cabin.hardware;

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
      temperature =
        typeof state.attributes.current_temperature === "number"
          ? state.attributes.current_temperature
          : null;
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
export async function togglePower(cabinId: number, turnOn: boolean) {
  const cabin = await prisma.cabin.findUnique({
    where: { id: cabinId },
    include: { hardware: true },
  });
  if (!cabin?.hardware?.electricitySwitchEntityId) return;

  if (turnOn) {
    await ha.turnOn(cabin.hardware.electricitySwitchEntityId);
  } else {
    await ha.turnOff(cabin.hardware.electricitySwitchEntityId);
  }
  revalidatePath(`/admin/cabins/${cabinId}`);
}

export async function toggleLock(cabinId: number, lock: boolean) {
  const cabin = await prisma.cabin.findUnique({
    where: { id: cabinId },
    include: { hardware: true },
  });
  if (!cabin?.hardware?.lockEntityId) return;

  if (lock) {
    await ha.lockDoor(cabin.hardware.lockEntityId);
  } else {
    await ha.unlockDoor(cabin.hardware.lockEntityId);
  }
  revalidatePath(`/admin/cabins/${cabinId}`);
}

export async function setTemperature(cabinId: number, temp: number) {
  const cabin = await prisma.cabin.findUnique({
    where: { id: cabinId },
    include: { hardware: true },
  });
  if (!cabin?.hardware?.climateEntityId) return;

  await ha.setClimateTemperature(cabin.hardware.climateEntityId, temp);
  revalidatePath(`/admin/cabins/${cabinId}`);
}

// ──────────────────────────────────────────────
// Guest portal
// ──────────────────────────────────────────────
export async function getSessionByToken(token: string) {
  return prisma.session.findUnique({
    where: { guestPortalToken: token },
    include: { cabin: { include: { hardware: true } } },
  });
}

// Guest actions
export async function guestSetTemperature(token: string, temp: number) {
  const session = await prisma.session.findUnique({
    where: { guestPortalToken: token },
    include: { cabin: { include: { hardware: true } } },
  });
  if (!session || session.status !== "ACTIVE") return;
  if (!session.cabin.hardware?.climateEntityId) return;

  // Clamp temperature to safe range
  const clampedTemp = Math.min(25, Math.max(16, temp));
  await ha.setClimateTemperature(
    session.cabin.hardware.climateEntityId,
    clampedTemp
  );
}

export async function guestUnlockDoor(token: string) {
  const session = await prisma.session.findUnique({
    where: { guestPortalToken: token },
    include: { cabin: { include: { hardware: true } } },
  });
  if (!session || session.status !== "ACTIVE") return;
  if (!session.cabin.hardware?.lockEntityId) return;

  await ha.unlockDoor(session.cabin.hardware.lockEntityId);
}

// Get active session for a cabin
export async function getActiveSession(cabinId: number) {
  return prisma.session.findFirst({
    where: { cabinId, status: "ACTIVE" },
    orderBy: { checkInTime: "desc" },
  });
}
