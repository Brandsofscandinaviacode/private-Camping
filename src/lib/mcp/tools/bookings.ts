// Booking (ophold) and invoice tools. Guest contact details are masked and
// portal/payment tokens and QuickPay ids are never returned.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { openReservationWhere } from "@/lib/booking-status";
import { getSessionCharges } from "@/lib/actions";
import { prepaidShortfall, resolvePrepaidDeposited } from "@/lib/prepaid";
import { scrubText } from "@/lib/mcp/redact";
import {
  ToolError,
  elWaterCost,
  expiredReservationWhere,
  registerReadOnlyTool,
  secondsSince,
  sessionSummary,
} from "@/lib/mcp/tools/common";

const SESSION_FILTERS = ["ACTIVE", "RESERVED", "EXPIRED_RESERVATION", "COMPLETED", "ALL"] as const;

function sessionWhere(filter: (typeof SESSION_FILTERS)[number], now: Date): Prisma.SessionWhereInput {
  switch (filter) {
    case "ACTIVE":
      return { status: "ACTIVE" };
    case "RESERVED":
      return openReservationWhere(now);
    case "EXPIRED_RESERVATION":
      return expiredReservationWhere(now);
    case "COMPLETED":
      return { status: "COMPLETED" };
    default:
      return {};
  }
}

const unitSelect = { select: { id: true, name: true, type: true } } as const;

