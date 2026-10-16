// Which stays hold a unit in a period — the conflict check for a walk-in on a
// reserved unit, "Skift enhed" and "Ændr afrejse". Server-only plain module
// (no auth): the server actions that call it check that.

import { prisma } from "./prisma";
import { openReservationWhere } from "./booking-status";
import { siteDayKey } from "./format";
import { rangesOverlap, stayDayRange, type DayRange, type StayConflict } from "./stay-corrections";

interface HoldingStay {
  id: number;
  unitId: number;
  guestName: string;
  status: "ACTIVE" | "PENDING";
  range: DayRange;
}

/** Checked-in stays and open reservations (not cancelled, not expired), by unit. */
export async function loadHoldingStays(unitIds?: number[], now: Date = new Date()): Promise<Map<number, HoldingStay[]>> {
  const today = siteDayKey(now)!;
  const unitFilter = unitIds ? { unitId: { in: unitIds } } : {};
  const rows = await prisma.session.findMany({
    where: { AND: [unitFilter, { OR: [{ status: "ACTIVE" as const }, openReservationWhere(now)] }] },
    select: { id: true, unitId: true, guestName: true, status: true, checkInTime: true, expectedCheckOut: true },
  });
  const byUnit = new Map<number, HoldingStay[]>();
  for (const r of rows) {
    const status = r.status === "ACTIVE" ? "ACTIVE" : "PENDING";
    const list = byUnit.get(r.unitId) ?? [];
    list.push({ id: r.id, unitId: r.unitId, guestName: r.guestName, status, range: stayDayRange(r, today) });
    byUnit.set(r.unitId, list);
  }
  return byUnit;
}

export function conflictsIn(
  stays: HoldingStay[] | undefined,
  range: DayRange,
  unitName: string,
  excludeSessionId?: number,
): StayConflict[] {
  return (stays ?? [])
    .filter((s) => s.id !== excludeSessionId && rangesOverlap(s.range, range))
    .sort((a, b) => (a.status === b.status ? a.range.from.localeCompare(b.range.from) : a.status === "ACTIVE" ? -1 : 1))
    .map((s) => ({ sessionId: s.id, guestName: s.guestName, status: s.status, unitName, from: s.range.from, to: s.range.to }));
}

/** Stays on one unit that overlap the period, the stay itself left out. */
export async function findUnitConflicts(
  unitId: number,
  unitName: string,
  range: DayRange,
  excludeSessionId?: number,
  now: Date = new Date(),
): Promise<StayConflict[]> {
  const stays = await loadHoldingStays([unitId], now);
  return conflictsIn(stays.get(unitId), range, unitName, excludeSessionId);
}
