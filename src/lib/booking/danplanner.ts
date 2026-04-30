import type { BookingProvider, BookingLoginResult, BookingVerifyResult } from "./types";
import { logger } from "../logger";

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

function isApprovePage(html: string): boolean {
  return /Approve\s*IP/i.test(html)
    || /verification\s*code/i.test(html)
    || /one\s*time\s*verification/i.test(html)
    || /name="Code"/i.test(html);
}

function isLoginPage(html: string): boolean {
  return /name="userName"/i.test(html) && /name="password"/i.test(html);
}

async function followRedirect(
  url: string,
  cookies: string,
  maxHops = 5,
): Promise<{ finalUrl: string; html: string; status: number; cookies: string }> {
  let current = url;
  let currentCookies = cookies;
  for (let i = 0; i < maxHops; i++) {
    const res = await fetch(current, {
      headers: { Cookie: currentCookies },
      redirect: "manual",
    });
    currentCookies = mergeCookies(currentCookies, extractCookies(res.headers));

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      current = loc.startsWith("http") ? loc : new URL(loc, current).toString();
      continue;
    }

    const html = await res.text();
    return { finalUrl: current, html, status: res.status, cookies: currentCookies };
  }
  return { finalUrl: current, html: "", status: 0, cookies: currentCookies };
}

