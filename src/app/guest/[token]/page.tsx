import { notFound } from "next/navigation";
import { getSessionByToken } from "@/lib/actions";
import { GuestPortalClient } from "@/components/guest/guest-portal-client";

export const dynamic = "force-dynamic";

export default async function GuestPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getSessionByToken(token);

  if (!session) notFound();

  const hw = session.cabin.hardware;

  return (
    <GuestPortalClient
      token={token}
      sessionId={session.id}
      guestName={session.guestName}
      cabinName={session.cabin.name}
      status={session.status}
      checkInTime={session.checkInTime.toISOString()}
      checkOutTime={session.checkOutTime?.toISOString() ?? null}
      hasClimate={hw?.hasClimate ?? false}
      hasSmartLock={hw?.hasSmartLock ?? false}
      hasElectricity={hw?.hasElectricity ?? false}
      hasWater={hw?.hasWater ?? false}
      // Completed session final costs
      totalElectricityCost={session.totalElectricityCost}
      totalWaterCost={session.totalWaterCost}
      totalCost={session.totalCost}
    />
  );
}
