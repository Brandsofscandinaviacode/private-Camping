// Energi Data Service API — Danish electricity spot prices
// API docs: https://www.energidataservice.dk/guides/api-guides

interface SpotPrice {
  HourDK: string;          // "2026-04-05T14:00:00"
  SpotPriceDKK: number;    // Price in DKK per MWh
  SpotPriceEUR: number;
}

interface EdsResponse {
  records: SpotPrice[];
}

// Price area: DK1 (west) or DK2 (east of Storebælt)
export async function fetchSpotPrices(area: "DK1" | "DK2" = "DK1"): Promise<SpotPrice[]> {
  const now = new Date();
  const start = new Date(now);
  start.setHours(start.getHours() - 1);

  const startStr = start.toISOString().slice(0, 13) + ":00";
  const endStr = new Date(now.getTime() + 24 * 3600000).toISOString().slice(0, 13) + ":00";

  const url = `https://api.energidataservice.dk/dataset/Elspotprices?offset=0&start=${startStr}&end=${endStr}&filter={"PriceArea":"${area}"}&sort=HourDK asc`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10000), next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`EDS API fejl: ${res.status}`);

  const data: EdsResponse = await res.json();
  return data.records || [];
}

// Fetch spot prices for a specific date (full day 00:00–23:00)
export async function fetchSpotPricesForDate(
  date: string, // "YYYY-MM-DD"
  area: "DK1" | "DK2" = "DK1"
): Promise<{ hour: string; pricePerKwh: number }[]> {
  const startStr = `${date}T00:00`;
  const endStr = `${date}T23:59`;

  const url = `https://api.energidataservice.dk/dataset/Elspotprices?offset=0&start=${startStr}&end=${endStr}&filter={"PriceArea":"${area}"}&sort=HourDK asc`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10000), next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`EDS API fejl: ${res.status}`);

  const data: EdsResponse = await res.json();
  return (data.records || []).map((p) => ({
    hour: p.HourDK,
    pricePerKwh: p.SpotPriceDKK / 1000,
  }));
}

// Get the available date range from the API
export async function getAvailableDateRange(area: "DK1" | "DK2" = "DK1"): Promise<{ earliest: string; latest: string }> {
  try {
    // Fetch the latest record to find the newest available date
    const url = `https://api.energidataservice.dk/dataset/Elspotprices?filter={"PriceArea":"${area}"}&sort=HourDK desc&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000), next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`EDS API: ${res.status}`);
    const data: EdsResponse = await res.json();
    const latestRecord = data.records?.[0];
    const latestDate = latestRecord ? latestRecord.HourDK.slice(0, 10) : new Date().toISOString().slice(0, 10);
    return { earliest: "2020-01-01", latest: latestDate };
  } catch {
    return { earliest: "2020-01-01", latest: new Date().toISOString().slice(0, 10) };
  }
}

// Get the current hour's spot price in DKK/kWh
export async function getCurrentSpotPrice(area: "DK1" | "DK2" = "DK1"): Promise<number | null> {
  try {
    const prices = await fetchSpotPrices(area);
    const now = new Date();

    // HourDK is in Danish local time (e.g. "2026-04-05T14:00:00").
    // Build a matching string in Danish local time so comparison works
    // regardless of the server's timezone.
    const cph = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Copenhagen" }));
    const currentDanishHour = `${cph.getFullYear()}-${String(cph.getMonth() + 1).padStart(2, "0")}-${String(cph.getDate()).padStart(2, "0")}T${String(cph.getHours()).padStart(2, "0")}`;

    // Find the price for the current Danish hour
    const current = prices.find((p) => p.HourDK.slice(0, 13) === currentDanishHour);

    if (!current) return null;

    // Convert from DKK/MWh to DKK/kWh
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
    // Fallback to fixed price if spot price unavailable
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