export async function danplannerLogin(config: DanplannerConfig): Promise<BookingLoginResult> {
  try {
    logger.info("danplanner", "Starting login", { baseUrl: config.baseUrl, username: config.username });

    const loginPageRes = await fetch(`${config.baseUrl}/Account/login`, { redirect: "manual" });
    const loginHtml = await loginPageRes.text();
    let cookies = mergeCookies("", extractCookies(loginPageRes.headers));

    logger.info("danplanner", "Got login page", { status: loginPageRes.status, htmlLength: loginHtml.length, cookiesSet: cookies.split("; ").length });

    const tokenMatch = loginHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
    if (!tokenMatch) {
      logger.error("danplanner", "Could not find verification token in login page", { htmlSnippet: loginHtml.slice(0, 500) });
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
    const loginStatus = loginRes.status;
    const loginLocation = loginRes.headers.get("location") || "";

    logger.info("danplanner", "Login POST response", { status: loginStatus, location: loginLocation });

    let finalHtml = "";
    let finalUrl = "";

    if (loginStatus >= 300 && loginStatus < 400 && loginLocation) {
      const redirectUrl = loginLocation.startsWith("http")
        ? loginLocation
        : new URL(loginLocation, config.baseUrl).toString();

      const followed = await followRedirect(redirectUrl, cookies);
      finalUrl = followed.finalUrl;
      finalHtml = followed.html;
      cookies = followed.cookies;
      logger.info("danplanner", "Followed redirect", { finalUrl, status: followed.status, htmlLength: finalHtml.length });
    } else if (loginStatus === 200) {
      finalHtml = await loginRes.text();
      finalUrl = `${config.baseUrl}/Account/login`;
      logger.info("danplanner", "Login returned 200", { htmlLength: finalHtml.length });
    } else {
      const body = await loginRes.text().catch(() => "");
      logger.error("danplanner", "Unexpected login response", { status: loginStatus, bodySnippet: body.slice(0, 500) });
      return { success: false, needs2FA: false, error: `Login fejlede (status ${loginStatus})` };
    }

    if (isApprovePage(finalHtml) || /ApproveIP/i.test(finalUrl)) {
      logger.info("danplanner", "2FA required - approve IP page detected", { finalUrl });
      return { success: false, needs2FA: true, sessionToken: cookies };
    }

    if (isLoginPage(finalHtml)) {
      const errorMatch = finalHtml.match(/<div[^>]*(?:validation-summary-errors|alert-danger|text-danger)[^>]*>([\s\S]*?)<\/div>/i);
      const errorText = errorMatch ? errorMatch[1].replace(/<[^>]+>/g, "").trim() : "Forkert brugernavn eller adgangskode";
      logger.warn("danplanner", "Login failed - back on login page", { error: errorText });
      return { success: false, needs2FA: false, error: errorText };
    }

    logger.info("danplanner", "Login successful", { finalUrl });
    return { success: true, needs2FA: false, sessionToken: cookies };
  } catch (err) {
    logger.error("danplanner", "Login error", err as Error);
    return { success: false, needs2FA: false, error: `Forbindelsesfejl: ${(err as Error).message}` };
  }
}

export async function danplannerVerify2FA(
  baseUrl: string,
  cookies: string,
  code: string,
): Promise<BookingVerifyResult> {
  try {
    logger.info("danplanner", "Starting 2FA verification");

    const candidateUrls = [
      `${baseUrl}/Account/ApproveIP`,
      `${baseUrl}/Account/Approve`,
      `${baseUrl}/Account/VerifyCode`,
    ];

    let approveUrl = "";
    let approveHtml = "";
    let workingCookies = cookies;

    for (const url of candidateUrls) {
      const res = await fetch(url, {
        headers: { Cookie: workingCookies },
        redirect: "manual",
      });
      workingCookies = mergeCookies(workingCookies, extractCookies(res.headers));

      if (res.status === 200) {
        const html = await res.text();
        if (isApprovePage(html)) {
          approveUrl = url;
          approveHtml = html;
          logger.info("danplanner", "Found approve page", { url, htmlLength: html.length });
          break;
        }
      } else if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (loc) {
          const redirectUrl = loc.startsWith("http") ? loc : new URL(loc, baseUrl).toString();
          const followed = await followRedirect(redirectUrl, workingCookies);
          workingCookies = followed.cookies;
          if (isApprovePage(followed.html)) {
            approveUrl = followed.finalUrl;
            approveHtml = followed.html;
            logger.info("danplanner", "Found approve page via redirect", { url: approveUrl });
            break;
          }
        }
      }
    }

    if (!approveUrl) {
      logger.error("danplanner", "Could not find approve IP page");
      return { success: false, error: "Kunne ikke finde godkendelsesside" };
    }

    const tokenMatch = approveHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
    const token = tokenMatch?.[1] || "";

    const body = new URLSearchParams({
      Code: code,
      __RequestVerificationToken: token,
    });

    const verifyRes = await fetch(approveUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: workingCookies,
      },
      body: body.toString(),
      redirect: "manual",
    });

    workingCookies = mergeCookies(workingCookies, extractCookies(verifyRes.headers));
    const verifyStatus = verifyRes.status;
    const verifyLocation = verifyRes.headers.get("location") || "";

    logger.info("danplanner", "2FA POST response", { status: verifyStatus, location: verifyLocation });

    let finalHtml = "";
    if (verifyStatus >= 300 && verifyStatus < 400 && verifyLocation) {
      const redirectUrl = verifyLocation.startsWith("http")
        ? verifyLocation
        : new URL(verifyLocation, baseUrl).toString();
      const followed = await followRedirect(redirectUrl, workingCookies);
      finalHtml = followed.html;
      workingCookies = followed.cookies;
    } else if (verifyStatus === 200) {
      finalHtml = await verifyRes.text();
    }

    if (isApprovePage(finalHtml)) {
      logger.warn("danplanner", "Still on approve page after verification - wrong code");
      return { success: false, error: "Forkert kode, prøv igen." };
    }

    logger.info("danplanner", "2FA verification successful");
    return { success: true, sessionToken: workingCookies };
  } catch (err) {
    logger.error("danplanner", "2FA error", err as Error);
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
    if (res.status >= 300 && res.status < 400) {
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
        logger.info("danplanner", "Test connection response", { status: res.status, htmlLength: html.length });
        if (html.includes("ResourceTypeList_") || html.includes("data-id")) {
          return { ok: true };
        }
        if (isLoginPage(html) || isApprovePage(html)) {
          return { ok: false, error: "Session udløbet. Log ind igen." };
        }
        return { ok: false, error: "Uventet svar fra Danplanner" };
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
      return parseTableRows(html).map((r) => ({
        externalId: r.id,
        name: r.name,
        typeId,
        typeName: typeId,
      }));
    },
  };
}
