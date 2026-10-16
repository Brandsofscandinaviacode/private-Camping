// Reservation lifecycle helpers — plain module, safe for server and client.
//
// An imported booking stays PENDING until the guest is checked in. If that
// never happens (no-show, or the stay was handled outside CampSense) it would
// otherwise show as "Reserveret" forever. A reservation is "open" until its
// planned checkout day has passed; after that it counts as expired.

/** Midnight at the start of the current day (server/browser local time). */
export function startOfToday(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Without a planned checkout, a no-show is given one day's grace. */
function noCheckoutCutoff(now: Date): Date {
  const d = startOfToday(now);
  d.setDate(d.getDate() - 1);
  return d;
}

/** True for a PENDING reservation whose stay is already over. */
export function isReservationExpired(
  s: { status: string; checkInTime: Date | string; expectedCheckOut: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (s.status !== "PENDING") return false;
  if (s.expectedCheckOut) return new Date(s.expectedCheckOut) < startOfToday(now);
  return new Date(s.checkInTime) < noCheckoutCutoff(now);
}

/** Prisma `where` for PENDING reservations that have not expired. */
export function openReservationWhere(now: Date = new Date()) {
  return {
    status: "PENDING" as const,
    OR: [
      { expectedCheckOut: { gte: startOfToday(now) } },
      { expectedCheckOut: null, checkInTime: { gte: noCheckoutCutoff(now) } },
    ],
  };
}

/**
 * Prisma `where` for PENDING reservations whose stay is over — the exact
 * complement of openReservationWhere() within PENDING. Spelled out instead of
 * `NOT: openReservationWhere()`, which SQL NULL semantics would get wrong for
 * rows without an expectedCheckOut.
 */
export function expiredReservationWhere(now: Date = new Date()) {
  return {
    status: "PENDING" as const,
    OR: [
      { expectedCheckOut: { lt: startOfToday(now) } },
      { expectedCheckOut: null, checkInTime: { lt: noCheckoutCutoff(now) } },
    ],
  };
}
