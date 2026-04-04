import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  getCabinWithDetails,
  getCabinHAStates,
  getActiveSession,
} from "@/lib/actions";
import { CheckInDialog } from "@/components/admin/check-in-dialog";
import { CheckOutDialog } from "@/components/admin/check-out-dialog";
import { CabinControls } from "@/components/admin/cabin-controls";
import { LiveConsumption } from "@/components/admin/live-consumption";
import { CopyButton } from "@/components/admin/copy-button";

export const dynamic = "force-dynamic";

export default async function CabinDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cabinId = parseInt(id, 10);
  if (isNaN(cabinId)) notFound();

  const cabin = await getCabinWithDetails(cabinId);
  if (!cabin) notFound();

  const [haStates, activeSession] = await Promise.all([
    getCabinHAStates(cabinId).catch(() => null),
    getActiveSession(cabinId),
  ]);

  const isOccupied = cabin.status === "OCCUPIED";
  const hw = cabin.hardware;

  // Completed sessions for history
  const completedSessions = cabin.sessions.filter(
    (s) => s.status === "COMPLETED"
  );

  return (
    <div className="p-6 space-y-6 max-w-4xl">
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
            <h1 className="text-2xl font-bold">{cabin.name}</h1>
            <Badge variant={isOccupied ? "default" : "secondary"}>
              {isOccupied ? "Optaget" : "Ledig"}
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column: Actions & Guest Info */}
        <div className="space-y-4">
          {/* Check-in / Check-out */}
          {!isOccupied ? (
            <CheckInDialog cabinId={cabin.id} cabinName={cabin.name} />
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
                  <span>
                    {new Date(activeSession.checkInTime).toLocaleString("da-DK")}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Gæsteportal:</span>
                  <CopyButton
                    text={`/guest/${activeSession.guestPortalToken}`}
                    label="Kopiér link"
                  />
                </div>
                <Separator />
                <CheckOutDialog
                  sessionId={activeSession.id}
                  guestName={activeSession.guestName}
                  cabinName={cabin.name}
                />
              </CardContent>
            </Card>
          ) : null}

          {/* Live Consumption */}
          {activeSession && <LiveConsumption sessionId={activeSession.id} />}
        </div>

        {/* Right column: Hardware Controls */}
        <div className="space-y-4">
          {hw && (
            <CabinControls
              cabinId={cabin.id}
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
                  <Button variant="link" size="sm">
                    Konfigurér i Settings
                  </Button>
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
                        {s.checkOutTime
                          ? new Date(s.checkOutTime).toLocaleDateString("da-DK")
                          : "—"}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {s.totalElectricityCost?.toFixed(2) ?? "—"} DKK
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {s.totalWaterCost?.toFixed(2) ?? "—"} DKK
                      </td>
                      <td className="py-2 text-right font-medium">
                        {s.totalCost?.toFixed(2) ?? "—"} DKK
                      </td>
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
