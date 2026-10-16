"use server";

// Fixing desk mistakes on a stay: cancel / no-show / reopen a reservation,
// change unit, undo a check-in or check-out, change the departure, free a
// unit left occupied, monthly invoicing on/off. Every export is a public
// endpoint and starts with requireAuth(). Expected problems come back as
// { ok: false, message } in Danish. Writes are guarded by the state the
// action saw (updateMany), so a double click or a racing cron tick can't
// apply one twice.

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireAuth } from "./auth";
import { logger } from "./logger";
import { fmtDate, fmtDateTime, siteDayKey } from "./format";
import { typeLabels, unitDisplayName } from "./utils";
import { checkOutDateError, type ReceiptLine } from "./check-in";
import { NO_HARDWARE_LINE } from "./check-in-hardware";
import { addLockedFields, bookingDayToDate, parseSyncValues } from "./booking/sync-merge";
import { bookingSystemLabel } from "./booking/sync";
import { isReservationExpired } from "./booking-status";
import { hasAnyHardware } from "./unit-state";
import * as hardware from "./hardware";
import { fmtMoney, paymentMethodLabel } from "./settlement-shared";
import { getPricing, tickSessionConsumption } from "./actions";
import { conflictsIn, findUnitConflicts, loadHoldingStays } from "./stay-conflicts";
import { hasMeters, meterLines, readUnitMeters, resumeUnitHardware, stopUnitHardware, type MeterReadings } from "./stay-hardware";
import {
  cancelReasonLabel,
  conflictSentence,
  conflictText,
  isCancelReason,
  stayDayRange,
  undoCheckInDeadline,
  undoCheckOutDeadline,
  UNDO_CHECK_IN_MINUTES,
  UNDO_CHECK_OUT_HOURS,
  type MoveTarget,
  type MoveTargetState,
  type StayActionResult,
} from "./stay-corrections";

type Result = { ok: true; message: string } | { ok: false; message: string };

const CHANGED_MEANWHILE = "Bookingen blev ændret samtidig – genindlæs siden og prøv igen.";

/** Thrown inside a transaction when a guarded write finds the row changed. */
class Changed extends Error {
  constructor(message = CHANGED_MEANWHILE) {
    super(message);
  }
}

function noteLine(label: string, username: string, text: string): string {
  return `[${label} ${fmtDateTime(new Date())} · ${username}] ${text}`;
}

function appendNote(notes: string | null, line: string): string {
  return notes ? `${notes}\n${line}` : line;
}

