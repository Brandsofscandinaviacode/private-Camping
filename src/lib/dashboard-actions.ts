"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { arrivedNotCheckedInWhere, openReservationWhere, overdueStayWhere } from "@/lib/booking-status";
import { todayArrivalsWhere, todayBounds, todayDeparturesWhere } from "@/lib/today";
import { unitDisplayName } from "@/lib/utils";

/**
 * Today's guest movements for the dashboard "I dag" KPI — the same lists as
 * /admin/today, so the numbers match what the desk sees there.
 *
 * - arrivals:    reservations due today + stays checked in today
 * - departures:  reservations and checked-in stays planned to leave today
 *                (Danplanner guests are rarely checked in) + stays checked out today
 * - nextCheckIn: the next reservation not yet checked in, today or later.
 *                Imported bookings carry only a date, so the card shows the day.
 */
export async function getDashboardMovements() {
  await requireAuth();

  const now = new Date();
  const [arrivals, departures, nextCheckIn] = await Promise.all([
    prisma.session.count({ where: todayArrivalsWhere(now) }),
    prisma.session.count({ where: todayDeparturesWhere(now) }),
    prisma.session.findFirst({
      where: { ...openReservationWhere(now), checkInTime: { gte: todayBounds(now).start } },
      orderBy: { checkInTime: "asc" },
      include: { unit: { select: { name: true, type: true } } },
    }),
  ]);

  return {
    arrivals,
    departures,
    nextCheckIn: nextCheckIn
      ? {
          time: nextCheckIn.checkInTime.toISOString(),
          unitName: unitDisplayName(nextCheckIn.unit.type, nextCheckIn.unit.name),
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
