"use server";

// Desk operations for laundry and showers: live overview, "Start for gæst",
// extend, "Annullér og refundér", history and the service credit ledger.
// Every export is a public endpoint and starts with requireAuth(). The pages
// are dynamic and the components re-fetch/refresh after each action.

import { prisma } from "./prisma";
import { requireAuth } from "./auth";
import { readGlobalSettings } from "./settings";
import * as hardware from "./hardware";
import { logger } from "./logger";
import { startOfToday } from "./booking-status";
import { unitDisplayName } from "./utils";
import {
  DESK_PAY_METHODS,
  PAY_METHOD_LABELS,
  isDeskPayMethod,
  refundPlan,
  serviceChannel,
  servicePaymentBadge,
  type CreditSource,
  type DeskStartInput,
  type RefundChoice,
  type RefundPlan,
  type ServiceChannel,
  type ServiceTone,
} from "./service-billing";
import {
  cancelAndRefundService,
  drawStayFunds,
  InsufficientFunds,
  kr,
  serviceDeviceOnline,
  type ServiceKind,
} from "./service-ops";

const PENDING_PAYMENT_TTL_MS = 15 * 60 * 1000;

type Result = { ok: boolean; message: string };

interface ActiveUse {
  id: number;
  status: string;
  startedAt: string;
  endsAt: string;
  /** Paused showers: time left when the guest resumes. */
  pausedSecondsLeft: number | null;
  stayId: number | null;
  guestName: string | null;
  unitName: string | null;
  source: string;
  detail: string | null;
  amount: number;
  creditUsed: number;
  payment: { label: string; tone: ServiceTone };
  startedBy: string | null;
  note: string | null;
  metered: boolean;
  refund: RefundPlan;
}

type StayRef = { id: number; status: string; guestName: string; unit: { name: string; type: string } } | null;

function sourceLabel(r: { startedBy: string | null; guestPortalToken?: string | null; sessionId: number | null }): string {
  if (r.startedBy) return `Skranken (${r.startedBy})`;
  if (r.guestPortalToken?.startsWith("qr:")) return "QR-kode";
  if (r.sessionId) return "Gæsteportal";
  return "Gæst";
}

function stayFields(stay: StayRef) {
  return {
    stayId: stay?.id ?? null,
    guestName: stay?.guestName ?? null,
    unitName: stay ? unitDisplayName(stay.unit.type, stay.unit.name) : null,
  };
}

const staySelect = {
  select: { id: true, status: true, guestName: true, unit: { select: { name: true, type: true } } },
} as const;

