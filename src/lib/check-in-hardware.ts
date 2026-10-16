// Hardware steps of a check-in (start readings, power on, thermostat, lock)
// with the real outcome of each step, so the desk never reads "strøm tændt"
// for an offline Shelly. Server-only plain module — not a server action file.

import { prisma } from "./prisma";
import * as ha from "./homeassistant";
import * as hardware from "./hardware";
import type { HardwareEndpoint, UnitHardwareRow } from "./hardware";
import { logger } from "./logger";
import type { ReceiptLine } from "./check-in";

export type CheckInHardwareRow = UnitHardwareRow & {
  hasClimate: boolean;
  climateEntityId: string | null;
  hasSmartLock: boolean;
  lockEntityId: string | null;
};

/** What a unit has wired up — 156 of 159 units have nothing. */
export function unitHardwareSummary(hw: CheckInHardwareRow | null | undefined): { any: boolean; meters: boolean } {
  const meters = hardware.hasElectricityMeter(hw) || hardware.hasHeatingMeter(hw) || hardware.hasWaterMeter(hw);
  const any =
    meters ||
    hardware.hasElectricitySwitch(hw) ||
    hardware.hasHeatingSwitch(hw) ||
    !!(hw?.hasClimate && hw.climateEntityId) ||
    !!(hw?.hasSmartLock && hw.lockEntityId);
  return { any, meters };
}

export const NO_HARDWARE_LINE: ReceiptLine = {
  label: "Måler og relæ",
  tone: "info",
  text: "Ingen måler/relæ på denne enhed – intet at tænde eller aflæse",
};

