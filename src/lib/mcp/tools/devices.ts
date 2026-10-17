// MQTT broker / Shelly device tools. Only status-reading RPC methods are ever
// sent; the method name is built from a fixed allow-list, never from input.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listMqttDevices } from "@/lib/actions";
import { mqttClient } from "@/lib/mqtt-client";
import { prisma } from "@/lib/prisma";
import { ToolError, registerReadOnlyTool, secondsSince } from "@/lib/mcp/tools/common";

// Shelly Gen2+ component kinds → RPC namespace. Indexed components take an id.
const INDEXED_COMPONENTS: Record<string, string> = {
  switch: "Switch",
  pm1: "PM1",
  em1: "EM1",
  em: "EM",
  em1data: "EM1Data",
  emdata: "EMData",
  cover: "Cover",
  light: "Light",
  input: "Input",
  temperature: "Temperature",
  humidity: "Humidity",
  voltmeter: "Voltmeter",
};
const SINGLETON_COMPONENTS: Record<string, string> = {
  sys: "Sys",
  wifi: "WiFi",
  mqtt: "MQTT",
  cloud: "Cloud",
  eth: "Eth",
  ble: "BLE",
};

/**
 * Topic prefixes may span several levels (Shelly allows "camping/s001"), but
 * never wildcards (+ #), $-topics or empty levels.
 */
const PREFIX_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

async function requireMqttEnabled(): Promise<void> {
  const row = await prisma.globalSetting.findUnique({ where: { key: "mqtt_enabled" } });
  if (row?.value !== "true") {
    throw new ToolError("MQTT is disabled in CampSense settings (mqtt_enabled) — devices are read via Home Assistant only.");
  }
}

export function registerDeviceTools(server: McpServer): void {
  registerReadOnlyTool(server, {
    name: "list_mqtt_devices",
    title: "MQTT devices",
    description:
      "Devices seen on the MQTT broker (grouped by top-level topic prefix, e.g. a Shelly id) with online/offline (Shelly last-will), last message time, " +
      "relay outputs, summed power/energy, voltage, temperature, Wi-Fi RSSI/IP and which CampSense units, showers or laundry machines use that prefix. " +
      "Discovery subscribes to the broker's wildcard topic; status topics are only included when includeTopics is true.",
    live: true,
    input: z.object({
      prefix: z.string().max(100).optional().describe("Only devices whose id contains this text"),
      includeTopics: z.boolean().default(false).describe("Include each device's topics with the latest (truncated) payload"),
    }),
    handler: async ({ prefix, includeTopics }) => {
      await requireMqttEnabled();
      const r = await listMqttDevices();
      if (!r.ok) throw new ToolError(r.message ?? "MQTT device discovery failed");
      const needle = prefix?.toLowerCase();
      const devices = r.devices.filter((d) => !needle || d.id.toLowerCase().includes(needle));
      const now = Date.now();
      return {
        connected: mqttClient.isConnected(),
        count: devices.length,
        devices: devices.slice(0, 200).map((d) => ({
          id: d.id,
          online: d.online,
          // Only messages from the device itself; CampSense's own /rpc requests don't count.
          lastSeen: d.lastSeen,
          lastSeenAgeSeconds: d.lastSeen ? secondsSince(new Date(d.lastSeen), now) : null,
          usedBy: d.usedBy,
          outputs: d.outputs,
          powerW: d.power,
          energyWh: d.energyWh,
          voltage: d.voltage,
          temperatureC: d.temperature,
          rssi: d.rssi,
          ip: d.ip,
          topicCount: d.topicCount,
          messageCount: d.messageCount,
          ...(includeTopics ? { topics: d.topics.slice(0, 50) } : {}),
        })),
      };
    },
  });

  registerReadOnlyTool(server, {
    name: "get_shelly_status",
    title: "Shelly status (RPC)",
    description:
      "Asks a Shelly Gen2+ device for its status over MQTT RPC. Without component: Shelly.GetStatus (whole device) — or Shelly.GetDeviceInfo when deviceInfo is true. " +
      "With component (e.g. switch:0, em1:0, em1data:0, pm1:0, input:1, sys, wifi): only <Component>.GetStatus. No other RPC method can be sent. " +
      "If the device does not answer within the timeout, the last cached status message (if any) is returned with its age.",
    live: true,
    input: z.object({
      prefix: z.string().max(200).regex(PREFIX_RE, "MQTT topic prefix, e.g. shellyplus1pm-a8032ab12345").describe("Device topic prefix"),
      component: z
        .string()
        .max(32)
        .optional()
        .describe("Shelly component, e.g. switch:0, em1:0, em1data:0, pm1:0, input:0, sys, wifi"),
      deviceInfo: z.boolean().default(false).describe("Without component: call Shelly.GetDeviceInfo instead of Shelly.GetStatus"),
      timeoutMs: z.number().int().min(500).max(10_000).default(3000),
    }),
    handler: async ({ prefix, component, deviceInfo, timeoutMs }) => {
      let method: string;
      let params: Record<string, unknown> = {};
      let cachedTopic: string | null = null;
      if (component) {
        const comp = component.trim().toLowerCase();
        const indexed = /^([a-z0-9]+):(\d{1,3})$/.exec(comp);
        if (indexed && INDEXED_COMPONENTS[indexed[1]]) {
          method = `${INDEXED_COMPONENTS[indexed[1]]}.GetStatus`;
          params = { id: parseInt(indexed[2], 10) };
        } else if (SINGLETON_COMPONENTS[comp]) {
          method = `${SINGLETON_COMPONENTS[comp]}.GetStatus`;
        } else {
          throw new ToolError(
            `Unsupported component "${component}". Use one of ${Object.keys(INDEXED_COMPONENTS).map((k) => `${k}:N`).join(", ")}, ${Object.keys(SINGLETON_COMPONENTS).join(", ")}.`,
          );
        }
        cachedTopic = `${prefix}/status/${comp}`;
      } else {
        method = deviceInfo ? "Shelly.GetDeviceInfo" : "Shelly.GetStatus";
      }

      await requireMqttEnabled();
      const t0 = Date.now();
      const reply = await mqttClient.rpc(prefix, method, params, timeoutMs);
      const ms = Date.now() - t0;

      if (reply) {
        return {
          prefix,
          method,
          params,
          ms,
          ...(reply.error ? { error: reply.error } : { result: reply.result }),
        };
      }

      const cached = cachedTopic ? mqttClient.getCached(cachedTopic) : null;
      let cachedPayload: unknown = null;
      if (cached) {
        try {
          cachedPayload = JSON.parse(cached.payload);
        } catch {
          cachedPayload = cached.payload.slice(0, 2000);
        }
      }
      return {
        prefix,
        method,
        params,
        ms,
        answered: false,
        reason: mqttClient.isConnected()
          ? `No reply within ${timeoutMs} ms — device offline, or wrong prefix (see list_mqtt_devices)`
          : "CampSense is not connected to the MQTT broker",
        cached: cached ? { receivedAt: cached.receivedAt, ageSeconds: secondsSince(cached.receivedAt), payload: cachedPayload } : null,
      };
    },
  });
}
