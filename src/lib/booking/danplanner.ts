import type { BookingProvider, BookingResource, BookingResourceType, BookingLoginResult, BookingVerifyResult } from "./types";

interface DanplannerConfig {
  baseUrl: string;
  username: string;
  password: string;
  sessionCookies?: string;
}

function extractCookies(headers: Headers): string[] {
  const raw = headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]);
}

function mergeCookies(existing: string, incoming: string[]): string {
  const map = new Map<string, string>();
  for (const part of existing.split("; ").filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq > 0) map.set(part.slice(0, eq), part);
  }
  for (const c of incoming) {
    const eq = c.indexOf("=");
    if (eq > 0) map.set(c.slice(0, eq), c);
  }
  return [...map.values()].join("; ");
}

function parseTableRows(html: string): Array<{ id: string; name: string }> {
  const rows: Array<{ id: string; name: string }> = [];
  const rowRegex = /data-id="(\d+)"[\s\S]*?<span>([^<]+)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRegex.exec(html)) !== null) {
    rows.push({ id: m[1], name: decodeHtmlEntities(m[2].trim()) });
  }
  return rows;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#xB2;/g, "²")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export async function danplannerLogin(config: DanplannerConfig): Promise<BookingLoginResult> {
  try {
    const loginPageRes = await fetch(`${config.baseUrl}/Account/login`, { redirect: "manual" });
    const loginHtml = await loginPageRes.text();
    let cookies = mergeCookies("", extractCookies(loginPageRes.headers));

    const tokenMatch = loginHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
    if (!tokenMatch) {
      return { success: false, needs2FA: false, error: "Kunne ikke finde login-token. Tjek URL." };
    }

    const body = new URLSearchParams({
      userName: config.username,
      password: config.password,
      returnUrl: "/",
      __RequestVerificationToken: tokenMatch[1],
    });

    const loginRes = await fetch(`${config.baseUrl}/Account/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookies,
      },
      body: body.toString(),
      redirect: "manual",
    });

    cookies = mergeCookies(cookies, extractCookies(loginRes.headers));

    const status = loginRes.status;
    const locationHeader = loginRes.headers.get("location") || "";

    if (status === 302 && (locationHeader.includes("Approve") || locationHeader.includes("approve"))) {
      return { success: false, needs2FA: true, sessionToken: cookies };
    }

    if (status === 302 && (locationHeader === "/" || locationHeader.includes("/Home") || locationHeader.includes("/Dashboard"))) {
      return { success: true, needs2FA: false, sessionToken: cookies };
    }

    const responseBody = await loginRes.text().catch(() => "");
    if (responseBody.includes("Approve IP") || responseBody.includes("verification code")) {
      return { success: false, needs2FA: true, sessionToken: cookies };
    }

    if (status >= 200 && status < 400) {
      return { success: true, needs2FA: false, sessionToken: cookies };
    }

    return { success: false, needs2FA: false, error: `Login fejlede (status ${status})` };
  } catch (err) {
    return { success: false, needs2FA: false, error: `Forbindelsesfejl: ${(err as Error).message}` };
  }
}

export async function danplannerVerify2FA(
  baseUrl: string,
  cookies: string,
  code: string
): Promise<BookingVerifyResult> {
  try {
    const approvePage = await fetch(`${baseUrl}/Account/ApproveIP`, {
      headers: { Cookie: cookies },
      redirect: "manual",
    });
    const approveHtml = await approvePage.text();
    cookies = mergeCookies(cookies, extractCookies(approvePage.headers));

    const tokenMatch = approveHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
    const token = tokenMatch?.[1] || "";

    const body = new URLSearchParams({
      Code: code,
      __RequestVerificationToken: token,
    });

    const verifyRes = await fetch(`${baseUrl}/Account/ApproveIP`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookies,
      },
      body: body.toString(),
      redirect: "manual",
    });

    cookies = mergeCookies(cookies, extractCookies(verifyRes.headers));

    const status = verifyRes.status;
    if (status === 302 || status === 200) {
      return { success: true, sessionToken: cookies };
    }

    return { success: false, error: `Verifikation fejlede (status ${status})` };
  } catch (err) {
    return { success: false, error: `Fejl: ${(err as Error).message}` };
  }
}

export function createDanplannerProvider(config: DanplannerConfig): BookingProvider {
  const cookies = config.sessionCookies || "";

  async function authedFetch(path: string): Promise<Response> {
    if (!cookies) throw new Error("Ikke forbundet til Danplanner. Log ind først.");
    const res = await fetch(`${config.baseUrl}${path}`, {
      headers: { Cookie: cookies },
      redirect: "manual",
    });
    if (res.status === 302) {
      const loc = res.headers.get("location") || "";
      if (loc.includes("login") || loc.includes("Login")) {
        throw new Error("Session udløbet. Log ind igen.");
      }
    }
    return res;
  }

  return {
    name: "Danplanner",

    async testConnection() {
      try {
        const res = await authedFetch("/ResourceType/ListResourceTypes");
        const html = await res.text();
        if (html.includes("ResourceTypeList_") || html.includes("data-id")) {
          return { ok: true };
        }
        if (html.includes("login") || html.includes("Login")) {
          return { ok: false, error: "Session udløbet. Log ind igen." };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },

    async getResourceTypes() {
      const res = await authedFetch("/ResourceType/ListResourceTypes");
      const html = await res.text();
      return parseTableRows(html).map((r) => ({ id: r.id, name: r.name }));
    },

    async getResources(typeId: string) {
      const res = await authedFetch(`/Resource/Lists?selectedResourceType=${typeId}`);
      const html = await res.text();
      const typeName = typeId;
      return parseTableRows(html).map((r) => ({
        externalId: r.id,
        name: r.name,
        typeId,
        typeName,
      }));
    },
  };
}
