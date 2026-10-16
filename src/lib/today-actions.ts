"use server";

// "I dag" at the desk: the day's lists and "Tjek valgte ind". Every export is
// a public endpoint and starts with requireAuth(); the filters and types live
// in today.ts.

import { unstable_rethrow } from "next/navigation";
import { prisma } from "./prisma";
import { requireAuth } from "./auth";
import { readGlobalSettings } from "./settings";
import { logger } from "./logger";
import { unitDisplayName } from "./utils";
import { activateBookingSession } from "./actions";
import { hasArrivedNotCheckedIn, overdueStayWhere } from "./booking-status";
import { isProviderBookingRef } from "./booking-ref";
import { bookingSystemLabel } from "./booking/sync";
import { unitHardwareSummary } from "./check-in-hardware";
import { prepaidAmountError } from "./check-in";
import { fmtDate, siteDayKey } from "./format";
import { isDeskPaymentMethod } from "./payments-shared";
import { computeSettlements } from "./settlement";
import { settlementHeadline } from "./settlement-shared";
import {
  BULK_CHECK_IN_MAX,
  arrivedEarlierWhere,
  compareTodayRows,
  todayArrivalsWhere,
  todayDeparturesWhere,
  type BulkCheckInOptions,
  type BulkCheckInResult,
  type BulkCheckInRow,
  type TodayOverview,
  type TodayRow,
} from "./today";

const rowInclude = { unit: { include: { hardware: true } } } as const;

export async function getTodayOverview(): Promise<TodayOverview> {
  await requireAuth();
  const now = new Date();

  const [arrivals, arrived, departures, overdue, settings] = await Promise.all([
    prisma.session.findMany({ where: todayArrivalsWhere(now), include: rowInclude }),
    prisma.session.findMany({ where: arrivedEarlierWhere(now), include: rowInclude }),
    prisma.session.findMany({ where: todayDeparturesWhere(now), include: rowInclude }),
    prisma.session.findMany({ where: overdueStayWhere(now), include: rowInclude }),
    readGlobalSettings(),
  ]);

  // One settlement figure for every stay that has started (reservations have
  // nothing in CampSense to settle — their stay is paid in the booking system).
  const started = [...arrivals, ...departures, ...overdue].filter((s) => s.status !== "PENDING").map((s) => s.id);
  const settlements = await computeSettlements(started);

  type Row = (typeof arrivals)[number];
  const toRow = (s: Row): TodayRow => {
    const hw = unitHardwareSummary(s.unit.hardware);
    const settlement = settlements.get(s.id);
    let money: TodayRow["money"] = null;
    if (settlement) {
      const h = settlementHeadline(settlement);
      // A running stay on a unit without meters has nothing to show yet.
      if (!(settlement.state === "RUNNING" && (h.amount ?? 0) < 0.005)) {
        money = { label: h.label, amount: h.amount, tone: h.tone };
      }
    }
    return {
      sessionId: s.id,
      status: s.status,
      unitId: s.unit.id,
      unitName: unitDisplayName(s.unit.type, s.unit.name),
      unitRawName: s.unit.name,
      isLongTerm: s.unit.isLongTerm,
      hasHardware: hw.any,
      hasMeters: hw.meters,
      guestName: s.guestName,
      guestPhone: s.guestPhone,
      guestEmail: s.guestEmail,
      bookingRef: s.bookingRef,
      externallyLinked: !!s.externalBookingId,
      linkedLabel: s.externalBookingId
        ? bookingSystemLabel(s.externalBookingId)
        : isProviderBookingRef(s.bookingRef) ? bookingSystemLabel(s.bookingRef) : null,
      arrivalKey: siteDayKey(s.checkInTime)!,
      departureKey: siteDayKey(s.expectedCheckOut),
      checkedInAt: s.status !== "PENDING" ? (s.checkInRecordedAt ?? s.checkInTime).toISOString() : null,
      checkedOutAt: s.status === "COMPLETED" ? (s.checkOutRecordedAt ?? s.checkOutTime)?.toISOString() ?? null : null,
      money,
      canCheckIn: hasArrivedNotCheckedIn(s, now),
    };
  };

  const pendingFirst = (r: TodayRow) => r.status !== "PENDING";
  const completedLast = (r: TodayRow) => r.status === "COMPLETED";
  return {
    date: siteDayKey(now)!,
    generatedAt: now.toISOString(),
    arrivals: arrivals.map(toRow).sort((a, b) => compareTodayRows(a, b, pendingFirst)),
    arrived: arrived.map(toRow).sort((a, b) => a.arrivalKey.localeCompare(b.arrivalKey) || compareTodayRows(a, b, () => false)),
    departures: departures.map(toRow).sort((a, b) => compareTodayRows(a, b, completedLast)),
    overdue: overdue.map(toRow).sort((a, b) => (a.departureKey ?? "").localeCompare(b.departureKey ?? "") || compareTodayRows(a, b, () => false)),
    currency: settings.currency || "DKK",
  };
}

