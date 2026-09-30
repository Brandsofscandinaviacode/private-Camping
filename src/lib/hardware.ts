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
  const msg = await mqttClient.getShellyStatus(prefix, component);
  if (!msg) return null;
  try {
    const data = JSON.parse(msg.payload) as ShellyComponentStatus;
    return { data, ageMs: Date.now() - msg.receivedAt.getTime() };
  } catch (e) {
    logger.error("hardware", `MQTT: kunne ikke parse payload fra ${topic}`, e);
    return null;
  }
}

/**
 * Where a component's energy counter lives. Switch/PM report `aenergy.total`
 * on the component itself; the EM family keeps energy in a separate data
 * component (EM1Data / EMData) with different field names.
 */
async function readShellyEnergyWh(prefix: string, component: string): Promise<{ wh: number | null; reason: string | null }> {
  const m = component.match(/^([a-z0-9]+):(\d+)$/i);
  const kind = m?.[1].toLowerCase();
  const idx = m?.[2] ?? "0";
  if (kind === "em1" || kind === "em") {
    const dataComp = kind === "em1" ? `em1data:${idx}` : `emdata:${idx}`;
    const res = await readShellyStatus(prefix, dataComp);
    if (!res) return { wh: null, reason: null };
    const d = res.data as ShellyComponentStatus & { total_act_energy?: number; total_act?: number };
    const wh = kind === "em1" ? d.total_act_energy : d.total_act;
    return typeof wh === "number" ? { wh, reason: null } : { wh: null, reason: `${dataComp} har ingen energitæller` };
  }
  const res = await readShellyStatus(prefix, component);
  if (!res) return { wh: null, reason: null };
  const wh = res.data.aenergy?.total;
  return typeof wh === "number" ? { wh, reason: null } : { wh: null, reason: `${component} har ingen energitæller (aenergy.total) — komponenten måler ikke kWh` };
}

function shellyPowerW(component: string, data: ShellyComponentStatus): number | null {
  const kind = component.split(":")[0].toLowerCase();
  const d = data as ShellyComponentStatus & { act_power?: number; total_act_power?: number };
  const w = kind === "em1" ? d.act_power : kind === "em" ? d.total_act_power : d.apower;
  return typeof w === "number" ? w : null;
}

/** HA energy sensors may report Wh or MWh; billing works in kWh. */
async function readHaEnergyKwh(entityId: string): Promise<{ kwh: number | null; state: string }> {
  const st = await ha.getEntityState(entityId);
  const v = parseFloat(st.state);
  if (isNaN(v)) return { kwh: null, state: st.state };
  const unit = (st.attributes.unit_of_measurement as string | undefined)?.toLowerCase();
  const kwh = unit === "wh" ? v / 1000 : unit === "mwh" ? v * 1000 : v;
  return { kwh, state: st.state };
}

function normalizedSource(source: string | null | undefined): HardwareSource {
  return source === "MQTT" ? "MQTT" : "HA";
}

// ──────────────────────────────────────────────
// Public read/write primitives on an endpoint
// ──────────────────────────────────────────────

/** Read cumulative energy in kWh. Returns null if unavailable. */
export async function readEnergyKwh(ep: HardwareEndpoint): Promise<number | null> {
  return (await readEnergyKwhWithReason(ep)).kwh;
}

/**
 * Like readEnergyKwh, but when there is no value it says why — so the admin
 * sees "wrong MQTT prefix" or "HA entity unavailable" instead of a bare
 * "no reading". Used by the cron's meter logging.
 */
export async function readEnergyKwhWithReason(
  ep: HardwareEndpoint,
): Promise<{ kwh: number | null; reason: string | null }> {
  if (ep.source === "MQTT") {
    if (!ep.mqttPrefix || !ep.mqttComponent) {
      return { kwh: null, reason: "MQTT: prefix eller komponent mangler" };
    }
    const r = await readShellyEnergyWh(ep.mqttPrefix, ep.mqttComponent);
    if (r.wh !== null) return { kwh: r.wh / 1000, reason: null };
    if (r.reason) return { kwh: null, reason: `MQTT: ${r.reason}` };
    return {
      kwh: null,
      reason: mqttClient.isConnected()
        ? `MQTT: ${ep.mqttPrefix} svarede ikke på ${ep.mqttComponent} — enheden er offline, eller prefix/komponent er forkert (se "Forbundne enheder")`
        : "MQTT: CampSense er ikke forbundet til brokeren",
    };
  }
  if (!ep.haEntityId) return { kwh: null, reason: "HA: ingen måler-entitet valgt" };
  try {
    const r = await readHaEnergyKwh(ep.haEntityId);
    if (r.kwh === null) return { kwh: null, reason: `HA: ${ep.haEntityId} er "${r.state}"` };
    return { kwh: r.kwh, reason: null };
  } catch (e) {
    return { kwh: null, reason: `HA: kunne ikke hente ${ep.haEntityId} (${e instanceof Error ? e.message : "ukendt fejl"})` };
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
    const w = shellyPowerW(ep.mqttComponent, res.data);
    if (w === null) return null;
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

/**
 * Switch a Shelly relay via RPC and wait for the device's reply. A plain
 * publish is only acknowledged by the broker, so an offline device looked
 * like success — callers then ended sessions / counted power-offs that never
 * happened. Throws if the device doesn't confirm or reports an error.
 */
async function shellySwitchSet(prefix: string, component: string, params: { on: boolean; toggle_after?: number }): Promise<void> {
  const m = component.match(/^switch:(\d+)$/i);
  if (!m) {
    // Not a switch component — fall back to the command topic (unconfirmed).
    await mqttClient.publish(`${prefix}/command/${component}`, params.on ? "on" : "off");
    return;
  }
  const reply = await mqttClient.rpc(prefix, "Switch.Set", { id: parseInt(m[1], 10), ...params }, 4000);
  if (!reply) throw new Error(`${prefix} bekræftede ikke kommandoen (offline?)`);
  if (reply.error) throw new Error(`${prefix}: ${reply.error.message ?? "fejl"} (kode ${reply.error.code ?? "?"})`);
}

/** Turn a switch endpoint on or off. Throws on transport failure. */
export async function setSwitch(ep: HardwareEndpoint, on: boolean): Promise<void> {
  if (ep.source === "MQTT") {
    if (!ep.mqttPrefix || !ep.mqttComponent) {
      throw new Error("MQTT prefix/component ikke konfigureret");
    }
    await shellySwitchSet(ep.mqttPrefix, ep.mqttComponent, { on });
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
    await shellySwitchSet(ep.mqttPrefix, ep.mqttComponent, { on: true, toggle_after: autoOffSeconds });
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
