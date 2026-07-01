/**
 * Mosquitto / MQTT client — singleton connection shared across all server
 * actions. Used as an alternative to Home Assistant for Shelly Gen3+ devices
 * that publish to a local broker.
 *
 * Runs server-side only. The broker credentials are stored in GlobalSetting
 * and never exposed to the browser.
 *
 * Shelly Gen2/3+ topic convention (per their docs):
 *   Status  — {prefix}/status/{component}   (retained JSON, QoS 0)
 *     e.g.  shellyplus1pm-abc123/status/switch:0
 *     payload includes  output:bool  apower:W  aenergy.total:Wh  voltage:V  current:A
 *   Command — {prefix}/command/{component}  (payload: "on" | "off" | "toggle")
 *     e.g.  shellyplus1pm-abc123/command/switch:0
 *
 * This client subscribes to each needed status topic on demand, caches the
 * latest payload + receive time in memory, and publishes commands directly.
 * Retained messages mean the latest state is delivered immediately on
 * subscribe, so we don't need a long warm-up period.
 */

import mqtt from "mqtt";
import type { MqttClient, IClientOptions, IClientPublishOptions } from "mqtt";
import { prisma } from "./prisma";
import { logger } from "./logger";

interface CachedMessage {
  payload: string;
  receivedAt: Date;
}

export interface MqttConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
}

/** A device discovered on the broker, grouped by its top-level topic prefix. */
export interface MqttDevice {
  id: string; // top-level topic segment, e.g. "Camping-S001"
  topicCount: number; // number of distinct topics seen under this prefix
  lastSeen: string; // ISO timestamp of the most recent message
  online: boolean | null; // parsed from {id}/online, null if unknown
  power: number | null; // summed apower (W) across switch/pm components, best-effort
  topics: string[]; // the sub-topics seen (sorted)
}

