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
