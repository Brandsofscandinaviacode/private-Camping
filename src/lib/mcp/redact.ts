// Redaction helpers for the read-only MCP tools.
//
// The MCP endpoint hands data to an external client (Claude), so guest contact
// details are masked, secrets are never echoed, and free text from the log is
// scrubbed for anything that looks like a credential.

/** j***@example.com — enough to recognise a guest, not to contact them. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** Only the last three digits. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 3) return "***";
  return `***${digits.slice(-3)}`;
}

/**
 * Setting keys whose value must never leave the server. Broader than the
 * obvious names: Twilio's account SID and the cached Danplanner 2FA form are
 * credentials too.
 */
const SECRET_SETTING_RE = /(key|token|secret|password|pass|private|cookie|session|sid|auth|grant|credential|approve_form)/i;

export function isSecretSetting(key: string): boolean {
  return SECRET_SETTING_RE.test(key);
}

/** Settings that are internal bookkeeping or belong to the MCP key itself. */
export function isHiddenSetting(key: string): boolean {
  return key.startsWith("_") || key.startsWith("mcp_api_key");
}

export function maskSettingValue(key: string, value: string | null | undefined): string {
  if (isSecretSetting(key)) return value ? "•••• (sat)" : "(ikke sat)";
  const v = value ?? "";
  return v.length > 300 ? `${v.slice(0, 300)}… (${v.length} tegn)` : v;
}

// ── Free text (log lines) ─────────────────────────────────────

const EMAIL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
// CampSense's own opaque secrets (OAuth codes/tokens, MCP key, client secrets).
const OWN_TOKEN_RE = /\bcs(?:at|rt|ac|mk|cs)_[A-Za-z0-9_-]{8,}/g;
const KV_SECRET_RE = /\b([A-Za-z_]*(?:token|password|passwd|secret|api[_-]?key|private[_-]?key|cookie|session[_-]?id)[A-Za-z_]*)(["']?\s*[:=]\s*["']?)([^\s"'&,;}]+)/gi;

// International numbers (+45 12 34 56 78) and the raw value Twilio echoes
// after "To"/"From" number. Bare digit runs are left alone (dates, meters).
const INTL_PHONE_RE = /\+\d[\d -]{5,16}\d/g;
const TWILIO_NUMBER_RE = /(\b(?:To|From)'?\s+number:?\s*'?)(\+?\d[\d -]{3,16}\d)/gi;

export function scrubText(text: string): string {
  return text
    .replace(TWILIO_NUMBER_RE, (_m, pre: string, num: string) => `${pre}${maskPhone(num)}`)
    .replace(INTL_PHONE_RE, (num) => maskPhone(num) ?? "••••")
    .replace(EMAIL_RE, "$1***@$2")
    .replace(BEARER_RE, "$1 ••••")
    .replace(OWN_TOKEN_RE, "••••")
    .replace(KV_SECRET_RE, "$1$2••••");
}

/** Keys in structured log data that hold credentials or raw page HTML. */
const SECRET_DATA_KEY_RE = /(password|passwd|secret|token|cookie|authorization|api[_-]?key|private[_-]?key|credential)/i;
const BULKY_DATA_KEY_RE = /(html|snippet|body)/i;

/** Recursively scrub structured log data; bounded in depth and size. */
export function scrubData(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    const s = scrubText(value);
    return s.length > 500 ? `${s.slice(0, 500)}… (${s.length} tegn)` : s;
  }
  if (typeof value !== "object") return value;
  if (depth >= 4) return "[…]";
  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map((v) => scrubData(v, depth + 1));
    if (value.length > 20) items.push(`… (${value.length - 20} flere)`);
    return items;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
    if (SECRET_DATA_KEY_RE.test(k)) out[k] = v ? "••••" : v;
    else if (BULKY_DATA_KEY_RE.test(k) && typeof v === "string") out[k] = `(udeladt, ${v.length} tegn)`;
    else out[k] = scrubData(v, depth + 1);
  }
  return out;
}