// ──────────────────────────────────────────────
// Live overview
// ──────────────────────────────────────────────
export async function getServicesOverview() {
  await requireAuth();
  const now = new Date();
  const pendingCutoff = new Date(now.getTime() - PENDING_PAYMENT_TTL_MS);
  await Promise.all([
    prisma.laundrySess.updateMany({ where: { status: "PENDING", createdAt: { lte: pendingCutoff } }, data: { status: "CANCELLED" } }),
    prisma.showerSess.updateMany({ where: { status: "PENDING", createdAt: { lte: pendingCutoff } }, data: { status: "CANCELLED" } }),
  ]);

  const [settings, machines, showers] = await Promise.all([
    readGlobalSettings(),
    prisma.laundryMachine.findMany({
      orderBy: [{ kind: "desc" }, { name: "asc" }],
      include: {
        programs: { where: { enabled: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        sessions: {
          where: { status: { in: ["ACTIVE", "PENDING"] } },
          orderBy: { startedAt: "desc" },
          take: 1,
          include: { session: staySelect },
        },
      },
    }),
    prisma.shower.findMany({
      orderBy: { name: "asc" },
      include: {
        sessions: {
          where: { status: { in: ["ACTIVE", "PAUSED", "PENDING"] } },
          orderBy: { startedAt: "desc" },
          take: 1,
          include: { session: staySelect },
        },
      },
    }),
  ]);

  // Only the few devices with a Shelly are asked — in parallel, short wait.
  const [machineOnline, showerOnline] = await Promise.all([
    Promise.all(machines.map((m) => serviceDeviceOnline(m))),
    Promise.all(showers.map((s) => serviceDeviceOnline(s))),
  ]);

  return {
    cardPayment: settings.quickpay_enabled === "true",
    servicesOnAccount: settings.postpaid_services_mode === "ON_ACCOUNT",
    machines: machines.map((m, i) => {
      const a = m.sessions[0];
      const metered = a?.billingMode === "METERED";
      // A fixed wash past its end is done even if the sweep hasn't run yet.
      const live = a && (a.status === "PENDING" || metered || a.endsAt > now) ? a : null;
      const active: ActiveUse | null = live
        ? {
            id: live.id,
            status: live.status,
            startedAt: live.startedAt.toISOString(),
            endsAt: live.endsAt.toISOString(),
            pausedSecondsLeft: null,
            ...stayFields(live.session),
            source: sourceLabel(live),
            detail: metered ? "Målt forbrug" : live.programName || (live.durationMinutes ? `${live.durationMinutes} min` : null),
            amount: metered && live.status === "ACTIVE" ? live.reservedAmount ?? 0 : live.pricePaid,
            creditUsed: live.creditUsed,
            payment: servicePaymentBadge(live),
            startedBy: live.startedBy,
            note: live.note,
            metered,
            refund: refundPlan(live, { stayActive: live.session?.status === "ACTIVE" }),
          }
        : null;
      return {
        id: m.id,
        name: m.name,
        machineKind: (m.kind === "DRYER" ? "DRYER" : "WASHER") as "WASHER" | "DRYER",
        code: m.code,
        location: m.location,
        billingMode: m.billingMode,
        durationMinutes: m.durationMinutes,
        pricePerUse: m.pricePerUse,
        enabled: m.enabled,
        online: machineOnline[i],
        programs: m.programs.map((p) => ({ id: p.id, name: p.name, durationMinutes: p.durationMinutes, pricePerUse: p.pricePerUse })),
        active,
      };
    }),
    showers: showers.map((s, i) => {
      const a = s.sessions[0];
      const live = a && (a.status !== "ACTIVE" || a.endsAt > now) ? a : null;
      const active: ActiveUse | null = live
        ? {
            id: live.id,
            status: live.status,
            startedAt: live.startedAt.toISOString(),
            endsAt: live.endsAt.toISOString(),
            pausedSecondsLeft: live.status === "PAUSED" && live.pauseRemainingMs != null ? Math.ceil(live.pauseRemainingMs / 1000) : null,
            ...stayFields(live.session),
            source: sourceLabel(live),
            detail: live.minutesPaid ? `${live.minutesPaid} min` : live.pendingMinutes ? `${live.pendingMinutes} min` : null,
            amount: live.pricePaid,
            creditUsed: live.creditUsed,
            payment: servicePaymentBadge(live),
            startedBy: live.startedBy,
            note: live.note,
            metered: false,
            refund: refundPlan(live, { stayActive: live.session?.status === "ACTIVE" }),
          }
        : null;
      return {
        id: s.id,
        name: s.name,
        code: s.code,
        location: s.location,
        pricePerMinute: s.pricePerMinute,
        minMinutes: s.minMinutes,
        maxMinutes: s.maxMinutes,
        enabled: s.enabled,
        online: showerOnline[i],
        active,
      };
    }),
  };
}

/** Checked-in stays a desk start can be charged to ("På opholdet"). */
export async function getStaysForServiceCharge() {
  await requireAuth();
  const stays = await prisma.session.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      guestName: true,
      billingMode: true,
      prepaidAmount: true,
      laundryCredit: true,
      unit: { select: { name: true, type: true } },
    },
  });
  return stays
    .map((s) => ({
      id: s.id,
      guestName: s.guestName,
      unitName: unitDisplayName(s.unit.type, s.unit.name),
      billingMode: s.billingMode,
      balance: s.billingMode === "PREPAID" ? s.prepaidAmount ?? 0 : null,
      credit: s.laundryCredit,
    }))
    .sort((a, b) => a.unitName.localeCompare(b.unitName, "da", { numeric: true }));
}

// ──────────────────────────────────────────────
// "Start for gæst"
// ──────────────────────────────────────────────
/**
 * Start a machine or shower from the desk with what was actually agreed:
 * program/minutes, price and how it was paid. Money taken at the desk becomes
 * a SERVICE payment (for the till); "På opholdet" goes on the stay (balance
 * for PREPAID, the bill for POSTPAID); "Gratis" needs a reason. The relay is
 * switched on first — if the device doesn't answer, nothing is recorded.
 */
