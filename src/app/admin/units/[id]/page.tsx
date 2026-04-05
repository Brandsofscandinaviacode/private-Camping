import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Anchor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  getUnitWithDetails,
  getUnitHAStates,
  getActiveSession,
} from "@/lib/actions";
import { CheckInDialog } from "@/components/admin/check-in-dialog";
import { CheckOutDialog } from "@/components/admin/check-out-dialog";
import { CabinControls } from "@/components/admin/cabin-controls";
import { LiveConsumption } from "@/components/admin/live-consumption";
import { CopyButton } from "@/components/admin/copy-button";
import { CreateInvoiceButton } from "@/components/admin/create-invoice-button";

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

  const [haStates, activeSession] = await Promise.all([
    getUnitHAStates(unitId).catch(() => null),
    getActiveSession(unitId),
  ]);

  const isOccupied = unit.status === "OCCUPIED";
  const hw = unit.hardware;
  const completedSessions = unit.sessions.filter((s) => s.status === "COMPLETED");

  return (
    <div className="p-8 lg:p-10 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{typeLabels[unit.type]} {unit.name}</h1>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
              isOccupied ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            }`}>
              {isOccupied ? "Optaget" : "Ledig"}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Actions & Guest Info */}
        <div className="space-y-5">
          {/* Short-term: Check-in / Check-out */}
          {!isOccupied && !unit.isLongTerm ? (
            <CheckInDialog unitId={unit.id} unitName={`${typeLabels[unit.type]} ${unit.name}`} />
          ) : activeSession ? (
            <div className="rounded-xl border bg-card shadow-sm">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="font-semibold">Aktuel gæst</h2>
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
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Gæsteportal</span>
                  <CopyButton text={`/guest/${activeSession.guestPortalToken}`} label="Kopiér link" />
                </div>
                <Separator />
                <CheckOutDialog
                  sessionId={activeSession.id}
                  guestName={activeSession.guestName}
                  unitName={`${typeLabels[unit.type]} ${unit.name}`}
                />
              </div>
            </div>
          ) : null}

          {/* Long-term tenant info */}
          {unit.isLongTerm && unit.longTermGuestName && (
            <div className="rounded-xl border bg-card shadow-sm">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="font-semibold">Langtidslejer</h2>
              </div>
              <div className="p-5 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Navn</span>
                  <span className="font-medium">{unit.longTermGuestName}</span>
                </div>
                {unit.longTermGuestEmail && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Email</span>
                    <span>{unit.longTermGuestEmail}</span>
                  </div>
                )}
                {unit.longTermGuestPhone && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Telefon</span>
                    <span>{unit.longTermGuestPhone}</span>
                  </div>
                )}
                {unit.longTermPortalToken && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Portal</span>
                    <CopyButton text={`/guest/${unit.longTermPortalToken}`} label="Kopiér link" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Live Consumption */}
          {activeSession && <LiveConsumption sessionId={activeSession.id} />}

          {/* Monthly invoicing for long-term */}
          {unit.isLongTerm && (
            <div className="rounded-xl border bg-card shadow-sm">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h2 className="font-semibold">Månedlige fakturaer</h2>
                <CreateInvoiceButton unitId={unit.id} />
              </div>
              <div className="p-5">
                {unit.invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ingen fakturaer endnu</p>
                ) : (
                  <div className="space-y-2">
                    {unit.invoices.map((inv) => (
                      <div key={inv.id} className="flex items-center justify-between py-2.5 px-4 rounded-lg bg-muted/50 text-sm">
                        <span className="font-medium">
                          {new Date(inv.periodStart).toLocaleDateString("da-DK", { month: "long", year: "numeric" })}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="tabular-nums">{inv.totalAmount.toFixed(2)} DKK</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            inv.status === "PAID" ? "bg-green-50 text-green-600" :
                            inv.status === "OVERDUE" ? "bg-red-50 text-red-600" :
                            "bg-muted text-muted-foreground"
                          }`}>
                            {inv.status === "DRAFT" ? "Kladde" :
                             inv.status === "PENDING" ? "Afventer" :
                             inv.status === "PAID" ? "Betalt" : "Forfalden"}
                          </span>
                        </div>
                      </div>
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
                hasWater: hw.hasWater,
                hasClimate: hw.hasClimate,
                hasSmartLock: hw.hasSmartLock,
              }}
              haStates={haStates}
            />
          )}
          {!hw && (
            <div className="rounded-xl border bg-card shadow-sm p-8 text-center">
              <p className="text-muted-foreground">Ingen hardware konfigureret</p>
              <Link href="/admin/settings">
                <Button variant="link" className="mt-2">Konfigurér i Indstillinger</Button>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Session History */}
      {completedSessions.length > 0 && (
        <div className="rounded-xl border bg-card shadow-sm">
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
                </tr>
              </thead>
              <tbody>
                {completedSessions.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-3">{s.guestName}</td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {new Date(s.checkInTime).toLocaleDateString("da-DK")}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {s.checkOutTime ? new Date(s.checkOutTime).toLocaleDateString("da-DK") : "—"}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{s.totalElectricityCost?.toFixed(2) ?? "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{s.totalWaterCost?.toFixed(2) ?? "—"}</td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums">{s.totalCost?.toFixed(2) ?? "—"} DKK</td>
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