function fmtNum(v: number, digits: number): string {
  return v.toLocaleString("da-DK", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** "MQTT: Camping-S001 er offline — brokeren har …" → "Camping-S001 er offline". */
export function shortReason(reason: string): string {
  return reason.replace(/^MQTT: /, "").replace(/^HA: /, "Home Assistant: ").split(" — ")[0];
}

/** The advice after " — " in a long reason, or null when the short form says it all. */
export function reasonAdvice(reason: string): string | null {
  const i = reason.indexOf(" — ");
  if (i < 0) return null;
  const rest = reason.slice(i + 3).trim();
  if (!rest) return null;
  const sentence = rest.charAt(0).toUpperCase() + rest.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

export async function readWithReason(ep: HardwareEndpoint): Promise<{ value: number | null; reason: string | null }> {
  try {
    const r = await hardware.readEnergyKwhWithReason(ep);
    return { value: r.kwh, reason: r.kwh === null ? r.reason ?? "ingen værdi" : null };
  } catch (e) {
    return { value: null, reason: errorText(e) };
  }
}

/** Start reading; a miss is logged and tracked for the meter-failure alert. */
async function readStart(ep: HardwareEndpoint, context: string) {
  const r = await readWithReason(ep);
  if (r.value === null) {
    logger.warn("meter", `Startaflæsning mangler [${context}] ${hardware.endpointLabel(ep)}: ${r.reason}`);
    try {
      const key = `_meter_fail_${context.replace(/[^a-zA-Z0-9]/g, "_")}`;
      const now = new Date().toISOString();
      await prisma.globalSetting.upsert({ where: { key }, create: { key, value: now }, update: { value: now } });
    } catch { /* don't fail the check-in over alert tracking */ }
  }
  return r;
}

export function readingLine(
  label: string,
  r: { value: number | null; reason: string | null },
  unit: "kWh" | "L",
  detail?: string,
): ReceiptLine {
  if (r.value !== null) {
    return { label, tone: "ok", text: `Aflæst ${fmtNum(r.value, unit === "kWh" ? 2 : 0)} ${unit}` };
  }
  const reason = r.reason ?? "ingen værdi";
  return {
    label,
    tone: "warn",
    text: `Ikke aflæst: ${shortReason(reason)}`,
    detail: [reasonAdvice(reason), detail].filter(Boolean).join(" ") || undefined,
  };
}

export async function switchOnLine(ep: HardwareEndpoint, label: string, context: string): Promise<ReceiptLine> {
  try {
    await hardware.setSwitch(ep, true);
    return { label, tone: "ok", text: "Tændt" };
  } catch (e) {
    // Shelly errors name the device; Home Assistant errors are often just "fetch failed".
    const msg = ep.source === "HA" ? `Home Assistant: ${errorText(e)}` : errorText(e);
    logger.error("hardware", `${context} ${label.toLowerCase()} on`, e);
    return {
      label,
      tone: "error",
      text: `FEJL – ${shortReason(msg)}`,
      detail: [reasonAdvice(msg), "Tænd manuelt under enhedens styring, når den svarer igen."].filter(Boolean).join(" "),
    };
  }
}

/**
 * Reads the start meters, then switches power/heating on, sets the thermostat
 * and unlocks the door. Never throws: every failure becomes a receipt line.
 */
export async function startStayHardware(
  hw: CheckInHardwareRow | null | undefined,
  context: string,
  occupiedTemp: number,
): Promise<{
  startKwh: number | null;
  startHeatingKwh: number | null;
  startWaterLiters: number | null;
  lines: ReceiptLine[];
}> {
  if (!hw || !unitHardwareSummary(hw).any) {
    return { startKwh: null, startHeatingKwh: null, startWaterLiters: null, lines: [NO_HARDWARE_LINE] };
  }

  // Readings first, so the baseline is taken before anything is switched on.
  const el = hardware.hasElectricityMeter(hw) ? await readStart(hardware.electricityMeterEp(hw), `${context}:el`) : null;
  const heat = hardware.hasHeatingMeter(hw) ? await readStart(hardware.heatingMeterEp(hw), `${context}:heat`) : null;
  const water = hardware.hasWaterMeter(hw) ? await readStart(hardware.waterMeterEp(hw), `${context}:water`) : null;

  const lines: ReceiptLine[] = [];
  lines.push(
    hardware.hasElectricitySwitch(hw)
      ? await switchOnLine(hardware.electricitySwitchEp(hw), "Strøm", context)
      : { label: "Strøm", tone: "info", text: "Intet relæ på enheden" },
  );
  lines.push(
    el
      ? readingLine(
          "Startaflæsning el",
          el,
          "kWh",
          "Forbrug indtil måleren svarer igen bliver ikke afregnet. Kender du målerstanden, så skriv den hurtigst muligt under 'Redigér booking' → El start (kWh).",
        )
      : { label: "Startaflæsning el", tone: "info", text: "Ingen elmåler på enheden" },
  );
  if (hardware.hasHeatingSwitch(hw)) lines.push(await switchOnLine(hardware.heatingSwitchEp(hw), "Varme", context));
  if (heat) lines.push(readingLine("Startaflæsning varme", heat, "kWh"));
  if (water) lines.push(readingLine("Startaflæsning vand", water, "L"));

  if (hw.hasClimate && hw.climateEntityId) {
    try {
      await ha.setClimateTemperature(hw.climateEntityId, occupiedTemp);
      lines.push({ label: "Termostat", tone: "ok", text: `Sat til ${occupiedTemp} °C` });
    } catch (e) {
      logger.error("hardware", `${context} climate`, e);
      lines.push({ label: "Termostat", tone: "error", text: `FEJL – ${errorText(e)}` });
    }
  }
  if (hw.hasSmartLock && hw.lockEntityId) {
    try {
      await ha.unlockDoor(hw.lockEntityId);
      lines.push({ label: "Dørlås", tone: "ok", text: "Låst op" });
    } catch (e) {
      logger.error("hardware", `${context} unlock`, e);
      lines.push({ label: "Dørlås", tone: "error", text: `FEJL – ${errorText(e)}` });
    }
  }

  return { startKwh: el?.value ?? null, startHeatingKwh: heat?.value ?? null, startWaterLiters: water?.value ?? null, lines };
}

/**
 * Best-effort reversal of startStayHardware when the check-in didn't go
 * through after all (lost a race with a cancel/move): switch the relays off
 * again so a unit nobody is staying in doesn't keep drawing power.
 */
export async function undoStayHardware(hw: CheckInHardwareRow | null | undefined, context: string): Promise<void> {
  if (!hw) return;
  const eps = [
    hardware.hasElectricitySwitch(hw) ? hardware.electricitySwitchEp(hw) : null,
    hardware.hasHeatingSwitch(hw) ? hardware.heatingSwitchEp(hw) : null,
  ].filter((ep): ep is HardwareEndpoint => ep !== null);
  for (const ep of eps) {
    try {
      await hardware.setSwitch(ep, false);
    } catch (e) {
      logger.error("hardware", `${context} undo: relay off failed`, e);
    }
  }
}

/**
 * Live status before check-in, for the few units with hardware: can the
 * meters be read and do the relays answer? Reads only, switches nothing.
 */
export async function checkInHardwarePrecheck(hw: CheckInHardwareRow | null | undefined): Promise<{ lines: ReceiptLine[]; problem: boolean }> {
  if (!hw || !unitHardwareSummary(hw).any) return { lines: [NO_HARDWARE_LINE], problem: false };

  const meter = async (label: string, ep: HardwareEndpoint, unit: "kWh" | "L"): Promise<ReceiptLine> => {
    const r = await readWithReason(ep);
    return r.value !== null
      ? { label, tone: "ok", text: `Svarer – ${fmtNum(r.value, unit === "kWh" ? 2 : 0)} ${unit}` }
      : { label, tone: "warn", text: `Svarer ikke: ${shortReason(r.reason ?? "ingen værdi")}`, detail: reasonAdvice(r.reason ?? "") ?? undefined };
  };
  const relay = async (label: string, ep: HardwareEndpoint): Promise<ReceiptLine> => {
    const on = await hardware.getSwitchState(ep).catch(() => null);
    if (on === null) return { label, tone: "warn", text: "Status ukendt – relæet svarer ikke" };
    return { label, tone: "ok", text: on ? "Relæet svarer (allerede tændt)" : "Relæet svarer – tændes ved check-in" };
  };

  const checks: Promise<ReceiptLine>[] = [];
  if (hardware.hasElectricitySwitch(hw)) checks.push(relay("Strøm", hardware.electricitySwitchEp(hw)));
  if (hardware.hasElectricityMeter(hw)) checks.push(meter("Elmåler", hardware.electricityMeterEp(hw), "kWh"));
  if (hardware.hasHeatingSwitch(hw)) checks.push(relay("Varme", hardware.heatingSwitchEp(hw)));
  if (hardware.hasHeatingMeter(hw)) checks.push(meter("Varmemåler", hardware.heatingMeterEp(hw), "kWh"));
  if (hardware.hasWaterMeter(hw)) checks.push(meter("Vandmåler", hardware.waterMeterEp(hw), "L"));
  const lines = await Promise.all(checks);
  return { lines, problem: lines.some((l) => l.tone !== "ok" && l.tone !== "info") };
}