export async function adminStartService(input: DeskStartInput): Promise<Result> {
  const auth = await requireAuth();
  const by = auth.username ?? null;

  const minutes = Math.round(Number(input.minutes));
  const price = Math.round(Number(input.price) * 100) / 100;
  const note = input.note?.trim() || null;
  const method = input.method;
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) return { ok: false, message: "Ugyldigt antal minutter" };
  if (!Number.isFinite(price) || price < 0) return { ok: false, message: "Ugyldig pris" };
  if (!isDeskPayMethod(method) && method !== "STAY" && method !== "FREE") return { ok: false, message: "Vælg hvordan der er betalt" };
  if (method === "FREE" && !note) return { ok: false, message: "Skriv hvorfor det er gratis" };
  if (method !== "FREE" && price <= 0) return { ok: false, message: "Prisen er 0 — vælg \"Gratis\" og skriv en årsag" };

  let stay: { id: number; billingMode: string; prepaidAmount: number | null; guestName: string; unitName: string } | null = null;
  if (method === "STAY") {
    if (!input.stayId) return { ok: false, message: "Vælg gæstens ophold" };
    const s = await prisma.session.findUnique({
      where: { id: input.stayId },
      include: { unit: { select: { name: true, type: true } } },
    });
    if (!s || s.status !== "ACTIVE") return { ok: false, message: "Opholdet er ikke tjekket ind" };
    if (s.billingMode === "PREPAID" && (s.prepaidAmount ?? 0) < price) {
      return { ok: false, message: `Gæstens saldo er for lav (${kr(s.prepaidAmount ?? 0)}) — tag betaling i receptionen eller tilføj en indbetaling først` };
    }
    stay = { id: s.id, billingMode: s.billingMode, prepaidAmount: s.prepaidAmount, guestName: s.guestName, unitName: unitDisplayName(s.unit.type, s.unit.name) };
  }

  const now = new Date();
  const pendingCutoff = new Date(now.getTime() - PENDING_PAYMENT_TTL_MS);
  let device: { name: string; source: string; switchEntityId: string | null; mqttPrefix: string | null; mqttComponent: string | null };
  let program: { id: number; name: string } | null = null;

  if (input.kind === "LAUNDRY") {
    const machine = await prisma.laundryMachine.findUnique({ where: { id: input.id }, include: { programs: true } });
    if (!machine) return { ok: false, message: "Maskinen findes ikke" };
    if (!machine.enabled) return { ok: false, message: `${machine.name} er deaktiveret` };
    if (input.programId) {
      const p = machine.programs.find((x) => x.id === input.programId);
      if (!p) return { ok: false, message: "Ugyldigt program" };
      program = { id: p.id, name: p.name };
    }
    // A fixed wash past its end is finished even if the sweep hasn't run.
    await prisma.laundrySess.updateMany({
      where: { machineId: machine.id, status: "ACTIVE", billingMode: "FIXED", endsAt: { lte: now } },
      data: { status: "COMPLETED" },
    });
    const busy = await prisma.laundrySess.findFirst({
      where: {
        machineId: machine.id,
        OR: [{ status: "ACTIVE" }, { status: "PENDING", createdAt: { gt: pendingCutoff } }],
      },
      select: { id: true },
    });
    if (busy) return { ok: false, message: `${machine.name} er i brug` };
    device = machine;
  } else {
    const shower = await prisma.shower.findUnique({ where: { id: input.id } });
    if (!shower) return { ok: false, message: "Badet findes ikke" };
    if (!shower.enabled) return { ok: false, message: `${shower.name} er deaktiveret` };
    const busy = await prisma.showerSess.findFirst({
      where: {
        showerId: shower.id,
        OR: [
          { status: "ACTIVE", endsAt: { gt: now } },
          { status: "PAUSED" },
          { status: "PENDING", createdAt: { gt: pendingCutoff } },
        ],
      },
      select: { id: true },
    });
    if (busy) return { ok: false, message: `${shower.name} er i brug` };
    device = shower;
  }

  // Relay first: a start that doesn't happen must leave no payment behind.
  const ep = hardware.switchRowEp(device);
  try {
    await hardware.setSwitchTimed(ep, minutes * 60 + (input.kind === "LAUNDRY" ? 120 : 60));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(input.kind === "LAUNDRY" ? "laundry" : "shower", `${device.name}: start fra skranken fejlede`, msg);
    return { ok: false, message: `${device.name} kunne ikke startes (${msg}). Der er ikke registreret nogen betaling.` };
  }

  const pay =
    method === "FREE" ? { paymentStatus: "FREE", paymentMethod: "FREE", pricePaid: 0 }
      : method === "STAY" && stay?.billingMode === "PREPAID" ? { paymentStatus: "PREPAID", paymentMethod: "BALANCE", pricePaid: price }
      : method === "STAY" ? { paymentStatus: "ON_ACCOUNT", paymentMethod: "ACCOUNT", pricePaid: price }
      : { paymentStatus: "PAID", paymentMethod: method, pricePaid: price };
  const detail = input.kind === "LAUNDRY" ? (program ? ` · ${program.name}` : ` · ${minutes} min`) : ` · ${minutes} min`;
  const endsAt = new Date(Date.now() + minutes * 60_000);

  try {
    await prisma.$transaction(async (tx) => {
      if (stay && pay.paymentStatus === "PREPAID") {
        await drawStayFunds(tx, stay.id, { kind: "BALANCE", creditUsed: 0, amount: price });
      }
      const common = {
        sessionId: stay?.id ?? null,
        endsAt,
        status: "ACTIVE",
        startedBy: by,
        note,
        ...pay,
      };
      const row = input.kind === "LAUNDRY"
        ? await tx.laundrySess.create({
            data: { ...common, machineId: input.id, durationMinutes: minutes, programId: program?.id ?? null, programName: program?.name ?? null },
          })
        : await tx.showerSess.create({ data: { ...common, showerId: input.id, minutesPaid: minutes } });

      if (isDeskPayMethod(method)) {
        const payment = await tx.payment.create({
          data: {
            amount: price,
            method,
            kind: "SERVICE",
            note: `${device.name}${detail} — startet fra skranken${note ? `: ${note}` : ""}`,
            createdBy: by,
          },
        });
        if (input.kind === "LAUNDRY") await tx.laundrySess.update({ where: { id: row.id }, data: { deskPaymentId: payment.id } });
        else await tx.showerSess.update({ where: { id: row.id }, data: { deskPaymentId: payment.id } });
      }
    });
  } catch (e) {
    try { await hardware.setSwitch(ep, false); } catch { /* device timer still ends it */ }
    if (e instanceof InsufficientFunds) return { ok: false, message: "Gæstens saldo er for lav — intet er startet" };
    logger.error(input.kind === "LAUNDRY" ? "laundry" : "shower", `${device.name}: start fra skranken kunne ikke gemmes`, e);
    return { ok: false, message: "Starten kunne ikke gemmes — maskinen er slukket igen. Prøv igen." };
  }

  const how =
    method === "FREE" ? "gratis"
      : method === "STAY" ? (stay!.billingMode === "PREPAID" ? `${kr(price)} trukket fra saldo (${stay!.unitName})` : `${kr(price)} på regningen (${stay!.unitName})`)
      : `${kr(price)} ${PAY_METHOD_LABELS[method].toLowerCase()}`;
  logger.info(
    input.kind === "LAUNDRY" ? "laundry" : "shower",
    `${device.name}${detail} startet fra skranken af ${by ?? "?"} — ${how}${note ? ` (${note})` : ""}`,
  );
  return { ok: true, message: `${device.name} startet i ${minutes} min — ${how}` };
}

