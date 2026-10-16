// Tail of the JSON-lines app log (src/lib/logger.ts), read backwards in
// chunks so a 10 MB log costs only as much I/O as the entries returned.

import { open, type FileHandle } from "fs/promises";
import path from "path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scrubData, scrubText } from "@/lib/mcp/redact";
import { registerReadOnlyTool } from "@/lib/mcp/tools/common";

type Level = "info" | "warn" | "error";
const LEVEL_RANK: Record<Level, number> = { info: 0, warn: 1, error: 2 };

export interface LogTailEntry {
  timestamp: string;
  level: string;
  context: string;
  message: string;
  data?: unknown;
}

export interface LogTailOptions {
  minLevel?: Level;
  /** Exact context match, case-insensitive (e.g. "danplanner", "mqtt"). */
  context?: string;
  /** Case-insensitive substring of the message. */
  contains?: string;
  sinceMinutes?: number;
  limit: number;
}

function logFiles(): string[] {
  const dir = process.env.LOG_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "logs");
  const current = path.join(dir, "campsense.log");
  // Newest first: the live file, then the one rotated away at 10 MB.
  return [current, `${current}.1`];
}

const CHUNK_BYTES = 64 * 1024;
// Both files are capped at 10 MB, so this covers them entirely in the worst case.
const MAX_SCAN_BYTES = 24 * 1024 * 1024;

/**
 * Feed complete lines of `file` to `onLine`, last line first, until it
 * returns false or the byte budget runs out. Splits on raw 0x0A bytes, which
 * never occur inside a multi-byte UTF-8 sequence, so æøå survive chunking.
 */
async function scanReverse(
  file: string,
  budget: { bytes: number },
  onLine: (line: string) => boolean,
): Promise<"stopped" | "eof" | "budget" | "missing"> {
  let fh: FileHandle;
  try {
    fh = await open(file, "r");
  } catch {
    return "missing";
  }
  try {
    let pos = (await fh.stat()).size;
    let carry: Buffer = Buffer.alloc(0);
    while (pos > 0) {
      if (budget.bytes <= 0) return "budget";
      const len = Math.min(CHUNK_BYTES, pos);
      pos -= len;
      const chunk = Buffer.alloc(len);
      await fh.read(chunk, 0, len, pos);
      budget.bytes -= len;
      const buf = Buffer.concat([chunk, carry]);
      let end = buf.length;
      // lastIndexOf with a negative offset counts from the end — hence the end > 0 guard.
      let nl = buf.lastIndexOf(0x0a, end - 1);
      while (nl >= 0) {
        if (end > nl + 1 && !onLine(buf.subarray(nl + 1, end).toString("utf8"))) return "stopped";
        end = nl;
        nl = end > 0 ? buf.lastIndexOf(0x0a, end - 1) : -1;
      }
      // Bytes before the first newline may continue in the previous chunk.
      carry = Buffer.from(buf.subarray(0, end));
    }
    if (carry.length > 0 && !onLine(carry.toString("utf8"))) return "stopped";
    return "eof";
  } finally {
    await fh.close().catch(() => {});
  }
}

export async function readLogTail(opts: LogTailOptions): Promise<{
  entries: LogTailEntry[];
  scannedBytes: number;
  complete: boolean;
}> {
  const minRank = LEVEL_RANK[opts.minLevel ?? "info"];
  const ctx = opts.context?.trim().toLowerCase() || null;
  const needle = opts.contains?.trim().toLowerCase() || null;
  const cutoff = opts.sinceMinutes ? Date.now() - opts.sinceMinutes * 60_000 : null;
  const entries: LogTailEntry[] = [];
  const budget = { bytes: MAX_SCAN_BYTES };
  let reachedCutoff = false;

  const onLine = (line: string): boolean => {
    let e: LogTailEntry;
    try {
      e = JSON.parse(line) as LogTailEntry;
    } catch {
      return true; // a torn or foreign line — skip it
    }
    if (cutoff !== null && e.timestamp && Date.parse(e.timestamp) < cutoff) {
      reachedCutoff = true;
      return false; // the log is chronological: everything further back is older
    }
    if ((LEVEL_RANK[e.level as Level] ?? 0) < minRank) return true;
    if (ctx && e.context?.toLowerCase() !== ctx) return true;
    if (needle && !String(e.message ?? "").toLowerCase().includes(needle)) return true;
    entries.push({
      timestamp: e.timestamp,
      level: e.level,
      context: e.context,
      message: scrubText(String(e.message ?? "")).slice(0, 1000),
      ...(e.data !== undefined ? { data: scrubData(e.data) } : {}),
    });
    return entries.length < opts.limit;
  };

  let complete = true;
  for (const file of logFiles()) {
    const r = await scanReverse(file, budget, onLine);
    if (r === "stopped" || reachedCutoff) break;
    if (r === "budget") {
      complete = false;
      break;
    }
  }
  return { entries, scannedBytes: MAX_SCAN_BYTES - budget.bytes, complete };
}

export function registerLogTools(server: McpServer): void {
  registerReadOnlyTool(server, {
    name: "get_recent_logs",
    title: "Recent application log",
    description:
      "Newest-first tail of the CampSense application log (JSON lines, incl. the rotated file). " +
      "Filter by minimum level, exact context (e.g. cron, tick, meter, hardware, mqtt, danplanner, quickpay, laundry, shower, invoice, checkout, eds, accounting, mcp), " +
      "a message substring and/or a time window. Credentials, e-mail addresses and raw HTML in log data are redacted.",
    input: z.object({
      level: z.enum(["info", "warn", "error"]).optional().describe("Minimum level (default info = everything)"),
      context: z.string().max(64).optional().describe("Only entries with exactly this context"),
      contains: z.string().max(200).optional().describe("Only entries whose message contains this text (case-insensitive)"),
      sinceMinutes: z.number().int().min(1).max(60 * 24 * 90).optional().describe("Only entries from the last N minutes"),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    handler: async (args) => {
      const r = await readLogTail({
        minLevel: args.level,
        context: args.context,
        contains: args.contains,
        sinceMinutes: args.sinceMinutes,
        limit: args.limit,
      });
      return {
        count: r.entries.length,
        newestFirst: true,
        scannedKiB: Math.round(r.scannedBytes / 1024),
        ...(r.complete ? {} : { note: "Scan stopped at the byte budget; older entries were not searched." }),
        entries: r.entries,
      };
    },
  });
}
