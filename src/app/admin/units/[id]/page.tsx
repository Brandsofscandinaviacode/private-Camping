import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const typeLabels: Record<string, string> = { CABIN: "Hytte", CARAVAN: "Campingvogn", PITCH: "Plads" };

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
    <div className="p-6 lg:p-8 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/admin">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Tilbage
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{unit.name}</h1>
            <Badge variant={isOccupied ? "default" : "secondary"}
              className={isOccupied ? "bg-primary/20 text-primary border-primary/30" : ""}>
              {isOccupied ? "Optaget" : "Ledig"}
            </Badge>
            <span className="text-xs px-2 py-1 rounded bg-accent text-accent-foreground">
              {typeLabels[unit.type]}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Actions & Guest Info */}
        <div className="space-y-4">
          {/* Short-term: Check-in / Check-out */}
          {!isOccupied && !unit.isLongTerm ? (
            <CheckInDialog unitId={unit.id} unitName={unit.name} />
          ) : activeSession ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Aktuel gæst</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Navn:</span>
                  <span className="font-medium">{activeSession.guestName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Check-in:</span>
                  <span>{new Date(activeSession.checkInTime).toLocaleString("da-DK")}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Gæsteportal:</span>
                  <CopyButton text={`/guest/${activeSession.guestPortalToken}`} label="Kopiér link" />
                </div>
                <Separator />
                <CheckOutDialog
                  sessionId={activeSession.id}
                  guestName={activeSession.guestName}
                  unitName={unit.name}
                />
              </CardContent>
            </Card>
          ) : null}

          {/* Long-term tenant info */}
          {unit.isLongTerm && unit.longTermGuestName && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Langtidslejer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Navn:</span>
                  <span className="font-medium">{unit.longTermGuestName}</span>
                </div>
                {unit.longTermGuestEmail && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Email:</span>
                    <span>{unit.longTermGuestEmail}</span>
                  </div>
                )}
                {unit.longTermGuestPhone && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Telefon:</span>
                    <span>{unit.longTermGuestPhone}</span>
                  </div>
                )}
                {unit.longTermPortalToken && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Portal:</span>
                    <CopyButton text={`/guest/${unit.longTermPortalToken}`} label="Kopiér link" />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Live Consumption */}
          {activeSession && <LiveConsumption sessionId={activeSession.id} />}

          {/* Monthly invoicing for long-term */}
          {unit.isLongTerm && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Månedlige fakturaer</CardTitle>
                <CreateInvoiceButton unitId={unit.id} />
              </CardHeader>
              <CardContent>
                {unit.invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ingen fakturaer endnu</p>
                ) : (
                  <div className="space-y-2">
                    {unit.invoices.map((inv) => (
                      <div key={inv.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 text-sm">
                        <div>
                          <span className="font-medium">
                            {new Date(inv.periodStart).toLocaleDateString("da-DK", { month: "long", year: "numeric" })}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-bold">{inv.totalAmount.toFixed(2)} DKK</span>
                          <Badge
                            variant={inv.status === "PAID" ? "default" : "secondary"}
                            className={
                              inv.status === "PAID" ? "bg-primary/20 text-primary" :
                              inv.status === "OVERDUE" ? "bg-destructive/20 text-destructive" : ""
                            }
                          >
                            {inv.status === "DRAFT" ? "Kladde" :
                             inv.status === "PENDING" ? "Afventer" :
                             inv.status === "PAID" ? "Betalt" : "Forfalden"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Hardware Controls */}
        <div className="space-y-4">
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
            <Card>
              <CardContent className="py-6 text-center text-muted-foreground">
                <p>Ingen hardware konfigureret</p>
                <Link href="/admin/settings">
                  <Button variant="link" size="sm">Konfigurér i Indstillinger</Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Session History */}
      {completedSessions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Seneste ophold</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Gæst</th>
                    <th className="pb-2 pr-4">Check-in</th>
                    <th className="pb-2 pr-4">Check-out</th>
                    <th className="pb-2 pr-4 text-right">El</th>
                    <th className="pb-2 pr-4 text-right">Vand</th>
                    <th className="pb-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {completedSessions.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{s.guestName}</td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {new Date(s.checkInTime).toLocaleDateString("da-DK")}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {s.checkOutTime ? new Date(s.checkOutTime).toLocaleDateString("da-DK") : "—"}
                      </td>
                      <td className="py-2 pr-4 text-right">{s.totalElectricityCost?.toFixed(2) ?? "—"} DKK</td>
                      <td className="py-2 pr-4 text-right">{s.totalWaterCost?.toFixed(2) ?? "—"} DKK</td>
                      <td className="py-2 text-right font-medium">{s.totalCost?.toFixed(2) ?? "—"} DKK</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
