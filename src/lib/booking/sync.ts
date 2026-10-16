// Booking-system sync: import reservations, merge later changes (desk edits
// win, see sync-merge.ts), flag reservations that dropped out of the feed and
// record the outcome for the status line. Server-only and without auth —
// the server actions in actions.ts (and the cron, through them) check that.

import { v4 as uuidv4 } from "uuid";
import { prisma } from "../prisma";
import { readGlobalSettings } from "../settings";
import { logger } from "../logger";
import { arrivedNotCheckedInWhere, startOfToday } from "../booking-status";
import type { BookingEntry, BookingProvider } from "./types";
import { parseBookingRef } from "../booking-ref";
import {
  SYNC_FIELD_LABELS,
  bookingDayToDate,
  incomingSyncValues,
  isSyncField,
  mergeBookingIntoStay,
  parseLockedFields,
  parseSyncValues,
  serializeSyncValues,
  syncFieldMode,
  syncValueToDb,
  type SyncField,
} from "./sync-merge";

export interface BookingSyncResult {
  created: number;
  updated: number;
  skipped: Array<{ booking: string; reason: string }>;
  /** Stays with a new difference for the desk to decide on. */
  conflicts: number;
  /** Reservations newly marked as no longer in the feed. */
  missing: number;
  /** Bookings the provider returned. */
  total: number;
  error?: string;
}

const ATTEMPT_KEY = "_booking_last_sync_attempt";

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return err?.code === "P2002" || /unique constraint/i.test(err?.message ?? "");
}

/** ACTIVE before PENDING before COMPLETED, cancelled last, oldest first. */
function preferStay(
  a: { id: number; status: string; cancelledAt: Date | null },
  b: { id: number; status: string; cancelledAt: Date | null },
): number {
  const rank = (s: typeof a) => (s.cancelledAt ? 3 : s.status === "ACTIVE" ? 0 : s.status === "PENDING" ? 1 : 2);
  return rank(a) - rank(b) || a.id - b.id;
}

/**
 * Stays imported before the externalBookingId column only carry the key in
 * bookingRef. Link them; where several stays share one ref (duplicates from
 * an edited ref) only the preferred one gets it — the column is unique.
 */
