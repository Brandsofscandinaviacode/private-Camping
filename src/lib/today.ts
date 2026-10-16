// The desk's day ("I dag"): who arrives, who is on site without a check-in,
// who leaves and who has overstayed. Plain module — the Prisma filters are
// shared by the dashboard card and /admin/today so the numbers agree, and the
// types are used by the page's client components.

import { openReservationWhere, startOfToday } from "./booking-status";
import { siteDayStart } from "./format";
import type { CheckInReceipt } from "./check-in";
import type { SettlementTone } from "./settlement-shared";

export type TodaySectionKey = "arrivals" | "arrived" | "departures" | "overdue";

/** Anchors on /admin/today — the dashboard card links to them. */
export const TODAY_ANCHORS: Record<TodaySectionKey, string> = {
  arrivals: "ankomster",
  arrived: "ikke-tjekket-ind",
  departures: "afrejser",
  overdue: "overskredet",
};

export function todayHref(section: TodaySectionKey): string {
  return `/admin/today#${TODAY_ANCHORS[section]}`;
}

/** [start, end) of the current day — the same boundary as booking-status. */
export function todayBounds(now: Date = new Date()): { start: Date; end: Date } {
  const start = startOfToday(now);
  return { start, end: siteDayStart(start, 1) };
}

/** Arriving today: reservations due today, and stays checked in today. */
export function todayArrivalsWhere(now: Date = new Date()) {
  const { start, end } = todayBounds(now);
  return {
    cancelledAt: null,
    status: { in: ["PENDING" as const, "ACTIVE" as const] },
    checkInTime: { gte: start, lt: end },
  };
}

/**
 * On site per the booking since an earlier day, not checked in — the backlog.
 * Reservations ending today are left to "Rejser i dag": checking a guest in
 * on their day of departure serves no purpose.
 */
export function arrivedEarlierWhere(now: Date = new Date()) {
  const { start, end } = todayBounds(now);
  return {
    AND: [
      openReservationWhere(now),
      { checkInTime: { lt: start } },
      { OR: [{ expectedCheckOut: null }, { expectedCheckOut: { gte: end } }] },
    ],
  };
}

/**
 * Leaving today: reservations and checked-in stays planned to leave today
 * (Danplanner guests are rarely checked in — they still need cleaning), and
 * stays checked out today.
 */
export function todayDeparturesWhere(now: Date = new Date()) {
  const { start, end } = todayBounds(now);
  const today = { gte: start, lt: end };
  return {
    cancelledAt: null,
    OR: [
      { status: { in: ["PENDING" as const, "ACTIVE" as const] }, expectedCheckOut: today },
      { status: "COMPLETED" as const, OR: [{ checkOutTime: today }, { checkOutRecordedAt: today }] },
    ],
  };
}

export interface TodayRow {
  sessionId: number;
  status: "PENDING" | "ACTIVE" | "COMPLETED";
  unitId: number;
  /** "Plads 116" */
  unitName: string;
  /** Raw unit name, as the check-in/out dialogs take it. */
  unitRawName: string;
  isLongTerm: boolean;
  hasHardware: boolean;
  hasMeters: boolean;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  bookingRef: string | null;
  /** Linked to a booking-system booking (externalBookingId). */
  externallyLinked: boolean;
  /** "Danplanner" for a booking from a booking system, otherwise null. */
  linkedLabel: string | null;
  /** Booking arrival day "YYYY-MM-DD" (imported bookings carry no real time). */
  arrivalKey: string;
  /** Planned departure "YYYY-MM-DD". */
  departureKey: string | null;
  /** When the desk did the check-in / check-out (ISO). */
  checkedInAt: string | null;
  checkedOutAt: string | null;
  /** The one settlement figure — checked-in and checked-out stays only. */
  money: { label: string; amount: number | null; tone: SettlementTone } | null;
  /** The arrival day has come and the reservation is open: may be checked in. */
  canCheckIn: boolean;
}

export interface TodayOverview {
  /** "YYYY-MM-DD" in site time. */
  date: string;
  generatedAt: string;
  arrivals: TodayRow[];
  arrived: TodayRow[];
  departures: TodayRow[];
  overdue: TodayRow[];
  currency: string;
}

/** Done rows (checked in / out) sink to the bottom, otherwise by unit. */
export function compareTodayRows(a: TodayRow, b: TodayRow, done: (r: TodayRow) => boolean): number {
  const d = Number(done(a)) - Number(done(b));
  if (d !== 0) return d;
  return a.unitName.localeCompare(b.unitName, "da", { numeric: true }) || a.guestName.localeCompare(b.guestName, "da");
}

// ──────────────────────────────────────────────
// Bulk check-in ("Tjek valgte ind")
// ──────────────────────────────────────────────
export const BULK_CHECK_IN_MAX = 200;

export interface BulkCheckInOptions {
  billingMode: "PREPAID" | "POSTPAID";
  /** Per guest, PREPAID only. */
  prepaidAmount?: number;
  prepaidMethod?: string;
  /** Keep the booking's arrival date as check-in time (units without meters). */
  keepArrivalDate: boolean;
  sendWelcome: boolean;
}

export interface BulkCheckInRow {
  sessionId: number;
  guestName: string;
  unitName: string;
  ok: boolean;
  message: string;
  receipt?: CheckInReceipt;
}

export type BulkCheckInResult =
  | { ok: true; results: BulkCheckInRow[] }
  | { ok: false; message: string };
