"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  AUTHORIZE_FIELDS,
  buildRedirect,
  createAuthorizationCode,
  isMcpEnabled,
  originFromHeaders,
  validateAuthorizeRequest,
} from "@/lib/mcp/oauth";

function readParams(formData: FormData): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {};
  for (const key of AUTHORIZE_FIELDS) {
    const v = formData.get(key);
    if (typeof v === "string" && v !== "") params[key] = v;
  }
  return params;
}

function authorizePath(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, v);
  return `/oauth/authorize?${qs.toString()}`;
}

/**
 * Approve or deny from the consent page. Everything is re-validated here —
 * the hidden fields are attacker-controllable — and only a logged-in admin
 * can issue a code. Next's same-origin check on server actions is the CSRF
 * protection.
 */
async function decide(formData: FormData, approve: boolean): Promise<never> {
  const params = readParams(formData);
  const origin = originFromHeaders(await headers());

  if (!(await isMcpEnabled())) redirect(authorizePath(params));
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId) {
    redirect(`/login?next=${encodeURIComponent(authorizePath(params))}`);
  }

  const v = await validateAuthorizeRequest(params, origin);
  if (!v.ok) {
    if (!v.redirectable) redirect(authorizePath(params)); // page renders the error
    redirect(buildRedirect(v.redirectUri, {
      error: v.error, error_description: v.description, state: v.state, iss: origin,
    }));
  }

  const redirectHost = new URL(v.req.redirectUri).host;
  if (!approve) {
    logger.info("mcp", "OAuth client denied", { clientId: v.req.clientId, clientName: v.req.clientName, redirectHost });
    redirect(buildRedirect(v.req.redirectUri, {
      error: "access_denied", error_description: "Afvist af administrator", state: v.req.state, iss: origin,
    }));
  }

  const code = await createAuthorizationCode(v.req, session.userId);
  logger.info("mcp", "OAuth client approved", {
    clientId: v.req.clientId, clientName: v.req.clientName, redirectHost, userId: session.userId,
  });
  redirect(buildRedirect(v.req.redirectUri, { code, state: v.req.state, iss: origin }));
}

export async function approveAuthorization(formData: FormData) {
  await decide(formData, true);
}

export async function denyAuthorization(formData: FormData) {
  await decide(formData, false);
}
