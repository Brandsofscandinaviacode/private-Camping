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
} from "lucide-react";

const typeIcons: Record<string, typeof Home> = {
  CABIN: Home,
  SEASONAL: Caravan,
  CARAVAN: Caravan,
  PITCH: MapPin,
};

// ──────────────────────────────────────────────────────────────
// Disciplined status palette.
// Brand orange (--primary) is reserved for actions/brand only — it is
// NO LONGER a status colour. Status now reads at a glance:
//   Optaget    → blue     Reserveret → amber     Ledig → emerald
// To revert "occupied" to orange, swap the `occ` entry to primary classes.
// ──────────────────────────────────────────────────────────────
export type UnitStatusKey = "occ" | "res" | "free";

export const STATUS: Record<UnitStatusKey, {
  label: string; dot: string; text: string; soft: string; accent: string;
}> = {
  occ:  { label: "Optaget",    dot: "bg-blue-500",    text: "text-blue-600",    soft: "bg-blue-500/10",    accent: "bg-blue-500" },
  res:  { label: "Reserveret", dot: "bg-amber-500",   text: "text-amber-600",   soft: "bg-amber-500/10",   accent: "bg-amber-500" },
  free: { label: "Ledig",      dot: "bg-emerald-500", text: "text-emerald-600", soft: "bg-emerald-500/10", accent: "bg-emerald-500" },
};

export function statusKey(status: string, pendingGuestName?: string | null): UnitStatusKey {
  if (status === "OCCUPIED") return "occ";
  if (pendingGuestName) return "res";
  return "free";
}

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short" }).format(new Date(iso)) : null;
const fmtTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : null;

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
  } | null;
  activeGuestName: string | null;
  pendingGuestName?: string | null;
  activeCheckOut?: string | null;
  pendingCheckIn?: string | null;
}

/** One short, glanceable meta line — guest-management info, not raw telemetry. */
function metaLine(p: UnitCardProps, st: UnitStatusKey): string {
  if (st === "occ") {
    const d = fmtDate(p.activeCheckOut);
    return d ? `Afrejse ${d}` : "Indtjekket";
  }
  if (st === "res") {
    const d = fmtDate(p.pendingCheckIn);
    const t = fmtTime(p.pendingCheckIn);
    return d ? `Check-in ${d}${t ? ` · ${t}` : ""}` : "Reserveret";
  }
  return "Klar til check-in";
}

export function UnitCardCompact({
  unit,
  activeGuestName,
  pendingGuestName,
}: Pick<UnitCardProps, "unit" | "activeGuestName" | "pendingGuestName">) {
  const st = statusKey(unit.status, pendingGuestName);
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
        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${s.dot}`} />
      </div>
    </Link>
  );
}

export function UnitCard(props: UnitCardProps) {
  const { unit, haStates, activeGuestName, pendingGuestName } = props;
  const st = statusKey(unit.status, pendingGuestName);
  const s = STATUS[st];
  const TypeIcon = typeIcons[unit.type] || Home;
  const displayGuest = activeGuestName || pendingGuestName || unit.longTermGuestName;
  // One optional live signal — only when HA is actually reachable. The global
  // "HA offline" banner on the dashboard replaces the old per-card error label.
  const showLive = !!haStates?.haReachable && st === "occ" && haStates?.powerOn !== null;

  return (
    <Link href={`/admin/units/${unit.id}`} className="h-full block">
      <div className={`group relative rounded-xl border border-border/60 bg-card p-4 pl-5 shadow-sm hover:shadow-lg hover:border-foreground/15 transition-all cursor-pointer h-full min-h-[136px] flex flex-col overflow-hidden`}>
        <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${s.accent}`} />

        {/* Header row: icon + status */}
        <div className="flex items-center justify-between mb-3">
          <div className={`h-9 w-9 rounded-[10px] flex items-center justify-center shrink-0 ${st === "occ" ? s.soft : "bg-muted"}`}>
            <TypeIcon className={`h-[18px] w-[18px] ${st === "occ" ? s.text : "text-muted-foreground"}`} />
          </div>
          <span className={`text-xs font-semibold inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${s.soft} ${s.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
            {s.label}
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
          <span className="truncate">{metaLine(props, st)}</span>
          {unit.isLongTerm && (
            <span className="ml-auto shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
              Langtid
            </span>
          )}
          {!unit.isLongTerm && showLive && (
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
// of a card wall. Far more scannable when counts are high.
// ──────────────────────────────────────────────────────────────
export function UnitRow(props: UnitCardProps & { type: string }) {
  const { unit, activeGuestName, pendingGuestName } = props;
  const st = statusKey(unit.status, pendingGuestName);
  const s = STATUS[st];
  const TypeIcon = typeIcons[props.type] || MapPin;
  const displayGuest = activeGuestName || pendingGuestName || unit.longTermGuestName;

  return (
    <Link
      href={`/admin/units/${unit.id}`}
      className="group grid grid-cols-[1.4fr_1fr_1.6fr_1fr_auto] items-center gap-3 px-4 py-3 border-b border-border/60 last:border-0 hover:bg-muted/40 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${st === "occ" ? s.soft : "bg-muted"}`}>
          <TypeIcon className={`h-4 w-4 ${st === "occ" ? s.text : "text-muted-foreground"}`} />
        </span>
        <span className="font-semibold text-sm truncate">{unit.name}</span>
      </div>
      <span className={`inline-flex items-center gap-2 text-[13px] font-semibold ${s.text}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
        {s.label}
      </span>
      <span className={`text-sm truncate ${displayGuest ? "" : "text-muted-foreground"}`}>
        {displayGuest || "—"}
      </span>
      <span className="text-[13px] text-muted-foreground inline-flex items-center gap-1.5">
        {st === "res" && <LogIn className="h-3.5 w-3.5" />}
        {st === "occ"
          ? (fmtDate(props.activeCheckOut) ? `Afrejse ${fmtDate(props.activeCheckOut)}` : "—")
          : st === "res"
            ? (fmtDate(props.pendingCheckIn) ? fmtDate(props.pendingCheckIn) : "Reserveret")
            : "—"}
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-primary transition-colors" />
    </Link>
  );
}
