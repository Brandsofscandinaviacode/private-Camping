/**
 * Client IP for rate limiting. X-Forwarded-For is a list the client can
 * prepend to, so the first entry is attacker-controlled. Each trusted proxy
 * (Traefik in Coolify) appends the address it saw, so the real client is the
 * entry TRUSTED_PROXY_HOPS from the right (default 1). With
 * TRUSTED_PROXY_HOPS=0 forwarded headers are ignored entirely.
 *
 * Plain module without Node APIs — used by both the middleware and server code.
 */
export function clientIpFromHeaders(h: { get(name: string): string | null }): string {
  const hops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "1", 10);
  if (!Number.isFinite(hops) || hops <= 0) return "direct";
  const chain = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (chain.length >= hops) return chain[chain.length - hops];
  return h.get("x-real-ip")?.trim() || "unknown";
}
