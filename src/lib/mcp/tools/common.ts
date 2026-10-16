// Shared plumbing for the read-only MCP tools: registration with uniform
// annotations, error handling and JSON output, plus small domain helpers
// (booking state, masked guest info, Copenhagen time buckets).

import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { Session } from "@/generated/prisma/client";
import { runWithApiAuth } from "@/lib/auth-context";
import { expiredReservationWhere, isReservationExpired } from "@/lib/booking-status";
import { logger } from "@/lib/logger";
import type { McpAuth } from "@/lib/mcp/oauth";
import { maskEmail, maskPhone } from "@/lib/mcp/redact";

export interface McpToolContext {
  /** Who is calling — shown by get_system_status, never used for access decisions. */
  auth?: McpAuth;
}

/** An expected failure (bad id, nothing configured) — reported as-is to the client. */
export class ToolError extends Error {}

const MAX_TEXT_CHARS = 200_000;

/** Pretty JSON with floats trimmed to 4 decimals (meter readings, prices). */
export function toJsonText(data: unknown): string {
  const text = JSON.stringify(
    data,
    (_k, v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v),
    1,
  );
  if (text === undefined) return "null";
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}\n… (output truncated at ${MAX_TEXT_CHARS} of ${text.length} characters — narrow the query with filters or a lower limit)`;
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

interface ReadOnlyToolDef<S extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: S;
  /** Talks to live hardware (MQTT/Home Assistant) rather than only the database. */
  live?: boolean;
  handler: (args: z.output<S>) => Promise<unknown>;
}

/**
 * Register a read-only tool. The handler runs inside runWithApiAuth so the
 * existing requireAuth-guarded helpers in actions.ts can be reused, and any
 * error becomes an isError result instead of a JSON-RPC failure.
 */
export function registerReadOnlyTool<S extends z.ZodObject>(server: McpServer, def: ReadOnlyToolDef<S>): void {
  const run = async (args: z.output<S>): Promise<CallToolResult> => {
    try {
      const data = await runWithApiAuth(() => def.handler(args));
      return { content: [{ type: "text", text: toJsonText(data) }] };
    } catch (e) {
      if (e instanceof ToolError) return errorResult(e.message);
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("mcp", `Tool ${def.name} fejlede`, msg);
      return errorResult(`${def.name} failed: ${msg}`);
    }
  };
  server.registerTool(
    def.name,
    {
      title: def.title,
      description: def.description,
      inputSchema: def.input,
      annotations: { title: def.title, readOnlyHint: true, openWorldHint: def.live === true },
    },
    // The SDK's conditional callback type can't be resolved for a generic S;
    // `run` takes exactly the parsed input the SDK passes.
    run as unknown as ToolCallback<S>,
  );
}

// ── Booking state ─────────────────────────────────────────────

/**
 * ACTIVE / COMPLETED come straight from the row. A PENDING row is RESERVED
 * only while its stay hasn't ended — an imported booking that was never
 * checked in (e.g. July–August) is EXPIRED_RESERVATION by October, not
 * "Reserveret". Same rule as src/lib/booking-status.ts.
 */
export type BookingState = "ACTIVE" | "RESERVED" | "EXPIRED_RESERVATION" | "COMPLETED";

export function bookingState(s: {
  status: string;
  checkInTime: Date | string;
  expectedCheckOut: Date | string | null;
}): BookingState {
  if (s.status === "PENDING") return isReservationExpired(s) ? "EXPIRED_RESERVATION" : "RESERVED";
  return s.status === "ACTIVE" ? "ACTIVE" : "COMPLETED";
}

// Re-exported so every tool uses the one rule in booking-status.ts.
export { expiredReservationWhere };

export function maskedGuest(s: { guestName: string; guestEmail: string | null; guestPhone: string | null }) {
  return { name: s.guestName, email: maskEmail(s.guestEmail), phone: maskPhone(s.guestPhone) };
}

/**
 * El/water cost to set against a stay. Once checked out the stored totals are
 * what was billed (the legacy snapshot fallback or an admin edit can set them
 * without touching the accumulators); before that, the running accumulators.
 */
export function elWaterCost(
  s: Pick<Session, "status" | "accumulatedElCost" | "accumulatedWaterCost" | "totalElectricityCost" | "totalWaterCost">,
) {
  const done = s.status === "COMPLETED";
  return {
    el: done ? (s.totalElectricityCost ?? s.accumulatedElCost) : s.accumulatedElCost,
    water: done ? (s.totalWaterCost ?? s.accumulatedWaterCost) : s.accumulatedWaterCost,
  };
}

/** Compact booking summary — no tokens, payment ids or raw contact details. */
export function sessionSummary(s: Session, unit?: { id: number; name: string; type: string }) {
  const prepaid = s.billingMode === "PREPAID";
  const cost = elWaterCost(s);
  return {
    id: s.id,
    ...(unit ? { unit } : { unitId: s.unitId }),
    guest: maskedGuest(s),
    bookingRef: s.bookingRef,
    status: s.status,
    state: bookingState(s),
    paymentStatus: s.paymentStatus,
    billingMode: s.billingMode,
    checkInTime: s.checkInTime,
    expectedCheckOut: s.expectedCheckOut,
    checkOutTime: s.checkOutTime,
    // The accumulators are drained by every invoice, so on an invoiced stay
    // they only cover consumption since the last invoice. El includes heating.
    uninvoiced: {
      scope: "since last invoice (whole stay if never invoiced, e.g. PREPAID)",
      electricityKwh: s.accumulatedElKwh,
      electricityCost: s.accumulatedElCost,
      electricityIncludesHeating: true,
      waterLiters: s.accumulatedWaterLiters,
      waterCost: s.accumulatedWaterCost,
    },
    lastTickAt: s.lastTickAt,
    prepaid: prepaid
      ? {
          // Service balance: laundry/shower draws are already taken off; el/water are not.
          serviceBalance: s.prepaidAmount,
          deposited: s.prepaidDeposited,
          remainingAfterElWater: (s.prepaidAmount ?? 0) - cost.el - cost.water,
        }
      : null,
    totalCost: s.totalCost,
    externalPrice: s.externalPrice,
  };
}

// ── Time ──────────────────────────────────────────────────────

export const SITE_TIME_ZONE = "Europe/Copenhagen";

const cphFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: SITE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  timeZoneName: "shortOffset",
});

/**
 * Local Copenhagen day ("2026-10-16") and hour ("2026-10-16T14", the format
 * of SpotPriceCache.hourDK) of an instant. `hourBucket` adds the UTC offset
 * ("2026-10-25T02+2") so the repeated 02:00 hour on the autumn DST change
 * stays two separate consumption buckets.
 */
export function cphBuckets(d: Date): { day: string; hour: string; hourBucket: string } {
  const p = Object.fromEntries(cphFormatter.formatToParts(d).map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  const offset = (p.timeZoneName ?? "").replace("GMT", "") || "+0";
  return { day, hour: `${day}T${p.hour}`, hourBucket: `${day}T${p.hour}${offset}` };
}

export function secondsSince(d: Date | null | undefined, now = Date.now()): number | null {
  return d ? Math.round((now - d.getTime()) / 1000) : null;
}
