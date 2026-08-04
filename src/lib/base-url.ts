/**
 * Public base URL for links that leave the server — guest portal links in
 * emails/SMS, QuickPay callbacks, QR codes.
 *
 * Resolution order:
 *   1. The `site_url` setting (Indstillinger → Generelt)
 *   2. The APP_URL / SITE_URL env var (handy for container deploys)
 *   3. http://localhost:3000 — development only
 *
 * Falling through to localhost in production silently sends guests links they
 * cannot open, so `isPlaceholderBaseUrl` lets the admin UI warn about it.
 */

const DEV_FALLBACK = "http://localhost:3000";

/** Strip trailing slashes so callers can safely append `/guest/...`. */
function normalize(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function getBaseUrl(settings: Record<string, string | undefined>): string {
  const fromSetting = settings.site_url?.trim();
  if (fromSetting) return normalize(fromSetting);

  const fromEnv = process.env.APP_URL?.trim() || process.env.SITE_URL?.trim();
  if (fromEnv) return normalize(fromEnv);

  return DEV_FALLBACK;
}

/**
 * True when the resolved URL points at localhost — i.e. links generated with
 * it only work on the server itself and are useless to a guest.
 */
export function isPlaceholderBaseUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url.trim());
}
