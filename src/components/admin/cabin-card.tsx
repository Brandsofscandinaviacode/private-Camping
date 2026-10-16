"use client";

import Link from "next/link";
import {
  Zap,
  Home,
  Caravan,
  MapPin,
  ChevronRight,
  CalendarClock,
  LogIn,
  WifiOff,
} from "lucide-react";
import { UNIT_STATE, unitStateKey, type UnitStateKey } from "@/lib/unit-state";
import { fmtShortDate, fmtRelativeDay, siteDayKey } from "@/lib/format";

const typeIcons: Record<string, typeof Home> = {
  CABIN: Home,
  SEASONAL: Caravan,
  CARAVAN: Caravan,
  PITCH: MapPin,
};

// ──────────────────────────────────────────────────────────────
// Status palette lives in @/lib/unit-state so the dashboard, the unit page
// and the site map share one set of words and colours:
//   Optaget → blue · Ikke tjekket ind (på pladsen iflg. booking) → amber
//   Reserveret → light amber · Ledig → emerald
// Brand orange (--primary) is reserved for actions/brand only.
// ──────────────────────────────────────────────────────────────
export type UnitStatusKey = UnitStateKey;
export const STATUS = UNIT_STATE;

export function statusKey(status: string, pendingGuestName?: string | null, pendingArrived = false): UnitStatusKey {
  return unitStateKey(status, !!pendingGuestName, pendingArrived);
}

const isToday = (iso: string | null | undefined) => !!iso && siteDayKey(iso) === siteDayKey(new Date());

interface UnitCardProps {
  unit: {
    id: number;
    name: string;
    type: string;
    status: string;
    isLongTerm: boolean;
    longTermGuestName: string | null;
    hardware: {
      hasElectricity: boolean;
      hasWater: boolean;
      hasClimate: boolean;
      hasSmartLock: boolean;
    } | null;
  };
  haStates: {
    powerOn: boolean | null;
    temperature: number | null;
    locked: boolean | null;
    haReachable: boolean;
    offlineReason?: string | null;
  } | null;
  activeGuestName: string | null;
  pendingGuestName?: string | null;
  activeCheckOut?: string | null;
  pendingCheckIn?: string | null;
  pendingCheckOut?: string | null;
  /** The reservation's arrival day has come (computed on the server). */
  pendingArrived?: boolean;
}

/** One short, glanceable meta line — guest-management info, not raw telemetry. */
function metaLine(p: UnitCardProps, st: UnitStatusKey): string {
  if (st === "occ") {
    return p.activeCheckOut ? `Afrejse ${fmtRelativeDay(p.activeCheckOut)}` : "Tjekket ind";
  }
  if (st === "arr") {
    const leaving = isToday(p.pendingCheckOut) ? " · afrejse i dag" : "";
    if (isToday(p.pendingCheckIn)) return `Ankommer i dag${leaving}`;
    return p.pendingCheckIn ? `Ankom ${fmtShortDate(p.pendingCheckIn)} · ikke tjekket ind${leaving}` : "Ikke tjekket ind";
  }
  if (st === "res") {
    return p.pendingCheckIn ? `Ankommer ${fmtRelativeDay(p.pendingCheckIn)}` : "Reserveret";
  }
  return "Klar til check-in";
}

/** Arrival/departure for the list's date column: always prefixed, never ambiguous. */
function dateCell(p: UnitCardProps, st: UnitStatusKey): string {
  if (st === "occ") return p.activeCheckOut ? `Afr. ${fmtRelativeDay(p.activeCheckOut)}` : "—";
  if (st === "arr" || st === "res") return p.pendingCheckIn ? `Ank. ${fmtRelativeDay(p.pendingCheckIn)}` : "—";
  return "—";
}

function OfflineMark({ reason }: { reason: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 shrink-0" title={reason}>
      <WifiOff className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">Hardware svarer ikke: </span>Offline
    </span>
  );
}

