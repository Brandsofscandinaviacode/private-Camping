// Danish electricity spot prices via elprisenligenu.dk
// API: https://www.elprisenligenu.dk/api/v1/prices/{YEAR}/{MM-DD}_{AREA}.json
//
// DESIGN PRINCIPLE: Spot prices are immutable — once published, they never
// change. We store every fetched hour in the SpotPriceCache table and ONLY
// call the API when we're missing hours we need (typically once a day when
// tomorrow's prices are published ~13:00).
//
// All reads (dashboard, cron tick, guest portal) go to the DB — never to
// the API. The API is only called by:
//   1. refreshSpotPriceCache() in the cron heavy-task
//   2. fetchSpotPricesForDate() when the Elpriser page requests a date
//      we don't have cached yet

import { prisma } from "./prisma";
import { logger } from "./logger";

// ──────────────────────────────────────────────
// API response type from elprisenligenu.dk
// ──────────────────────────────────────────────
interface ElprisRecord {
  DKK_per_kWh: number;
  EUR_per_kWh: number;
  EXR: number;
  time_start: string;  // "2026-04-16T14:00:00+02:00"
  time_end: string;
}

// Internal format (matches old DB convention: DKK/MWh for priceDKK)
interface SpotPrice {
  HourDK: string;          // "2026-04-16T14:00:00"
  SpotPriceDKK: number;    // DKK per MWh (for DB compat)
  SpotPriceEUR: number;    // EUR per MWh
}

// ──────────────────────────────────────────────
// DB HELPERS
// ──────────────────────────────────────────────

async function upsertPrices(area: string, records: SpotPrice[]) {
  const now = new Date();
  for (const p of records) {
    try {
      await prisma.spotPriceCache.upsert({
        where: { area_hourDK: { area, hourDK: p.HourDK } },
        create: {
          area,
          hourDK: p.HourDK,
          priceDKK: p.SpotPriceDKK,
          priceEUR: p.SpotPriceEUR,
          fetchedAt: now,
        },
        update: {
          priceDKK: p.SpotPriceDKK,
          priceEUR: p.SpotPriceEUR,
          fetchedAt: now,
        },
      });
    } catch {
      // DB error — skip, non-critical
    }
  }
}

