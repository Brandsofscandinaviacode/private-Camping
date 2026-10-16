// Danish date/time formatting, always in the campsite's time zone — the
// server may run in UTC, and the browser may not be in Denmark. Plain module,
// safe on server and client.

export const SITE_TIME_ZONE = "Europe/Copenhagen";

type DateLike = Date | string | number | null | undefined;

function toDate(d: DateLike): Date | null {
  if (d === null || d === undefined || d === "") return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

const dateFmt = new Intl.DateTimeFormat("da-DK", { timeZone: SITE_TIME_ZONE, day: "numeric", month: "numeric", year: "numeric" });
const shortDateFmt = new Intl.DateTimeFormat("da-DK", { timeZone: SITE_TIME_ZONE, day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("da-DK", { timeZone: SITE_TIME_ZONE, hour: "2-digit", minute: "2-digit" });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: SITE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** 16.10.2026 */
export function fmtDate(d: DateLike): string {
  const date = toDate(d);
  return date ? dateFmt.format(date) : "—";
}

/** 16. okt. */
export function fmtShortDate(d: DateLike): string {
  const date = toDate(d);
  return date ? shortDateFmt.format(date) : "—";
}

/** 08.37 */
export function fmtTime(d: DateLike): string {
  const date = toDate(d);
  return date ? timeFmt.format(date) : "—";
}

/** 16.10.2026 08.37 */
export function fmtDateTime(d: DateLike): string {
  const date = toDate(d);
  return date ? `${dateFmt.format(date)} ${timeFmt.format(date)}` : "—";
}

/** Calendar day in the site's time zone, "2026-10-16" — for comparing days. */
export function siteDayKey(d: DateLike): string | null {
  const date = toDate(d);
  return date ? dayKeyFmt.format(date) : null;
}

/**
 * Relative day for date-only values (imported bookings carry no real time):
 * "i dag", "i morgen", "i går", otherwise "17. okt.".
 */
export function fmtRelativeDay(d: DateLike, now: Date = new Date()): string {
  const key = siteDayKey(d);
  if (!key) return "—";
  const today = siteDayKey(now)!;
  const dayMs = 86_400_000;
  const diff = Math.round((Date.parse(key) - Date.parse(today)) / dayMs);
  if (diff === 0) return "i dag";
  if (diff === 1) return "i morgen";
  if (diff === -1) return "i går";
  return fmtShortDate(d);
}
