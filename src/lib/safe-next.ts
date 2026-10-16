/**
 * Validate a post-login return path (`/login?next=…`). Only same-origin
 * relative paths are allowed, so the parameter can't become an open redirect.
 * Plain module — used by both the login page and the client login form.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (typeof next !== "string" || next.length === 0 || next.length > 4096) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  // Control characters or backslashes can be normalised into "//host" by browsers.
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return null;
  try {
    const base = "http://campsense.invalid";
    const u = new URL(next, base);
    if (u.origin !== base) return null;
    // Parsing collapses dot segments ("/.//evil.com" → "//evil.com"), so the
    // normalised result must pass the same checks again.
    const out = u.pathname + u.search + u.hash;
    if (!out.startsWith("/") || out.startsWith("//") || out.startsWith("/\\")) return null;
    return out;
  } catch {
    return null;
  }
}
