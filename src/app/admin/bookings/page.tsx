import Link from "next/link";
import { getAllSessions, getUnpaidCount } from "@/lib/actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookingFilters } from "@/components/admin/booking-filters";
import {
  AlertCircle,
  Calendar,
  CreditCard,
  ExternalLink,
} from "lucide-react";

export const dynamic = "force-dynamic";

const typeLabels: Record<string, string> = { CABIN: "Hytte", CARAVAN: "Vogn", PITCH: "Plads" };

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const activeFilter = (filter as "all" | "unpaid" | "paid" | "active") || "all";
  const [sessions, unpaidCount] = await Promise.all([
    getAllSessions(activeFilter),
    getUnpaidCount(),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bookinger</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {sessions.length} bookinger
            {unpaidCount > 0 && (
              <span className="text-destructive ml-2">
                — {unpaidCount} afventer betaling
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <BookingFilters activeFilter={activeFilter} unpaidCount={unpaidCount} />

      {/* Booking list */}
      {sessions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Calendar className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p>Ingen bookinger fundet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => {
            const isActive = s.status === "ACTIVE";
            const isUnpaid = s.status === "COMPLETED" && s.paymentStatus === "UNPAID";
            const isPaid = s.paymentStatus === "PAID";

            return (
              <Link key={s.id} href={`/admin/bookings/${s.id}`}>
                <Card className={`hover:border-primary/30 transition-colors cursor-pointer ${
                  isUnpaid ? "border-l-4 border-l-destructive" :
                  isActive ? "border-l-4 border-l-primary" :
                  isPaid ? "border-l-4 border-l-primary/30" : ""
                }`}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{s.guestName}</span>
                            {s.bookingRef && (
                              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                {s.bookingRef}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                            <span>{s.unit.name}</span>
                            <span className="opacity-50">·</span>
                            <span>{typeLabels[s.unit.type] || s.unit.type}</span>
                            <span className="opacity-50">·</span>
                            <span>{new Date(s.checkInTime).toLocaleDateString("da-DK")}</span>
                            {s.checkOutTime && (
                              <>
                                <span>→</span>
                                <span>{new Date(s.checkOutTime).toLocaleDateString("da-DK")}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {s.totalCost !== null && (
                          <span className="text-sm font-semibold">
                            {s.totalCost.toFixed(2)} DKK
                          </span>
                        )}
                        {isActive && (
                          <Badge className="bg-primary/20 text-primary border-primary/30">Aktiv</Badge>
                        )}
                        {isUnpaid && (
                          <Badge variant="destructive" className="bg-destructive/20 text-destructive border-destructive/30">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            Ubetalt
                          </Badge>
                        )}
                        {isPaid && (
                          <Badge className="bg-primary/20 text-primary border-primary/30">
                            <CreditCard className="h-3 w-3 mr-1" />
                            Betalt
                          </Badge>
                        )}
                        <ExternalLink className="h-4 w-4 text-muted-foreground/50" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