export function UnitCardCompact({
  unit,
  activeGuestName,
  pendingGuestName,
  pendingArrived,
}: Pick<UnitCardProps, "unit" | "activeGuestName" | "pendingGuestName" | "pendingArrived">) {
  const st = statusKey(unit.status, pendingGuestName, pendingArrived);
  const s = STATUS[st];
  const displayGuest = activeGuestName || pendingGuestName || unit.longTermGuestName;

  return (
    <Link href={`/admin/units/${unit.id}`} className="h-full block">
      <div className="group relative rounded-lg border border-border/60 bg-card px-3 py-2.5 shadow-sm hover:shadow-md hover:border-foreground/15 transition-all cursor-pointer h-full flex items-center gap-3 overflow-hidden">
        <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${s.accent}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight truncate">{unit.name}</p>
          {displayGuest && st !== "free" && (
            <p className="text-xs text-muted-foreground truncate">{displayGuest}</p>
          )}
          {st === "free" && <p className="text-xs text-muted-foreground/70">Ledig</p>}
        </div>
        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${s.dot}`} title={s.label} />
      </div>
    </Link>
  );
}

export function UnitCard(props: UnitCardProps) {
  const { unit, haStates, activeGuestName, pendingGuestName } = props;
  const st = statusKey(unit.status, pendingGuestName, props.pendingArrived);
  const s = STATUS[st];
  const TypeIcon = typeIcons[unit.type] || Home;
  const displayGuest = activeGuestName || pendingGuestName || unit.longTermGuestName;
  // One optional live signal — only when the hardware answered. When it
  // didn't, a small "Offline" mark says so (only the few metered units).
  const showLive = !!haStates?.haReachable && st === "occ" && haStates?.powerOn !== null;
  const offlineReason = haStates?.offlineReason ?? null;

  return (
    <Link href={`/admin/units/${unit.id}`} className="h-full block">
      <div className={`group relative rounded-xl border border-border/60 bg-card p-4 pl-5 shadow-sm hover:shadow-lg hover:border-foreground/15 transition-all cursor-pointer h-full min-h-[136px] flex flex-col overflow-hidden`}>
        <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${s.accent}`} />

        {/* Header row: icon + status */}
        <div className="flex items-center justify-between mb-3">
          <div className={`h-9 w-9 rounded-[10px] flex items-center justify-center shrink-0 ${st === "occ" ? s.soft : "bg-muted"}`}>
            <TypeIcon className={`h-[18px] w-[18px] ${st === "occ" ? s.text : "text-muted-foreground"}`} />
          </div>
          <span className={`text-xs font-semibold inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${s.soft} ${s.text}`} title={s.label}>
            <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
            {s.short}
          </span>
        </div>

        {/* Name + guest */}
        <p className="text-[15px] font-semibold leading-tight tracking-tight">{unit.name}</p>
        {displayGuest && st !== "free" ? (
          <p className="text-[13px] text-foreground/70 mt-0.5 truncate">{displayGuest}</p>
        ) : (
          <p className="text-[13px] text-muted-foreground/60 mt-0.5">Ingen gæst</p>
        )}

        {/* Footer meta */}
        <div className="mt-auto pt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5 opacity-70 shrink-0" />
          <span className={`truncate ${st === "arr" ? s.text : ""}`}>{metaLine(props, st)}</span>
          {unit.isLongTerm && (
            <span className="ml-auto shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
              Langtid
            </span>
          )}
          {!unit.isLongTerm && offlineReason && (
            <span className="ml-auto"><OfflineMark reason={offlineReason} /></span>
          )}
          {!unit.isLongTerm && !offlineReason && showLive && (
            <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-foreground/60">
              <Zap className={`h-3 w-3 ${haStates?.powerOn ? "text-amber-500" : "text-muted-foreground/40"}`} />
              {haStates?.powerOn ? "Tændt" : "Slukket"}
            </span>
          )}
        </div>
        <ChevronRight className="absolute top-4 right-3 h-4 w-4 text-transparent group-hover:text-foreground/30 transition-colors" />
      </div>
    </Link>
  );
}

// ──────────────────────────────────────────────────────────────
// Dense table row — used for large groups (e.g. 149 Pladser) instead
// of a card wall. Below md it folds into two lines (name on top, status ·
// guest · date below) so a phone never cuts the unit name to "Pl…".
// ──────────────────────────────────────────────────────────────
export const UNIT_ROW_COLS = "md:grid md:grid-cols-[minmax(0,1.4fr)_8.5rem_minmax(0,1.6fr)_8.5rem_auto]";

export function UnitRow(props: UnitCardProps & { type: string }) {
  const { unit, activeGuestName, pendingGuestName, haStates } = props;
  const st = statusKey(unit.status, pendingGuestName, props.pendingArrived);
  const s = STATUS[st];
  const TypeIcon = typeIcons[props.type] || MapPin;
  const displayGuest = activeGuestName || pendingGuestName || unit.longTermGuestName;
  const date = dateCell(props, st);
  const offlineReason = haStates?.offlineReason ?? null;

  return (
    <Link
      href={`/admin/units/${unit.id}`}
      className={`group flex items-center gap-3 px-4 py-3 border-b border-border/60 last:border-0 hover:bg-muted/40 transition-colors ${UNIT_ROW_COLS} md:items-center`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1 md:flex-none">
        <span className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${st === "occ" ? s.soft : "bg-muted"}`}>
          <TypeIcon className={`h-4 w-4 ${st === "occ" ? s.text : "text-muted-foreground"}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-sm break-words md:truncate">{unit.name}</span>
            {offlineReason && <OfflineMark reason={offlineReason} />}
          </div>
          {/* Phone: second line */}
          <p className="md:hidden text-xs text-muted-foreground truncate mt-0.5">
            <span className={`inline-flex items-center gap-1.5 font-semibold ${s.text}`} title={s.label}>
              <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
              {s.short}
            </span>
            {displayGuest && <> · {displayGuest}</>}
            {date !== "—" && <> · {date}</>}
          </p>
        </div>
      </div>
      <span className={`hidden md:inline-flex items-center gap-2 text-[13px] font-semibold ${s.text}`} title={s.label}>
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${s.dot}`} />
        <span className="truncate">{s.short}</span>
      </span>
      <span className={`hidden md:block text-sm truncate ${displayGuest ? "" : "text-muted-foreground"}`}>
        {displayGuest || "—"}
      </span>
      <span className={`hidden md:inline-flex text-[13px] items-center gap-1.5 ${st === "arr" ? s.text : "text-muted-foreground"}`}>
        {(st === "arr" || st === "res") && <LogIn className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{date}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/30 group-hover:text-primary transition-colors" />
    </Link>
  );
}
