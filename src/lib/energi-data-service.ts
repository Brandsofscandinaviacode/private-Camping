// Energi Data Service API — Danish electricity spot prices
// API docs: https://www.energidataservice.dk/guides/api-guides
//
// DESIGN PRINCIPLE: Spot prices are immutable — once a price for a given
// hour is published, it never changes. We store every fetched hour in the
// SpotPriceCache table and ONLY call the EDS API when we're missing hours
// we need (typically once a day when tomorrow's prices are published ~13:00).
//
// All reads (dashboard, cron tick, guest portal) go to the DB — never to
// the API. The API is only called by:
//   1. refreshSpotPriceCache() in the cron heavy-task (skips if we already
//      have the hours we need)
//   2. fetchSpotPricesForDate() when the Elpriser page requests a specific
//      date we don't have cached yet

import { prisma } from "./prisma";

interface SpotPrice {
  HourDK: string;          // "2026-04-05T14:00:00"
  SpotPriceDKK: number;    // Price in DKK per MWh
  SpotPriceEUR: number;
}

interface EdsResponse {
  records: SpotPrice[];
}

// ──────────────────────────────────────────────
// DB HELPERS
// ──────────────────────────────────────────────

/** Upsert API results into the cache */
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
      // DB error — skip caching, non-critical
    }
  }
}

/** Read cached prices for a given range */
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
    return []; // DB error → no cached data
  }
}

// ──────────────────────────────────────────────
// API FETCHING (internal — only used when DB is missing data)
// ──────────────────────────────────────────────

async function fetchFromApi(startStr: string, endStr: string, area: string): Promise<SpotPrice[]> {
  const url = `https://api.energidataservice.dk/dataset/Elspotprices?offset=0&start=${startStr}&end=${endStr}&filter={"PriceArea":"${area}"}&sort=HourDK asc`;

  // Retry up to 3 times with backoff — EDS can be slow on first contact.
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
      if (!res.ok) throw new Error(`EDS API fejl: ${res.status}`);
      const data: EdsResponse = await res.json();
      return data.records || [];
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

/** Return "YYYY-MM-DDTHH" in Europe/Copenhagen time zone. */
function danishHourPrefix(date?: Date): string {
  const cph = new Date((date ?? new Date()).toLocaleString("en-US", { timeZone: "Europe/Copenhagen" }));
  return `${cph.getFullYear()}-${String(cph.getMonth() + 1).padStart(2, "0")}-${String(cph.getDate()).padStart(2, "0")}T${String(cph.getHours()).padStart(2, "0")}`;
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

    // 2. Most recent cached price (e.g. we have up to hour 13 but it's now 14
    //    because tomorrow's prices haven't been published yet)
    try {
      const latest = await prisma.spotPriceCache.findFirst({
        where: { area },
        orderBy: { hourDK: "desc" },
      });
      if (latest) return latest.priceDKK / 1000;
    } catch { /* DB error */ }

    return null;
  } catch (e) {
    console.error("getCurrentSpotPrice fejl:", e);
    return null;
  }
}

/** Spot prices for the chart (current -1h to +24h). Reads from DB only. */
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
    const records = await fetchFromApi(startStr, endStr, area);
    if (records.length > 0) {
      await upsertPrices(area, records);
    }
    return records.map((p) => ({
      hour: p.HourDK,
      pricePerKwh: p.SpotPriceDKK / 1000,
    }));
  } catch (e) {
    console.error("EDS API fejl for dato", date, e);
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
 * Only calls the EDS API if we're missing the current hour or don't have
 * enough future hours cached. Typically results in 1-2 API calls per day:
 *   - Once in the morning when the current hour rolls past cached data
 *   - Once after ~13:00 when tomorrow's prices become available
 */
export async function refreshSpotPriceCache(area: "DK1" | "DK2" = "DK1"): Promise<{ fetched: number }> {
  try {
    const currentHourPrefix = danishHourPrefix();

    // Check: do we have the current hour?
    const hasCurrentHour = await prisma.spotPriceCache.findFirst({
      where: { area, hourDK: { startsWith: currentHourPrefix } },
    });

    // Check: what's the latest hour we have?
    const latestCached = await prisma.spotPriceCache.findFirst({
      where: { area },
      orderBy: { hourDK: "desc" },
    });

    // Calculate how many hours ahead we have cached
    let hoursAhead = 0;
    if (latestCached) {
      const latestTime = new Date(latestCached.hourDK).getTime();
      hoursAhead = Math.max(0, (latestTime - Date.now()) / 3600_000);
    }

    // Skip API call if we have the current hour AND at least 12 hours ahead.
    // Tomorrow's prices are published ~13:00, so 12h buffer is safe.
    if (hasCurrentHour && hoursAhead >= 12) {
      return { fetched: 0 };
    }

    // We need more data — fetch from API
    const now = new Date();
    const start = new Date(now);
    start.setHours(start.getHours() - 2);

    const startStr = start.toISOString().slice(0, 13) + ":00";
    const endStr = new Date(now.getTime() + 36 * 3600000).toISOString().slice(0, 13) + ":00";

    const records = await fetchFromApi(startStr, endStr, area);
    if (records.length > 0) {
      await upsertPrices(area, records);
    }
    return { fetched: records.length };
  } catch (e) {
    console.error("EDS cache refresh fejl:", e);
    return { fetched: 0 };
  }
}

/** Clean up old cache entries (older than 30 days) */
export async function cleanOldSpotPrices(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 3600_000);
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
// Mode 1: FIXED — Fixed price per kWh (current behavior)
// Mode 2: MINIMUM — Use fixed price, but if spot > fixed, add the difference
// Mode 3: SPOT — Spot price + fixed surcharge

export type PricingMode = "fixed" | "minimum" | "spot";

export interface EffectivePrice {
  pricePerKwh: number;      // What the guest sees/pays
  spotPrice: number | null;  // Current spot price (null if unavailable)
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
    // Spot price unavailable — use mode-appropriate fallback
    if (mode === "spot") {
      // In spot mode, the surcharge alone is the minimum the guest should pay
      return { pricePerKwh: surcharge, spotPrice: null, mode };
    }
    // In minimum mode, use the fixed price as fallback
    return { pricePerKwh: fixedPrice, spotPrice: null, mode };
  }

  if (mode === "minimum") {
    // fixedPrice is the minimum. If spot > fixedPrice, add the difference.
    // Effective = fixedPrice + max(0, spotPrice - fixedPrice) = max(fixedPrice, spotPrice)
    return {
      pricePerKwh: Math.max(fixedPrice, spotPrice),
      spotPrice,
      mode,
    };
  }

  if (mode === "spot") {
    // Guest pays: spot price + surcharge
    return {
      pricePerKwh: spotPrice + surcharge,
      spotPrice,
      mode,
    };
  }

  return { pricePerKwh: fixedPrice, spotPrice: null, mode };
}