/** Admin "+ minutter" on a running shower; re-arms the valve's auto-off. Free of charge. */
export async function adminExtendShower(showerSessionId: number, extraMinutes: number): Promise<Result> {
  const auth = await requireAuth();
  const extra = Math.round(Number(extraMinutes));
  if (!Number.isFinite(extra) || extra < 1 || extra > 120) return { ok: false, message: "Ugyldigt antal minutter" };
  const sess = await prisma.showerSess.findUnique({ where: { id: showerSessionId }, include: { shower: true } });
  if (!sess || (sess.status !== "ACTIVE" && sess.status !== "PAUSED")) return { ok: false, message: "Badet er ikke i gang" };

  if (sess.status === "PAUSED") {
    // Paused: the valve is closed; resuming re-arms it with the new total.
    const res = await prisma.showerSess.updateMany({
      where: { id: sess.id, status: "PAUSED" },
      data: { pauseRemainingMs: (sess.pauseRemainingMs ?? 0) + extra * 60_000, minutesPaid: sess.minutesPaid + extra },
    });
    if (res.count === 0) return { ok: false, message: "Badet er ikke længere på pause — prøv igen" };
  } else {
    const base = Math.max(Date.now(), sess.endsAt.getTime());
    const newEndsAt = new Date(base + extra * 60_000);
    const remainingSec = Math.ceil((newEndsAt.getTime() - Date.now()) / 1000);
    try {
      await hardware.setSwitchTimed(hardware.switchRowEp(sess.shower), remainingSec + 60);
    } catch (e) {
      return { ok: false, message: `Kunne ikke forlænge — ${sess.shower.name} svarede ikke (${e instanceof Error ? e.message : "offline?"}). Sluttiden er uændret.` };
    }
    await prisma.showerSess.updateMany({
      where: { id: sess.id, status: "ACTIVE" },
      data: { endsAt: newEndsAt, minutesPaid: sess.minutesPaid + extra },
    });
  }
  logger.info("shower", `${sess.shower.name} (shower:${sess.id}) forlænget ${extra} min af ${auth.username ?? "?"}`);
  return { ok: true, message: `${sess.shower.name} forlænget med ${extra} minutter` };
}

