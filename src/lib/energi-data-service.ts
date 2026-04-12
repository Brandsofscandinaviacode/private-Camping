// Energi Data Service API — Danish electricity spot prices
// API docs: https://www.energidataservice.dk/guides/api-guides
// Prices are cached in the SpotPriceCache table — API is only called
// when cached data is missing or stale (older than 6 hours).
// All cache operations fail gracefully — if the table doesn't exist
// or any DB error occurs, we fall back to direct API calls.

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
// CACHE HELPERS (all fail silently on DB errors)
// ──────────────────────────────────────────────

const CACHE_MAX_AGE_MS = 6 * 3600_000; // 6 hours

/** Check whether we have fresh cached data covering the requested range */
async function isCacheFresh(area: string, startHour: string, endHour: string): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - CACHE_MAX_AGE_MS);
    const cached = await prisma.spotPriceCache.count({
      where: {
        area,
        hourDK: { gte: startHour, lte: endHour },
        fetchedAt: { gte: cutoff },
      },
    });
    return cached > 0;
  } catch {
    return false; // DB error → treat as cache miss
  }
}

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
// API FETCHING (internal — consumers use the public functions below)
// ──────────────────────────────────────────────

async function fetchFromApi(startStr: string, endStr: string, area: string): Promise<SpotPrice[]> {
  const url = `https://api.energidataservice.dk/dataset/Elspotprices?offset=0&start=${startStr}&end=${endStr}&filter={"PriceArea":"${area}"}&sort=HourDK asc`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (!res.ok) throw new Error(`EDS API fejl: ${res.status}`);

  const data: EdsResponse = await res.json();
  return data.records || [];
}

// ──────────────────────────────────────────────
// PUBLIC API
// ──────────────────────────────────────────────

// Price area: DK1 (west) or DK2 (east of Storebælt)
export async function fetchSpotPrices(area: "DK1" | "DK2" = "DK1"): Promise<SpotPrice[]> {
  const now = new Date();
  const start = new Date(now);
  start.setHours(start.getHours() - 1);

  const startStr = start.toISOString().slice(0, 13) + ":00";
  const endStr = new Date(now.getTime() + 24 * 3600000).toISOString().slice(0, 13) + ":00";

  // Try cache first
  const fresh = await isCacheFresh(area, startStr, endStr);
  if (fresh) {
    const cached = await getCachedPrices(area, startStr, endStr);
    if (cached.length > 0) {
      return cached.map((c) => ({
        HourDK: c.hourDK,
        SpotPriceDKK: c.priceDKK,
        SpotPriceEUR: c.priceEUR,
      }));
    }
  }

  // Cache miss or stale — fetch from API and cache
  try {
    const records = await fetchFromApi(startStr, endStr, area);
    if (records.length > 0) {
      await upsertPrices(area, records);
    }
    return records;
  } catch (e) {
    // API failed — fall back to whatever we have in cache (even if stale)
    console.error("EDS API fejl, bruger cache:", e);
    const stale = await getCachedPrices(area, startStr, endStr);
    if (stale.length > 0) {
      return stale.map((c) => ({
        HourDK: c.hourDK,
        SpotPriceDKK: c.priceDKK,
        SpotPriceEUR: c.priceEUR,
      }));
    }
    throw e; // No cache at all
  }
}

// Fetch spot prices for a specific date (full day 00:00–23:00)
export async function fetchSpotPricesForDate(
  date: string, // "YYYY-MM-DD"
  area: "DK1" | "DK2" = "DK1"
): Promise<{ hour: string; pricePerKwh: number }[]> {
  const startStr = `${date}T00:00`;
  const endStr = `${date}T23:59`;

  // Try cache first
  const fresh = await isCacheFresh(area, startStr, endStr);
  if (fresh) {
    const cached = await getCachedPrices(area, startStr, endStr);
    if (cached.length > 0) {
      return cached.map((c) => ({
        hour: c.hourDK,
        pricePerKwh: c.priceDKK / 1000,
      }));
    }
  }

  // Fetch from API and cache
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
    console.error("EDS API fejl, bruger cache:", e);
    const stale = await getCachedPrices(area, startStr, endStr);
    return stale.map((c) => ({
      hour: c.hourDK,
      pricePerKwh: c.priceDKK / 1000,
    }));
  }
}