async function backfillExternalBookingIds(prefix: string): Promise<void> {
  const rows = await prisma.session.findMany({
    where: { externalBookingId: null, bookingRef: { startsWith: prefix } },
    select: { id: true, bookingRef: true, status: true, cancelledAt: true },
  });
  if (rows.length === 0) return;

  const refs = [...new Set(rows.map((r) => r.bookingRef!))];
  const taken = new Set(
    (await prisma.session.findMany({
      where: { externalBookingId: { in: refs } },
      select: { externalBookingId: true },
    })).map((r) => r.externalBookingId),
  );

  for (const ref of refs) {
    if (taken.has(ref)) continue;
    const [best] = rows.filter((r) => r.bookingRef === ref).sort(preferStay);
    try {
      await prisma.session.update({ where: { id: best.id }, data: { externalBookingId: ref } });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
}

/**
 * A stay that belongs to this booking but isn't linked yet, e.g. one whose
 * "Booking nr." was tidied from "danplanner:227359" to "227359" at the desk.
 * Linking it stops the sync from importing the booking a second time.
 */
async function adoptUnlinkedStay(ref: string, booking: BookingEntry, unitId: number | undefined) {
  const bare = [...new Set([booking.externalBookingId, booking.bookingNumber].filter(Boolean))];
  // A bare number only counts on the same unit and during this booking.
  const periodStart = new Date(bookingDayToDate(booking.checkIn).getTime() - 36 * 3_600_000);
  const periodEnd = new Date(bookingDayToDate(booking.checkOut).getTime() + 36 * 3_600_000);
  const candidates = await prisma.session.findMany({
    where: {
      externalBookingId: null,
      OR: [
        { bookingRef: ref },
        ...(unitId
          ? [{
              unitId,
              bookingRef: { in: bare },
              checkInTime: { lte: periodEnd },
              OR: [{ checkOutTime: null }, { checkOutTime: { gte: periodStart } }],
            }]
          : []),
      ],
    },
  });
  if (candidates.length === 0) return null;
  const [best] = candidates.sort(preferStay);
  try {
    return await prisma.session.update({ where: { id: best.id }, data: { externalBookingId: ref } });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return prisma.session.findUnique({ where: { externalBookingId: ref } });
  }
}

async function applyBookings(
  bookings: BookingEntry[],
  providerName: string,
  fullFeed: boolean,
): Promise<BookingSyncResult> {
  const prefix = `${providerName}:`;
  await backfillExternalBookingIds(prefix);

  const units = await prisma.unit.findMany({ select: { id: true, name: true, externalId: true, externalProvider: true } });
  const unitsByName = new Map(units.map((u) => [u.name.toLowerCase().trim(), u.id]));
  const unitsByExternalId = new Map(
    units.filter((u) => u.externalId && u.externalProvider === providerName).map((u) => [u.externalId!, u.id]),
  );
  const resolveUnit = (b: BookingEntry): number | undefined =>
    (b.unitExternalId ? unitsByExternalId.get(b.unitExternalId) : undefined)
    ?? unitsByName.get(b.unitName.toLowerCase().trim());

  const refs = [...new Set(bookings.map((b) => prefix + b.externalBookingId))];
  const linked = await prisma.session.findMany({ where: { externalBookingId: { in: refs } } });
  const byRef = new Map(linked.map((s) => [s.externalBookingId!, s]));

  let created = 0;
  let updated = 0;
  let conflicts = 0;
  const skipped: Array<{ booking: string; reason: string }> = [];
  const changes: Array<{ sessionId: number; applied: SyncField[]; conflicts: SyncField[] }> = [];
  const seen = new Set<string>();

  for (const booking of bookings) {
    const ref = prefix + booking.externalBookingId;
    if (seen.has(ref)) continue;
    seen.add(ref);
    const label = `${booking.bookingNumber} (${booking.unitName})`;
    const unitId = resolveUnit(booking);
    const incoming = incomingSyncValues({
      guestName: booking.customerName || booking.guestNames,
      guestEmail: booking.email,
      guestPhone: booking.phone,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      unitId,
    });

    const existing = byRef.get(ref) ?? (await adoptUnlinkedStay(ref, booking, unitId));
    if (existing) {
      // Cancelled/no-show reservations and finished stays are left alone.
      if (existing.cancelledAt) continue;
      if (existing.status !== "PENDING" && existing.status !== "ACTIVE") continue;
      const m = mergeBookingIntoStay(existing, incoming);
      if (!m.dirty) continue;
      await prisma.session.update({
        where: { id: existing.id },
        data: { ...m.data, lastSyncedValues: m.lastSyncedValues, syncConflicts: m.syncConflicts },
      });
      if (m.applied.length > 0) updated++;
      if (m.newConflicts.length > 0) conflicts++;
      if (m.applied.length > 0 || m.newConflicts.length > 0) {
        changes.push({ sessionId: existing.id, applied: m.applied, conflicts: m.newConflicts });
      }
      continue;
    }

    if (!unitId) {
      skipped.push({ booking: label, reason: "Enhed findes ikke" });
      continue;
    }
    const checkInDate = bookingDayToDate(booking.checkIn);
    const checkOutDate = bookingDayToDate(booking.checkOut);
    // Don't import a stay that is already over — it could only ever show
    // up as an expired reservation.
    if (checkOutDate < startOfToday()) {
      skipped.push({ booking: label, reason: "Opholdet er allerede afsluttet" });
      continue;
    }

    try {
      await prisma.session.create({
        data: {
          unitId,
          guestName: (incoming.guestName as string | undefined) ?? "Ukendt gæst",
          guestEmail: (incoming.guestEmail as string | undefined) ?? null,
          guestPhone: (incoming.guestPhone as string | undefined) ?? null,
          bookingRef: ref,
          externalBookingId: ref,
          lastSyncedValues: serializeSyncValues(incoming),
          guestPortalToken: uuidv4(),
          status: "PENDING",
          paymentStatus: "UNPAID",
          checkInTime: checkInDate,
          expectedCheckOut: checkOutDate,
          billingMode: "POSTPAID",
        },
      });
      created++;
    } catch (e) {
      // A sync running at the same time imported it first.
      if (!isUniqueViolation(e)) throw e;
    }
  }

  // Open reservations the booking system no longer lists (cancelled, moved
  // or checked out there). Only a complete feed can tell; a filtered or
  // empty one (failed parse) would flag everything. Only those whose arrival
  // has come: the feed lists guests on site and arriving today.
  let missing = 0;
  if (fullFeed && bookings.length > 0) {
    const seenRefs = [...seen];
    const marked = await prisma.session.updateMany({
      where: {
        AND: [
          arrivedNotCheckedInWhere(),
          {
            cancelledAt: null,
            missingFromFeedAt: null,
            OR: [
              { externalBookingId: { startsWith: prefix, notIn: seenRefs } },
              // Unlinked duplicates of a linked stay: the feed entry isn't theirs.
              { externalBookingId: null, bookingRef: { startsWith: prefix } },
            ],
          },
        ],
      },
      data: { missingFromFeedAt: new Date() },
    });
    missing = marked.count;
    await prisma.session.updateMany({
      where: { cancelledAt: null, missingFromFeedAt: { not: null }, externalBookingId: { in: seenRefs } },
      data: { missingFromFeedAt: null },
    });
  }

  logger.info("danplanner", "Booking sync completed", {
    created,
    updated,
    conflicts,
    missing,
    skippedCount: skipped.length,
    totalFromProvider: bookings.length,
    changes: changes.slice(0, 50),
  });

  return { created, updated, skipped, conflicts, missing, total: bookings.length };
}

async function writeSettings(entries: Array<{ key: string; value: string }>): Promise<void> {
  for (const s of entries) {
    await prisma.globalSetting.upsert({ where: { key: s.key }, update: { value: s.value }, create: s });
  }
}

function okStatus(r: BookingSyncResult): string {
  const parts = [`${r.created} nye`, `${r.updated} opdateret`];
  if (r.conflicts) parts.push(`${r.conflicts} med forskelle`);
  if (r.missing) parts.push(`${r.missing} ikke længere i Danplanner`);
  if (r.skipped.length) parts.push(`${r.skipped.length} sprunget over`);
  return `ok: ${parts.join(", ")}`;
}

/**
 * Fetch bookings and apply them. Every run — cron, "Hent nu" or the settings
 * page — records its outcome in `_booking_last_sync*` for the status line.
 * Expected failures come back as `error`, never thrown.
 */
export async function syncBookingsWithProvider(
  provider: BookingProvider,
  providerName: string,
  productType: "all" | "tourist" | "seasonal",
): Promise<BookingSyncResult> {
  const empty = { created: 0, updated: 0, skipped: [], conflicts: 0, missing: 0, total: 0 };
  let result: BookingSyncResult;
  try {
    const bookings = await provider.getBookings(productType);
    result = await applyBookings(bookings, providerName, productType === "all");
  } catch (e) {
    result = { ...empty, error: e instanceof Error ? e.message : String(e) };
  }

  const now = new Date().toISOString();
  try {
    await writeSettings(
      result.error
        ? [
            { key: "_booking_last_sync", value: now },
            { key: "_booking_last_sync_status", value: `fejl: ${result.error}` },
          ]
        : [
            { key: "_booking_last_sync", value: now },
            { key: "_booking_last_sync_status", value: okStatus(result) },
            { key: "_booking_last_sync_ok", value: now },
            { key: "_booking_last_sync_count", value: String(result.total) },
          ],
    );
  } catch (e) {
    logger.error("danplanner", "Could not record sync status", e instanceof Error ? e.message : e);
  }
  return result;
}

/**
 * Claim the sync slot for a manual run — the same timestamp the cron's
 * auto-sync claims, so the two can't start together, and a manual run also
 * pushes the next automatic one out. False when a run started very recently.
 */
export async function claimBookingSyncSlot(minGapMs: number): Promise<boolean> {
  const row = await prisma.globalSetting.findUnique({ where: { key: ATTEMPT_KEY } });
  const last = row?.value ? new Date(row.value).getTime() : 0;
  if (Date.now() - last < minGapMs) return false;
  const value = new Date().toISOString();
  if (row) {
    const claimed = await prisma.globalSetting.updateMany({ where: { key: ATTEMPT_KEY, value: row.value }, data: { value } });
    return claimed.count > 0;
  }
  try {
    await prisma.globalSetting.create({ data: { key: ATTEMPT_KEY, value } });
    return true;
  } catch {
    return false;
  }
}

export interface BookingSyncStatus {
  configured: boolean;
  providerLabel: string;
  autoSync: boolean;
  intervalMinutes: number;
  /** Last run, successful or not. */
  lastRunAt: string | null;
  lastStatus: string | null;
  /** Last successful fetch, and how many bookings it returned. */
  lastOkAt: string | null;
  lastCount: number | null;
  awaitingTwoFactor: boolean;
  /** Auto-sync is on, but nothing came in for well over two intervals. */
  stale: boolean;
  /** Stays with a difference waiting for the desk. */
  conflicts: number;
  /** Arrived reservations the booking system no longer lists. */
  missing: number;
}

/** For the status line. Server-only: the settings it reads include secrets. */
export async function readBookingSyncStatus(): Promise<BookingSyncStatus> {
  const [s, conflicts, missing] = await Promise.all([
    readGlobalSettings(),
    prisma.session.count({
      where: { syncConflicts: { not: null }, cancelledAt: null, status: { in: ["PENDING", "ACTIVE"] } },
    }),
    prisma.session.count({
      where: { AND: [arrivedNotCheckedInWhere(), { cancelledAt: null, missingFromFeedAt: { not: null } }] },
    }),
  ]);
  const provider = s.booking_provider || "none";
  const count = s._booking_last_sync_count ? parseInt(s._booking_last_sync_count, 10) : NaN;
  const lastStatus = s._booking_last_sync_status || null;
  // Before the first run that records it, a successful last run stands in.
  const lastOkAt = s._booking_last_sync_ok || (lastStatus?.startsWith("ok") ? s._booking_last_sync || null : null);
  const autoSync = s.booking_auto_sync === "true";
  const intervalMinutes = Math.max(5, parseInt(s.booking_sync_interval_minutes || "30", 10) || 30);
  const staleAfterMs = (2 * intervalMinutes + 10) * 60_000;
  return {
    configured: provider !== "none",
    providerLabel: provider === "danplanner" ? "Danplanner" : "Bookingsystem",
    autoSync,
    intervalMinutes,
    stale: autoSync && (!lastOkAt || Date.now() - Date.parse(lastOkAt) > staleAfterMs),
    lastRunAt: s._booking_last_sync || null,
    lastStatus,
    lastOkAt,
    lastCount: Number.isFinite(count) ? count : null,
    awaitingTwoFactor: !!s.danplanner_approve_form,
    conflicts,
    missing,
  };
}

/** "Danplanner" for a stay linked as "danplanner:…". */
export function bookingSystemLabel(externalBookingId: string | null | undefined): string {
  return parseBookingRef(externalBookingId)?.label ?? "bookingsystemet";
}

/**
 * The desk's answer to a difference: "booking" takes the booking system's
 * value, "mine" keeps ours. Either way the value is remembered as seen, so
 * the same difference isn't raised again — only a newer change would be.
 */
export async function resolveSyncConflictInternal(
  sessionId: number,
  field: string,
  choice: "booking" | "mine",
): Promise<{ ok: boolean; message: string }> {
  if (!isSyncField(field)) return { ok: false, message: "Ukendt felt" };
  const s = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!s) return { ok: false, message: "Bookingen findes ikke" };

  const conflicts = parseSyncValues(s.syncConflicts);
  const value = conflicts[field];
  if (value === undefined) return { ok: false, message: "Forskellen er allerede afgjort — genindlæs siden" };
  if (s.cancelledAt || syncFieldMode(s.status, field) === "ignore") {
    return { ok: false, message: `${SYNC_FIELD_LABELS[field]} kan ikke længere ændres på denne booking` };
  }

  const snapshot = parseSyncValues(s.lastSyncedValues);
  snapshot[field] = value;
  delete conflicts[field];
  const data: Record<string, unknown> = {
    lastSyncedValues: serializeSyncValues(snapshot),
    syncConflicts: serializeSyncValues(conflicts),
  };
  if (choice === "booking") {
    if (field === "unitId" && !(await prisma.unit.findUnique({ where: { id: Number(value) }, select: { id: true } }))) {
      return { ok: false, message: "Enheden findes ikke længere i CampSense" };
    }
    data[field] = syncValueToDb(field, value);
    // Back under the booking system's control.
    const locked = parseLockedFields(s.lockedFields).filter((f) => f !== field);
    data.lockedFields = locked.length > 0 ? JSON.stringify(locked) : null;
  }

  // Only if no sync changed the differences in the meantime.
  const done = await prisma.session.updateMany({ where: { id: sessionId, syncConflicts: s.syncConflicts }, data });
  if (done.count === 0) return { ok: false, message: "Bookingen blev opdateret imens — prøv igen" };

  const label = SYNC_FIELD_LABELS[field];
  return {
    ok: true,
    message: choice === "booking"
      ? `${label} er opdateret fra ${bookingSystemLabel(s.externalBookingId)}`
      : `${label} beholdes som her i CampSense`,
  };
}
