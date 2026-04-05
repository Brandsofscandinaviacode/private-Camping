import { notFound } from "next/navigation";
import { getSessionByToken, getUnitByPortalToken, getActiveSession, getLiveConsumption } from "@/lib/actions";
import { GuestPortalClient } from "@/components/guest/guest-portal-client";

export const dynamic = "force-dynamic";

export default async function GuestPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Try session-based token first
  const session = await getSessionByToken(token);
  if (session) {
    const hw = session.unit.hardware;
    return (
      <GuestPortalClient
        token={token}
        sessionId={session.id}
        guestName={session.guestName}
        unitName={session.unit.name}
        status={session.status}
        checkInTime={session.checkInTime.toISOString()}
        checkOutTime={session.checkOutTime?.toISOString() ?? null}
        hasClimate={hw?.hasClimate ?? false}
        hasSmartLock={hw?.hasSmartLock ?? false}
        hasElectricity={hw?.hasElectricity ?? false}
        hasWater={hw?.hasWater ?? false}
        totalElectricityCost={session.totalElectricityCost}
        totalWaterCost={session.totalWaterCost}
        totalCost={session.totalCost}
        externalPrice={session.externalPrice}
        externalDescription={session.externalDescription}
        paymentStatus={session.paymentStatus}
        isLongTerm={false}
        invoices={[]}
      />
    );
  }

  // Try long-term portal token
  const unit = await getUnitByPortalToken(token);
  if (unit) {
    const activeSession = await getActiveSession(unit.id);
    const hw = unit.hardware;

    return (
      <GuestPortalClient
        token={token}
        sessionId={activeSession?.id ?? null}
        guestName={unit.longTermGuestName || "Lejer"}
        unitName={unit.name}
        status={activeSession?.status ?? "ACTIVE"}
        checkInTime={activeSession?.checkInTime?.toISOString() ?? new Date().toISOString()}
        checkOutTime={null}
        hasClimate={hw?.hasClimate ?? false}
        hasSmartLock={hw?.hasSmartLock ?? false}
        hasElectricity={hw?.hasElectricity ?? false}
        hasWater={hw?.hasWater ?? false}
        totalElectricityCost={null}
        totalWaterCost={null}
        totalCost={null}
        externalPrice={null}
        externalDescription={null}
        paymentStatus="UNPAID"
        isLongTerm={true}
        invoices={unit.invoices.map((inv) => ({
          id: inv.id,
          periodStart: inv.periodStart.toISOString(),
          periodEnd: inv.periodEnd.toISOString(),
          electricityCost: inv.electricityCost,
          waterCost: inv.waterCost,
          totalAmount: inv.totalAmount,
          status: inv.status,
          paymentToken: inv.paymentToken,
        }))}
      />
    );
  }

  notFound();
}
