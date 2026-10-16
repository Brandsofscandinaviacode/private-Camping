// Bookings list: filters, paging and search ranking. Plain module, safe on
// server and client (the filter bar builds its links with bookingListUrl).

import { isReservationCancelled, isReservationExpired } from "./booking-status";
import { unitDisplayName } from "./utils";

export const BOOKING_LIST_FILTERS = ["all", "active", "pending", "arrived", "overdue", "unpaid", "paid", "expired", "cancelled"] as const;
export type BookingListFilter = (typeof BOOKING_LIST_FILTERS)[number];

export function parseBookingListFilter(value: string | undefined): BookingListFilter {
  return (BOOKING_LIST_FILTERS as readonly string[]).includes(value ?? "") ? (value as BookingListFilter) : "all";
}

export const BOOKING_PAGE_SIZE = 100;
export const BOOKING_MAX_LIMIT = 2000;
/** A search scans at most this many stays (newest first) — see getAllSessions. */
export const BOOKING_SEARCH_SCAN = 10_000;

/** ?limit= → a whole number of pages between one page and BOOKING_MAX_LIMIT. */
export function parseBookingListLimit(value: string | undefined): number {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n) || n <= BOOKING_PAGE_SIZE) return BOOKING_PAGE_SIZE;
  return Math.min(Math.ceil(n / BOOKING_PAGE_SIZE) * BOOKING_PAGE_SIZE, BOOKING_MAX_LIMIT);
}

export function bookingListUrl({ filter, q, limit }: { filter: string; q?: string; limit?: number }): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (q) params.set("q", q);
  if (limit && limit > BOOKING_PAGE_SIZE) params.set("limit", String(limit));
  const qs = params.toString();
  return `/admin/bookings${qs ? `?${qs}` : ""}`;
}

// ── Ordering ────────────────────────────────────────────────

type SortableSession = {
  status: string;
  checkInTime: Date;
  expectedCheckOut: Date | null;
  cancelledAt?: Date | null;
};

/** Checked-in stays first, expired and cancelled reservations last, everything else in between. */
function statusRank(s: SortableSession, now: Date): number {
  if (s.status === "ACTIVE") return 0;
  if (isReservationExpired(s, now) || isReservationCancelled(s)) return 2;
  return 1;
}

/**
 * List order: checked-in stays by planned departure (overdue ones first, then
 * today's departures; no planned date last), then everything else newest
 * arrival first.
 */
export function compareBookingRows(a: SortableSession, b: SortableSession, now: Date = new Date()): number {
  const ra = statusRank(a, now);
  const rb = statusRank(b, now);
  if (ra !== rb) return ra - rb;
  if (ra === 0) {
    const da = a.expectedCheckOut?.getTime() ?? Number.POSITIVE_INFINITY;
    const db = b.expectedCheckOut?.getTime() ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da < db ? -1 : 1;
  }
  return b.checkInTime.getTime() - a.checkInTime.getTime();
}

// ── Search ──────────────────────────────────────────────────

export type SearchableSession = SortableSession & {
  id: number;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  bookingRef: string | null;
  externalBookingId: string | null;
  unit: { name: string; type: string };
};

/** Lower-cased for matching. JS folds Æ/Ø/Å correctly; SQLite LIKE only folds ASCII. */
export function normalizeSearchText(s: string): string {
  return s.normalize("NFC").toLocaleLowerCase("da-DK").replace(/\s+/g, " ").trim();
}

const UNIT_NUMBER = /^\d+[a-zæøå]?$/;

/** "plads 87" → "87", "87b" → "87b", "a12" → null (number must stand alone). */
function trailingUnitNumber(normalizedName: string): string | null {
  const m = /(?:^|[\s#.-])(\d+[a-zæøå]?)$/.exec(normalizedName);
  return m ? m[1] : null;
}

/**
 * How well a stay matches a normalized query: 0 = the unit itself ("87",
 * "Plads 87"), 1 = guest name, e-mail or part of a unit name, 2 = only a
 * booking number or phone number. null = no match.
 */
export function searchMatchTier(s: SearchableSession, nq: string): 0 | 1 | 2 | null {
  const unitName = normalizeSearchText(s.unit.name);
  const unitLabel = normalizeSearchText(unitDisplayName(s.unit.type, s.unit.name));
  if (nq === unitName || nq === unitLabel || (UNIT_NUMBER.test(nq) && trailingUnitNumber(unitName) === nq)) return 0;

  const name = normalizeSearchText(s.guestName);
  if (name.includes(nq) || unitName.includes(nq) || unitLabel.includes(nq)) return 1;
  if (s.guestEmail && normalizeSearchText(s.guestEmail).includes(nq)) return 1;
  // "Lisbeth Jørgensen" should find "Lisbeth & Steen Jørgensen"
  const words = nq.split(" ");
  if (words.length > 1 && words.every((w) => name.includes(w))) return 1;

  for (const ref of [s.bookingRef, s.externalBookingId]) {
    if (ref && normalizeSearchText(ref).includes(nq)) return 2;
  }
  if (s.guestPhone) {
    if (normalizeSearchText(s.guestPhone).includes(nq)) return 2;
    // "22 33 44 55" finds "+4522334455"
    const digits = nq.replace(/[\s+()-]/g, "");
    if (/^\d{3,}$/.test(digits) && s.guestPhone.replace(/\D/g, "").includes(digits)) return 2;
  }
  return null;
}

/** Matching stays, best match first, then in list order. */
export function rankBookingSearch<T extends SearchableSession>(rows: T[], query: string, now: Date = new Date()): T[] {
  const nq = normalizeSearchText(query);
  if (!nq) return rows;
  const hits: { row: T; tier: number }[] = [];
  for (const row of rows) {
    const tier = searchMatchTier(row, nq);
    if (tier !== null) hits.push({ row, tier });
  }
  hits.sort((a, b) => a.tier - b.tier || compareBookingRows(a.row, b.row, now));
  return hits.map((h) => h.row);
}
