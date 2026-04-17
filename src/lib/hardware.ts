/**
 * Hardware abstraction layer.
 *
 * Every unit/laundry machine/shower has a `source` field picking either
 * "HA" (Home Assistant REST API) or "MQTT" (direct Mosquitto). This module
 * dispatches read/write operations to the right transport so call sites
 * (actions.ts, cron, guest portal) only deal with a simple endpoint object.
 *
 * Shelly Gen2/3+ convention for MQTT:
 *   A single "component" on the device (e.g. `switch:0`) exposes both the
 *   relay and the in-built energy + power meter. Status topic publishes a
 *   retained JSON object with `output`, `apower`, `aenergy.total`, etc.
 *   Command topic accepts `on`/`off`/`toggle` as plain text payloads.
 *
 * Climate (thermostat) and smart locks remain HA-only — Shelly does not
 * cover those device classes natively.
 */

import * as ha from "./homeassistant";
import { mqttClient } from "./mqtt-client";
import { logger } from "./logger";

export type HardwareSource = "HA" | "MQTT";

/** A single addressable hardware endpoint. */
export interface HardwareEndpoint {
  source: HardwareSource;
  /** HA: the specific entity_id to read/control. */
  haEntityId?: string | null;
  /** MQTT: Shelly device topic prefix, e.g. `shellyplus1pm-abc123`. */
  mqttPrefix?: string | null;
  /** MQTT: Shelly component id, e.g. `switch:0`. */
  mqttComponent?: string | null;
}

// ──────────────────────────────────────────────
// Low-level MQTT helpers — parse Shelly Gen2+ status JSON
// ──────────────────────────────────────────────
interface ShellyComponentStatus {
  output?: boolean;
  apower?: number;       // W
  aenergy?: { total?: number }; // Wh (cumulative)
  voltage?: number;
  current?: number;
  temperature?: { tC?: number };
}

async function readShellyStatus(
  prefix: string,
  component: string,
): Promise<{ data: ShellyComponentStatus; ageMs: number } | null> {
  const topic = `${prefix}/status/${component}`;
  const msg = await mqttClient.getStatus(topic);
  if (!msg) return null;
  try {
    const data = JSON.parse(msg.payload) as ShellyComponentStatus;
    return { data, ageMs: Date.now() - msg.receivedAt.getTime() };
  } catch (e) {
    logger.error("hardware", `MQTT: kunne ikke parse payload fra ${topic}`, e);
    return null;
  }
}

function normalizedSource(source: string | null | undefined): HardwareSource {
  return source === "MQTT" ? "MQTT" : "HA";
}

// ──────────────────────────────────────────────
// Public read/write primitives on an endpoint
// ──────────────────────────────────────────────

/** Read cumulative energy in kWh. Returns null if unavailable. */
export async function readEnergyKwh(ep: HardwareEndpoint): Promise<number | null> {
  if (ep.source === "MQTT") {
    if (!ep.mqttPrefix || !ep.mqttComponent) return null;
    const res = await readShellyStatus(ep.mqttPrefix, ep.mqttComponent);
    if (!res) return null;
    const wh = res.data.aenergy?.total;
    if (typeof wh !== "number") return null;
    return wh / 1000;
  }
  // HA
  if (!ep.haEntityId) return null;
  try {
    return await ha.getEntityNumericState(ep.haEntityId);
  } catch {
    return null;
  }
}

/** Read instantaneous power in W. Returns null if unavailable. */
export async function readPowerWatts(
  ep: HardwareEndpoint,
): Promise<{ watts: number; ageMs: number } | null> {
  if (ep.source === "MQTT") {
    if (!ep.mqttPrefix || !ep.mqttComponent) return null;
    const res = await readShellyStatus(ep.mqttPrefix, ep.mqttComponent);
    if (!res) return null;
    const w = res.data.apower;
    if (typeof w !== "number") return null;
    return { watts: w, ageMs: res.ageMs };
  }
  // HA
  if (!ep.haEntityId) return null;
  try {
    const v = await ha.getEntityNumericState(ep.haEntityId);
    if (v === null) return null;
    // Normalize kW → W by inspecting the unit attribute
    try {
      const state = await ha.getEntityState(ep.haEntityId);
      const unit = (state.attributes.unit_of_measurement as string | undefined)?.toLowerCase();
      const watts = unit === "kw" ? v * 1000 : v;
      return { watts, ageMs: 0 };
    } catch {
      return { watts: v, ageMs: 0 };
    }
  } catch {
    return null;
  }
}

