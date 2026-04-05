import Link from "next/link";
import { getAllSessions, getUnpaidCount } from "@/lib/actions";
import { BookingFilters } from "@/components/admin/booking-filters";
import {
  AlertCircle,
  Calendar,
  CreditCard,
  ChevronRight,
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
    <div className="p-6 lg:p-8 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-lg font-semibold">Bookinger</h1>
        <p className="text-muted-foreground text-xs mt-0.5">
          {sessions.length} bookinger
          {unpaidCount > 0 && (
            <span className="text-destructive ml-1.5">
              &middot; {unpaidCount} afventer betaling
            </span>
          )}
        </p>
      </div>

      {/* Filter tabs */}
      <BookingFilters activeFilter={activeFilter} unpaidCount={unpaidCount} />

      {/* Booking list */}
      {sessions.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Calendar className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Ingen bookinger fundet</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card divide-y divide-border">
          {sessions.map((s) => {
            const isActive = s.status === "ACTIVE";
            const isUnpaid = s.status === "COMPLETED" && s.paymentStatus === "UNPAID";
            const isPaid = s.paymentStatus === "PAID";

            return (
              <Link key={s.id} href={`/admin/bookings/${s.id}`}>
                <div className={`flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent/40 transition-colors cursor-pointer ${
                  isUnpaid ? "border-l-2 border-l-destructive" :
                  isActive ? "border-l-2 border-l-primary" : ""
                }`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{s.guestName}</span>
                      {s.bookingRef && (
                        <span className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {s.bookingRef}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                      <span>{s.unit.name}</span>
                      <span className="opacity-40">&middot;</span>
                      <span>{typeLabels[s.unit.type] || s.unit.type}</span>
                      <span className="opacity-40">&middot;</span>
                      <span>{new Date(s.checkInTime).toLocaleDateString("da-DK")}</span>
                      {s.checkOutTime && (
                        <>
                          <span className="opacity-40">&rarr;</span>
                          <span>{new Date(s.checkOutTime).toLocaleDateString("da-DK")}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {s.totalCost !== null && (
                      <span className="text-sm tabular-nums">
                        {s.totalCost.toFixed(2)} <span className="text-muted-foreground text-xs">DKK</span>
                      </span>
                    )}
                    {isActive && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">Aktiv</span>
                    )}
                    {isUnpaid && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Ubetalt
                      </span>
                    )}
                    {isPaid && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary flex items-center gap-1">
                        <CreditCard className="h-3 w-3" />
                        Betalt
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground/30" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