// ──────────────────────────────────────────────
// "Annullér og refundér"
// ──────────────────────────────────────────────
export async function cancelServiceUse(
  kind: ServiceKind,
  id: number,
  reason: string,
  choice: RefundChoice | null,
): Promise<Result> {
  const auth = await requireAuth();
  if (kind !== "LAUNDRY" && kind !== "SHOWER") return { ok: false, message: "Ukendt service" };
  if (choice !== null && choice !== "NONE" && !DESK_PAY_METHODS.includes(choice)) {
    return { ok: false, message: "Ugyldig refusionsmetode" };
  }
  return cancelAndRefundService(kind, id, { reason: String(reason ?? ""), choice, by: auth.username ?? null });
}

// ──────────────────────────────────────────────
// History
// ──────────────────────────────────────────────
const CHANNEL_LABELS: Record<ServiceChannel, string> = {
  DESK: "Skranken",
  CARD: "Kort (online)",
  BALANCE: "Fra saldo",
  ACCOUNT: "På regning",
  INVOICED: "Faktureret",
  CREDIT: "Servicekredit",
  FREE: "Gratis",
  UNVERIFIED: "Ingen betaling registreret",
  UNPAID: "Ikke betalt",
};

export async function getServiceHistory(opts: { days?: number; kind?: "ALL" | ServiceKind } = {}) {
  await requireAuth();
  const days = [1, 7, 30].includes(Number(opts.days)) ? Number(opts.days) : 7;
  const kind = opts.kind === "LAUNDRY" || opts.kind === "SHOWER" ? opts.kind : "ALL";
  const today = startOfToday();
  const since = days === 1 ? today : new Date(today.getTime() - (days - 1) * 86_400_000);
  // Card payments abandoned on the payment page never started anything.
  const notAbandoned = { NOT: { status: "CANCELLED", cancelledAt: null, paymentStatus: "UNPAID" } };

  const [laundry, showers, deskPayments] = await Promise.all([
    kind === "SHOWER" ? [] : prisma.laundrySess.findMany({
      where: { startedAt: { gte: since }, status: { not: "PENDING" }, ...notAbandoned },
      include: { machine: { select: { name: true, kind: true } }, session: staySelect },
      orderBy: { startedAt: "desc" },
      take: 500,
    }),
    kind === "LAUNDRY" ? [] : prisma.showerSess.findMany({
      where: { startedAt: { gte: since }, status: { not: "PENDING" }, ...notAbandoned },
      include: { shower: { select: { name: true } }, session: staySelect },
      orderBy: { startedAt: "desc" },
      take: 500,
    }),
    prisma.payment.findMany({
      where: { kind: "SERVICE", createdAt: { gte: today } },
      select: { amount: true, method: true },
    }),
  ]);

  const now = new Date();
  type Row = {
    key: string;
    kind: ServiceKind;
    id: number;
    startedAt: string;
    label: string;
    detail: string | null;
    source: string;
    stayId: number | null;
    guestName: string | null;
    unitName: string | null;
    amount: number;
    creditUsed: number;
    channel: ServiceChannel;
    payment: { label: string; tone: ServiceTone };
    state: string;
    note: string | null;
    cancel: { at: string; by: string | null; reason: string | null } | null;
    refund: RefundPlan;
  };

  const rows: Row[] = [
    ...laundry.map((l): Row => {
      const metered = l.billingMode === "METERED";
      const running = l.status === "ACTIVE" && (metered || l.endsAt > now);
      return {
        key: `laundry-${l.id}`,
        kind: "LAUNDRY",
        id: l.id,
        startedAt: l.startedAt.toISOString(),
        label: l.machine.name,
        detail: metered ? `Målt · ${l.billedMinutes.toFixed(0)} min` : l.programName || (l.durationMinutes ? `${l.durationMinutes} min` : null),
        source: sourceLabel(l),
        ...stayFields(l.session),
        amount: metered && l.status === "ACTIVE" ? l.reservedAmount ?? 0 : l.pricePaid,
        creditUsed: l.creditUsed,
        channel: serviceChannel(l),
        payment: servicePaymentBadge(l),
        state: l.cancelledAt || l.status === "CANCELLED" ? "Annulleret" : running ? "Kører" : "Færdig",
        note: l.note,
        cancel: l.cancelledAt ? { at: l.cancelledAt.toISOString(), by: l.cancelledBy, reason: l.cancelReason } : null,
        refund: refundPlan(l, { stayActive: l.session?.status === "ACTIVE" }),
      };
    }),
    ...showers.map((s): Row => {
      const running = (s.status === "ACTIVE" && s.endsAt > now) || s.status === "PAUSED";
      return {
        key: `shower-${s.id}`,
        kind: "SHOWER",
        id: s.id,
        startedAt: s.startedAt.toISOString(),
        label: s.shower.name,
        detail: s.minutesPaid ? `${s.minutesPaid} min` : null,
        source: sourceLabel(s),
        ...stayFields(s.session),
        amount: s.pricePaid,
        creditUsed: s.creditUsed,
        channel: serviceChannel(s),
        payment: servicePaymentBadge(s),
        state: s.cancelledAt || s.status === "CANCELLED" ? "Annulleret" : running ? (s.status === "PAUSED" ? "Pause" : "Kører") : "Færdig",
        note: s.note,
        cancel: s.cancelledAt ? { at: s.cancelledAt.toISOString(), by: s.cancelledBy, reason: s.cancelReason } : null,
        refund: refundPlan(s, { stayActive: s.session?.status === "ACTIVE" }),
      };
    }),
  ].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  // Today: money at the desk (starts, credit sold, refunds) per method, plus
  // what went through the other channels.
  const desk = DESK_PAY_METHODS.map((m) => {
    const ps = deskPayments.filter((p) => p.method === m);
    return {
      method: m,
      label: PAY_METHOD_LABELS[m],
      total: Math.round(ps.reduce((s, p) => s + p.amount, 0) * 100) / 100,
      refunded: Math.round(ps.filter((p) => p.amount < 0).reduce((s, p) => s - p.amount, 0) * 100) / 100,
      count: ps.length,
    };
  });
  const todayKey = today.toISOString();
  const todayRows = rows.filter((r) => r.startedAt >= todayKey && !r.cancel && r.state !== "Annulleret");
  const otherChannels: ServiceChannel[] = ["BALANCE", "ACCOUNT", "CARD", "CREDIT", "FREE", "UNVERIFIED"];
  const other = otherChannels
    .map((c) => {
      const rs = todayRows.filter((r) => r.channel === c);
      const total = c === "CREDIT" ? 0 : rs.reduce((s, r) => s + r.amount, 0);
      return { channel: c, label: CHANNEL_LABELS[c], count: rs.length, total: Math.round(total * 100) / 100 };
    })
    .filter((x) => x.count > 0);
  const creditToday = Math.round(todayRows.reduce((s, r) => s + r.creditUsed, 0) * 100) / 100;

  return {
    days,
    kind,
    rows,
    today: {
      desk,
      deskTotal: Math.round(desk.reduce((s, d) => s + d.total, 0) * 100) / 100,
      other,
      creditUsed: creditToday,
      uses: todayRows.length,
    },
  };
}

