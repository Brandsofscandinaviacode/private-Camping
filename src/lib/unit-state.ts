// Unit occupancy state shared by the dashboard (cards + list), the unit page
// and the site map, so "who is here?" gets one answer and one colour
// everywhere. Plain module, safe for server and client.
//
//   Optaget (tjekket ind)                         → blue
//   På pladsen iflg. booking – ikke tjekket ind   → amber
//   Reserveret (ankommer senere)                  → light amber
//   Ledig                                         → emerald
//
// Brand orange stays reserved for actions. Power/meter state is never a fill
// colour — it is drawn as a small indicator on top (see the site map).

export type UnitStateKey = "occ" | "arr" | "res" | "free";

export const UNIT_STATE: Record<UnitStateKey, {
  /** Full wording — legends, tooltips, the unit page. */
  label: string;
  /** Chips, badges and narrow columns. */
  short: string;
  dot: string;
  text: string;
  soft: string;
  accent: string;
  /** Site map marker: fill + border + label colour. */
  marker: string;
}> = {
  occ: {
    label: "Optaget – tjekket ind", short: "Optaget",
    dot: "bg-blue-500", text: "text-blue-600", soft: "bg-blue-500/10", accent: "bg-blue-500",
    marker: "bg-blue-500 border-blue-600 text-white",
  },
  arr: {
    label: "På pladsen iflg. booking – ikke tjekket ind", short: "Ikke tjekket ind",
    dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", soft: "bg-amber-500/15", accent: "bg-amber-500",
    marker: "bg-amber-500 border-amber-600 text-white",
  },
  res: {
    label: "Reserveret – ankommer senere", short: "Reserveret",
    dot: "bg-amber-300", text: "text-amber-600/90", soft: "bg-amber-500/10", accent: "bg-amber-300",
    marker: "bg-white border-amber-400 text-amber-700",
  },
  free: {
    label: "Ledig", short: "Ledig",
    dot: "bg-emerald-500", text: "text-emerald-600", soft: "bg-emerald-500/10", accent: "bg-emerald-500",
    marker: "bg-emerald-500 border-emerald-600 text-white",
  },
};

/**
 * A checked-in unit is "occ". Otherwise an open reservation decides: "arr"
 * when its arrival day has come (hasArrivedNotCheckedIn — compute that on the
 * server, where the clock is in site time), "res" when it is still ahead.
 */
export function unitStateKey(unitStatus: string, hasPending: boolean, pendingArrived = false): UnitStateKey {
  if (unitStatus === "OCCUPIED") return "occ";
  if (hasPending) return pendingArrived ? "arr" : "res";
  return "free";
}

/**
 * Every unit gets a hardware row when it is created, all switched off. Only
 * the features that are switched on mean the unit has meters or relays.
 */
export function hasAnyHardware(hw: {
  hasElectricity: boolean; hasHeating?: boolean; hasWater: boolean; hasClimate: boolean; hasSmartLock: boolean;
} | null | undefined): boolean {
  return !!hw && (hw.hasElectricity || !!hw.hasHeating || hw.hasWater || hw.hasClimate || hw.hasSmartLock);
}

/** A reading older than this is not "now" — the cron reads meters every 10 minutes. */
export const METER_FRESH_MS = 20 * 60_000;

/** An ACTIVE stay on a metered unit with no tick for this long is no longer being measured. */
export const METERING_STOPPED_MS = 30 * 60_000;

/** "4 min", "8 timer", "33 dage" — how long ago, for "sidst aflæst …". */
export function fmtAge(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 48) return hours === 1 ? "1 time" : `${hours} timer`;
  const days = Math.round(hours / 24);
  return `${days} dage`;
}
