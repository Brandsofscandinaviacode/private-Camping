import type { BookingProvider, BookingEntry, BookingLoginResult, BookingVerifyResult } from "./types";
import { logger } from "../logger";

interface DanplannerConfig {
  baseUrl: string;
  username: string;
  password: string;
  sessionCookies?: string;
  /**
   * Called when the provider silently re-authenticates, so the caller can
   * persist the fresh session. Without it the new cookies are used for the
   * current request only and the next call has to log in again.
   */
  onSessionRefreshed?: (cookies: string) => void | Promise<void>;
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
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
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

interface ParsedForm {
  action: string;
  method: string;
  fields: Record<string, string>;
  visibleInputNames: string[];
}

function parseFormFromHtml(html: string, hint?: RegExp): ParsedForm | null {
  const formRegex = /<form([^>]*)>([\s\S]*?)<\/form>/gi;
  let match: RegExpExecArray | null;
  let bestForm: { attrs: string; body: string } | null = null;

  while ((match = formRegex.exec(html)) !== null) {
    const attrs = match[1];
    const body = match[2];
    if (hint && hint.test(body)) {
      bestForm = { attrs, body };
      break;
    }
    if (!bestForm) bestForm = { attrs, body };
  }

  if (!bestForm) return null;

  const actionMatch = bestForm.attrs.match(/action=["']([^"']*)["']/i);
  const methodMatch = bestForm.attrs.match(/method=["']([^"']*)["']/i);

  const fields: Record<string, string> = {};
  const visibleInputNames: string[] = [];
  const inputRegex = /<input\b([^>]*)>/gi;
  let im: RegExpExecArray | null;
  while ((im = inputRegex.exec(bestForm.body)) !== null) {
    const inputAttrs = im[1];
    const nameMatch = inputAttrs.match(/name=["']([^"']+)["']/i);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const valueMatch = inputAttrs.match(/value=["']([^"']*)["']/i);
    const typeMatch = inputAttrs.match(/type=["']([^"']*)["']/i);
    const type = (typeMatch?.[1] || "text").toLowerCase();
    fields[name] = valueMatch ? valueMatch[1] : "";
    if (type !== "hidden" && type !== "submit" && type !== "button" && type !== "checkbox") {
      visibleInputNames.push(name);
    }
  }

  return {
    action: actionMatch?.[1] || "",
    method: (methodMatch?.[1] || "post").toLowerCase(),
    fields,
    visibleInputNames,
  };
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
      const parsed = parseFormFromHtml(finalHtml, /name=["']Code["']|verification|approve/i);
      if (parsed) {
        logger.info("danplanner", "Parsed approve form", {
          action: parsed.action,
          method: parsed.method,
          fieldNames: Object.keys(parsed.fields),
          visibleInputs: parsed.visibleInputNames,
          hiddenValuesPresent: Object.entries(parsed.fields)
            .filter(([k]) => k !== "__RequestVerificationToken")
            .map(([k, v]) => `${k}=${v ? "[set]" : "[empty]"}`),
        });

        let actionUrl = parsed.action;
        if (actionUrl && !actionUrl.startsWith("http")) {
          actionUrl = new URL(actionUrl, config.baseUrl).toString();
        }

        return {
          success: false,
          needs2FA: true,
          sessionToken: cookies,
          approveFormData: parsed.fields,
          approveFormAction: actionUrl || `${config.baseUrl}/Account/ApproveIp`,
        };
      } else {
        logger.warn("danplanner", "Could not parse approve form");
      }
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
  cachedForm?: { action: string; fields: Record<string, string> },
): Promise<BookingVerifyResult> {
  try {
    logger.info("danplanner", "Starting 2FA verification", { hasCachedForm: !!cachedForm });

    let actionUrl: string;
    const fields: Record<string, string> = {};
    let approveUrl = "";
    let workingCookies = cookies;

    if (cachedForm && Object.keys(cachedForm.fields).length > 0) {
      Object.assign(fields, cachedForm.fields);
      actionUrl = cachedForm.action;
      approveUrl = `${baseUrl}/Account/login`;
      logger.info("danplanner", "Using cached approve form", {
        action: actionUrl,
        fieldNames: Object.keys(fields),
        hiddenValuesPresent: Object.entries(fields)
          .filter(([k]) => k !== "__RequestVerificationToken")
          .map(([k, v]) => `${k}=${v ? "[set]" : "[empty]"}`),
      });
    } else {
      const candidateUrls = [
        `${baseUrl}/Account/ApproveIp`,
        `${baseUrl}/Account/ApproveIP`,
        `${baseUrl}/Account/Approve`,
        `${baseUrl}/`,
      ];

      let approveHtml = "";
      for (const url of candidateUrls) {
        const res = await fetch(url, {
          headers: { Cookie: workingCookies },
          redirect: "manual",
        });
        workingCookies = mergeCookies(workingCookies, extractCookies(res.headers));

        let html = "";
        let finalUrl = url;

        if (res.status === 200) {
          html = await res.text();
        } else if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (loc) {
            const redirectUrl = loc.startsWith("http") ? loc : new URL(loc, baseUrl).toString();
            const followed = await followRedirect(redirectUrl, workingCookies);
            workingCookies = followed.cookies;
            html = followed.html;
            finalUrl = followed.finalUrl;
          }
        }

        if (html && isApprovePage(html)) {
          approveUrl = finalUrl;
          approveHtml = html;
          logger.info("danplanner", "Found approve page (fallback)", { url: approveUrl, htmlLength: html.length });
          break;
        }
      }

      if (!approveUrl) {
        logger.error("danplanner", "Could not find approve IP page");
        return { success: false, error: "Kunne ikke finde godkendelsesside" };
      }

      const form = parseFormFromHtml(approveHtml, /name=["']Code["']|verification|approve|otp/i);
      if (!form) {
        logger.error("danplanner", "Could not parse approve form", { htmlSnippet: approveHtml.slice(0, 800) });
        return { success: false, error: "Kunne ikke læse godkendelsesformularen" };
      }

      Object.assign(fields, form.fields);
      actionUrl = form.action;
      if (!actionUrl) {
        actionUrl = approveUrl;
      } else if (!actionUrl.startsWith("http")) {
        actionUrl = new URL(actionUrl, baseUrl).toString();
      }
    }

    const codeFieldCandidates = ["Code", "code", "VerificationCode", "OTP", "PinCode"];
    const fieldKeys = Object.keys(fields);
    let codeFieldName = fieldKeys.find((n) => codeFieldCandidates.some((c) => c.toLowerCase() === n.toLowerCase()));
    if (!codeFieldName) {
      codeFieldName = "Code";
    }
    fields[codeFieldName] = code;

    logger.info("danplanner", "Submitting approve form", {
      action: actionUrl,
      codeField: codeFieldName,
      fieldNames: Object.keys(fields),
      hasToken: !!fields["__RequestVerificationToken"],
      usernameSet: !!fields["Username"],
      passwordSet: !!fields["Password"],
    });

    const body = new URLSearchParams(fields);

    const verifyRes = await fetch(actionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: workingCookies,
        Referer: approveUrl || `${baseUrl}/Account/login`,
        Origin: baseUrl,
      },
      body: body.toString(),
      redirect: "manual",
    });

    workingCookies = mergeCookies(workingCookies, extractCookies(verifyRes.headers));
    const verifyStatus = verifyRes.status;
    const verifyLocation = verifyRes.headers.get("location") || "";

    logger.info("danplanner", "2FA POST response", { status: verifyStatus, location: verifyLocation });

    let finalHtml = "";
    let finalUrl = actionUrl;
    if (verifyStatus >= 300 && verifyStatus < 400 && verifyLocation) {
      const redirectUrl = verifyLocation.startsWith("http")
        ? verifyLocation
        : new URL(verifyLocation, baseUrl).toString();
      const followed = await followRedirect(redirectUrl, workingCookies);
      finalHtml = followed.html;
      finalUrl = followed.finalUrl;
      workingCookies = followed.cookies;
      logger.info("danplanner", "2FA followed redirect", { finalUrl, htmlLength: finalHtml.length });
    } else if (verifyStatus === 200) {
      finalHtml = await verifyRes.text();
    }

    if (isApprovePage(finalHtml)) {
      const errorMatch = finalHtml.match(/<div[^>]*(?:validation-summary-errors|alert-danger|text-danger|error)[^>]*>([\s\S]*?)<\/div>/i);
      const errorText = errorMatch ? errorMatch[1].replace(/<[^>]+>/g, "").trim() : "";

      const formStart = finalHtml.search(/<form/i);
      const formEnd = finalHtml.indexOf("</form>", formStart);
      const formSnippet = formStart >= 0 && formEnd > formStart
        ? finalHtml.slice(formStart, formEnd + 7)
        : finalHtml.slice(0, 800);

      logger.warn("danplanner", "Still on approve page after verification", {
        errorText,
        htmlLength: finalHtml.length,
        formSnippet: formSnippet.slice(0, 1500),
      });
      return { success: false, error: errorText || "Forkert kode, prøv igen." };
    }

    if (isLoginPage(finalHtml)) {
      logger.warn("danplanner", "Redirected to login page after verification");
      return { success: false, error: "Session udløbet. Log ind igen." };
    }

    logger.info("danplanner", "2FA verification successful", { finalUrl });
    return { success: true, sessionToken: workingCookies };
  } catch (err) {
    logger.error("danplanner", "2FA error", err as Error);
    return { success: false, error: `Fejl: ${(err as Error).message}` };
  }
}

function parseBookings(html: string): BookingEntry[] {
  const bookings: BookingEntry[] = [];
  const rowRegex = /<tr\s+class="bookingItem"[^>]*>([\s\S]*?)<\/tr>/g;
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(html)) !== null) {
    const row = match[1];

    const bookingIdMatch = row.match(/data-bookingid="(\d+)"/);
    const customerIdMatch = row.match(/data-customerid="(\d+)"/);
    const emailMatch = row.match(/data-customermail="([^"]*)"/);
    const mobileMatch = row.match(/data-mobile="([^"]*)"/);
    const langMatch = row.match(/data-language="([^"]*)"/);

    const bookingNumMatch = row.match(/<a[^>]*href="\/Booking\/Edit\/[^"]+"[^>]*>[\s\S]*?<\/i>\s*(\d+)\s*<\/a>/);
    const placeMatch = row.match(/<td[^>]*data-sort="[^"]*"[^>]*>\s*<a[^>]*>\s*<span>([^<]+)<\/span>/);
    const customerNameMatch = row.match(/<a\s+class="truncate"[^>]*>[\s\S]*?<\/i>\s*([^<]+?)\s*<\/a>/);
    const guestNamesMatch = row.match(/<td>\s*<span>([^<]+)<\/span>\s*<\/td>/);
    const countryMatch = row.match(/title="([^"]+)"/);

    const dateColMatch = row.match(
      /<td[^>]*data-sort="(\d{4}-\d{2}-\d{2})"[^>]*>([\s\S]*?)<\/td>/,
    );

    if (!bookingIdMatch || !placeMatch || !dateColMatch) continue;

    const arrivalDate = dateColMatch[1];
    const dateInner = dateColMatch[2];
    const dateSpans = [...dateInner.matchAll(/<span>(\d{2}-\d{2})<\/span>/g)].map((m) => m[1]);
    if (dateSpans.length < 2) continue;

    const arrivalYear = parseInt(arrivalDate.slice(0, 4), 10);
    const arrivalMonth = parseInt(arrivalDate.slice(5, 7), 10);
    const arrivalDay = parseInt(arrivalDate.slice(8, 10), 10);

    const [depDayStr, depMonthStr] = dateSpans[1].split("-");
    const depDay = parseInt(depDayStr, 10);
    const depMonth = parseInt(depMonthStr, 10);
    let depYear = arrivalYear;
    if (depMonth < arrivalMonth || (depMonth === arrivalMonth && depDay < arrivalDay)) {
      depYear = arrivalYear + 1;
    }
    const depDate = `${depYear}-${String(depMonth).padStart(2, "0")}-${String(depDay).padStart(2, "0")}`;

    bookings.push({
      externalBookingId: bookingIdMatch[1],
      externalCustomerId: customerIdMatch?.[1] || "",
      bookingNumber: bookingNumMatch?.[1]?.trim() || bookingIdMatch[1],
      unitName: decodeHtmlEntities(placeMatch[1].trim()),
      customerName: decodeHtmlEntities((customerNameMatch?.[1] || "").trim()),
      guestNames: decodeHtmlEntities((guestNamesMatch?.[1] || "").trim()),
      email: (emailMatch?.[1] || "").trim(),
      phone: (mobileMatch?.[1] || "").trim(),
      language: langMatch?.[1] || "da",
      country: decodeHtmlEntities(countryMatch?.[1] || ""),
      checkIn: arrivalDate,
      checkOut: depDate,
    });
  }

  return bookings;
}