// Get the available date range from the API
export async function getAvailableDateRange(area: "DK1" | "DK2" = "DK1"): Promise<{ earliest: string; latest: string }> {
  try {
    // Check cache for the latest record first
    let latestCached: { hourDK: string; fetchedAt: Date } | null = null;
    try {
      latestCached = await prisma.spotPriceCache.findFirst({
        where: { area },
        orderBy: { hourDK: "desc" },
      });
    } catch {
      // DB error — skip cache
    }

    // If we have a fresh cache record, use it
    if (latestCached && (Date.now() - latestCached.fetchedAt.getTime()) < CACHE_MAX_AGE_MS) {
      return { earliest: "2020-01-01", latest: latestCached.hourDK.slice(0, 10) };
    }

    // Fetch the latest record from API
    const url = `https://api.energidataservice.dk/dataset/Elspotprices?filter={"PriceArea":"${area}"}&sort=HourDK desc&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (!res.ok) throw new Error(`EDS API: ${res.status}`);
    const data: EdsResponse = await res.json();
    const latestRecord = data.records?.[0];
    const latestDate = latestRecord ? latestRecord.HourDK.slice(0, 10) : new Date().toISOString().slice(0, 10);
    return { earliest: "2020-01-01", latest: latestDate };
  } catch {
    // Fall back to cache or today
    let latestCached: { hourDK: string } | null = null;
    try {
      latestCached = await prisma.spotPriceCache.findFirst({
        where: { area },
        orderBy: { hourDK: "desc" },
      });
    } catch {
      // DB error — skip cache
    }
    const latestDate = latestCached ? latestCached.hourDK.slice(0, 10) : new Date().toISOString().slice(0, 10);
    return { earliest: "2020-01-01", latest: latestDate };
  }
}

// Get the current hour's spot price in DKK/kWh
export async function getCurrentSpotPrice(area: "DK1" | "DK2" = "DK1"): Promise<number | null> {
  try {
    const now = new Date();

    // Build the current Danish hour string for lookup
    const cph = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Copenhagen" }));
    const currentDanishHour = `${cph.getFullYear()}-${String(cph.getMonth() + 1).padStart(2, "0")}-${String(cph.getDate()).padStart(2, "0")}T${String(cph.getHours()).padStart(2, "0")}`;

    // Check DB cache first (fast path — no API call)
    try {
      const cached = await prisma.spotPriceCache.findFirst({
        where: {
          area,
          hourDK: { startsWith: currentDanishHour },
        },
      });
      if (cached) {
        return cached.priceDKK / 1000; // DKK/MWh → DKK/kWh
      }
    } catch {
      // DB error — skip cache, try API
    }

    // Cache miss — fetch from API (this also populates the cache)
    const prices = await fetchSpotPrices(area);
    const current = prices.find((p) => p.HourDK.slice(0, 13) === currentDanishHour);

    if (!current) return null;
    return current.SpotPriceDKK / 1000;
  } catch (e) {
    console.error("Energi Data Service fejl:", e);
    return null;
  }
}

// Get prices for the last N hours
export async function getSpotPriceHistory(area: "DK1" | "DK2" = "DK1"): Promise<{ hour: string; pricePerKwh: number }[]> {
  try {
    const prices = await fetchSpotPrices(area);
    return prices.map((p) => ({
      hour: p.HourDK,
      pricePerKwh: p.SpotPriceDKK / 1000,
    }));
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────
// CACHE MAINTENANCE
// ──────────────────────────────────────────────

/** Refresh the spot price cache — called from cron to proactively keep data fresh */
export async function refreshSpotPriceCache(area: "DK1" | "DK2" = "DK1"): Promise<{ fetched: number }> {
  const now = new Date();
  const start = new Date(now);
  start.setHours(start.getHours() - 2); // Include recent past

  const startStr = start.toISOString().slice(0, 13) + ":00";
  const endStr = new Date(now.getTime() + 36 * 3600000).toISOString().slice(0, 13) + ":00"; // Up to 36h ahead

  try {
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

/** Clean up old cache entries (older than 7 days) */
export async function cleanOldSpotPrices(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600_000);
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