export function registerBookingTools(server: McpServer): void {
  registerReadOnlyTool(server, {
    name: "list_sessions",
    title: "List bookings",
    description:
      "Bookings/stays (sessions) with guest name, masked contact, bookingRef, billing mode, accumulated electricity/water use and cost, last billing tick, prepaid balance, " +
      "check-in / expected checkout / checkout. Each row has `state`: ACTIVE, RESERVED (PENDING and the stay has not ended), EXPIRED_RESERVATION " +
      "(PENDING but the planned checkout day has passed without check-in — e.g. a July–August booking seen in October is no longer reserved), " +
      "CANCELLED_RESERVATION (cancelled or marked as no-show at the desk) or COMPLETED. " +
      "RESERVED is listed soonest first, everything else newest first.",
    input: z.object({
      status: z.enum(SESSION_FILTERS).default("ALL"),
      unitId: z.number().int().positive().optional(),
      search: z.string().max(100).optional().describe("Guest name or booking reference contains this text"),
      limit: z.number().int().min(1).max(100).default(25),
    }),
    handler: async ({ status, unitId, search, limit }) => {
      const now = new Date();
      const filters: Prisma.SessionWhereInput[] = [sessionWhere(status, now)];
      if (unitId) filters.push({ unitId });
      if (search?.trim()) {
        filters.push({ OR: [{ guestName: { contains: search.trim() } }, { bookingRef: { contains: search.trim() } }] });
      }
      // AND, not spread: the reservation filters carry their own OR.
      const where: Prisma.SessionWhereInput = { AND: filters };
      const [total, rows] = await Promise.all([
        prisma.session.count({ where }),
        prisma.session.findMany({
          where,
          include: { unit: unitSelect },
          orderBy: { checkInTime: status === "RESERVED" ? "asc" : "desc" },
          take: limit,
        }),
      ]);
      return {
        filter: status,
        total,
        returned: rows.length,
        sessions: rows.map((s) => sessionSummary(s, s.unit)),
      };
    },
  });

  registerReadOnlyTool(server, {
    name: "get_session",
    title: "Booking detail",
    description:
      "Full billing detail of one booking: state, accumulators, start / last-tick / end meter readings, per-booking price overrides, totals, prepaid balance " +
      "(deposited, remaining after el/water, current shortfall), laundry and shower purchases, prepaid top-ups and invoices overlapping the stay (none for a booking that was never checked in).",
    input: z.object({ sessionId: z.number().int().positive().describe("Session (booking) id") }),
    handler: async ({ sessionId }) => {
      const s = await prisma.session.findUnique({ where: { id: sessionId }, include: { unit: unitSelect } });
      if (!s) throw new ToolError(`Session ${sessionId} not found. Use list_sessions to find ids.`);

      const stayEnd = s.checkOutTime ?? new Date();
      const [charges, topUps, invoices, deposited] = await Promise.all([
        getSessionCharges(sessionId),
        prisma.prepaidTopUp.findMany({
          where: { sessionId },
          orderBy: { appliedAt: "asc" },
          select: { amount: true, appliedAt: true },
        }),
        // Invoices belong to the unit. A booking that was never checked in has
        // none of its own — listing the unit's would show other occupants'.
        s.status === "PENDING"
          ? Promise.resolve([])
          : prisma.invoice.findMany({
              where: { unitId: s.unitId, periodEnd: { gte: s.checkInTime }, periodStart: { lte: stayEnd } },
              orderBy: { periodStart: "asc" },
              take: 24,
            }),
        s.billingMode === "PREPAID" ? resolvePrepaidDeposited(s) : Promise.resolve(null),
      ]);

      const { el: elCost, water: waterCost } = elWaterCost(s);

      return {
        ...sessionSummary(s, s.unit),
        // Free text typed by staff — mask any e-mail address in it like elsewhere.
        notes: s.notes ? scrubText(s.notes) : null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        billing: {
          lastTickAt: s.lastTickAt,
          lastTickAgeSeconds: s.status === "ACTIVE" ? secondsSince(s.lastTickAt) : null,
          accumulated: {
            scope: "since last invoice — every invoice drains these (whole stay if never invoiced)",
            elKwh: s.accumulatedElKwh,
            elCost: s.accumulatedElCost,
            waterLiters: s.accumulatedWaterLiters,
            waterCost: s.accumulatedWaterCost,
          },
          readings: {
            start: { kwh: s.startKwh, heatingKwh: s.startHeatingKwh, waterLiters: s.startWaterLiters },
            lastTick: { kwh: s.lastTickKwh, heatingKwh: s.lastTickHeatingKwh, waterLiters: s.lastTickWaterLiters },
            end: { kwh: s.endKwh, heatingKwh: s.endHeatingKwh, waterLiters: s.endWaterLiters },
          },
          overrides: { pricePerKwh: s.pricePerKwhOverride, pricePerLiterWater: s.pricePerLiterWaterOverride },
          totals: { electricity: s.totalElectricityCost, water: s.totalWaterCost, total: s.totalCost },
          external: { price: s.externalPrice, description: s.externalDescription },
          laundryCredit: s.laundryCredit,
        },
        prepaidDetail:
          s.billingMode === "PREPAID"
            ? {
                balance: s.prepaidAmount,
                deposited,
                depositedReconstructed: s.prepaidDeposited == null,
                elWaterCharged: elCost + waterCost,
                remaining: (s.prepaidAmount ?? 0) - elCost - waterCost,
                shortfall: prepaidShortfall({
                  prepaidAmount: s.prepaidAmount,
                  totalElectricityCost: elCost,
                  totalWaterCost: waterCost,
                }),
              }
            : null,
        payment: { status: s.paymentStatus, paidAt: s.paidAt, hasPaymentReference: !!s.paymentId },
        accounting: { syncId: s.accountingSyncId, syncedAt: s.accountingSyncAt },
        services: {
          charges: charges.charges,
          servicesTotal: charges.servicesTotal,
          runningTotal: charges.total,
        },
        topUps,
        invoices: invoices.map((i) => ({
          id: i.id,
          periodStart: i.periodStart,
          periodEnd: i.periodEnd,
          status: i.status,
          totalAmount: i.totalAmount,
          paidAt: i.paidAt,
        })),
      };
    },
  });

  registerReadOnlyTool(server, {
    name: "list_invoices",
    title: "List invoices",
    description:
      "Invoices (mainly monthly invoices for long-term tenants) with period, meter readings, el/water/services cost, total, status (DRAFT, PENDING, PAID, OVERDUE), " +
      "paid date and accounting sync id. Newest period first.",
    input: z.object({
      status: z.enum(["DRAFT", "PENDING", "PAID", "OVERDUE"]).optional(),
      unitId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).default(25),
    }),
    handler: async ({ status, unitId, limit }) => {
      const where: Prisma.InvoiceWhereInput = {
        ...(status ? { status } : {}),
        ...(unitId ? { unitId } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.invoice.count({ where }),
        prisma.invoice.findMany({
          where,
          include: { unit: unitSelect },
          orderBy: [{ periodEnd: "desc" }, { id: "desc" }],
          take: limit,
        }),
      ]);
      return {
        total,
        returned: rows.length,
        invoices: rows.map((i) => ({
          id: i.id,
          unit: i.unit,
          periodStart: i.periodStart,
          periodEnd: i.periodEnd,
          status: i.status,
          readings: {
            kwh: { start: i.startKwh, end: i.endKwh },
            heatingKwh: { start: i.startHeatingKwh, end: i.endHeatingKwh },
            waterLiters: { start: i.startWaterLiters, end: i.endWaterLiters },
          },
          electricityCost: i.electricityCost,
          waterCost: i.waterCost,
          servicesCost: i.servicesCost,
          totalAmount: i.totalAmount,
          paidAt: i.paidAt,
          hasPaymentLink: !!i.paymentToken,
          accountingSyncId: i.accountingSyncId,
          accountingSyncAt: i.accountingSyncAt,
          createdAt: i.createdAt,
        })),
      };
    },
  });
}