async function getCachedPrices(area: string, startHour: string, endHour: string) {
  try {
    return await prisma.spotPriceCache.findMany({
      where: {
        area,
        hourDK: { gte: startHour, lte: endHour },
      },
      orderBy: { hourDK: "asc" },
    });
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────
// API FETCHING — elprisenligenu.dk
// ──────────────────────────────────────────────

/**
 * Fetch spot prices for a single date from elprisenligenu.dk.
 * URL format: /api/v1/prices/{YEAR}/{MM-DD}_{AREA}.json
 * Returns empty array if no data (e.g. future date not yet published).
 */
async function fetchDayFromApi(date: string, area: string): Promise<SpotPrice[]> {
  // date = "2026-04-16", area = "DK1"
  const [year, monthDay] = [date.slice(0, 4), date.slice(5)]; // "2026", "04-16"
  const url = `https://www.elprisenligenu.dk/api/v1/prices/${year}/${monthDay}_${area}.json`;

  const MAX_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
      if (res.status === 404) return []; // No data for this date yet
      if (!res.ok) throw new Error(`elprisenligenu API fejl: ${res.status}`);
      const data: ElprisRecord[] = await res.json();
      return data.map((r) => ({
        // Strip timezone offset — time_start is already Danish local time
        HourDK: r.time_start.slice(0, 19), // "2026-04-16T14:00:00"
        SpotPriceDKK: r.DKK_per_kWh * 1000, // kWh → MWh for DB compat
        SpotPriceEUR: r.EUR_per_kWh * 1000,
      }));
    } catch (e) {
      lastError = e;
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

// ──────────────────────────────────────────────
// Danish hour helper
// ──────────────────────────────────────────────

function danishNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Copenhagen" }));
}

function danishHourPrefix(date?: Date): string {
  const cph = date ?? danishNow();
  return `${cph.getFullYear()}-${String(cph.getMonth() + 1).padStart(2, "0")}-${String(cph.getDate()).padStart(2, "0")}T${String(cph.getHours()).padStart(2, "0")}`;
}

function danishDateStr(date?: Date): string {
  const cph = date ?? danishNow();
  return `${cph.getFullYear()}-${String(cph.getMonth() + 1).padStart(2, "0")}-${String(cph.getDate()).padStart(2, "0")}`;
}

// ──────────────────────────────────────────────
// PUBLIC: read spot prices (DB only — no API calls)
// ──────────────────────────────────────────────

/** Get the current hour's spot price in DKK/kWh. DB-only, never calls API. */
export async function getCurrentSpotPrice(area: "DK1" | "DK2" = "DK1"): Promise<number | null> {
  try {
    const currentDanishHour = danishHourPrefix();

    // 1. Exact match for the current Danish hour
    try {
      const exact = await prisma.spotPriceCache.findFirst({
        where: { area, hourDK: { startsWith: currentDanishHour } },
      });
      if (exact) return exact.priceDKK / 1000; // DKK/MWh → DKK/kWh
    } catch { /* DB error — fall through */ }

    // 2. Most recent cached price as fallback
    try {
      const latest = await prisma.spotPriceCache.findFirst({
        where: { area },
        orderBy: { hourDK: "desc" },
      });
      if (latest) return latest.priceDKK / 1000;
    } catch { /* DB error */ }

    return null;
  } catch (e) {
    logger.error("eds", "getCurrentSpotPrice fejl", e);
    return null;
  }
}

/** Spot prices for the chart (current -1h to +24h). DB-only read. */
export async function fetchSpotPrices(area: "DK1" | "DK2" = "DK1"): Promise<SpotPrice[]> {
  const now = new Date();
  const start = new Date(now);
  start.setHours(start.getHours() - 1);

  const startStr = start.toISOString().slice(0, 13) + ":00";
  const endStr = new Date(now.getTime() + 24 * 3600000).toISOString().slice(0, 13) + ":00";

  const cached = await getCachedPrices(area, startStr, endStr);
  return cached.map((c) => ({
    HourDK: c.hourDK,
    SpotPriceDKK: c.priceDKK,
    SpotPriceEUR: c.priceEUR,
  }));
}

/** Spot prices for a specific date. Fetches from API only if DB has no data for that day. */
export async function fetchSpotPricesForDate(
  date: string, // "YYYY-MM-DD"
  area: "DK1" | "DK2" = "DK1"
): Promise<{ hour: string; pricePerKwh: number }[]> {
  const startStr = `${date}T00:00`;
  const endStr = `${date}T23:59`;

  // Check DB first
  const cached = await getCachedPrices(area, startStr, endStr);
  if (cached.length > 0) {
    return cached.map((c) => ({
      hour: c.hourDK,
      pricePerKwh: c.priceDKK / 1000,
    }));
  }

  // DB has nothing for this date — fetch from API and store
  try {
    const records = await fetchDayFromApi(date, area);
    if (records.length > 0) {
      await upsertPrices(area, records);
    }
    return records.map((p) => ({
      hour: p.HourDK,
      pricePerKwh: p.SpotPriceDKK / 1000,
    }));
  } catch (e) {
    logger.error("eds", `Elpris API fejl for dato ${date}`, e);
    return [];
  }
}

/** Get prices for the chart. DB-only read. */
export async function getSpotPriceHistory(area: "DK1" | "DK2" = "DK1"): Promise<{ hour: string; pricePerKwh: number }[]> {
  const prices = await fetchSpotPrices(area);
  return prices.map((p) => ({
    hour: p.HourDK,
    pricePerKwh: p.SpotPriceDKK / 1000,
  }));
}

/** Available date range — DB-only read. */
export async function getAvailableDateRange(area: "DK1" | "DK2" = "DK1"): Promise<{ earliest: string; latest: string }> {
  try {
    const latestCached = await prisma.spotPriceCache.findFirst({
      where: { area },
      orderBy: { hourDK: "desc" },
    });
    const latestDate = latestCached ? latestCached.hourDK.slice(0, 10) : new Date().toISOString().slice(0, 10);
    return { earliest: "2020-01-01", latest: latestDate };
  } catch {
    return { earliest: "2020-01-01", latest: new Date().toISOString().slice(0, 10) };
  }
}

// ──────────────────────────────────────────────
// CACHE MAINTENANCE (called by cron only)
// ──────────────────────────────────────────────

/**
 * Refresh the spot price cache — called by cron (heavy tasks, ~every 10 min).
 *
 * Only calls the API if we're missing today's or tomorrow's prices.
 * Typically results in 1-2 API calls per day:
 *   - Once for today (if not already cached)
 *   - Once after ~13:00 when tomorrow's prices become available
 */
export async function refreshSpotPriceCache(area: "DK1" | "DK2" = "DK1"): Promise<{ fetched: number }> {
  try {
    const cph = danishNow();
    const today = danishDateStr(cph);
    const tomorrow = danishDateStr(new Date(cph.getTime() + 24 * 3600_000));

    let totalFetched = 0;

    // Fetch today if we don't have all 24 hours
    const todayStart = `${today}T00:00`;
    const todayEnd = `${today}T23:59`;
    const todayCount = await prisma.spotPriceCache.count({
      where: { area, hourDK: { gte: todayStart, lte: todayEnd } },
    }).catch(() => 0);

    if (todayCount < 24) {
      try {
        const records = await fetchDayFromApi(today, area);
        if (records.length > 0) {
          await upsertPrices(area, records);
          totalFetched += records.length;
        }
      } catch (e) {
        logger.error("eds", "Elpris cache refresh fejl (i dag)", e);
      }
    }

    // Fetch tomorrow if we don't have it yet (published ~13:00)
    const tomorrowStart = `${tomorrow}T00:00`;
    const tomorrowEnd = `${tomorrow}T23:59`;
    const tomorrowCount = await prisma.spotPriceCache.count({
      where: { area, hourDK: { gte: tomorrowStart, lte: tomorrowEnd } },
    }).catch(() => 0);

    if (tomorrowCount < 24) {
      try {
        const records = await fetchDayFromApi(tomorrow, area);
        if (records.length > 0) {
          await upsertPrices(area, records);
          totalFetched += records.length;
        }
      } catch (e) {
        // Expected to fail before ~13:00 when tomorrow's prices aren't published yet
        console.log("Morgendagens priser ikke tilgængelige endnu");
      }
    }

    return { fetched: totalFetched };
  } catch (e) {
    logger.error("eds", "Elpris cache refresh fejl", e);
    return { fetched: 0 };
  }
}

/** Clean up old cache entries (older than 90 days) */
export async function cleanOldSpotPrices(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 3600_000);
    const result = await prisma.spotPriceCache.deleteMany({
      where: { hourDK: { lt: cutoff.toISOString().slice(0, 13) + ":00" } },
    });
    return result.count;
  } catch {
    return 0;
  }
}

// ──────────────────────────────────────────────
// PRICING MODES
// ──────────────────────────────────────────────

export type PricingMode = "fixed" | "minimum" | "spot";

export interface EffectivePrice {
  pricePerKwh: number;
  spotPrice: number | null;
  mode: PricingMode;
}

export async function getEffectiveElPrice(
  mode: PricingMode,
  fixedPrice: number,
  surcharge: number,
  area: "DK1" | "DK2"
): Promise<EffectivePrice> {
  if (mode === "fixed") {
    return { pricePerKwh: fixedPrice, spotPrice: null, mode };
  }

  const spotPrice = await getCurrentSpotPrice(area);

  if (spotPrice === null) {
    if (mode === "spot") {
      return { pricePerKwh: surcharge, spotPrice: null, mode };
    }
    return { pricePerKwh: fixedPrice, spotPrice: null, mode };
  }

  if (mode === "minimum") {
    return {
      pricePerKwh: Math.max(fixedPrice, spotPrice),
      spotPrice,
      mode,
    };
  }

  if (mode === "spot") {
    return {
      pricePerKwh: spotPrice + surcharge,
      spotPrice,
      mode,
    };
  }

  return { pricePerKwh: fixedPrice, spotPrice: null, mode };
}
