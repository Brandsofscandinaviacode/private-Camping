import Link from "next/link";
import { getAllSessions, getUnpaidCount } from "@/lib/actions";
import { BookingFilters } from "@/components/admin/booking-filters";
import { Calendar, ChevronRight, ArrowRight } from "lucide-react";
import { unitDisplayName } from "@/lib/utils";
import { PageShell, PageHeader, Surface, EmptyState, StatusBadge, bookingTone } from "@/components/admin/admin-ui";

export const dynamic = "force-dynamic";

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const { filter, q } = await searchParams;
  const activeFilter = (filter as "all" | "unpaid" | "paid" | "active" | "pending") || "all";
  const searchQuery = q?.trim() || "";
  const [sessions, unpaidCount] = await Promise.all([
    getAllSessions(activeFilter, searchQuery || undefined),
    getUnpaidCount(),
  ]);

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
            <b className="text-foreground font-semibold">{sessions.length}</b> bookinger
            {unpaidCount > 0 && <span className="text-red-600 font-medium"> · {unpaidCount} afventer betaling</span>}
          </>
        }
      />

      <BookingFilters activeFilter={activeFilter} unpaidCount={unpaidCount} searchQuery={searchQuery} />

      {sessions.length === 0 ? (
        <Surface className="py-4">
          <EmptyState icon={Calendar} title="Ingen bookinger fundet" hint="Prøv et andet filter eller søgeord" />
        </Surface>
      ) : (
        <Surface className="divide-y divide-border/60 overflow-hidden">
          {sessions.map((s) => {
            const { tone, label, pulse } = bookingTone(s.status, s.paymentStatus);
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
                      <span className="shrink-0">{new Date(s.checkInTime).toLocaleDateString("da-DK")}</span>
                      {s.checkOutTime && (
                        <>
                          <ArrowRight className="h-3 w-3 opacity-40 shrink-0" />
                          <span className="shrink-0">{new Date(s.checkOutTime).toLocaleDateString("da-DK")}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {s.totalCost !== null && (
                      <span className="text-sm tabular-nums font-semibold">
                        {s.totalCost.toFixed(2)} <span className="text-muted-foreground font-normal">DKK</span>
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
    </PageShell>
  );
}
