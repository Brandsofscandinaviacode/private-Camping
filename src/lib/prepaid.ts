import { prisma } from "./prisma";
import * as hardware from "./hardware";

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

/**
 * After a top-up or admin adjustment: if a PREPAID stay had its electricity
 * cut by checkPrepaidBalances and the balance now covers consumption again,
 * turn the relay back on. Without this the guest pays and stays in the dark
 * until an admin notices. Returns true if the relay was switched on.
 */
export async function restorePrepaidPowerIfFunded(sessionId: number): Promise<boolean> {
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { unit: { include: { hardware: true } } },
  });
  if (!s || s.status !== "ACTIVE" || s.billingMode !== "PREPAID") return false;
  const hw = s.unit.hardware;
  if (!hardware.hasElectricitySwitch(hw)) return false;
  const remaining = (s.prepaidAmount ?? 0) - s.accumulatedElCost - s.accumulatedWaterCost;
  if (remaining <= 0) return false;
  try {
    await hardware.setSwitch(hardware.electricitySwitchEp(hw!), true);
    return true;
  } catch {
    return false;
  }
}

/**
 * What a PREPAID stay owes beyond its balance. prepaidAmount already has every
 * service draw taken off, so only el/water remain to set against it. Used by
 * checkout (to decide PAID vs UNPAID), the card payment link, and the QuickPay
 * callback's amount check, so all three agree on the figure the guest sees.
 */
export function prepaidShortfall(session: {
  prepaidAmount: number | null;
  totalElectricityCost: number | null;
  totalWaterCost: number | null;
}): number {
  const due = (session.totalElectricityCost ?? 0) + (session.totalWaterCost ?? 0) - (session.prepaidAmount ?? 0);
  return due > 0 ? Math.round(due * 100) / 100 : 0;
}
