import Link from "next/link";
import { isReservationExpired, isStayOverdue } from "@/lib/booking-status";
import { getAllSessions, getBookingListCounts, getUnpaidCount } from "@/lib/actions";
import { BOOKING_MAX_LIMIT, BOOKING_PAGE_SIZE, BOOKING_SEARCH_SCAN, bookingListUrl, parseBookingListFilter, parseBookingListLimit } from "@/lib/booking-list";
import { fmtDate, fmtRelativeDay, siteDayKey } from "@/lib/format";
import { getBookingAttentionCounts } from "@/lib/dashboard-actions";
import { BookingFilters } from "@/components/admin/booking-filters";
import { Calendar, ChevronRight, ArrowRight } from "lucide-react";
import { unitDisplayName } from "@/lib/utils";
import { PageShell, PageHeader, Surface, EmptyState, StatusBadge, bookingTone } from "@/components/admin/admin-ui";

export const dynamic = "force-dynamic";

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; limit?: string }>;
}) {
  const { filter, q, limit: limitParam } = await searchParams;
  const activeFilter = parseBookingListFilter(filter);
  const limit = parseBookingListLimit(limitParam);
  const searchQuery = q?.trim() || "";
  const [{ sessions, total, searchCapped }, unpaidCount, attention, counts] = await Promise.all([
    getAllSessions(activeFilter, searchQuery || undefined, limit),
    getUnpaidCount(),
    getBookingAttentionCounts(),
    getBookingListCounts(),
  ]);
  const now = new Date();
  const today = siteDayKey(now);

  // Left accent colour by status (matches the badge tone)
  const accent: Record<string, string> = {
    red: "border-l-red-500",
    amber: "border-l-amber-500",
    blue: "border-l-blue-500",
    emerald: "border-l-transparent",
    muted: "border-l-transparent",
  };

  return (
    <PageShell width="5xl">
      <PageHeader
        title="Bookinger"
        icon={Calendar}
        subtitle={
          <>
            <b className="text-foreground font-semibold">{total}</b> {total === 1 ? "booking" : "bookinger"}
            {searchQuery && <> matcher &quot;{searchQuery}&quot;</>}
            {unpaidCount > 0 && <span className="text-red-600 font-medium"> · {unpaidCount} afventer betaling</span>}
          </>
        }
      />

      <BookingFilters activeFilter={activeFilter} unpaidCount={unpaidCount} arrivedCount={attention.arrived} overdueCount={attention.overdue} counts={counts} searchQuery={searchQuery} />

      {sessions.length === 0 ? (
        <Surface className="py-4">
          <EmptyState icon={Calendar} title="Ingen bookinger fundet" hint="Prøv et andet filter eller søgeord" />
          {searchQuery && activeFilter !== "all" && (
            <p className="-mt-10 pb-6 text-center text-sm">
              <Link href={bookingListUrl({ filter: "all", q: searchQuery })} className="text-primary hover:underline">Søg i alle bookinger</Link>
            </p>
          )}
        </Surface>
      ) : (
        <Surface className="divide-y divide-border/60 overflow-hidden">
          {sessions.map((s) => {
            const expired = isReservationExpired(s, now);
            const overdue = isStayOverdue(s, now);
            const { tone, label, pulse } = bookingTone(s.status, s.paymentStatus, { expired, overdue });
            // El/vand so far — zero (and hidden) on units without meters
            const running = s.status === "ACTIVE" ? s.accumulatedElCost + s.accumulatedWaterCost : 0;
            return (
              <Link key={s.id} href={`/admin/bookings/${s.id}`} aria-label={`${s.guestName}${label ? ` — ${label}` : ""}`}>
                <div className={`flex items-center justify-between gap-4 px-5 py-4 hover:bg-muted/40 transition-all cursor-pointer border-l-[3px] ${accent[tone]}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate">{s.guestName}</span>
                      {s.bookingRef && (
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded shrink-0">{s.bookingRef}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mt-0.5">
                      <span className="truncate">{unitDisplayName(s.unit.type, s.unit.name)}</span>
                      <span className="opacity-30">·</span>
                      <span className="shrink-0">{fmtDate(s.checkInTime)}</span>
                      {(s.checkOutTime || s.expectedCheckOut) && <ArrowRight className="h-3 w-3 opacity-40 shrink-0" />}
                      {s.checkOutTime ? (
                        <span className="shrink-0">{fmtDate(s.checkOutTime)}</span>
                      ) : s.expectedCheckOut && !expired ? (
                        <span className={`shrink-0 ${overdue ? "text-red-600 font-medium" : s.status === "ACTIVE" && siteDayKey(s.expectedCheckOut) === today ? "text-amber-600 font-medium" : ""}`}>
                          Afrejse {fmtRelativeDay(s.expectedCheckOut, now)}
                        </span>
                      ) : s.expectedCheckOut ? (
                        <span className="shrink-0">{fmtDate(s.expectedCheckOut)}</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {s.totalCost !== null ? (
                      <span className="text-sm tabular-nums font-semibold">
                        {s.totalCost.toFixed(2)} <span className="text-muted-foreground font-normal">DKK</span>
                      </span>
                    ) : running > 0 && (
                      <span className="text-right leading-tight" title="El og vand indtil nu">
                        <span className="block text-sm tabular-nums font-semibold">
                          {running.toFixed(2)} <span className="text-muted-foreground font-normal">DKK</span>
                        </span>
                        <span className="block text-[11px] text-muted-foreground">el/vand indtil nu</span>
                      </span>
                    )}
                    {label && <StatusBadge tone={tone} pulse={pulse}>{label}</StatusBadge>}
                    <ChevronRight className="h-4 w-4 text-muted-foreground/30" />
                  </div>
                </div>
              </Link>
            );
          })}
        </Surface>
      )}

      {total > BOOKING_PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
          <span>
            {sessions.length < total ? <>Viser <b className="text-foreground">{sessions.length}</b> af {total}</> : <>Viser alle {total}</>}
          </span>
          {sessions.length < total && (limit < BOOKING_MAX_LIMIT ? (
            <Link
              href={bookingListUrl({ filter: activeFilter, q: searchQuery, limit: limit + BOOKING_PAGE_SIZE })}
              scroll={false}
              className="font-medium text-foreground px-3 py-2 rounded-lg border border-border bg-card hover:border-foreground/20 transition"
            >
              Vis {Math.min(BOOKING_PAGE_SIZE, total - sessions.length)} flere
            </Link>
          ) : (
            <span>Brug søgning eller filtre for at finde resten</span>
          ))}
        </div>
      )}
      {searchCapped && (
        <p className="text-center text-xs text-muted-foreground">Søgningen dækker de nyeste {BOOKING_SEARCH_SCAN.toLocaleString("da-DK")} ophold.</p>
      )}
    </PageShell>
  );
}
