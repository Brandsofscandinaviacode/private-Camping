import { notFound } from "next/navigation";
import { getSessionByToken, getUnitByPortalToken, getActiveSession, getLiveConsumption, getGlobalSettings } from "@/lib/actions";
import { GuestPortalClient } from "@/components/guest/guest-portal-client";

export const dynamic = "force-dynamic";

export default async function GuestPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const globalSettings = await getGlobalSettings();
  const quickpayEnabled = globalSettings.quickpay_enabled === "true";
  const siteMapUrl = globalSettings.site_map_url || null;

  // Try session-based token first
  const session = await getSessionByToken(token);
  if (session) {
    const hw = session.unit.hardware;
    const typeKey = session.unit.type.toLowerCase();
    const practicalInfo = {
      da: globalSettings[`practical_info_${typeKey}_da`] || globalSettings[`practical_info_${typeKey}`] || null,
      en: globalSettings[`practical_info_${typeKey}_en`] || null,
      de: globalSettings[`practical_info_${typeKey}_de`] || null,
    };
    return (
      <GuestPortalClient
        token={token}
        sessionId={session.id}
        guestName={session.guestName}
        unitName={session.unit.name}
        status={session.status}
        checkInTime={session.checkInTime.toISOString()}
        checkOutTime={session.checkOutTime?.toISOString() ?? null}
        expectedCheckOut={session.expectedCheckOut?.toISOString() ?? null}
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
        quickpayEnabled={quickpayEnabled}
        unitType={session.unit.type}
        practicalInfo={practicalInfo}
        siteMapUrl={siteMapUrl}
      />
    );
  }

  // Try long-term portal token
  const unit = await getUnitByPortalToken(token);
  if (unit) {
    const activeSession = await getActiveSession(unit.id);
    const hw = unit.hardware;
    const typeKey = unit.type.toLowerCase();
    const practicalInfo = {
      da: globalSettings[`practical_info_${typeKey}_da`] || globalSettings[`practical_info_${typeKey}`] || null,
      en: globalSettings[`practical_info_${typeKey}_en`] || null,
      de: globalSettings[`practical_info_${typeKey}_de`] || null,
    };

    return (
      <GuestPortalClient
        token={token}
        sessionId={activeSession?.id ?? null}
        guestName={unit.longTermGuestName || "Lejer"}
        unitName={unit.name}
        status={activeSession?.status ?? "ACTIVE"}
        checkInTime={activeSession?.checkInTime?.toISOString() ?? new Date().toISOString()}
        checkOutTime={null}
        expectedCheckOut={null}
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
        quickpayEnabled={quickpayEnabled}
        unitType={unit.type}
        practicalInfo={practicalInfo}
        siteMapUrl={siteMapUrl}
      />
    );
  }

  notFound();
}
