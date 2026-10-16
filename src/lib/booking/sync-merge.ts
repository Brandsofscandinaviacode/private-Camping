// Merging a booking-system entry into a CampSense stay. Desk edits win:
// every sync stores what the booking system sent (lastSyncedValues), so a DB
// value that differs from it was changed at the desk and is kept. When the
// booking system then sends something new as well, that value is parked in
// syncConflicts for the desk to accept or dismiss.
//
// Plain module, no I/O — safe for server and client.

import { fmtDate, siteDayKey } from "../format";

export const SYNC_FIELDS = ["guestName", "guestEmail", "guestPhone", "checkInTime", "expectedCheckOut", "unitId"] as const;
export type SyncField = (typeof SYNC_FIELDS)[number];
export type SyncValue = string | number;
export type SyncValues = Partial<Record<SyncField, SyncValue>>;

export const SYNC_FIELD_LABELS: Record<SyncField, string> = {
  guestName: "Navn",
  guestEmail: "E-mail",
  guestPhone: "Telefon",
  checkInTime: "Ankomst",
  expectedCheckOut: "Afrejse",
  unitId: "Plads",
};

const DATE_FIELDS: ReadonlySet<SyncField> = new Set(["checkInTime", "expectedCheckOut"]);

export function isSyncField(f: string): f is SyncField {
  return (SYNC_FIELDS as readonly string[]).includes(f);
}

/**
 * How the sync treats a field for a stay in this status:
 *  - auto: the booking system's changes come through unless the desk edited it
 *  - confirm: every change from the booking system needs the desk's OK
 *  - ignore: never touched (a started stay keeps its unit and real check-in)
 */
export function syncFieldMode(status: string, field: SyncField): "auto" | "confirm" | "ignore" {
  if (status === "PENDING") return "auto";
  if (status === "ACTIVE") {
    if (field === "expectedCheckOut") return "confirm";
    if (field === "checkInTime" || field === "unitId") return "ignore";
    return "auto";
  }
  return "ignore";
}

// ── JSON columns ─────────────────────────────

export function parseSyncValues(raw: string | null | undefined): SyncValues {
  if (!raw) return {};
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return {}; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out: SyncValues = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (isSyncField(k) && (typeof v === "string" || typeof v === "number")) out[k] = v;
  }
  return out;
}

export function serializeSyncValues(v: SyncValues): string | null {
  return Object.keys(v).length > 0 ? JSON.stringify(v) : null;
}

export function parseLockedFields(raw: string | null | undefined): SyncField[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((f): f is SyncField => typeof f === "string" && isSyncField(f)) : [];
  } catch {
    return [];
  }
}

// ── Normalisation ────────────────────────────
// Strings trimmed (empty = no value), dates as the site-local day
// "YYYY-MM-DD" (imported dates carry no real time), unit as its id.

function str(s: string | null | undefined): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}

export interface SyncableStay {
  status: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  checkInTime: Date;
  expectedCheckOut: Date | null;
  unitId: number;
  lastSyncedValues: string | null;
  syncConflicts: string | null;
  lockedFields: string | null;
}

export function currentSyncValues(s: Omit<SyncableStay, "status" | "lastSyncedValues" | "syncConflicts" | "lockedFields">): SyncValues {
  const v: SyncValues = {};
  const name = str(s.guestName);
  if (name) v.guestName = name;
  const email = str(s.guestEmail);
  if (email) v.guestEmail = email;
  const phone = str(s.guestPhone);
  if (phone) v.guestPhone = phone;
  const inDay = siteDayKey(s.checkInTime);
  if (inDay) v.checkInTime = inDay;
  const outDay = siteDayKey(s.expectedCheckOut);
  if (outDay) v.expectedCheckOut = outDay;
  v.unitId = s.unitId;
  return v;
}

export function incomingSyncValues(b: {
  guestName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  unitId?: number | null;
}): SyncValues {
  const v: SyncValues = {};
  const name = str(b.guestName);
  if (name) v.guestName = name;
  const email = str(b.guestEmail);
  if (email) v.guestEmail = email;
  const phone = str(b.guestPhone);
  if (phone) v.guestPhone = phone;
  if (b.checkIn && /^\d{4}-\d{2}-\d{2}$/.test(b.checkIn)) v.checkInTime = b.checkIn;
  if (b.checkOut && /^\d{4}-\d{2}-\d{2}$/.test(b.checkOut)) v.expectedCheckOut = b.checkOut;
  if (b.unitId) v.unitId = b.unitId;
  return v;
}

