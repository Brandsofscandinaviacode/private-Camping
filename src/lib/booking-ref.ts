// Booking numbers from an external booking system are stored with a provider
// prefix ("danplanner:227359") — that is the sync key, not something staff or
// guests should read or edit. Plain module, safe on server and client.

const PROVIDER_LABELS: Record<string, string> = {
  danplanner: "Danplanner",
};

/** { provider, id } for a provider-prefixed ref, else null. */
export function parseBookingRef(ref: string | null | undefined): { provider: string; label: string; id: string } | null {
  if (!ref) return null;
  const m = /^([a-z][a-z0-9_-]{2,}):(\S+)$/.exec(ref.trim());
  if (!m) return null;
  const provider = m[1];
  const label = PROVIDER_LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
  return { provider, label, id: m[2] };
}

/** "Danplanner #227359" for imported bookings, the ref itself otherwise. */
export function bookingRefLabel(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const p = parseBookingRef(ref);
  return p ? `${p.label} #${p.id}` : ref;
}

/** Receipt wording: "Danplanner-booking 227359" or "Booking BK-001". */
export function bookingRefReceiptLabel(ref: string | null | undefined, fallbackId: number): string {
  const p = parseBookingRef(ref);
  if (p) return `${p.label}-booking ${p.id}`;
  return ref ? `Booking ${ref}` : `Booking #${fallbackId}`;
}