// ──────────────────────────────────────────────
// Service credit ledger
// ──────────────────────────────────────────────
const CREDIT_REASON_LABELS: Record<string, string> = {
  SALE: "Købt",
  COMPENSATION: "Kompensation",
  REMOVED: "Fjernet",
  USED: "Brugt",
  REFUNDED: "Ført tilbage",
};

export async function getServiceCreditHistory(sessionId: number) {
  await requireAuth();
  const entries = await prisma.serviceCreditEntry.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return entries.map((e) => ({
    id: e.id,
    at: e.createdAt.toISOString(),
    amount: e.amount,
    reason: CREDIT_REASON_LABELS[e.reason] ?? e.reason,
    method: e.method ? PAY_METHOD_LABELS[e.method] ?? e.method : null,
    note: e.note,
    by: e.createdBy,
  }));
}

/**
 * Add service credit (laundry and showers) to a stay. Sold credit records the
 * desk payment; compensation needs a reason. Either way it's in the ledger.
 */
export async function addServiceCredit(sessionId: number, amount: number, source: CreditSource, note?: string): Promise<Result> {
  const auth = await requireAuth();
  const value = Math.round(Number(amount) * 100) / 100;
  const text = note?.trim() || null;
  if (!Number.isFinite(value) || value <= 0) return { ok: false, message: "Beløb skal være positivt" };
  if (source !== "COMPENSATION" && !isDeskPayMethod(source)) return { ok: false, message: "Vælg betaling eller kompensation" };
  if (source === "COMPENSATION" && !text) return { ok: false, message: "Skriv hvorfor gæsten får kompensation" };
  const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { unit: { select: { name: true, type: true } } } });
  if (!session) return { ok: false, message: "Booking ikke fundet" };
  const by = auth.username ?? null;
  const stayLabel = `${unitDisplayName(session.unit.type, session.unit.name)} · ${session.guestName}`;

  await prisma.$transaction(async (tx) => {
    let paymentId: number | null = null;
    if (source !== "COMPENSATION") {
      const p = await tx.payment.create({
        data: {
          amount: value,
          method: source,
          kind: "SERVICE",
          note: `Servicekredit · ${stayLabel}${text ? `: ${text}` : ""}`,
          createdBy: by,
        },
      });
      paymentId = p.id;
    }
    await tx.session.update({ where: { id: sessionId }, data: { laundryCredit: { increment: value } } });
    await tx.serviceCreditEntry.create({
      data: {
        sessionId,
        amount: value,
        reason: source === "COMPENSATION" ? "COMPENSATION" : "SALE",
        method: source === "COMPENSATION" ? null : source,
        note: text,
        paymentId,
        createdBy: by,
      },
    });
  });
  logger.info("laundry", `Servicekredit +${value.toFixed(2)} DKK på ophold ${sessionId} af ${by ?? "?"} (${source}${text ? `: ${text}` : ""})`);
  return { ok: true, message: `${kr(value)} kredit tilføjet${source === "COMPENSATION" ? " som kompensation" : ` — ${PAY_METHOD_LABELS[source].toLowerCase()} registreret`}` };
}

