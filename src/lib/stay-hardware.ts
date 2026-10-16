// Relays and meters when a stay changes unit or a check-in/check-out is
// undone, with the real outcome of each step as receipt lines (same wording
// as the check-in receipt). Server-only plain module — not a server action
// file. Units without hardware (most pitches) get no lines at all.

import * as ha from "./homeassistant";
import * as hardware from "./hardware";
import { logger } from "./logger";
import type { ReceiptLine } from "./check-in";
import {
  readWithReason,
  readingLine,
  reasonAdvice,
  shortReason,
  switchOnLine,
  unitHardwareSummary,
  type CheckInHardwareRow,
} from "./check-in-hardware";

export type StayHardwareRow = CheckInHardwareRow & { winterModeEnabled: boolean };

export interface MeterReadings {
  el: { value: number | null; reason: string | null } | null;
  heat: { value: number | null; reason: string | null } | null;
  water: { value: number | null; reason: string | null } | null;
}

/** Reads every configured meter once (null = no such meter on the unit). */
export async function readUnitMeters(hw: StayHardwareRow | null | undefined): Promise<MeterReadings> {
  return {
    el: hardware.hasElectricityMeter(hw) ? await readWithReason(hardware.electricityMeterEp(hw!)) : null,
    heat: hardware.hasHeatingMeter(hw) ? await readWithReason(hardware.heatingMeterEp(hw!)) : null,
    water: hardware.hasWaterMeter(hw) ? await readWithReason(hardware.waterMeterEp(hw!)) : null,
  };
}

export function hasMeters(hw: StayHardwareRow | null | undefined): boolean {
  return unitHardwareSummary(hw).meters;
}

/** Receipt lines for readings, labelled with the unit ("Startaflæsning el · Plads 97"). */
export function meterLines(prefix: string, unitName: string, r: MeterReadings): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  if (r.el) lines.push(readingLine(`${prefix} el · ${unitName}`, r.el, "kWh"));
  if (r.heat) lines.push(readingLine(`${prefix} varme · ${unitName}`, r.heat, "kWh"));
  if (r.water) lines.push(readingLine(`${prefix} vand · ${unitName}`, r.water, "L"));
  return lines;
}

async function switchOffLine(ep: hardware.HardwareEndpoint, label: string, context: string): Promise<ReceiptLine> {
  try {
    await hardware.setSwitch(ep, false);
    return { label, tone: "ok", text: "Slukket" };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const msg = ep.source === "HA" ? `Home Assistant: ${raw}` : raw;
    logger.error("hardware", `${context} ${label.toLowerCase()} off`, e);
    return {
      label,
      tone: "error",
      text: `FEJL – ${shortReason(msg)}`,
      detail: [reasonAdvice(msg), "Sluk manuelt under enhedens styring, når den svarer igen."].filter(Boolean).join(" "),
    };
  }
}

/**
 * The unit is left empty: power off, heating off (unless winter mode protects
 * the cabin), thermostat to the vacant temperature, door locked.
 */
export async function stopUnitHardware(
  hw: StayHardwareRow | null | undefined,
  unitName: string,
  context: string,
  vacantTemp: number,
): Promise<ReceiptLine[]> {
  if (!hw || !unitHardwareSummary(hw).any) return [];
  const lines: ReceiptLine[] = [];
  if (hardware.hasElectricitySwitch(hw)) lines.push(await switchOffLine(hardware.electricitySwitchEp(hw), `Strøm · ${unitName}`, context));
  if (hardware.hasHeatingSwitch(hw) && !hw.winterModeEnabled) {
    lines.push(await switchOffLine(hardware.heatingSwitchEp(hw), `Varme · ${unitName}`, context));
  }
  if (hw.hasClimate && hw.climateEntityId) {
    try {
      await ha.setClimateTemperature(hw.climateEntityId, vacantTemp);
      lines.push({ label: `Termostat · ${unitName}`, tone: "ok", text: `Sat til ${vacantTemp} °C` });
    } catch (e) {
      logger.error("hardware", `${context} climate vacant`, e);
      lines.push({ label: `Termostat · ${unitName}`, tone: "error", text: `FEJL – ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  if (hw.hasSmartLock && hw.lockEntityId) {
    try {
      await ha.lockDoor(hw.lockEntityId);
      lines.push({ label: `Dørlås · ${unitName}`, tone: "ok", text: "Låst" });
    } catch (e) {
      logger.error("hardware", `${context} lock`, e);
      lines.push({ label: `Dørlås · ${unitName}`, tone: "error", text: `FEJL – ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return lines;
}

/** A guest is (again) on the unit: power and heating on, thermostat, door unlocked. */
export async function resumeUnitHardware(
  hw: StayHardwareRow | null | undefined,
  unitName: string,
  context: string,
  occupiedTemp: number,
): Promise<ReceiptLine[]> {
  if (!hw || !unitHardwareSummary(hw).any) return [];
  const lines: ReceiptLine[] = [];
  if (hardware.hasElectricitySwitch(hw)) lines.push(await switchOnLine(hardware.electricitySwitchEp(hw), `Strøm · ${unitName}`, context));
  if (hardware.hasHeatingSwitch(hw)) lines.push(await switchOnLine(hardware.heatingSwitchEp(hw), `Varme · ${unitName}`, context));
  if (hw.hasClimate && hw.climateEntityId) {
    try {
      await ha.setClimateTemperature(hw.climateEntityId, occupiedTemp);
      lines.push({ label: `Termostat · ${unitName}`, tone: "ok", text: `Sat til ${occupiedTemp} °C` });
    } catch (e) {
      logger.error("hardware", `${context} climate`, e);
      lines.push({ label: `Termostat · ${unitName}`, tone: "error", text: `FEJL – ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  if (hw.hasSmartLock && hw.lockEntityId) {
    try {
      await ha.unlockDoor(hw.lockEntityId);
      lines.push({ label: `Dørlås · ${unitName}`, tone: "ok", text: "Låst op" });
    } catch (e) {
      logger.error("hardware", `${context} unlock`, e);
      lines.push({ label: `Dørlås · ${unitName}`, tone: "error", text: `FEJL – ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return lines;
}