/**
 * "Tjek valgte ind": the same activation as the booking dialog, one booking
 * at a time (each claims its unit atomically), with a result per row. One
 * failure never stops the rest.
 */
export async function activateBookingSessions(sessionIds: number[], opts: BulkCheckInOptions): Promise<BulkCheckInResult> {
  await requireAuth();
  const ids = [...new Set(Array.isArray(sessionIds) ? sessionIds : [])].filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return { ok: false, message: "Vælg mindst én booking." };
  if (ids.length > BULK_CHECK_IN_MAX) return { ok: false, message: `Højst ${BULK_CHECK_IN_MAX} gæster ad gangen.` };

  const mode = opts?.billingMode === "PREPAID" ? "PREPAID" : "POSTPAID";
  let amount: number | undefined;
  let payment: { method: string } | undefined;
  if (mode === "PREPAID") {
    amount = typeof opts.prepaidAmount === "number" ? opts.prepaidAmount : undefined;
    const amountError = prepaidAmountError(amount);
    if (amountError) return { ok: false, message: amountError };
    if (!isDeskPaymentMethod(opts.prepaidMethod)) return { ok: false, message: "Vælg hvordan gæsterne har betalt forudbetalingen." };
    payment = { method: opts.prepaidMethod };
  }
  const activation = { keepArrivalDate: !!opts?.keepArrivalDate, sendWelcome: !!opts?.sendWelcome };

  const sessions = await prisma.session.findMany({
    where: { id: { in: ids } },
    include: { unit: { select: { name: true, type: true, isLongTerm: true } } },
  });
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const now = new Date();
  const results: BulkCheckInRow[] = [];

  // In the order the desk sees them; the activations run one after another.
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) {
      results.push({ sessionId: id, guestName: `#${id}`, unitName: "—", ok: false, message: "Bookingen findes ikke." });
      continue;
    }
    const base = { sessionId: id, guestName: s.guestName, unitName: unitDisplayName(s.unit.type, s.unit.name) };
    // Same rules as the dialog, checked up front for a clear reason per row.
    if (s.status === "PENDING" && siteDayKey(s.checkInTime)! > siteDayKey(now)!) {
      results.push({ ...base, ok: false, message: `Ankommer først ${fmtDate(s.checkInTime)}.` });
      continue;
    }
    if (s.status === "PENDING" && !s.expectedCheckOut && !s.unit.isLongTerm) {
      results.push({ ...base, ok: false, message: "Mangler planlagt afrejse – tjek gæsten ind enkeltvis." });
      continue;
    }
    try {
      const res = await activateBookingSession(id, mode, amount, undefined, payment, activation);
      results.push(res.ok ? { ...base, ok: true, message: res.message, receipt: res.receipt } : { ...base, ok: false, message: res.message });
    } catch (e) {
      unstable_rethrow(e);
      logger.error("checkin", `Samlet check-in af booking ${id} fejlede`, e);
      results.push({ ...base, ok: false, message: "Teknisk fejl – prøv at tjekke gæsten ind enkeltvis." });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  logger.info("checkin", `Samlet check-in: ${okCount} af ${results.length} tjekket ind (${mode}${activation.keepArrivalDate ? ", ankomstdato beholdt" : ""}${activation.sendWelcome ? ", velkomstbesked" : ""})`);
  return { ok: true, results };
}
