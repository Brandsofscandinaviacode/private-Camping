import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  getUnitWithDetails,
  getUnitHAStates,
  getActiveSession,
  getGlobalSettings,
} from "@/lib/actions";
import { CheckInDialog } from "@/components/admin/check-in-dialog";
import { CheckOutDialog } from "@/components/admin/check-out-dialog";
import { CabinControls } from "@/components/admin/cabin-controls";
import { LiveConsumption } from "@/components/admin/live-consumption";
import { CopyButton } from "@/components/admin/copy-button";
import { CreateInvoiceButton } from "@/components/admin/create-invoice-button";
import { DeleteUnitButton } from "@/components/admin/delete-unit-button";
import { InvoiceRow } from "@/components/admin/invoice-row";
import { ConsumptionChart } from "@/components/admin/consumption-chart";

export const dynamic = "force-dynamic";

const typeLabels: Record<string, string> = { CABIN: "Hytte", SEASONAL: "Fastligger", CARAVAN: "Campingvogn", PITCH: "Plads" };

export default async function UnitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const unitId = parseInt(id, 10);
  if (isNaN(unitId)) notFound();

  const unit = await getUnitWithDetails(unitId);
  if (!unit) notFound();

  const [haStates, activeSession, globalSettings] = await Promise.all([
    getUnitHAStates(unitId).catch(() => null),
    getActiveSession(unitId),
    getGlobalSettings(),
  ]);
  const autoPowerOff = globalSettings.auto_power_off_on_checkout === "true";

  const isOccupied = unit.status === "OCCUPIED";
  const hw = unit.hardware;
  const completedSessions = unit.sessions.filter((s) => s.status === "COMPLETED");
  const unitDisplayName = `${typeLabels[unit.type]} ${unit.name}`;

  return (
    <div className="p-4 sm:p-6 lg:p-10 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{unitDisplayName}</h1>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                isOccupied ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}>
                {isOccupied ? "Optaget" : "Ledig"}
              </span>
            </div>
          </div>
        </div>
        <DeleteUnitButton unitId={unit.id} unitName={unitDisplayName} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Actions & Guest Info */}
        <div className="space-y-5">
          {/* Check-in / Check-out — works for all unit types */}
          {!isOccupied && !activeSession ? (
            <CheckInDialog unitId={unit.id} unitName={unitDisplayName} />
          ) : activeSession ? (
            <div className="rounded-xl border border-border/60 bg-card shadow-sm">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h2 className="font-semibold">Aktuel gæst</h2>
                <Link href={`/admin/bookings/${activeSession.id}`}>
                  <Button variant="outline" size="sm">
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    Se booking
                  </Button>
                </Link>
              </div>
              <div className="p-5 space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Navn</span>
                  <span className="font-medium">{activeSession.guestName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Check-in</span>
                  <span>{new Date(activeSession.checkInTime).toLocaleString("da-DK")}</span>
                </div>
                {activeSession.expectedCheckOut && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Forventet checkout</span>
                    <span>{new Date(activeSession.expectedCheckOut).toLocaleDateString("da-DK")}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Gæsteportal</span>
                  <CopyButton text={`/guest/${activeSession.guestPortalToken}`} label="Kopiér link" />
                </div>
                <Separator />
                <CheckOutDialog
                  sessionId={activeSession.id}
                  guestName={activeSession.guestName}
                  unitName={unitDisplayName}
                  autoPowerOff={autoPowerOff}
                />
              </div>
            </div>
          ) : null}

          {/* Live Consumption */}
          {activeSession && <LiveConsumption sessionId={activeSession.id} />}

          {/* Consumption Trends */}
          <div className="rounded-xl border border-border/60 bg-card shadow-sm">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="font-semibold">Forbrugstrend</h2>
            </div>
            <div className="p-5">
              <ConsumptionChart unitId={unit.id} />
            </div>
          </div>

          {/* Monthly invoicing for long-term */}
          {unit.isLongTerm && (
            <div className="rounded-xl border border-border/60 bg-card shadow-sm">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h2 className="font-semibold">Månedlige fakturaer</h2>
                {unit.longTermGuestName && <CreateInvoiceButton unitId={unit.id} />}
              </div>
              <div className="p-5">
                {unit.invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ingen fakturaer endnu</p>
                ) : (
                  <div className="space-y-2">
                    {unit.invoices.map((inv) => (
                      <InvoiceRow key={inv.id} invoice={inv} unitId={unit.id} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Hardware Controls */}
        <div className="space-y-5">
          {hw && (
            <CabinControls
              unitId={unit.id}
              hardware={{
                hasElectricity: hw.hasElectricity,
                hasHeating: hw.hasHeating,
                hasWater: hw.hasWater,
                hasClimate: hw.hasClimate,
                hasSmartLock: hw.hasSmartLock,
              }}
              haStates={haStates}
            />
          )}
          {!hw && (
            <div className="rounded-xl border border-border/60 bg-card shadow-sm p-8 text-center">
              <p className="text-muted-foreground">Ingen hardware konfigureret</p>
              <Link href="/admin/settings">
                <Button variant="link" className="mt-2">Konfigurér i Indstillinger</Button>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Session History — clickable rows */}
      {completedSessions.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card shadow-sm">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="font-semibold">Seneste ophold</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Gæst</th>
                  <th className="px-5 py-3 font-medium">Check-in</th>
                  <th className="px-5 py-3 font-medium">Check-out</th>
                  <th className="px-5 py-3 font-medium text-right">El</th>
                  <th className="px-5 py-3 font-medium text-right">Vand</th>
                  <th className="px-5 py-3 font-medium text-right">Total</th>
                  <th className="px-5 py-3 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {completedSessions.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-3">
                      <Link href={`/admin/bookings/${s.id}`} className="text-primary hover:underline">
                        {s.guestName}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {new Date(s.checkInTime).toLocaleDateString("da-DK")}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {s.checkOutTime ? new Date(s.checkOutTime).toLocaleDateString("da-DK") : "—"}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{s.totalElectricityCost?.toFixed(2) ?? "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{s.totalWaterCost?.toFixed(2) ?? "—"}</td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums">{s.totalCost?.toFixed(2) ?? "—"} DKK</td>
                    <td className="px-5 py-3 text-right">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        s.paymentStatus === "PAID" ? "bg-green-50 text-green-600" :
                        "bg-red-50 text-red-600"
                      }`}>
                        {s.paymentStatus === "PAID" ? "Betalt" : "Ubetalt"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
