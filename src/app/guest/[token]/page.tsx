import { notFound } from "next/navigation";
import { getSessionByToken, getUnitByPortalToken, getActiveSession, getGlobalSettings, getGuestLaundryMachines, getGuestShowers } from "@/lib/actions";
import { prisma } from "@/lib/prisma";
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
  const invoiceDay = globalSettings.invoice_email_day ? parseInt(globalSettings.invoice_email_day, 10) || null : null;

  // Try session-based token first
  const [laundryMachines, showers] = await Promise.all([
    getGuestLaundryMachines(),
    getGuestShowers(),
  ]);

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

    // If this is a fastligger, load invoices too
    const isFastligger = session.unit.isLongTerm;
    const invoices = isFastligger
      ? await prisma.invoice.findMany({
          where: { unitId: session.unitId },
          orderBy: { periodEnd: "desc" },
          take: 12,
        })
      : [];

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
        billingMode={(session.billingMode as "PREPAID" | "POSTPAID") || "POSTPAID"}
        prepaidAmount={session.prepaidAmount}
        isLongTerm={isFastligger}
        invoices={invoices.map((inv) => ({
          id: inv.id,
          periodStart: inv.periodStart.toISOString(),
          periodEnd: inv.periodEnd.toISOString(),
          startKwh: inv.startKwh,
          endKwh: inv.endKwh,
          startWaterLiters: inv.startWaterLiters,
          endWaterLiters: inv.endWaterLiters,
          electricityCost: inv.electricityCost,
          waterCost: inv.waterCost,
          totalAmount: inv.totalAmount,
          status: inv.status,
          paymentToken: inv.paymentToken,
        }))}
        quickpayEnabled={quickpayEnabled}
        unitType={session.unit.type}
        practicalInfo={practicalInfo}
        siteMapUrl={siteMapUrl}
        laundryMachines={laundryMachines}
        showers={showers}
        laundryCredit={session.laundryCredit ?? 0}
        nextInvoiceDay={isFastligger ? invoiceDay : null}
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
          startKwh: inv.startKwh,
          endKwh: inv.endKwh,
          startWaterLiters: inv.startWaterLiters,
          endWaterLiters: inv.endWaterLiters,
          electricityCost: inv.electricityCost,
          waterCost: inv.waterCost,
          totalAmount: inv.totalAmount,
          status: inv.status,
          paymentToken: inv.paymentToken,
        }))}
        billingMode="POSTPAID"
        prepaidAmount={null}
        quickpayEnabled={quickpayEnabled}
        unitType={unit.type}
        practicalInfo={practicalInfo}
        siteMapUrl={siteMapUrl}
        laundryMachines={laundryMachines}
        showers={showers}
        laundryCredit={activeSession?.laundryCredit ?? 0}
        nextInvoiceDay={invoiceDay}
      />
    );
  }

  notFound();
}
