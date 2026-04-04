/**
 * Home Assistant REST API client.
 * Runs server-side only — the HA token is never exposed to the browser.
 */

import { prisma } from "./prisma";

interface HAState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

async function getHAConfig(): Promise<{ url: string; token: string }> {
  const [urlSetting, tokenSetting] = await Promise.all([
    prisma.globalSetting.findUnique({ where: { key: "ha_url" } }),
    prisma.globalSetting.findUnique({ where: { key: "ha_token" } }),
  ]);

  if (!urlSetting?.value || !tokenSetting?.value) {
    throw new Error("Home Assistant URL or Token not configured");
  }

  return { url: urlSetting.value, token: tokenSetting.value };
}

async function haFetch(path: string, options?: RequestInit): Promise<Response> {
  const { url, token } = await getHAConfig();
  const response = await fetch(`${url}/api${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
    signal: AbortSignal.timeout(10000), // 10s timeout
  });

  if (!response.ok) {
    throw new Error(`HA API error: ${response.status} ${response.statusText}`);
  }

  return response;
}

/** Get the current state of an entity */
export async function getEntityState(entityId: string): Promise<HAState> {
  const res = await haFetch(`/states/${entityId}`);
  return res.json();
}

/** Get numeric state value (for meters) — returns null if unavailable */
export async function getEntityNumericState(
  entityId: string
): Promise<number | null> {
  try {
    const state = await getEntityState(entityId);
    const value = parseFloat(state.state);
    return isNaN(value) ? null : value;
  } catch {
    return null;
  }
}

/** Turn a switch on */
export async function turnOn(entityId: string): Promise<void> {
  await haFetch("/services/switch/turn_on", {
    method: "POST",
    body: JSON.stringify({ entity_id: entityId }),
  });
}

/** Turn a switch off */
export async function turnOff(entityId: string): Promise<void> {
  await haFetch("/services/switch/turn_off", {
    method: "POST",
    body: JSON.stringify({ entity_id: entityId }),
  });
}

/** Lock a smart lock */
export async function lockDoor(entityId: string): Promise<void> {
  await haFetch("/services/lock/lock", {
    method: "POST",
    body: JSON.stringify({ entity_id: entityId }),
  });
}

/** Unlock a smart lock */
export async function unlockDoor(entityId: string): Promise<void> {
  await haFetch("/services/lock/unlock", {
    method: "POST",
    body: JSON.stringify({ entity_id: entityId }),
  });
}

/** Set climate temperature */
export async function setClimateTemperature(
  entityId: string,
  temperature: number
): Promise<void> {
  await haFetch("/services/climate/set_temperature", {
    method: "POST",
    body: JSON.stringify({ entity_id: entityId, temperature }),
  });
}

/** Check if HA is reachable */
export async function checkHAConnection(): Promise<boolean> {
  try {
    const res = await haFetch("/");
    return res.ok;
  } catch {
    return false;
  }
}
