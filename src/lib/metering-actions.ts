"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import * as hardware from "@/lib/hardware";
import { unitDisplayName } from "@/lib/utils";
import { METERING_STOPPED_MS } from "@/lib/unit-state";

export interface StoppedMeteringStay {
  sessionId: number;
  unitId: number;
  unitName: string;
  guestName: string;
  /** Last successful tick; null when the stay has never been read. */
  lastReadingAt: string | null;
  checkInTime: string;
  /** How long since the last reading (or check-in), at the time of the query. */
  ageMs: number;
  /** Why the meter gave no reading at the last cron run, if it said. */
  reason: string | null;
}

/**
 * Checked-in stays on units with meters whose consumption hasn't been read
 * for a while (the cron ticks every 10 min). Their balance and amounts stand
 * still, and usage after the last reading can be lost at check-out.
 */
export async function getStoppedMetering(): Promise<StoppedMeteringStay[]> {
  await requireAuth();
  const now = Date.now();
  const cutoff = new Date(now - METERING_STOPPED_MS);
  const [sessions, summaryRow] = await Promise.all([
    prisma.session.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { lastTickAt: { lt: cutoff } },
          { lastTickAt: null, checkInTime: { lt: cutoff } },
        ],
      },
      include: { unit: { include: { hardware: true } } },
      orderBy: { checkInTime: "asc" },
    }),
    prisma.globalSetting.findUnique({ where: { key: "_cron_log_summary" } }),
  ]);

  // The cron's own words for why each unit gave no reading
  const reasonsByUnit = new Map<string, string[]>();
  try {
    const summary = summaryRow?.value ? JSON.parse(summaryRow.value) as { reasons?: { unit: string; reason: string }[] } : null;
    for (const r of summary?.reasons ?? []) {
      reasonsByUnit.set(r.unit, [...(reasonsByUnit.get(r.unit) ?? []), r.reason]);
    }
  } catch { /* no summary yet */ }

  return sessions
    .filter((s) => {
      const hw = s.unit.hardware;
      return hardware.hasElectricityMeter(hw) || hardware.hasHeatingMeter(hw) || hardware.hasWaterMeter(hw);
    })
    .map((s) => {
      const unitName = unitDisplayName(s.unit.type, s.unit.name);
      return {
        sessionId: s.id,
        unitId: s.unitId,
        unitName,
        guestName: s.guestName,
        lastReadingAt: s.lastTickAt?.toISOString() ?? null,
        checkInTime: s.checkInTime.toISOString(),
        ageMs: now - (s.lastTickAt ?? s.checkInTime).getTime(),
        reason: reasonsByUnit.get(unitName)?.join(" · ") ?? null,
      };
    })
    .sort((a, b) => b.ageMs - a.ageMs);
}
