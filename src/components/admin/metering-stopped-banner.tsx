import Link from "next/link";
import { WifiOff } from "lucide-react";
import { fmtShortDate, fmtTime, siteDayKey } from "@/lib/format";
import { fmtAge } from "@/lib/unit-state";
import type { StoppedMeteringStay } from "@/lib/metering-actions";

const MAX_ROWS = 6;

/** "kl. 09.44" today, otherwise "13. sep. kl. 11.26". */
function when(iso: string): string {
  const sameDay = siteDayKey(iso) === siteDayKey(new Date());
  return sameDay ? `kl. ${fmtTime(iso)}` : `${fmtShortDate(iso)} kl. ${fmtTime(iso)}`;
}

/**
 * Dashboard alert: checked-in stays on metered units that haven't been read
 * for a while. Same look as the other dashboard alerts; each stay links to
 * its booking, where the frozen balance lives.
 */
export function MeteringStoppedBanner({ stays }: { stays: StoppedMeteringStay[] }) {
  if (stays.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-4 py-3">
      <div className="flex items-center gap-3.5">
        <div className="h-9 w-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
          <WifiOff className="h-[18px] w-[18px] text-amber-600" />
        </div>
        <p className="text-sm text-amber-800 flex-1">
          <span className="font-bold">Måling stoppet for {stays.length} ophold</span> — forbruget aflæses ikke, så saldo og beløb står stille, og forbrug efter sidste aflæsning kommer ikke med ved udtjek
        </p>
      </div>
      <ul className="mt-2 sm:ml-[50px] divide-y divide-amber-200/60">
        {stays.slice(0, MAX_ROWS).map((s) => {
          const ref = s.lastReadingAt ?? s.checkInTime;
          return (
            <li key={s.sessionId}>
              <Link href={`/admin/bookings/${s.sessionId}`} className="block py-1.5 hover:bg-amber-100/60 rounded-md -mx-1.5 px-1.5 transition-colors">
                <p className="text-[13px] text-amber-900">
                  <span className="font-semibold">{s.unitName}</span> · {s.guestName} ·{" "}
                  {s.lastReadingAt
                    ? <>sidst aflæst {when(ref)} ({fmtAge(s.ageMs)} siden)</>
                    : <>ingen aflæsning siden check-in {when(ref)}</>}
                </p>
                {s.reason && <p className="text-xs text-amber-700/80 line-clamp-2">{s.reason}</p>}
              </Link>
            </li>
          );
        })}
      </ul>
      {stays.length > MAX_ROWS && (
        <Link href="/admin/bookings?filter=active" className="mt-1 sm:ml-[50px] inline-block text-xs font-medium text-amber-700 hover:underline">
          + {stays.length - MAX_ROWS} flere — se aktive ophold
        </Link>
      )}
    </div>
  );
}
