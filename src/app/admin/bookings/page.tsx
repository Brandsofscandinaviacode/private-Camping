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

const typeLabels: Record<string, string> = { CABIN: "Hytte", SEASONAL: "Fastligger", CARAVAN: "Vogn", PITCH: "Plads" };

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
    <div className="p-4 sm:p-6 lg:p-10 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bookinger</h1>
        <p className="text-muted-foreground mt-1">
          {sessions.length} bookinger
          {unpaidCount > 0 && (
            <span className="text-red-500 ml-2">
              &middot; {unpaidCount} afventer betaling
            </span>
          )}
        </p>
      </div>

      <BookingFilters activeFilter={activeFilter} unpaidCount={unpaidCount} />

      {sessions.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Calendar className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>Ingen bookinger fundet</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 bg-card shadow-sm divide-y divide-border/60 overflow-hidden">
          {sessions.map((s) => {
            const isActive = s.status === "ACTIVE";
            const isUnpaid = s.status === "COMPLETED" && s.paymentStatus === "UNPAID";
            const isPaid = s.paymentStatus === "PAID";

            return (
              <Link key={s.id} href={`/admin/bookings/${s.id}`}>
                <div className={`flex items-center justify-between gap-4 px-5 py-4 hover:bg-muted/40 transition-all cursor-pointer ${
                  isUnpaid ? "border-l-[3px] border-l-red-500" :
                  isActive ? "border-l-[3px] border-l-primary" : ""
                }`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.guestName}</span>
                      {s.bookingRef && (
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                          {s.bookingRef}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mt-0.5">
                      <span>{typeLabels[s.unit.type] || s.unit.type} {s.unit.name}</span>
                      <span className="opacity-30">&middot;</span>
                      <span>{new Date(s.checkInTime).toLocaleDateString("da-DK")}</span>
                      {s.checkOutTime && (
                        <>
                          <span className="opacity-30">&rarr;</span>
                          <span>{new Date(s.checkOutTime).toLocaleDateString("da-DK")}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {s.totalCost !== null && (
                      <span className="text-sm tabular-nums font-medium">
                        {s.totalCost.toFixed(2)} <span className="text-muted-foreground">DKK</span>
                      </span>
                    )}
                    {isActive && (
                      <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                        Aktiv
                      </span>
                    )}
                    {isUnpaid && (
                      <span className="text-xs px-2.5 py-1 rounded-full bg-red-50 text-red-600 font-medium inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                        Ubetalt
                      </span>
                    )}
                    {isPaid && (
                      <span className="text-xs px-2.5 py-1 rounded-full bg-green-50 text-green-600 font-medium inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
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