async function loadMqttConfig(): Promise<MqttConfig> {
  const rows = await prisma.globalSetting.findMany({
    where: {
      key: { in: ["mqtt_enabled", "mqtt_host", "mqtt_port", "mqtt_username", "mqtt_password", "mqtt_tls"] },
    },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    enabled: map.mqtt_enabled === "true",
    host: map.mqtt_host || "localhost",
    port: parseInt(map.mqtt_port || "1883", 10),
    username: map.mqtt_username || "",
    password: map.mqtt_password || "",
    tls: map.mqtt_tls === "true",
  };
}

class MqttClientWrapper {
  private client: MqttClient | null = null;
  private cache = new Map<string, CachedMessage>();
  private subscribed = new Set<string>();
  private connectPromise: Promise<MqttClient | null> | null = null;
  private reconnecting: Promise<MqttClient | null> | null = null;
  private lastConfigKey = "";

  /**
   * Ensure a live MQTT connection using current GlobalSetting config.
   * Returns null if MQTT is disabled or the connection fails.
   * Concurrent callers share the same in-flight connection attempt.
   */
  async ensureConnected(): Promise<MqttClient | null> {
    if (this.client?.connected) return this.client;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = (async () => {
      try {
        const cfg = await loadMqttConfig();
        if (!cfg.enabled) {
          await this.teardown();
          return null;
        }

        const configKey = `${cfg.host}:${cfg.port}:${cfg.username}:${cfg.password}:${cfg.tls}`;
        if (this.client && configKey !== this.lastConfigKey) {
          // Config changed — force reconnect with fresh credentials
          await this.teardown();
        }
        this.lastConfigKey = configKey;

        const options: IClientOptions = {
          protocol: cfg.tls ? "mqtts" : "mqtt",
          host: cfg.host,
          port: cfg.port,
          username: cfg.username || undefined,
          password: cfg.password || undefined,
          reconnectPeriod: 5000,
          connectTimeout: 10_000,
          clean: true,
          clientId: `campsense-${process.pid}-${Math.random().toString(16).slice(2, 8)}`,
          ...(cfg.tls && { rejectUnauthorized: true }),
        };

        const c = mqtt.connect(options);

        // Wait for either connect or error
        await new Promise<void>((resolve, reject) => {
          const onConnect = () => {
            c.off("error", onError);
            resolve();
          };
          const onError = (err: Error) => {
            c.off("connect", onConnect);
            reject(err);
          };
          c.once("connect", onConnect);
          c.once("error", onError);
          setTimeout(() => {
            c.off("connect", onConnect);
            c.off("error", onError);
            reject(new Error("MQTT connect timeout"));
          }, 10_000);
        });

        c.on("message", (topic, payload) => {
          this.cache.set(topic, { payload: payload.toString(), receivedAt: new Date() });
        });
        c.on("error", (err) => {
          logger.error("mqtt", "Connection error", err.message);
        });
        c.on("close", () => {
          // mqtt.js will auto-reconnect via reconnectPeriod; subscriptions are
          // re-applied on 'connect' below.
        });
        c.on("connect", () => {
          // Re-subscribe after reconnect
          for (const topic of this.subscribed) {
            c.subscribe(topic, { qos: 0 });
          }
        });

        this.client = c;
        return c;
      } catch (e) {
        logger.error("mqtt", "Connect failed", e instanceof Error ? e.message : e);
        await this.teardown();
        return null;
      } finally {
        this.connectPromise = null;
      }
    })();

    return this.connectPromise;
  }

  /** Subscribe to a topic (idempotent). Returns true on success. */
  async subscribe(topic: string): Promise<boolean> {
    const c = await this.ensureConnected();
    if (!c) return false;
    if (this.subscribed.has(topic)) return true;
    return new Promise<boolean>((resolve) => {
      c.subscribe(topic, { qos: 0 }, (err) => {
        if (err) {
          logger.error("mqtt", `Subscribe failed [${topic}]`, err.message);
          resolve(false);
        } else {
          this.subscribed.add(topic);
          resolve(true);
        }
      });
    });
  }

  /** Get the latest cached message for a topic, or null if none received. */
  getCached(topic: string): CachedMessage | null {
    return this.cache.get(topic) ?? null;
  }

  /**
   * Subscribe if needed, then wait briefly for a retained message to arrive
   * before returning the cached payload. Shellies publish status as retained
   * messages so the first value typically arrives within a few ms of subscribe.
   */
  async getStatus(topic: string, waitMs = 500): Promise<CachedMessage | null> {
    const subscribed = await this.subscribe(topic);
    if (!subscribed) return null;

    const existing = this.getCached(topic);
    if (existing) return existing;

    // Wait up to waitMs for the retained message to arrive
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
      const c = this.getCached(topic);
      if (c) return c;
    }
    return null;
  }

  /**
   * Discover devices on the broker the way MQTT Explorer does: subscribe to the
   * wildcard `#`, let retained messages populate the cache, then group every
   * topic by its top-level segment. Shelly status/online topics are retained,
   * so a device shows up within milliseconds of subscribing.
   *
   * Note: `#` does not match `$SYS/...` per the MQTT spec, so broker-internal
   * topics are excluded automatically.
   */
  async discoverDevices(waitMs = 1500): Promise<MqttDevice[]> {
    const c = await this.ensureConnected();
    if (!c) return [];

    await this.subscribe("#");
    // Give retained messages time to arrive (only meaningful on the first call;
    // afterwards the cache is already warm).
    if (this.cache.size === 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    } else {
      await new Promise((r) => setTimeout(r, 150));
    }

    interface Group {
      topics: Set<string>;
      lastSeen: Date;
      online: boolean | null;
      power: number | null;
    }
    const groups = new Map<string, Group>();

    for (const [topic, msg] of this.cache.entries()) {
      const seg = topic.split("/")[0];
      if (!seg || seg.startsWith("$")) continue;

      let g = groups.get(seg);
      if (!g) {
        g = { topics: new Set(), lastSeen: msg.receivedAt, online: null, power: null };
        groups.set(seg, g);
      }
      g.topics.add(topic);
      if (msg.receivedAt > g.lastSeen) g.lastSeen = msg.receivedAt;

      // Shelly last-will: {id}/online = "true" | "false"
      if (topic === `${seg}/online`) {
        g.online = msg.payload.trim() === "true";
      }

      // Best-effort live power: apower (W) from switch/pm/em status components
      if (/\/status\/(switch|pm1?|em1?):/.test(topic)) {
        try {
          const j = JSON.parse(msg.payload);
          if (typeof j.apower === "number") g.power = (g.power ?? 0) + j.apower;
        } catch {
          /* not JSON — ignore */
        }
      }
    }

    return [...groups.entries()]
      .map(([id, g]) => ({
        id,
        topicCount: g.topics.size,
        lastSeen: g.lastSeen.toISOString(),
        online: g.online,
        power: g.power,
        topics: [...g.topics].sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Publish a command. Throws if broker is not connected. */
  async publish(topic: string, payload: string, options?: IClientPublishOptions): Promise<void> {
    const c = await this.ensureConnected();
    if (!c) throw new Error("MQTT broker ikke forbundet — tjek konfiguration i indstillinger");
    return new Promise((resolve, reject) => {
      c.publish(topic, payload, options ?? { qos: 1 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Current connection status — used by the admin status panel. */
  isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  /** Force a reconnect (e.g. after config change in admin UI). */
  async reconnect(): Promise<MqttClient | null> {
    if (this.reconnecting) return this.reconnecting;
    this.reconnecting = (async () => {
      try {
        await this.teardown();
        return await this.ensureConnected();
      } finally {
        this.reconnecting = null;
      }
    })();
    return this.reconnecting;
  }

  private async teardown(): Promise<void> {
    this.connectPromise = null;
    if (this.client) {
      try {
        this.client.end(true);
      } catch {
        /* ignore */
      }
      this.client = null;
    }
    this.subscribed.clear();
    this.cache.clear();
  }
}

// Singleton across Next.js hot-reload + server actions.
declare global {
  var __campsense_mqtt: MqttClientWrapper | undefined;
}

export const mqttClient: MqttClientWrapper =
  globalThis.__campsense_mqtt ?? new MqttClientWrapper();
if (!globalThis.__campsense_mqtt) {
  globalThis.__campsense_mqtt = mqttClient;
}

/**
 * Test a broker config without persisting it. Used by the "Test forbindelse"
 * button in the admin settings before the user saves.
 */
export async function testMqttBroker(cfg: {
  host: string;
  port: number;
  username: string;
  password: string;
  tls?: boolean;
}): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const c = mqtt.connect({
      protocol: cfg.tls ? "mqtts" : "mqtt",
      host: cfg.host,
      port: cfg.port,
      username: cfg.username || undefined,
      password: cfg.password || undefined,
      reconnectPeriod: 0,
      connectTimeout: 5_000,
      clean: true,
      clientId: `campsense-test-${Date.now()}`,
      ...(cfg.tls && { rejectUnauthorized: true }),
    });
    const done = (ok: boolean, message: string) => {
      try {
        c.end(true);
      } catch {
        /* ignore */
      }
      resolve({ ok, message });
    };
    const timer = setTimeout(() => done(false, `Timeout — ${cfg.host}:${cfg.port} svarer ikke`), 6_000);
    c.once("connect", () => {
      clearTimeout(timer);
      done(true, `Forbundet til ${cfg.host}:${cfg.port}`);
    });
    c.once("error", (err) => {
      clearTimeout(timer);
      const msg = err.message || "ukendt fejl";
      if (msg.includes("ECONNREFUSED")) {
        done(false, `Kan ikke nå broker — er mosquitto startet på ${cfg.host}:${cfg.port}?`);
      } else if (msg.toLowerCase().includes("not authorized") || msg.toLowerCase().includes("bad username")) {
        done(false, "Forkert brugernavn eller kodeord");
      } else {
        done(false, `Fejl: ${msg}`);
      }
    });
  });
}