/** Turn a switch endpoint on or off. Throws on transport failure. */
export async function setSwitch(ep: HardwareEndpoint, on: boolean): Promise<void> {
  if (ep.source === "MQTT") {
    if (!ep.mqttPrefix || !ep.mqttComponent) {
      throw new Error("MQTT prefix/component ikke konfigureret");
    }
    const topic = `${ep.mqttPrefix}/command/${ep.mqttComponent}`;
    await mqttClient.publish(topic, on ? "on" : "off");
    return;
  }
  // HA
  if (!ep.haEntityId) throw new Error("HA entity ikke konfigureret");
  if (on) await ha.turnOn(ep.haEntityId);
  else await ha.turnOff(ep.haEntityId);
}

/**
 * Turn a switch ON with a hardware-level auto-off timer.
 * For MQTT (Shelly Gen2/3+), sends an RPC call with `toggle_after` which
 * causes the device itself to turn off after the given seconds — even if
 * the server, browser, and cron all fail.
 * For HA, falls back to a normal turnOn (no device-level timer available).
 */
export async function setSwitchTimed(ep: HardwareEndpoint, autoOffSeconds: number): Promise<void> {
  if (ep.source === "MQTT") {
    if (!ep.mqttPrefix || !ep.mqttComponent) {
      throw new Error("MQTT prefix/component ikke konfigureret");
    }
    // Shelly Gen2+ RPC: Switch.Set with toggle_after for hardware auto-off.
    // Component id is like "switch:0" — we need the numeric part.
    const idMatch = ep.mqttComponent.match(/:(\d+)$/);
    const switchId = idMatch ? parseInt(idMatch[1], 10) : 0;
    const rpcTopic = `${ep.mqttPrefix}/rpc`;
    const rpcPayload = JSON.stringify({
      id: Date.now() % 100000,
      src: "campsense",
      method: "Switch.Set",
      params: { id: switchId, on: true, toggle_after: autoOffSeconds },
    });
    await mqttClient.publish(rpcTopic, rpcPayload);
    return;
  }
  // HA — no device-level timer available, just turn on normally
  if (!ep.haEntityId) throw new Error("HA entity ikke konfigureret");
  await ha.turnOn(ep.haEntityId);
}