/**
 * A booking-system day as a stored timestamp. Noon UTC, explicitly — never
 * local parsing, which the server's time zone would shift.
 */
export function bookingDayToDate(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

/** The value as it is written to the session column. */
export function syncValueToDb(field: SyncField, value: SyncValue): string | number | Date {
  if (DATE_FIELDS.has(field)) return bookingDayToDate(String(value));
  if (field === "unitId") return Number(value);
  return String(value);
}

/** For display, e.g. "Danplanner siger: 18.10.2026". */
export function formatSyncValue(field: SyncField, value: SyncValue, unitNames?: Map<number, string>): string {
  if (DATE_FIELDS.has(field)) return fmtDate(bookingDayToDate(String(value)));
  if (field === "unitId") return unitNames?.get(Number(value)) ?? `Enhed #${value}`;
  return String(value);
}

// ── Merge ────────────────────────────────────

export type SyncDbChanges = Partial<{
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  checkInTime: Date;
  expectedCheckOut: Date;
  unitId: number;
}>;

export interface SyncMergeResult {
  /** Column updates to apply (booking-system values that came through). */
  data: SyncDbChanges;
  lastSyncedValues: string | null;
  syncConflicts: string | null;
  /** Fields whose value came through from the booking system. */
  applied: SyncField[];
  /** Fields with a new or changed conflict for the desk. */
  newConflicts: SyncField[];
  /** True when anything (values, snapshot or conflicts) must be written. */
  dirty: boolean;
}

export function mergeBookingIntoStay(stay: SyncableStay, incoming: SyncValues): SyncMergeResult {
  const db = currentSyncValues(stay);
  const snapshot = parseSyncValues(stay.lastSyncedValues);
  const conflicts = parseSyncValues(stay.syncConflicts);
  const locked = new Set(parseLockedFields(stay.lockedFields));

  const data: SyncDbChanges = {};
  const applied: SyncField[] = [];
  const newConflicts: SyncField[] = [];

  const apply = (f: SyncField, v: SyncValue) => {
    (data as Record<string, unknown>)[f] = syncValueToDb(f, v);
    applied.push(f);
  };

  for (const f of SYNC_FIELDS) {
    const mode = syncFieldMode(stay.status, f);
    if (mode === "ignore") {
      // Nothing to decide any more (e.g. arrival of a stay that has started).
      delete conflicts[f];
      continue;
    }
    const n = incoming[f];
    // The booking system has no value: never let that clear one we have.
    if (n === undefined) continue;
    const d = db[f];
    const s = snapshot[f];

    if (d === n) {
      // In agreement — any earlier disagreement is settled.
      snapshot[f] = n;
      delete conflicts[f];
      continue;
    }

    // Changed at the desk: locked by hand, or no longer what we last got.
    // Without a snapshot (never sent, or synced before snapshots existed) a
    // differing filled value counts as the desk's, so the first sync after
    // the upgrade can't undo edits.
    const deskOwned = locked.has(f) || (s !== undefined ? d !== s : d !== undefined);

    if (!deskOwned && (d === undefined || mode === "auto")) {
      // Empty here, or the booking system changed a value nobody touched.
      apply(f, n);
      snapshot[f] = n;
      delete conflicts[f];
      continue;
    }

    if (s !== undefined && n === s) {
      // The booking system still says what it said before; the desk's value
      // stands and an older conflict is stale.
      delete conflicts[f];
      continue;
    }

    // Something new from the booking system that disagrees with our value.
    if (conflicts[f] !== n) newConflicts.push(f);
    conflicts[f] = n;
  }

  const nextSnapshot = serializeSyncValues(snapshot);
  const nextConflicts = serializeSyncValues(conflicts);
  const dirty = applied.length > 0
    || nextSnapshot !== (stay.lastSyncedValues || null)
    || nextConflicts !== (stay.syncConflicts || null);

  return { data, lastSyncedValues: nextSnapshot, syncConflicts: nextConflicts, applied, newConflicts, dirty };
}
