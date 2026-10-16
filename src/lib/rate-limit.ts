const hits = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) {
    if (entry.resetAt <= now) hits.delete(key);
  }
}, 60_000);

// Backstop against memory exhaustion from many distinct keys.
const MAX_KEYS = 10_000;

function makeRoom(): void {
  if (hits.size < MAX_KEYS) return;
  const now = Date.now();
  for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  // Still full: drop the oldest insertions (Map iterates in insertion order).
  for (const key of hits.keys()) {
    if (hits.size < MAX_KEYS) break;
    hits.delete(key);
  }
}

/** True when `key` has used up its budget — does not count an attempt. */
export function isLimited(key: string, limit: number): boolean {
  const entry = hits.get(key);
  return !!entry && entry.resetAt > Date.now() && entry.count >= limit;
}

/** Count one attempt (e.g. a failed login) against `key`; returns the new count. */
export function recordHit(key: string, windowMs: number): number {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    makeRoom();
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  entry.count++;
  return entry.count;
}

/** Attempts counted against `key` in its current window. */
export function hitCount(key: string): number {
  const entry = hits.get(key);
  return entry && entry.resetAt > Date.now() ? entry.count : 0;
}

export function resetLimit(key: string): void {
  hits.delete(key);
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; remaining: number } {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || entry.resetAt <= now) {
    makeRoom();
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }

  entry.count++;
  if (entry.count > limit) {
    return { ok: false, remaining: 0 };
  }
  return { ok: true, remaining: limit - entry.count };
}
