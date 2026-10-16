/**
 * OAuth token/revocation requests are application/x-www-form-urlencoded;
 * accept JSON too, since some clients send it.
 */
export async function readFormBody(req: Request): Promise<URLSearchParams | null> {
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const json = await req.json();
      if (!json || typeof json !== "object" || Array.isArray(json)) return null;
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(json)) if (typeof v === "string") form.set(k, v);
      return form;
    }
    return new URLSearchParams(await req.text());
  } catch {
    return null;
  }
}
