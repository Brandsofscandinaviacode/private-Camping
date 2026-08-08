import { prisma } from "./prisma";

/**
 * The total a guest has ever deposited on a prepaid stay (initial + top-ups).
 *
 * Reads the prepaidDeposited field; for sessions created before that field
 * existed it reconstructs a best effort: current balance plus everything drawn
 * from it by services (PREPAID purchases and active metered reservations).
 * Shared by server actions and the QuickPay callback — deliberately NOT a
 * server action itself (no auth check; callers guard access).
 */
export async function resolvePrepaidDeposited(session: {
  id: number;
  prepaidAmount: number | null;
  prepaidDeposited: number | null;
}): Promise<number> {
  if (session.prepaidDeposited != null) return session.prepaidDeposited;
  const [laundry, showers, active] = await Promise.all([
    prisma.laundrySess.aggregate({
      where: { sessionId: session.id, paymentStatus: "PREPAID", status: { not: "ACTIVE" } },
      _sum: { pricePaid: true },
    }),
    prisma.showerSess.aggregate({
      where: { sessionId: session.id, paymentStatus: "PREPAID" },
      _sum: { pricePaid: true },
    }),
    // Active sessions: a metered wash drew its reservation; a fixed-price one
    // drew its price. Coalesce per row, so fetch instead of aggregate.
    prisma.laundrySess.findMany({
      where: { sessionId: session.id, paymentStatus: "PREPAID", status: "ACTIVE" },
      select: { reservedAmount: true, pricePaid: true, billingMode: true },
    }),
  ]);
  const activeDrawn = active.reduce(
    (sum, l) => sum + (l.billingMode === "METERED" ? (l.reservedAmount ?? 0) : l.pricePaid),
    0,
  );
  const drawn = (laundry._sum.pricePaid ?? 0) + (showers._sum.pricePaid ?? 0) + activeDrawn;
  return (session.prepaidAmount ?? 0) + drawn;
}
