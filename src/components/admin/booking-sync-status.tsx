import Link from "next/link";
import { AlertTriangle, CalendarSync } from "lucide-react";
import { readBookingSyncStatus } from "@/lib/booking/sync";
import { fmtRelativeDay, fmtTime } from "@/lib/format";
import { AutoRefresh } from "./auto-refresh";
import { BookingSyncNowButton } from "./booking-sync-actions";

/** "18.38", or "i går 18.38" / "14. okt. 18.38" when not today. */
function when(iso: string): string {
  const day = fmtRelativeDay(iso);
  return day === "i dag" ? fmtTime(iso) : `${day} ${fmtTime(iso)}`;
}

const SETTINGS_HREF = "/admin/settings?tab=booking";

/**
 * One-line booking-sync status for the dashboard and the bookings list:
 * "Danplanner: hentet 18.38 · 34 gæster · Hent nu". Red when the last run
 * failed, a login is waiting for 2FA, or nothing has been fetched for well
 * over two sync intervals. Also keeps the page fresh while it stays open.
 */
export async function BookingSyncStatus({ className = "" }: { className?: string }) {
  const st = await readBookingSyncStatus().catch(() => null);
  const refresh = <AutoRefresh />;
  if (!st?.configured) return refresh;

  const failed = !!st.lastStatus?.startsWith("fejl");
  const stale = st.stale;
  const red = st.awaitingTwoFactor || failed || stale;
  const name = st.providerLabel;

  let text: React.ReactNode;
  if (st.awaitingTwoFactor) {
    text = <>{name} venter på godkendelse (2FA) — gæster hentes ikke</>;
  } else if (failed) {
    text = (
      <span title={st.lastStatus ?? undefined}>
        {name}: hentning fejlede{st.lastRunAt ? ` ${when(st.lastRunAt)}` : ""}
        {st.lastOkAt && <> · sidst hentet {when(st.lastOkAt)}</>}
      </span>
    );
  } else if (!st.lastOkAt) {
    text = <>{name}: endnu ikke hentet</>;
  } else {
    text = (
      <>
        {name}: {stale ? "ikke hentet siden" : "hentet"} {when(st.lastOkAt)}
        {st.lastCount != null && <> · {st.lastCount} {st.lastCount === 1 ? "gæst" : "gæster"}</>}
        {!st.autoSync && <> · automatisk hentning slået fra</>}
      </>
    );
  }

  const Icon = red ? AlertTriangle : CalendarSync;
  return (
    <>
      {refresh}
      <div
        className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs ${
          red ? "w-fit rounded-lg bg-red-500/10 text-red-600 px-2.5 py-1.5" : "text-muted-foreground"
        } ${className}`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span>{text}</span>
        {st.conflicts > 0 && (
          <>
            <span className="opacity-40">·</span>
            <Link href="/admin/bookings" className="text-amber-600 font-medium hover:underline underline-offset-2">
              {st.conflicts} {st.conflicts === 1 ? "booking" : "bookinger"} med forskelle
            </Link>
          </>
        )}
        {st.missing > 0 && (
          <>
            <span className="opacity-40">·</span>
            <Link href="/admin/bookings?filter=arrived" className="text-amber-600 font-medium hover:underline underline-offset-2">
              {st.missing} ikke længere i {name}
            </Link>
          </>
        )}
        <span className="opacity-40">·</span>
        {st.awaitingTwoFactor ? (
          <Link href={SETTINGS_HREF} className="font-medium underline-offset-2 hover:underline">Åbn indstillinger</Link>
        ) : (
          <>
            <BookingSyncNowButton label={failed ? "Prøv igen" : "Hent nu"} />
            {red && (
              <>
                <span className="opacity-40">·</span>
                <Link href={SETTINGS_HREF} className="font-medium underline-offset-2 hover:underline">Indstillinger</Link>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