export function createDanplannerProvider(config: DanplannerConfig): BookingProvider {
  // Mutable: refreshed in place when the session expires and we log back in.
  let cookies = config.sessionCookies || "";

  /**
   * Log in again with the stored credentials after the session expires.
   *
   * Danplanner's 2FA approves the *IP*, not the session, so once an admin has
   * verified this server a plain re-login succeeds. If it does come back
   * needing 2FA we surface that instead of retrying forever.
   */
  async function reauthenticate(): Promise<boolean> {
    if (!config.username || !config.password) {
      logger.warn("danplanner", "Session expired but no stored credentials to re-login with");
      return false;
    }
    logger.info("danplanner", "Session expired — attempting automatic re-login");
    const result = await danplannerLogin(config);
    if (result.success && result.sessionToken) {
      cookies = result.sessionToken;
      try {
        await config.onSessionRefreshed?.(cookies);
      } catch (e) {
        logger.error("danplanner", "Could not persist refreshed session", e instanceof Error ? e.message : e);
      }
      logger.info("danplanner", "Automatic re-login succeeded");
      return true;
    }
    logger.error("danplanner", "Automatic re-login failed", {
      needs2FA: result.needs2FA,
      error: result.error,
    });
    return false;
  }

  /** True when a response means "your session is gone", not a real failure. */
  function isSessionExpired(status: number, location: string, html?: string): boolean {
    if (status === 401 || status === 403) return true;
    if (status >= 300 && status < 400 && /login/i.test(location)) return true;
    if (html && (isLoginPage(html) || isApprovePage(html))) return true;
    return false;
  }

  async function authedFetch(path: string, isRetry = false): Promise<Response> {
    if (!cookies) {
      // No session at all — try to establish one before giving up.
      if (!isRetry && (await reauthenticate())) return authedFetch(path, true);
      throw new Error("Ikke forbundet til Danplanner. Log ind først.");
    }
    const res = await fetch(`${config.baseUrl}${path}`, {
      headers: { Cookie: cookies },
      redirect: "manual",
    });
    const loc = res.headers.get("location") || "";
    if (isSessionExpired(res.status, loc)) {
      if (!isRetry && (await reauthenticate())) return authedFetch(path, true);
      throw new Error("Session udløbet — automatisk login mislykkedes. Log ind igen under Indstillinger → Booking.");
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

    async getBookings(productType = "all") {
      const productTypeMap: Record<string, string> = { all: "0", tourist: "1", seasonal: "2" };
      const productTypeValue = productTypeMap[productType] || "0";

      const attempt = async (isRetry: boolean): Promise<BookingEntry[]> => {

      // First GET dashboard to obtain a fresh antiforgery token (some Danplanner
      // AJAX endpoints validate the token even though the cookie alone is sent
      // on subsequent requests).
      let token = "";
      try {
        const dashRes = await fetch(`${config.baseUrl}/`, {
          headers: { Cookie: cookies },
          redirect: "manual",
        });
        if (dashRes.status === 200) {
          const dashHtml = await dashRes.text();
          const m = dashHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
          if (m) token = m[1];
        }
        logger.info("danplanner", "Fetched dashboard for antiforgery token", {
          status: dashRes.status,
          tokenFound: !!token,
        });
      } catch (err) {
        logger.warn("danplanner", "Could not fetch dashboard for token", { error: (err as Error).message });
      }

      const bodyParams: Record<string, string> = {
        GuestsProductType: productTypeValue,
        IncludeArrivals: "True",
      };
      if (token) bodyParams["__RequestVerificationToken"] = token;
      const body = new URLSearchParams(bodyParams);

      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookies,
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${config.baseUrl}/`,
        Origin: config.baseUrl,
      };
      if (token) headers["RequestVerificationToken"] = token;

      const res = await fetch(`${config.baseUrl}/Dashboard/GetGuests`, {
        method: "POST",
        headers,
        body: body.toString(),
        redirect: "manual",
      });

      const html = await res.text();
      logger.info("danplanner", "GetGuests response", {
        status: res.status,
        htmlLength: html.length,
        productType: productTypeValue,
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location") || "";
        if (loc.includes("login") || loc.includes("Login")) {
          throw new Error("Session udløbet. Log ind igen.");
        }
      }

      // Session gone (401/403, redirect to login, or a login/approve page
      // served with 200) — re-authenticate once, then run the whole flow
      // again so the antiforgery token is fetched with the new cookies too.
      if (isSessionExpired(res.status, res.headers.get("location") || "", html)) {
        if (!isRetry && (await reauthenticate())) return attempt(true);
        throw new Error("Session udløbet — automatisk login mislykkedes. Log ind igen under Indstillinger → Booking.");
      }

      if (res.status >= 400) {
        logger.error("danplanner", "GetGuests failed", {
          status: res.status,
          bodySnippet: html.slice(0, 800),
        });
        throw new Error(`GetGuests fejlede (status ${res.status})`);
      }

      const bookings = parseBookings(html);
      logger.info("danplanner", "Parsed bookings", { count: bookings.length });
      return bookings;
      }

      // No session yet — establish one before the first attempt.
      if (!cookies && !(await reauthenticate())) {
        throw new Error("Ikke forbundet til Danplanner. Log ind først.");
      }
      return attempt(false);
    },
  };
}