function revalidateStay(sessionId: number, unitIds: number[]) {
  revalidatePath("/admin");
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${sessionId}`);
  for (const id of unitIds) revalidatePath(`/admin/units/${id}`);
}

const fmtNum = (v: number, digits = 2) => v.toLocaleString("da-DK", { maximumFractionDigits: digits });

const TENANT_CLEARED = {
  longTermGuestName: null,
  longTermGuestEmail: null,
  longTermGuestPhone: null,
  longTermPortalToken: null,
};

// ──────────────────────────────────────────────
// Annullér / udeblevet / genåbn
// ──────────────────────────────────────────────

/**
 * Close a reservation without a stay: "CANCELLED" or "NO_SHOW". It leaves
 * every banner, counter and open list and the booking sync never revives it.
 * Undone with reopenReservation.
 */
export async function cancelReservation(sessionId: number, reason: string, note?: string): Promise<Result> {
  const auth = await requireAuth();
  const user = auth.username || "admin";
  if (!isCancelReason(reason)) return { ok: false, message: "Vælg annulleret eller udeblevet." };
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, cancelledAt: true, notes: true, unitId: true, externalBookingId: true },
  });
  if (!s) return { ok: false, message: "Bookingen findes ikke." };
  if (s.status === "ACTIVE") {
    return { ok: false, message: "Gæsten er tjekket ind. Brug 'Fortryd check-in' de første minutter, ellers tjek gæsten ud." };
  }
  if (s.status !== "PENDING") return { ok: false, message: "Opholdet er afsluttet og kan ikke annulleres." };
  if (s.cancelledAt) return { ok: false, message: "Reservationen er allerede lukket – genindlæs siden." };

  const label = cancelReasonLabel(reason);
  const text = note?.trim().slice(0, 500) || (reason === "NO_SHOW" ? "Gæsten kom ikke." : "Reservationen er annulleret.");
  const res = await prisma.session.updateMany({
    where: { id: sessionId, status: "PENDING", cancelledAt: null },
    data: { cancelledAt: new Date(), cancelReason: reason, notes: appendNote(s.notes, noteLine(label, user, text)) },
  });
  if (res.count === 0) return { ok: false, message: CHANGED_MEANWHILE };
  logger.info("booking", `Ophold ${sessionId}: ${label.toLowerCase()} af ${user}`);

  revalidateStay(sessionId, [s.unitId]);
  const hint = s.externalBookingId
    ? ` Den ændres ikke i ${bookingSystemLabel(s.externalBookingId)}, og synkroniseringen lader den være.`
    : "";
  return { ok: true, message: `Reservationen er markeret som ${label.toLowerCase()}.${hint}` };
}

/** Undo cancelReservation: the reservation is open again. */
export async function reopenReservation(sessionId: number): Promise<Result> {
  const auth = await requireAuth();
  const user = auth.username || "admin";
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: { select: { name: true, type: true } } },
  });
  if (!s) return { ok: false, message: "Bookingen findes ikke." };
  if (s.status !== "PENDING" || !s.cancelledAt) return { ok: false, message: "Reservationen er ikke annulleret – genindlæs siden." };

  const res = await prisma.session.updateMany({
    where: { id: sessionId, status: "PENDING", cancelledAt: { not: null } },
    data: { cancelledAt: null, cancelReason: null, notes: appendNote(s.notes, noteLine("Genåbnet", user, "Reservationen er åben igen.")) },
  });
  if (res.count === 0) return { ok: false, message: CHANGED_MEANWHILE };

  revalidateStay(sessionId, [s.unitId]);
  const reopened = { ...s, cancelledAt: null };
  if (isReservationExpired(reopened)) {
    return { ok: true, message: "Reservationen er genåbnet, men opholdet er slut, så den står som udløbet." };
  }
  const unitName = unitDisplayName(s.unit.type, s.unit.name);
  const conflicts = await findUnitConflicts(s.unitId, unitName, stayDayRange(reopened, siteDayKey(new Date())!), s.id);
  return {
    ok: true,
    message: conflicts.length > 0
      ? `Reservationen er genåbnet. OBS: ${conflictSentence(conflicts)}`
      : "Reservationen er genåbnet.",
  };
}

// ──────────────────────────────────────────────
// Skift enhed
// ──────────────────────────────────────────────

function movableError(s: { status: string; cancelledAt: Date | null; checkInTime: Date; expectedCheckOut: Date | null }): string | null {
  if (s.status === "COMPLETED") return "Opholdet er afsluttet og kan ikke flyttes.";
  if (s.cancelledAt) return "Reservationen er annulleret. Genåbn den først.";
  if (s.status === "PENDING" && isReservationExpired(s)) return "Reservationen er udløbet og kan ikke flyttes.";
  return null;
}

/** The days the new unit must be free: a checked-in guest moves today. */
function moveRange(s: { status: string; checkInTime: Date; expectedCheckOut: Date | null }, now: Date) {
  const today = siteDayKey(now)!;
  const range = stayDayRange(s, today);
  return s.status === "ACTIVE" ? { ...range, from: today } : range;
}

/** Every unit with whether it is free for this stay's period (for the unit picker). */
export async function getMoveTargets(
  sessionId: number,
): Promise<{ ok: true; targets: MoveTarget[] } | { ok: false; message: string }> {
  await requireAuth();
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, unitId: true, status: true, cancelledAt: true, checkInTime: true, expectedCheckOut: true },
  });
  if (!s) return { ok: false, message: "Bookingen findes ikke." };
  const err = movableError(s);
  if (err) return { ok: false, message: err };

  const now = new Date();
  const range = moveRange(s, now);
  const [units, holding] = await Promise.all([
    prisma.unit.findMany({ include: { hardware: true, resourceType: { select: { name: true, sortOrder: true } } } }),
    loadHoldingStays(undefined, now),
  ]);
  const collator = new Intl.Collator("da-DK", { numeric: true, sensitivity: "base" });
  units.sort((a, b) =>
    (a.resourceType?.sortOrder ?? 999) - (b.resourceType?.sortOrder ?? 999) ||
    collator.compare(a.resourceType?.name ?? "", b.resourceType?.name ?? "") ||
    a.sortOrder - b.sortOrder ||
    collator.compare(a.name, b.name),
  );

  const targets: MoveTarget[] = units.map((u) => {
    const name = unitDisplayName(u.type, u.name);
    const current = u.id === s.unitId;
    const conflicts = conflictsIn(holding.get(u.id), range, name, s.id);
    let state: MoveTargetState = "free";
    const texts = conflicts.map(conflictText);
    if (conflicts.some((c) => c.status === "ACTIVE")) state = "occupied";
    else if (!current && s.status === "ACTIVE" && u.status === "OCCUPIED") {
      state = "occupied";
      texts.unshift(`${name} står som optaget`);
    } else if (conflicts.length > 0) state = "reserved";
    return {
      id: u.id,
      name,
      group: u.resourceType?.name ?? typeLabels[u.type] ?? "Andre",
      state,
      conflicts: texts,
      current,
      hasHardware: hasAnyHardware(u.hardware),
    };
  });
  return { ok: true, targets };
}

type MeterKey = "el" | "heat" | "water";
const METER_FIELDS: Record<MeterKey, { start: "startKwh" | "startHeatingKwh" | "startWaterLiters"; last: "lastTickKwh" | "lastTickHeatingKwh" | "lastTickWaterLiters"; label: string; unit: string }> = {
  el: { start: "startKwh", last: "lastTickKwh", label: "El", unit: "kWh" },
  heat: { start: "startHeatingKwh", last: "lastTickHeatingKwh", label: "Varme", unit: "kWh" },
  water: { start: "startWaterLiters", last: "lastTickWaterLiters", label: "Vand", unit: "L" },
};

/**
 * Move a reservation or a checked-in stay to another unit. The session stays
 * the same — portal link, balance, laundry credit, booking number, services
 * and invoices go with it. For a checked-in stay on metered units the old
 * meter gets a final reading, its relay is switched off, the new unit's
 * reading becomes the baseline and its relay is switched on.
 */
export async function changeStayUnit(
  sessionId: number,
  targetUnitId: number,
  opts: { confirmConflicts?: boolean } = {},
): Promise<StayActionResult> {
  const auth = await requireAuth();
  try {
    return await changeStayUnitInternal(sessionId, targetUnitId, opts, auth.username || "admin");
  } catch (e) {
    logger.error("booking", `Skift enhed fejlede (ophold ${sessionId} → enhed ${targetUnitId})`, e);
    return { ok: false, message: "Flytningen fejlede uventet. Tjek bookingen, og prøv igen." };
  }
}

async function changeStayUnitInternal(
  sessionId: number,
  targetUnitId: number,
  opts: { confirmConflicts?: boolean },
  user: string,
): Promise<StayActionResult> {
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: { include: { hardware: true } } },
  });
  if (!s) return { ok: false, message: "Bookingen findes ikke." };
  const err = movableError(s);
  if (err) return { ok: false, message: err };
  if (targetUnitId === s.unitId) return { ok: false, message: "Gæsten er allerede på den enhed." };
  const target = await prisma.unit.findUnique({ where: { id: targetUnitId }, include: { hardware: true } });
  if (!target) return { ok: false, message: "Enheden findes ikke." };

  const oldName = unitDisplayName(s.unit.type, s.unit.name);
  const newName = unitDisplayName(target.type, target.name);
  const now = new Date();
  const range = moveRange(s, now);
  const conflicts = await findUnitConflicts(target.id, newName, range, s.id, now);
  const isActive = s.status === "ACTIVE";
  const linked = s.externalBookingId ? bookingSystemLabel(s.externalBookingId) : null;

  if (isActive) {
    const holder = conflicts.find((c) => c.status === "ACTIVE");
    if (holder) return { ok: false, message: `${conflictText(holder)} – tjek den gæst ud først, eller vælg en anden enhed.` };
    if (target.status === "OCCUPIED") return { ok: false, message: `${newName} står som optaget – vælg en anden enhed.` };
  }
  if (conflicts.length > 0 && !opts.confirmConflicts) {
    return {
      ok: false,
      needsConfirmation: true,
      conflicts: conflicts.map(conflictText),
      message: `${newName} er ikke ledig i hele perioden.`,
    };
  }
  const conflictLine: ReceiptLine[] = conflicts.length > 0
    ? [{ label: "Konflikt", tone: "warn", text: conflicts.map(conflictText).join(" · "), detail: "Flyt eller ret den anden booking." }]
    : [];

  // ── Reservation: only the unit changes ──
  if (!isActive) {
    const res = await prisma.session.updateMany({
      where: { id: sessionId, status: "PENDING", cancelledAt: null, unitId: s.unitId },
      data: {
        unitId: target.id,
        // The desk's unit wins over the booking system's from now on.
        lockedFields: s.externalBookingId ? addLockedFields(s.lockedFields, ["unitId"]) : s.lockedFields,
        notes: appendNote(s.notes, noteLine("Flyttet", user, `${oldName} → ${newName}`)),
      },
    });
    if (res.count === 0) return { ok: false, message: CHANGED_MEANWHILE };
    logger.info("booking", `Ophold ${sessionId}: reservation flyttet ${oldName} → ${newName} af ${user}`);
    revalidateStay(sessionId, [s.unitId, target.id]);
    const lines: ReceiptLine[] = [
      { label: "Enhed", tone: "ok", text: `${oldName} → ${newName}` },
      { label: "Booking", tone: "info", text: "Samme booking og gæstelink – intet at gøre for gæsten" },
      ...conflictLine,
    ];
    if (linked) {
      lines.push({
        label: linked,
        tone: "warn",
        text: `Ret også pladsen i ${linked}`,
        detail: `CampSense beholder ${newName}, også når ${linked} stadig siger ${oldName}.`,
      });
    }
    return {
      ok: true,
      message: `Reservationen er flyttet til ${newName}.`,
      receipt: { sessionId, title: "Reservationen er flyttet", summary: `${s.guestName}: ${oldName} → ${newName}`, lines },
    };
  }

  // ── Checked-in stay ──
  const oldHw = s.unit.hardware;
  const newHw = target.hardware;
  const metered = hasMeters(oldHw) || hasMeters(newHw);

  // Claim the new unit first, the same way check-in does.
  const claimed = await prisma.unit.updateMany({ where: { id: target.id, status: { not: "OCCUPIED" } }, data: { status: "OCCUPIED" } });
  if (claimed.count === 0) return { ok: false, message: `${newName} er netop blevet optaget – vælg en anden enhed.` };
  const releaseClaim = () =>
    prisma.unit.updateMany({ where: { id: target.id, status: "OCCUPIED" }, data: { status: "VACANT" } }).catch(() => {});

  let current = s;
  const lines: ReceiptLine[] = [{ label: "Enhed", tone: "ok", text: `${oldName} → ${newName}` }];
  let newReadings: MeterReadings = { el: null, heat: null, water: null };
  const update: Record<string, unknown> = {};
  const moveNotes: string[] = [];

  if (metered) {
    // Final reading on the old unit, so its consumption is billed up to now.
    let read = { el: false, heat: false, water: false };
    if (hasMeters(oldHw)) {
      try {
        const tick = await tickSessionConsumption(sessionId);
        if (tick) read = tick.read;
      } catch (e) {
        logger.error("booking", `Skift enhed: sidste aflæsning fejlede (ophold ${sessionId})`, e);
      }
      const reloaded = await prisma.session.findUnique({ where: { id: sessionId }, include: { unit: { include: { hardware: true } } } });
      if (!reloaded || reloaded.status !== "ACTIVE" || reloaded.unitId !== s.unitId) {
        await releaseClaim();
        return { ok: false, message: CHANGED_MEANWHILE };
      }
      current = reloaded;
      for (const key of ["el", "heat", "water"] as const) {
        const configured = key === "el" ? hardware.hasElectricityMeter(oldHw) : key === "heat" ? hardware.hasHeatingMeter(oldHw) : hardware.hasWaterMeter(oldHw);
        if (!configured) continue;
        const f = METER_FIELDS[key];
        const last = current[f.last];
        if (read[key] && last != null) {
          lines.push({ label: `Slutaflæsning ${f.label.toLowerCase()} · ${oldName}`, tone: "ok", text: `Aflæst ${fmtNum(last)} ${f.unit}` });
        } else if (last != null) {
          lines.push({
            label: `Slutaflæsning ${f.label.toLowerCase()} · ${oldName}`,
            tone: "warn",
            text: `Ikke aflæst – sidste aflæsning ${fmtNum(last)} ${f.unit}${current.lastTickAt ? ` (${fmtDateTime(current.lastTickAt)})` : ""} bruges`,
            detail: "Forbrug efter den aflæsning afregnes ikke.",
          });
        }
      }
    }

    // The new unit's readings become the baseline for the next tick. The
    // start reading is shifted by the same amount, so end − start still
    // covers both units; a utility the new unit doesn't meter keeps the old
    // unit's readings (nothing more is measured).
    newReadings = await readUnitMeters(newHw);
    for (const key of ["el", "heat", "water"] as const) {
      const r = newReadings[key];
      if (!r) continue;
      const f = METER_FIELDS[key];
      const oldStart = current[f.start];
      const oldLast = current[f.last];
      if (r.value != null) {
        update[f.last] = r.value;
        update[f.start] = oldStart != null && oldLast != null ? oldStart + (r.value - oldLast) : r.value;
        if (oldLast != null) {
          moveNotes.push(`${f.label}: ${fmtNum(oldLast)} ${f.unit} på ${oldName}, ${fmtNum(r.value)} ${f.unit} på ${newName}${oldStart != null ? " (startaflæsning omregnet, så forbruget dækker begge enheder)" : ""}`);
        }
      } else {
        // No baseline: the first reading that comes through starts the meter.
        update[f.last] = null;
        update[f.start] = null;
        moveNotes.push(`${f.label}: måleren på ${newName} kunne ikke aflæses – forbrug afregnes fra første aflæsning`);
      }
    }
    // Also stops a cron tick that read the old unit from writing after the move.
    update.lastTickAt = now;
  }

  const tenantOnOld = s.unit.isLongTerm && s.unit.longTermPortalToken === s.guestPortalToken;
  const note = noteLine("Flyttet", user, [`${oldName} → ${newName}`, ...moveNotes].join(". "));
  try {
    await prisma.$transaction(async (tx) => {
      // Invoices raised on the old unit during this stay go with the stay.
      await tx.invoice.updateMany({
        where: { unitId: s.unitId, sessionId: null, periodEnd: { gt: s.checkInTime } },
        data: { sessionId },
      });
      const moved = await tx.session.updateMany({
        where: { id: sessionId, status: "ACTIVE", unitId: s.unitId, lastTickAt: current.lastTickAt },
        data: { ...update, unitId: target.id, notes: appendNote(current.notes, note) },
      });
      if (moved.count === 0) throw new Changed();
      if (!s.unit.isLongTerm || tenantOnOld) {
        await tx.unit.update({ where: { id: s.unitId }, data: { status: "VACANT", ...(tenantOnOld ? TENANT_CLEARED : {}) } });
      }
      if (target.isLongTerm) {
        await tx.unit.update({
          where: { id: target.id },
          data: {
            longTermGuestName: s.guestName,
            longTermGuestEmail: s.guestEmail,
            longTermGuestPhone: s.guestPhone,
            longTermPortalToken: s.guestPortalToken,
          },
        });
      }
    });
  } catch (e) {
    await releaseClaim();
    if (e instanceof Changed) return { ok: false, message: e.message };
    throw e;
  }
  logger.info("booking", `Ophold ${sessionId}: flyttet ${oldName} → ${newName} af ${user}${moveNotes.length ? ` (${moveNotes.join("; ")})` : ""}`);

  // Relays after the move is saved: old off, new on.
  const pricing = await getPricing();
  const context = `move session=${sessionId}`;
  lines.push(...(await stopUnitHardware(oldHw, oldName, context, pricing.defaultVacantTemp)));
  lines.push(...meterLines("Startaflæsning", newName, newReadings));
  lines.push(...(await resumeUnitHardware(newHw, newName, context, pricing.defaultOccupiedTemp)));
  if (!hasAnyHardware(oldHw) && !hasAnyHardware(newHw)) lines.push({ ...NO_HARDWARE_LINE, text: "Ingen måler/relæ på enhederne – intet at slukke, tænde eller aflæse" });
  lines.push({ label: "Gæsteportal", tone: "info", text: "Samme link som før – saldo, vaskekredit og booking nr. følger med" });
  lines.push(...conflictLine);
  if (linked) lines.push({ label: linked, tone: "info", text: `Ret også pladsen i ${linked}, hvis bookingen skal følge med der` });

  revalidateStay(sessionId, [s.unitId, target.id]);
  const problem = lines.some((l) => l.tone === "error");
  return {
    ok: true,
    message: problem ? `Gæsten er flyttet til ${newName}, men ikke alt lykkedes – se kvitteringen.` : `Gæsten er flyttet til ${newName}.`,
    receipt: { sessionId, title: "Gæsten er flyttet", summary: `${s.guestName}: ${oldName} → ${newName}`, lines },
  };
}

// ──────────────────────────────────────────────
// Fortryd check-in
// ──────────────────────────────────────────────

/**
 * Undo a check-in made by mistake: within UNDO_CHECK_IN_MINUTES and while
 * nothing is billed or bought on the stay. The stay goes back to a
 * reservation (an imported one to its booked arrival day), the unit is
 * vacant and its relay off. `cancel` also closes the booking (a walk-in
 * registered by mistake). A deposit recorded in the payments ledger gets a
 * counter-entry: the money goes back to the guest.
 */
export async function undoCheckIn(sessionId: number, opts: { cancel?: boolean } = {}): Promise<StayActionResult> {
  const auth = await requireAuth();
  const user = auth.username || "admin";
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      unit: { include: { hardware: true } },
      payments: true,
      _count: {
        select: {
          prepaidTopUps: true,
          invoices: true,
          laundrySessions: { where: { status: { not: "CANCELLED" } } },
          showerSessions: { where: { status: { not: "CANCELLED" } } },
        },
      },
    },
  });
  if (!s) return { ok: false, message: "Bookingen findes ikke." };
  if (s.status !== "ACTIVE") return { ok: false, message: "Gæsten er ikke tjekket ind." };
  const now = new Date();
  if (now > undoCheckInDeadline(s)) {
    return { ok: false, message: `Check-in kan kun fortrydes de første ${UNDO_CHECK_IN_MINUTES} minutter. Brug 'Skift enhed', eller tjek gæsten ud.` };
  }
  if (s.accumulatedElCost + s.accumulatedWaterCost >= 0.005) {
    return { ok: false, message: "Der er allerede afregnet el/vand på opholdet. Tjek gæsten ud i stedet." };
  }
  if (s._count.laundrySessions + s._count.showerSessions > 0) {
    return { ok: false, message: "Gæsten har allerede brugt vask eller bad på opholdet. Annullér dem først, eller tjek gæsten ud." };
  }
  if (s._count.prepaidTopUps > 0) return { ok: false, message: "Gæsten har tanket saldoen op med kort. Tjek gæsten ud i stedet." };
  const unitInvoices = await prisma.invoice.count({ where: { unitId: s.unitId, sessionId: null, createdAt: { gte: s.checkInTime } } });
  if (s._count.invoices + unitInvoices > 0) return { ok: false, message: "Der er lavet en faktura på opholdet. Tjek gæsten ud i stedet." };

  // Deposits (BALANCE rows) are paid back with a counter-entry; any other
  // payment must be undone by the desk first.
  const reversed = new Set(s.payments.filter((p) => p.reversesId != null).map((p) => p.reversesId!));
  const open = s.payments.filter((p) => p.reversesId == null && !reversed.has(p.id));
  const blocking = open.find((p) => p.kind !== "BALANCE" || p.amount < 0);
  if (blocking) {
    return {
      ok: false,
      message: `Der er registreret en betaling på opholdet (${fmtMoney(blocking.amount)}, ${paymentMethodLabel(blocking.method)}). Fortryd den først.`,
    };
  }
  const deposits = open.filter((p) => p.kind === "BALANCE" && p.amount > 0);

  // An imported booking goes back to its booked arrival day.
  const bookedArrival = parseSyncValues(s.lastSyncedValues).checkInTime;
  const checkInTime = bookedArrival ? bookingDayToDate(String(bookedArrival)) : s.checkInTime;
  const deposited = s.billingMode === "PREPAID" ? (s.prepaidDeposited ?? s.prepaidAmount ?? 0) : 0;
  const tenantOnUnit = s.unit.isLongTerm && s.unit.longTermPortalToken === s.guestPortalToken;
  const unitName = unitDisplayName(s.unit.type, s.unit.name);
  const noteText = opts.cancel ? "Check-in fortrudt, og bookingen er annulleret (fejlregistrering)." : "Check-in fortrudt – står igen som reservation.";

  try {
    await prisma.$transaction(async (tx) => {
      const res = await tx.session.updateMany({
        where: { id: sessionId, status: "ACTIVE", accumulatedElCost: { lt: 0.005 }, accumulatedWaterCost: { lt: 0.005 } },
        data: {
          status: "PENDING",
          checkInTime,
          checkInRecordedAt: null,
          billingMode: "POSTPAID",
          prepaidAmount: null,
          prepaidDeposited: null,
          paymentStatus: "UNPAID",
          paidAt: null,
          startKwh: null,
          startHeatingKwh: null,
          startWaterLiters: null,
          lastTickKwh: null,
          lastTickHeatingKwh: null,
          lastTickWaterLiters: null,
          lastTickAt: null,
          accumulatedElCost: 0,
          accumulatedElKwh: 0,
          accumulatedWaterCost: 0,
          accumulatedWaterLiters: 0,
          ...(opts.cancel ? { cancelledAt: now, cancelReason: "CANCELLED" } : {}),
          notes: appendNote(s.notes, noteLine("Fortrudt", user, noteText)),
        },
      });
      if (res.count === 0) throw new Changed();
      for (const p of deposits) {
        await tx.payment.create({
          data: {
            sessionId,
            amount: -p.amount,
            method: p.method,
            kind: p.kind,
            reversesId: p.id,
            note: "Check-in fortrudt – forudbetalingen er givet tilbage",
            createdBy: user,
          },
        });
      }
      const stillActive = await tx.session.count({ where: { unitId: s.unitId, status: "ACTIVE" } });
      if (stillActive === 0) {
        await tx.unit.update({ where: { id: s.unitId }, data: { status: "VACANT", ...(tenantOnUnit ? TENANT_CLEARED : {}) } });
      }
    });
  } catch (e) {
    if (e instanceof Changed) return { ok: false, message: e.message };
    logger.error("booking", `Fortryd check-in fejlede (ophold ${sessionId})`, e);
    return { ok: false, message: "Check-in kunne ikke fortrydes. Prøv igen." };
  }
  logger.info("booking", `Ophold ${sessionId}: check-in fortrudt af ${user}${opts.cancel ? " (annulleret)" : ""}`);

  const pricing = await getPricing();
  const lines: ReceiptLine[] = [
    { label: "Booking", tone: "ok", text: opts.cancel ? "Annulleret (fejlregistrering)" : `Reservation igen – ankomst ${fmtDate(checkInTime)}` },
    { label: "Enhed", tone: "ok", text: `${unitName} er ledig` },
    ...(await stopUnitHardware(s.unit.hardware, unitName, `undoCheckIn session=${sessionId}`, pricing.defaultVacantTemp)),
  ];
  if (deposited > 0) {
    lines.push({
      label: "Forudbetaling",
      tone: "warn",
      text: `Giv gæsten ${fmtMoney(deposited)} tilbage`,
      detail: deposits.length > 0 ? "Modposten er bogført." : "Beløbet var kun noteret på opholdet.",
    });
  }
  revalidateStay(sessionId, [s.unitId]);
  return {
    ok: true,
    message: opts.cancel ? "Check-in er fortrudt, og bookingen er annulleret." : `Check-in er fortrudt. ${s.guestName} står igen som reserveret.`,
    receipt: { sessionId, title: "Check-in fortrudt", summary: `${s.guestName} · ${unitName}`, lines },
  };
}

// ──────────────────────────────────────────────
// Fortryd udtjek
// ──────────────────────────────────────────────

/**
 * Undo a check-out within UNDO_CHECK_OUT_HOURS, as long as no payment or
 * invoice came after it and the unit is still free. The stay runs again:
 * totals are cleared (the settlement goes back to "so far"), metering resumes
 * from the last reading — a manual end reading becomes the baseline, so
 * nothing is billed twice — and the relay is switched on.
 */
export async function undoCheckOut(sessionId: number): Promise<StayActionResult> {
  const auth = await requireAuth();
  const user = auth.username || "admin";
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: { include: { hardware: true } }, payments: true },
  });
  if (!s) return { ok: false, message: "Bookingen findes ikke." };
  if (s.status !== "COMPLETED" || !s.checkOutTime) return { ok: false, message: "Opholdet er ikke tjekket ud." };
  const now = new Date();
  const deadline = undoCheckOutDeadline(s);
  if (!deadline || now > deadline) return { ok: false, message: `Udtjek kan kun fortrydes inden for ${UNDO_CHECK_OUT_HOURS} timer.` };

  const checkedOutAt = s.checkOutRecordedAt ?? s.checkOutTime;
  const reversed = new Set(s.payments.filter((p) => p.reversesId != null).map((p) => p.reversesId!));
  const paidSince = s.payments.find((p) => p.createdAt >= checkedOutAt && p.reversesId == null && !reversed.has(p.id));
  if (paidSince) {
    return {
      ok: false,
      message: `Der er registreret en betaling efter udtjek (${fmtMoney(paidSince.amount)}, ${paymentMethodLabel(paidSince.method)}). Fortryd betalingen først.`,
    };
  }
  const invoicedSince = await prisma.invoice.count({
    where: { createdAt: { gte: checkedOutAt }, OR: [{ sessionId }, { unitId: s.unitId, sessionId: null }] },
  });
  if (invoicedSince > 0) return { ok: false, message: "Der er lavet en faktura efter udtjek, så udtjekket kan ikke fortrydes." };

  const unitName = unitDisplayName(s.unit.type, s.unit.name);
  const newGuest = await prisma.session.findFirst({ where: { unitId: s.unitId, status: "ACTIVE" }, select: { guestName: true } });
  if (newGuest) return { ok: false, message: `${unitName} er taget af ${newGuest.guestName}. Brug 'Skift enhed' efter at have fortrudt på en ledig enhed – eller tjek gæsten ind på ny.` };
  const tenantIsThisStay = s.unit.isLongTerm && s.unit.longTermPortalToken === s.guestPortalToken;
  if (s.unit.status === "OCCUPIED" && !tenantIsThisStay) return { ok: false, message: `${unitName} står som optaget, så udtjekket kan ikke fortrydes.` };

  // A manual end reading was billed into the accumulator: it becomes the
  // baseline, so the next tick doesn't bill the same consumption again.
  const baseline: Record<string, number> = {};
  const bump = (last: "lastTickKwh" | "lastTickHeatingKwh" | "lastTickWaterLiters", end: number | null, billedSince: boolean) => {
    const cur = s[last];
    if (end == null) return;
    if (cur != null ? end > cur : billedSince) baseline[last] = end;
  };
  bump("lastTickKwh", s.endKwh, s.lastTickAt == null && s.accumulatedElKwh > 0);
  bump("lastTickHeatingKwh", s.endHeatingKwh, s.lastTickAt == null && s.accumulatedElKwh > 0);
  bump("lastTickWaterLiters", s.endWaterLiters, s.lastTickAt == null && s.accumulatedWaterLiters > 0);

  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.unit.updateMany({
        where: {
          id: s.unitId,
          OR: [{ status: { not: "OCCUPIED" } }, ...(tenantIsThisStay ? [{ longTermPortalToken: s.guestPortalToken }] : [])],
        },
        data: {
          status: "OCCUPIED",
          ...(s.unit.isLongTerm
            ? { longTermGuestName: s.guestName, longTermGuestEmail: s.guestEmail, longTermGuestPhone: s.guestPhone, longTermPortalToken: s.guestPortalToken }
            : {}),
        },
      });
      if (claimed.count === 0) throw new Changed(`${unitName} er netop blevet optaget.`);
      if ((await tx.session.count({ where: { unitId: s.unitId, status: "ACTIVE" } })) > 0) throw new Changed(`${unitName} er netop blevet optaget.`);
      const res = await tx.session.updateMany({
        where: { id: sessionId, status: "COMPLETED", checkOutTime: s.checkOutTime },
        data: {
          status: "ACTIVE",
          checkOutTime: null,
          checkOutRecordedAt: null,
          endKwh: null,
          endHeatingKwh: null,
          endWaterLiters: null,
          totalElectricityCost: null,
          totalWaterCost: null,
          totalCost: null,
          paymentStatus: "UNPAID",
          paidAt: null,
          ...baseline,
          notes: appendNote(s.notes, noteLine("Fortrudt", user, `Udtjek fortrudt (var tjekket ud ${fmtDateTime(s.checkOutTime)}).`)),
        },
      });
      if (res.count === 0) throw new Changed();
    });
  } catch (e) {
    if (e instanceof Changed) return { ok: false, message: e.message };
    logger.error("booking", `Fortryd udtjek fejlede (ophold ${sessionId})`, e);
    return { ok: false, message: "Udtjekket kunne ikke fortrydes. Prøv igen." };
  }
  logger.info("booking", `Ophold ${sessionId}: udtjek fortrudt af ${user}`);

  const pricing = await getPricing();
  const hwLines = await resumeUnitHardware(s.unit.hardware, unitName, `undoCheckOut session=${sessionId}`, pricing.defaultOccupiedTemp);
  const lines: ReceiptLine[] = [
    { label: "Ophold", tone: "ok", text: `Tjekket ind igen på ${unitName}` },
    ...hwLines,
    ...(hasMeters(s.unit.hardware)
      ? [{ label: "Måling", tone: "info" as const, text: "Fortsætter fra sidste aflæsning – også forbruget siden udtjek afregnes" }]
      : []),
  ];
  if (s.unit.isLongTerm && !tenantIsThisStay) lines.push({ label: "Lejemål", tone: "ok", text: "Lejer og gæsteportal er sat på enheden igen" });
  revalidateStay(sessionId, [s.unitId]);
  revalidatePath(`/admin/bookings/${sessionId}/statement`);
  return {
    ok: true,
    message: `Udtjekket er fortrudt. ${s.guestName} er tjekket ind igen.`,
    receipt: { sessionId, title: "Udtjek fortrudt", summary: `${s.guestName} · ${unitName}`, lines },
  };
}

// ──────────────────────────────────────────────
// Ændr afrejse (forlæng / forkort)
// ──────────────────────────────────────────────

/**
 * New planned departure for a reservation or a checked-in stay ("YYYY-MM-DD",
 * or null for an open stay on a long-term unit). Other stays on the unit in
 * the new period come back as a conflict the desk must confirm.
 */
export async function changeExpectedCheckOut(
  sessionId: number,
  value: string | null,
  opts: { confirmConflicts?: boolean } = {},
): Promise<StayActionResult> {
  const auth = await requireAuth();
  const user = auth.username || "admin";
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: { select: { id: true, name: true, type: true, isLongTerm: true } } },
  });
  if (!s) return { ok: false, message: "Bookingen findes ikke." };
  if (s.status === "COMPLETED") return { ok: false, message: "Opholdet er afsluttet." };
  if (s.cancelledAt) return { ok: false, message: "Reservationen er annulleret. Genåbn den først." };

  const key = value?.trim() || null;
  const dateError = checkOutDateError(key, { required: !s.unit.isLongTerm });
  if (dateError) return { ok: false, message: dateError };
  const arrival = siteDayKey(s.checkInTime)!;
  if (key && s.status === "PENDING" && key <= arrival) {
    return { ok: false, message: `Afrejse skal ligge efter ankomst (${fmtDate(s.checkInTime)}).` };
  }
  const before = siteDayKey(s.expectedCheckOut);
  if (key === before) return { ok: true, message: "Afrejsen er uændret." };

  const unitName = unitDisplayName(s.unit.type, s.unit.name);
  const nextDeparture = key ? bookingDayToDate(key) : null;
  const range = stayDayRange({ ...s, expectedCheckOut: nextDeparture }, siteDayKey(new Date())!);
  const conflicts = await findUnitConflicts(s.unitId, unitName, range, s.id);
  if (conflicts.length > 0 && !opts.confirmConflicts) {
    return {
      ok: false,
      needsConfirmation: true,
      conflicts: conflicts.map(conflictText),
      message: "Den nye afrejse overlapper en anden booking på enheden.",
    };
  }

  const fmtKey = (k: string | null) => (k ? fmtDate(bookingDayToDate(k)) : "åben");
  const res = await prisma.session.updateMany({
    where: { id: sessionId, status: s.status, cancelledAt: null, expectedCheckOut: s.expectedCheckOut },
    data: {
      expectedCheckOut: nextDeparture,
      // A departure set at the desk survives the next booking sync.
      lockedFields: s.externalBookingId ? addLockedFields(s.lockedFields, ["expectedCheckOut"]) : s.lockedFields,
      notes: appendNote(s.notes, noteLine("Afrejse ændret", user, `${fmtKey(before)} → ${fmtKey(key)}`)),
    },
  });
  if (res.count === 0) return { ok: false, message: CHANGED_MEANWHILE };
  logger.info("booking", `Ophold ${sessionId}: afrejse ${before ?? "åben"} → ${key ?? "åben"} af ${user}`);

  revalidateStay(sessionId, [s.unitId]);
  const parts = [`Afrejse er nu ${fmtKey(key)}.`];
  if (conflicts.length > 0) parts.push(`OBS: ${conflictSentence(conflicts)}`);
  if (s.externalBookingId) parts.push(`Ret også datoen i ${bookingSystemLabel(s.externalBookingId)}.`);
  return { ok: true, message: parts.join(" ") };
}

// ──────────────────────────────────────────────
// Frigør enhed / månedsafregning
// ──────────────────────────────────────────────

/**
 * A unit marked occupied with nobody checked in (a fastligger checked out
 * before tenancies could be ended) is set vacant. On a long-term unit this
 * ends the tenancy: tenant, portal link and monthly invoicing stop.
 */
export async function releaseUnit(unitId: number): Promise<Result> {
  const auth = await requireAuth();
  const unit = await prisma.unit.findUnique({ where: { id: unitId } });
  if (!unit) return { ok: false, message: "Enheden findes ikke." };
  const name = unitDisplayName(unit.type, unit.name);
  if (unit.status !== "OCCUPIED" && !unit.longTermGuestName) return { ok: false, message: `${name} er allerede ledig.` };
  const guest = await prisma.session.findFirst({ where: { unitId, status: "ACTIVE" }, select: { guestName: true } });
  if (guest) return { ok: false, message: `${guest.guestName} er tjekket ind på ${name}. Tjek gæsten ud i stedet.` };

  const res = await prisma.unit.updateMany({
    where: { id: unitId, updatedAt: unit.updatedAt },
    data: { status: "VACANT", ...(unit.isLongTerm ? TENANT_CLEARED : {}) },
  });
  if (res.count === 0) return { ok: false, message: "Enheden blev ændret samtidig – genindlæs siden." };
  logger.info("booking", `${name} frigjort af ${auth.username || "admin"}${unit.isLongTerm ? ` (lejemål ${unit.longTermGuestName ?? ""} afsluttet)` : ""}`);
  revalidatePath("/admin");
  revalidatePath(`/admin/units/${unitId}`);
  return {
    ok: true,
    message: unit.isLongTerm
      ? `Lejemålet er afsluttet, og ${name} er ledig. Månedsfakturering for enheden stopper.`
      : `${name} er ledig igen.`,
  };
}

/**
 * Monthly interim invoicing for a long stay (e.g. winter guests on ordinary
 * pitches): the booking page reminds the desk each month, and the automatic
 * invoice run includes the stay when its unit has meters.
 */
export async function setMonthlyInvoicing(sessionId: number, on: boolean): Promise<Result> {
  const auth = await requireAuth();
  const s = await prisma.session.findUnique({ where: { id: sessionId }, select: { status: true, billingMode: true, cancelledAt: true, notes: true, unitId: true } });
  if (!s) return { ok: false, message: "Bookingen findes ikke." };
  if (s.status === "COMPLETED" || s.cancelledAt) return { ok: false, message: "Opholdet er afsluttet." };
  if (on && s.billingMode === "PREPAID") return { ok: false, message: "En forudbetalt gæst betaler af saldoen og faktureres ikke." };
  const res = await prisma.session.updateMany({
    where: { id: sessionId, status: s.status },
    data: {
      monthlyInvoicing: on,
      notes: appendNote(s.notes, noteLine("Månedsafregning", auth.username || "admin", on ? "Slået til." : "Slået fra.")),
    },
  });
  if (res.count === 0) return { ok: false, message: CHANGED_MEANWHILE };
  revalidateStay(sessionId, [s.unitId]);
  return {
    ok: true,
    message: on
      ? "Opholdet afregnes nu med månedlige mellemfakturaer."
      : "Månedsafregning er slået fra. Opholdet afregnes samlet ved udtjek.",
  };
}