/** Read switch on/off state. Returns null if unknown. */
export async function getSwitchState(ep: HardwareEndpoint): Promise<boolean | null> {
  if (ep.source === "MQTT") {
    if (!ep.mqttPrefix || !ep.mqttComponent) return null;
    const res = await readShellyStatus(ep.mqttPrefix, ep.mqttComponent);
    if (!res) return null;
    return typeof res.data.output === "boolean" ? res.data.output : null;
  }
  // HA
  if (!ep.haEntityId) return null;
  try {
    const state = await ha.getEntityState(ep.haEntityId);
    return state.state === "on";
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────
// Endpoint builders — pull the right fields out of UnitHardware rows
// so call sites don't have to repeat the mapping.
// ──────────────────────────────────────────────

/** Minimal structural type covering the hw columns this module reads. */
export interface UnitHardwareRow {
  hasElectricity: boolean;
  electricitySource: string;
  electricitySwitchEntityId: string | null;
  electricityMeterEntityId: string | null;
  electricityPowerEntityId: string | null;
  electricityMqttPrefix: string | null;
  electricityMqttComponent: string | null;

  hasHeating: boolean;
  heatingSource: string;
  heatingSwitchEntityId: string | null;
  heatingMeterEntityId: string | null;
  heatingPowerEntityId: string | null;
  heatingMqttPrefix: string | null;
  heatingMqttComponent: string | null;

  hasWater: boolean;
  waterSource: string;
  waterMeterEntityId: string | null;
  waterMqttPrefix: string | null;
  waterMqttComponent: string | null;
}

export function electricitySwitchEp(hw: UnitHardwareRow): HardwareEndpoint {
  return {
    source: normalizedSource(hw.electricitySource),
    haEntityId: hw.electricitySwitchEntityId,
    mqttPrefix: hw.electricityMqttPrefix,
    mqttComponent: hw.electricityMqttComponent,
  };
}
export function electricityMeterEp(hw: UnitHardwareRow): HardwareEndpoint {
  return {
    source: normalizedSource(hw.electricitySource),
    haEntityId: hw.electricityMeterEntityId,
    mqttPrefix: hw.electricityMqttPrefix,
    mqttComponent: hw.electricityMqttComponent,
  };
}
export function electricityPowerEp(hw: UnitHardwareRow): HardwareEndpoint {
  return {
    source: normalizedSource(hw.electricitySource),
    haEntityId: hw.electricityPowerEntityId,
    mqttPrefix: hw.electricityMqttPrefix,
    mqttComponent: hw.electricityMqttComponent,
  };
}

export function heatingSwitchEp(hw: UnitHardwareRow): HardwareEndpoint {
  return {
    source: normalizedSource(hw.heatingSource),
    haEntityId: hw.heatingSwitchEntityId,
    mqttPrefix: hw.heatingMqttPrefix,
    mqttComponent: hw.heatingMqttComponent,
  };
}
export function heatingMeterEp(hw: UnitHardwareRow): HardwareEndpoint {
  return {
    source: normalizedSource(hw.heatingSource),
    haEntityId: hw.heatingMeterEntityId,
    mqttPrefix: hw.heatingMqttPrefix,
    mqttComponent: hw.heatingMqttComponent,
  };
}
export function heatingPowerEp(hw: UnitHardwareRow): HardwareEndpoint {
  return {
    source: normalizedSource(hw.heatingSource),
    haEntityId: hw.heatingPowerEntityId,
    mqttPrefix: hw.heatingMqttPrefix,
    mqttComponent: hw.heatingMqttComponent,
  };
}

export function waterMeterEp(hw: UnitHardwareRow): HardwareEndpoint {
  return {
    source: normalizedSource(hw.waterSource),
    haEntityId: hw.waterMeterEntityId,
    mqttPrefix: hw.waterMqttPrefix,
    mqttComponent: hw.waterMqttComponent,
  };
}

// ──────────────────────────────────────────────
// Configuration helpers — "does this unit actually have X wired up?"
// Used by checkIn / checkOut / tick to decide whether to attempt an op.
// ──────────────────────────────────────────────

export function hasElectricitySwitch(hw: UnitHardwareRow | null | undefined): boolean {
  if (!hw?.hasElectricity) return false;
  return isEndpointConfigured(electricitySwitchEp(hw));
}
export function hasElectricityMeter(hw: UnitHardwareRow | null | undefined): boolean {
  if (!hw?.hasElectricity) return false;
  return isEndpointConfigured(electricityMeterEp(hw));
}
export function hasElectricityPower(hw: UnitHardwareRow | null | undefined): boolean {
  if (!hw?.hasElectricity) return false;
  return isEndpointConfigured(electricityPowerEp(hw));
}
export function hasHeatingSwitch(hw: UnitHardwareRow | null | undefined): boolean {
  if (!hw?.hasHeating) return false;
  return isEndpointConfigured(heatingSwitchEp(hw));
}
export function hasHeatingMeter(hw: UnitHardwareRow | null | undefined): boolean {
  if (!hw?.hasHeating) return false;
  return isEndpointConfigured(heatingMeterEp(hw));
}
export function hasHeatingPower(hw: UnitHardwareRow | null | undefined): boolean {
  if (!hw?.hasHeating) return false;
  return isEndpointConfigured(heatingPowerEp(hw));
}
export function hasWaterMeter(hw: UnitHardwareRow | null | undefined): boolean {
  if (!hw?.hasWater) return false;
  return isEndpointConfigured(waterMeterEp(hw));
}

/** True if the endpoint has the config fields for its source filled in. */
export function isEndpointConfigured(ep: HardwareEndpoint): boolean {
  if (ep.source === "MQTT") return !!(ep.mqttPrefix && ep.mqttComponent);
  return !!ep.haEntityId;
}

/** Label describing where a value came from — used in error logs. */
export function endpointLabel(ep: HardwareEndpoint): string {
  if (ep.source === "MQTT") return `mqtt:${ep.mqttPrefix}/${ep.mqttComponent}`;
  return `ha:${ep.haEntityId}`;
}

// ──────────────────────────────────────────────
// Generic switch endpoint — for laundry machines + showers
// which store their own (source, switchEntityId, mqttPrefix, mqttComponent).
// ──────────────────────────────────────────────

export interface SwitchRow {
  source: string;
  switchEntityId: string | null;
  mqttPrefix: string | null;
  mqttComponent: string | null;
}

export function switchRowEp(row: SwitchRow): HardwareEndpoint {
  return {
    source: normalizedSource(row.source),
    haEntityId: row.switchEntityId,
    mqttPrefix: row.mqttPrefix,
    mqttComponent: row.mqttComponent,
  };
}

export function isSwitchRowConfigured(row: SwitchRow | null | undefined): boolean {
  if (!row) return false;
  return isEndpointConfigured(switchRowEp(row));
}