/** Correct (remove) credit. A correction, not a payout — no money is recorded. */
export async function removeServiceCredit(sessionId: number, amount: number, note?: string): Promise<Result> {
  const auth = await requireAuth();
  const value = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(value) || value <= 0) return { ok: false, message: "Beløb skal være positivt" };
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { laundryCredit: true } });
  if (!session) return { ok: false, message: "Booking ikke fundet" };
  const removed = Math.min(session.laundryCredit, value);
  if (removed <= 0) return { ok: false, message: "Der er ingen kredit at fjerne" };

  const by = auth.username ?? null;
  try {
    await prisma.$transaction(async (tx) => {
      const res = await tx.session.updateMany({
        where: { id: sessionId, laundryCredit: { gte: removed } },
        data: { laundryCredit: { decrement: removed } },
      });
      if (res.count === 0) throw new InsufficientFunds();
      await tx.serviceCreditEntry.create({
        data: { sessionId, amount: -removed, reason: "REMOVED", note: note?.trim() || null, createdBy: by },
      });
    });
  } catch (e) {
    if (e instanceof InsufficientFunds) return { ok: false, message: "Kreditten er ændret imens — prøv igen" };
    throw e;
  }
  logger.info("laundry", `Servicekredit −${removed.toFixed(2)} DKK på ophold ${sessionId} af ${by ?? "?"}${note ? ` (${note})` : ""}`);
  return { ok: true, message: `${kr(removed)} kredit fjernet` };
}
