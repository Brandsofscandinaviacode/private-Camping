import { CloudOff, GitCompareArrows } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { isReservationExpired } from "@/lib/booking-status";
import { bookingSystemLabel } from "@/lib/booking/sync";
import {
  SYNC_FIELDS,
  SYNC_FIELD_LABELS,
  currentSyncValues,
  formatSyncValue,
  parseSyncValues,
  syncFieldMode,
  type SyncField,
  type SyncValue,
} from "@/lib/booking/sync-merge";
import { fmtDateTime } from "@/lib/format";
import { SyncConflictButtons } from "./booking-sync-actions";

interface SyncedStay {
  id: number;
  status: string;
  unitId: number;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  checkInTime: Date;
  expectedCheckOut: Date | null;
  externalBookingId: string | null;
  syncConflicts: string | null;
  missingFromFeedAt: Date | null;
  cancelledAt: Date | null;
}

/** Differences the desk still has to decide on, in display order. */
function openConflicts(s: Pick<SyncedStay, "status" | "syncConflicts" | "cancelledAt">): Array<[SyncField, SyncValue]> {
  if (s.cancelledAt || !s.syncConflicts) return [];
  const c = parseSyncValues(s.syncConflicts);
  return SYNC_FIELDS.filter((f) => c[f] !== undefined && syncFieldMode(s.status, f) !== "ignore").map((f) => [f, c[f]!]);
}

function isMissingFromFeed(s: Pick<SyncedStay, "status" | "missingFromFeedAt" | "cancelledAt" | "checkInTime" | "expectedCheckOut">): boolean {
  return s.status === "PENDING" && !s.cancelledAt && !!s.missingFromFeedAt && !isReservationExpired(s);
}

/**
 * Booking page: "Ikke længere i Danplanner", and every field where the
 * booking system now says something else than the desk entered —
 * "Danplanner siger: … [Brug den] [Behold min]".
 */
export async function BookingSyncNotice({ session }: { session: SyncedStay }) {
  const conflicts = openConflicts(session);
  const missing = isMissingFromFeed(session);
  if (!missing && conflicts.length === 0) return null;

  const system = bookingSystemLabel(session.externalBookingId);
  const current = currentSyncValues(session);
  const unitIds = conflicts.filter(([f]) => f === "unitId").map(([, v]) => Number(v)).concat(session.unitId);
  const unitNames = conflicts.some(([f]) => f === "unitId")
    ? new Map((await prisma.unit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
    : undefined;

  return (
    <div className="space-y-3">
      {missing && (
        <div className="rounded-xl border border-amber-200/60 bg-amber-50/60 dark:bg-amber-500/10 dark:border-amber-500/30 shadow-sm p-4 flex gap-3">
          <CloudOff className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-300">Ikke længere i {system}</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              Siden {fmtDateTime(session.missingFromFeedAt)} står reservationen ikke på {system}s gæsteliste. Den kan være
              aflyst, flyttet eller tjekket ud dér — tjek {system}, før du tjekker gæsten ind.
            </p>
          </div>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="rounded-xl border border-amber-200/60 bg-amber-50/60 dark:bg-amber-500/10 dark:border-amber-500/30 shadow-sm">
          <div className="px-4 pt-3 pb-2 flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-amber-600 shrink-0" />
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              {system} har ændret oplysninger, som er rettet her
            </p>
          </div>
          <div className="divide-y divide-amber-200/60 dark:divide-amber-500/20">
            {conflicts.map(([field, value]) => (
              <div key={field} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
                <div className="min-w-0">
                  <span className="text-muted-foreground">{SYNC_FIELD_LABELS[field]}:</span>{" "}
                  {system} siger <b className="font-semibold break-all">{formatSyncValue(field, value, unitNames)}</b>
                  <span className="text-muted-foreground">
                    {" "}· her: {current[field] !== undefined ? formatSyncValue(field, current[field]!, unitNames) : "—"}
                  </span>
                </div>
                <SyncConflictButtons sessionId={session.id} field={field} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Bookings list: small badges next to the guest's name. */
export function BookingSyncBadges({ session }: { session: SyncedStay }) {
  const missing = isMissingFromFeed(session);
  const conflicts = openConflicts(session).length;
  if (!missing && conflicts === 0) return null;
  const system = bookingSystemLabel(session.externalBookingId);
  return (
    <>
      {missing && (
        <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 shrink-0">
          Ikke længere i {system}
        </span>
      )}
      {conflicts > 0 && (
        <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 shrink-0">
          {system} har ændringer
        </span>
      )}
    </>
  );
}
