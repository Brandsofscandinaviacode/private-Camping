"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { arrivedNotCheckedInWhere, overdueStayWhere } from "@/lib/booking-status";
import { siteDayStart } from "@/lib/format";

/**
 * Today's guest movements for the dashboard "I dag" KPI.
 *
 * - arrivals:   sessions that check in today (any status created/scheduled today)
 * - departures: ACTIVE sessions whose planned checkout (expectedCheckOut) is today
 * - nextCheckIn: the next upcoming PENDING reservation (for the "Næste check-in" line)
 *
 * All three are cheap COUNT/findFirst queries against the existing `sessions` table —
 * no new schema is required.
 */
export async function getDashboardMovements() {
  await requireAuth();

  // The campsite's day, not the server's
  const start = siteDayStart();
  const end = siteDayStart(start, 1);

  const [arrivals, departures, nextCheckIn] = await Promise.all([
    prisma.session.count({
      // Cancelled / no-show reservations aren't arrivals
      where: { checkInTime: { gte: start, lt: end }, cancelledAt: null },
    }),
    prisma.session.count({
      where: { status: "ACTIVE", expectedCheckOut: { gte: start, lt: end } },
    }),
    prisma.session.findFirst({
      // Arrival is a day, not a time: today's arrivals count until checked in
      where: { status: "PENDING", cancelledAt: null, checkInTime: { gte: start } },
      orderBy: { checkInTime: "asc" },
      include: { unit: { select: { name: true } } },
    }),
  ]);

  return {
    arrivals,
    departures,
    nextCheckIn: nextCheckIn
      ? {
          time: nextCheckIn.checkInTime.toISOString(),
          unitName: nextCheckIn.unit.name,
          guestName: nextCheckIn.guestName,
        }
      : null,
  };
}

/**
 * Bookings that need a hand: guests Danplanner shows as arrived but who were
 * never checked in here (no occupancy, no metering), and stays whose planned
 * checkout has passed without a check-out.
 */
export async function getBookingAttentionCounts() {
  await requireAuth();
  const now = new Date();
  const [arrived, overdue] = await Promise.all([
    prisma.session.count({ where: arrivedNotCheckedInWhere(now) }),
    prisma.session.count({ where: overdueStayWhere(now) }),
  ]);
  return { arrived, overdue };
}
