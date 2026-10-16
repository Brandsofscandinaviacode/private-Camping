// OAuth 2.1 authorization server + bearer verification for the MCP endpoint.
//
// Claude (claude.ai custom connectors, Claude Code) discovers this server via
// the protected-resource metadata, registers itself dynamically (RFC 7591),
// sends an admin through /oauth/authorize to approve read access, and then
// calls /api/mcp with a short-lived bearer token. A static read-only key
// (Indstillinger → Claude / MCP) is accepted too, for clients that only
// support a fixed Authorization header.
//
// Server-only module: never import from a client component. Codes, tokens and
// client secrets are stored as SHA-256 hashes only.

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

export const MCP_SCOPE = "campsense:read";
export const ACCESS_TOKEN_TTL_S = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60; // 30 days
export const AUTH_CODE_TTL_S = 5 * 60;
export const MAX_REGISTERED_CLIENTS = 50;

const SETTING_ENABLED = "mcp_enabled";
const SETTING_KEY_HASH = "mcp_api_key_hash";
const SETTING_KEY_HINT = "mcp_api_key_hint";
const SETTING_KEY_CREATED = "mcp_api_key_created_at";
const STATIC_KEY_PREFIX = "csmk_";

type TokenEndpointAuthMethod = "none" | "client_secret_post" | "client_secret_basic";
const AUTH_METHODS: TokenEndpointAuthMethod[] = ["none", "client_secret_post", "client_secret_basic"];

// ── Primitives ────────────────────────────────────────────────

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Random opaque secret with a recognisable prefix (256 bits of entropy). */
export function newSecret(prefix: string): string {
  return prefix + base64url(randomBytes(32));
}

/** Constant-time comparison of two hex digests. */
function hashEquals(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

// ── URLs ──────────────────────────────────────────────────────

/**
 * Public origin of the request as the client saw it. Behind Coolify/Traefik
 * the app receives plain HTTP, so the forwarded headers win.
 */
export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  return originFromHeaders(req.headers, url.host, url.protocol.replace(":", ""));
}

/**
 * Same as requestOrigin for server components / server actions, which only
 * have `await headers()`.
 */
export function originFromHeaders(
  h: { get(name: string): string | null },
  fallbackHost = "localhost:3000",
  fallbackProto = "http",
): string {
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? fallbackHost).split(",")[0].trim();
  let proto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() || fallbackProto;
  if (process.env.FORCE_HTTPS === "true" && !/^(localhost|127\.|\[::1\])/i.test(host)) proto = "https";
  return `${proto}://${host}`;
}

export const mcpResourceUrl = (origin: string) => `${origin}/api/mcp`;
export const protectedResourceMetadataUrl = (origin: string) =>
  `${origin}/.well-known/oauth-protected-resource/api/mcp`;

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "CampSense",
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    scopes_supported: [MCP_SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: AUTH_METHODS,
    revocation_endpoint_auth_methods_supported: AUTH_METHODS,
    authorization_response_iss_parameter_supported: true,
  };
}

/** True when `resource` (RFC 8707) names this server's MCP endpoint. */
export function isOwnResource(resource: string, origin: string): boolean {
  return resource.replace(/\/+$/, "") === mcpResourceUrl(origin);
}

// ── CORS / responses ──────────────────────────────────────────

/** Bearer-token endpoints carry no cookies, so a wildcard origin is safe. */
export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
    "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version",
    "Access-Control-Max-Age": "86400",
  };
}

export function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(), ...extra },
  });
}

export function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/** 401 that tells the client where to find the authorization server. */
export function unauthorizedResponse(origin: string, reason: "missing" | "invalid"): Response {
  const parts = [
    `resource_metadata="${protectedResourceMetadataUrl(origin)}"`,
    `scope="${MCP_SCOPE}"`,
  ];
  if (reason === "invalid") {
    parts.push(`error="invalid_token"`, `error_description="The access token is invalid or expired"`);
  }
  return jsonResponse(
    { error: reason === "invalid" ? "invalid_token" : "unauthorized", error_description: "Authorization required" },
    401,
    { "WWW-Authenticate": `Bearer ${parts.join(", ")}` },
  );
}

export function mcpDisabledResponse(): Response {
  return jsonResponse(
    { error: "mcp_disabled", error_description: "MCP-adgang er slået fra i CampSense (Indstillinger → Claude / MCP)" },
    403,
  );
}

// ── Settings ──────────────────────────────────────────────────

export async function isMcpEnabled(): Promise<boolean> {
  const row = await prisma.globalSetting.findUnique({ where: { key: SETTING_ENABLED } });
  return row?.value === "true";
}

export async function setMcpEnabled(enabled: boolean): Promise<void> {
  await prisma.globalSetting.upsert({
    where: { key: SETTING_ENABLED },
    update: { value: enabled ? "true" : "false" },
    create: { key: SETTING_ENABLED, value: enabled ? "true" : "false" },
  });
}

// ── Bearer verification (MCP endpoint) ────────────────────────

export type McpAuth =
  | { kind: "oauth"; userId: number; clientId: string; scope: string }
  | { kind: "key" };

const LAST_USED_THROTTLE_MS = 5 * 60_000;

export async function authenticateMcpRequest(
  req: Request,
): Promise<{ ok: true; auth: McpAuth } | { ok: false; reason: "missing" | "invalid" }> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) return { ok: false, reason: "missing" };
  const token = match[1];
  const hash = sha256(token);

  if (token.startsWith(STATIC_KEY_PREFIX)) {
    const row = await prisma.globalSetting.findUnique({ where: { key: SETTING_KEY_HASH } });
    if (row?.value && hashEquals(hash, row.value)) return { ok: true, auth: { kind: "key" } };
    return { ok: false, reason: "invalid" };
  }

  const now = new Date();
  const row = await prisma.mcpOAuthToken.findUnique({ where: { tokenHash: hash } });
  if (!row || row.kind !== "access" || row.revokedAt || row.expiresAt <= now) {
    return { ok: false, reason: "invalid" };
  }
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    await Promise.all([
      prisma.mcpOAuthToken.update({ where: { id: row.id }, data: { lastUsedAt: now } }),
      prisma.mcpOAuthClient.update({ where: { clientId: row.clientId }, data: { lastUsedAt: now } }),
    ]).catch(() => {});
  }
  return { ok: true, auth: { kind: "oauth", userId: row.userId, clientId: row.clientId, scope: row.scope } };
}

// ── Dynamic client registration (RFC 7591) ────────────────────

/**
 * Redirect URIs must be https, or http on a loopback address (Claude Code
 * and other local clients). No fragments, no custom schemes.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  if (typeof uri !== "string" || uri.length > 2000) return false;
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}

/** Redirects that belong to Claude itself or a local client — no warning needed. */
export function isKnownClaudeRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    return u.protocol === "https:" && ["claude.ai", "claude.com"].includes(u.hostname);
  } catch {
    return false;
  }
}

type OAuthError = { ok: false; status: number; error: string; description: string };

export async function registerClient(input: Record<string, unknown>): Promise<
  { ok: true; body: Record<string, unknown> } | OAuthError
> {
  const bad = (description: string, error = "invalid_client_metadata"): OAuthError =>
    ({ ok: false, status: 400, error, description });

  const redirectUris = input.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 10) {
    return bad("redirect_uris must be a non-empty array (max 10)", "invalid_redirect_uri");
  }
  for (const uri of redirectUris) {
    if (typeof uri !== "string" || !isAllowedRedirectUri(uri)) {
      return bad(`redirect_uri not allowed: ${String(uri).slice(0, 200)} (https or http://localhost only)`, "invalid_redirect_uri");
    }
  }

  const method = (input.token_endpoint_auth_method ?? "client_secret_basic") as TokenEndpointAuthMethod;
  if (!AUTH_METHODS.includes(method)) return bad("unsupported token_endpoint_auth_method");

  const grantTypes = (input.grant_types ?? ["authorization_code"]) as unknown;
  if (!Array.isArray(grantTypes) || grantTypes.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    return bad("grant_types may only contain authorization_code and refresh_token");
  }
  const responseTypes = (input.response_types ?? ["code"]) as unknown;
  if (!Array.isArray(responseTypes) || responseTypes.some((r) => r !== "code")) {
    return bad("response_types may only contain code");
  }

  const clientName = typeof input.client_name === "string" ? input.client_name.slice(0, 100) : null;

  // Registration is open by design (MCP clients self-register). Keep the
  // table bounded: drop stale clients that never obtained a token.
  const total = await prisma.mcpOAuthClient.count();
  if (total >= MAX_REGISTERED_CLIENTS) {
    await prisma.mcpOAuthClient.deleteMany({
      where: { tokens: { none: {} }, createdAt: { lt: new Date(Date.now() - 60 * 60_000) } },
    });
    if ((await prisma.mcpOAuthClient.count()) >= MAX_REGISTERED_CLIENTS) {
      return { ok: false, status: 429, error: "temporarily_unavailable", description: "Too many registered clients" };
    }
  }

  const clientId = newSecret("csc_");
  const clientSecret = method === "none" ? null : newSecret("cscs_");
  const created = await prisma.mcpOAuthClient.create({
    data: {
      clientId,
      clientSecretHash: clientSecret ? sha256(clientSecret) : null,
      clientName,
      redirectUris: JSON.stringify(redirectUris),
      tokenEndpointAuthMethod: method,
    },
  });

  return {
    ok: true,
    body: {
      client_id: clientId,
      client_id_issued_at: Math.floor(created.createdAt.getTime() / 1000),
      ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
      client_name: clientName ?? undefined,
      redirect_uris: redirectUris,
      grant_types: grantTypes.length ? grantTypes : ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: method,
      scope: MCP_SCOPE,
    },
  };
}

function parseRedirectUris(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// ── Authorization request (/oauth/authorize) ──────────────────

export interface AuthorizeRequest {
  clientId: string;
  clientName: string | null;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: string;
  resource: string | null;
}

export type AuthorizeValidation =
  | { ok: true; req: AuthorizeRequest }
  /** Client or redirect URI can't be trusted — show the error, never redirect. */
  | { ok: false; redirectable: false; error: string }
  /** Report the error back to the (verified) redirect URI. */
  | { ok: false; redirectable: true; redirectUri: string; state: string | null; error: string; description: string };

export async function validateAuthorizeRequest(
  params: Record<string, string | undefined>,
  origin: string,
): Promise<AuthorizeValidation> {
  const clientId = params.client_id;
  if (!clientId) return { ok: false, redirectable: false, error: "client_id mangler" };
  const client = await prisma.mcpOAuthClient.findUnique({ where: { clientId } });
  if (!client) return { ok: false, redirectable: false, error: "Ukendt klient (client_id). Tilføj connectoren igen i Claude." };

  const registered = parseRedirectUris(client.redirectUris);
  let redirectUri = params.redirect_uri;
  if (!redirectUri && registered.length === 1) redirectUri = registered[0];
  if (!redirectUri || !registered.includes(redirectUri)) {
    return { ok: false, redirectable: false, error: "redirect_uri matcher ikke klientens registrering" };
  }

  const state = params.state ?? null;
  const fail = (error: string, description: string): AuthorizeValidation =>
    ({ ok: false, redirectable: true, redirectUri: redirectUri!, state, error, description });

  if (params.response_type !== "code") return fail("unsupported_response_type", "response_type must be code");
  const codeChallenge = params.code_challenge;
  if (!codeChallenge || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    return fail("invalid_request", "PKCE code_challenge is required");
  }
  if ((params.code_challenge_method ?? "") !== "S256") {
    return fail("invalid_request", "code_challenge_method must be S256");
  }
  const scopes = (params.scope ?? "").split(/\s+/).filter(Boolean);
  if (scopes.some((s) => s !== MCP_SCOPE)) return fail("invalid_scope", `Only ${MCP_SCOPE} is supported`);
  const resource = params.resource ?? null;
  if (resource && !isOwnResource(resource, origin)) {
    return fail("invalid_target", "resource must be this server's MCP endpoint");
  }

  return {
    ok: true,
    req: { clientId, clientName: client.clientName, redirectUri, state, codeChallenge, scope: MCP_SCOPE, resource },
  };
}

/** Append OAuth response parameters to a registered redirect URI. */
export function buildRedirect(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return u.toString();
}

export async function createAuthorizationCode(req: AuthorizeRequest, userId: number): Promise<string> {
  const code = newSecret("csac_");
  await prisma.mcpOAuthCode.create({
    data: {
      codeHash: sha256(code),
      clientId: req.clientId,
      userId,
      redirectUri: req.redirectUri,
      codeChallenge: req.codeChallenge,
      scope: req.scope,
      resource: req.resource,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_S * 1000),
    },
  });
  return code;
}

// ── Token endpoint ────────────────────────────────────────────

type TokenResult = { status: number; body: Record<string, unknown>; headers?: Record<string, string> };

const tokenError = (error: string, description: string, status = 400): TokenResult =>
  ({ status, body: { error, error_description: description } });

async function issueTokens(clientId: string, userId: number, scope: string): Promise<TokenResult> {
  const access = newSecret("csat_");
  const refresh = newSecret("csrt_");
  const now = Date.now();
  await prisma.mcpOAuthToken.createMany({
    data: [
      { tokenHash: sha256(access), kind: "access", clientId, userId, scope, expiresAt: new Date(now + ACCESS_TOKEN_TTL_S * 1000) },
      { tokenHash: sha256(refresh), kind: "refresh", clientId, userId, scope, expiresAt: new Date(now + REFRESH_TOKEN_TTL_S * 1000) },
    ],
  });
  await prisma.mcpOAuthClient.update({ where: { clientId }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return {
    status: 200,
    body: { access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_S, refresh_token: refresh, scope },
  };
}

/**
 * Authenticate the client at the token/revocation endpoint. Public clients
 * (method "none") are identified by client_id only — PKCE protects them.
 */
async function authenticateClient(form: URLSearchParams, authHeader: string | null) {
  let clientId = form.get("client_id");
  let clientSecret = form.get("client_secret");
  const basic = /^Basic\s+(\S+)$/i.exec(authHeader ?? "");
  if (basic) {
    try {
      const decoded = Buffer.from(basic[1], "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx > 0) {
        clientId = decodeURIComponent(decoded.slice(0, idx));
        clientSecret = decodeURIComponent(decoded.slice(idx + 1));
      }
    } catch { /* fall through to invalid_client */ }
  }
  if (!clientId) return null;
  const client = await prisma.mcpOAuthClient.findUnique({ where: { clientId } });
  if (!client) return null;
  if (client.tokenEndpointAuthMethod !== "none") {
    if (!clientSecret || !client.clientSecretHash || !hashEquals(sha256(clientSecret), client.clientSecretHash)) return null;
  }
  return client;
}

/** Revoke every token a client holds (code replay / refresh-token reuse). */
async function revokeClientTokens(clientId: string): Promise<void> {
  await prisma.mcpOAuthToken.updateMany({ where: { clientId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function handleTokenRequest(form: URLSearchParams, authHeader: string | null, origin: string): Promise<TokenResult> {
  const client = await authenticateClient(form, authHeader);
  if (!client) {
    return { ...tokenError("invalid_client", "Client authentication failed", 401), headers: { "WWW-Authenticate": 'Basic realm="CampSense"' } };
  }

  const resource = form.get("resource");
  if (resource && !isOwnResource(resource, origin)) {
    return tokenError("invalid_target", "resource must be this server's MCP endpoint");
  }

  const grantType = form.get("grant_type");

  if (grantType === "authorization_code") {
    const code = form.get("code");
    const verifier = form.get("code_verifier");
    const redirectUri = form.get("redirect_uri");
    if (!code || !verifier) return tokenError("invalid_request", "code and code_verifier are required");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return tokenError("invalid_grant", "Invalid code_verifier");

    const row = await prisma.mcpOAuthCode.findUnique({ where: { codeHash: sha256(code) } });
    if (!row || row.clientId !== client.clientId) return tokenError("invalid_grant", "Unknown authorization code");
    if (row.usedAt) {
      // A replayed code may have been intercepted — kill what it produced.
      await revokeClientTokens(client.clientId);
      return tokenError("invalid_grant", "Authorization code already used");
    }
    if (row.expiresAt <= new Date()) return tokenError("invalid_grant", "Authorization code expired");
    if (redirectUri && redirectUri !== row.redirectUri) return tokenError("invalid_grant", "redirect_uri mismatch");
    if (!redirectUri && parseRedirectUris(client.redirectUris).length !== 1) {
      return tokenError("invalid_request", "redirect_uri is required");
    }
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    if (challenge !== row.codeChallenge) return tokenError("invalid_grant", "PKCE verification failed");

    // Single use, atomically — two concurrent exchanges can't both win.
    const claimed = await prisma.mcpOAuthCode.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) return tokenError("invalid_grant", "Authorization code already used");

    return issueTokens(client.clientId, row.userId, row.scope);
  }

  if (grantType === "refresh_token") {
    const refresh = form.get("refresh_token");
    if (!refresh) return tokenError("invalid_request", "refresh_token is required");
    const row = await prisma.mcpOAuthToken.findUnique({ where: { tokenHash: sha256(refresh) } });
    if (!row || row.kind !== "refresh" || row.clientId !== client.clientId) {
      return tokenError("invalid_grant", "Unknown refresh token");
    }
    if (row.revokedAt) {
      // Rotated tokens are single use; reuse means it leaked.
      await revokeClientTokens(client.clientId);
      return tokenError("invalid_grant", "Refresh token already used");
    }
    if (row.expiresAt <= new Date()) return tokenError("invalid_grant", "Refresh token expired");
    const scope = form.get("scope");
    if (scope && scope.split(/\s+/).some((s) => s && s !== MCP_SCOPE)) {
      return tokenError("invalid_scope", `Only ${MCP_SCOPE} is supported`);
    }

    const rotated = await prisma.mcpOAuthToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count === 0) return tokenError("invalid_grant", "Refresh token already used");

    return issueTokens(client.clientId, row.userId, row.scope);
  }

  return tokenError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
}

/** RFC 7009: always 200, even for unknown tokens. */
export async function handleRevocationRequest(form: URLSearchParams, authHeader: string | null): Promise<TokenResult> {
  const client = await authenticateClient(form, authHeader);
  if (!client) {
    return { ...tokenError("invalid_client", "Client authentication failed", 401), headers: { "WWW-Authenticate": 'Basic realm="CampSense"' } };
  }
  const token = form.get("token");
  if (token) {
    await prisma.mcpOAuthToken.updateMany({
      where: { tokenHash: sha256(token), clientId: client.clientId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  return { status: 200, body: {} };
}

// ── Admin management ──────────────────────────────────────────

export async function getMcpAdminOverview() {
  const now = new Date();
  const [enabled, keyHint, keyCreated, clients] = await Promise.all([
    isMcpEnabled(),
    prisma.globalSetting.findUnique({ where: { key: SETTING_KEY_HINT } }),
    prisma.globalSetting.findUnique({ where: { key: SETTING_KEY_CREATED } }),
    prisma.mcpOAuthClient.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        tokens: {
          where: { revokedAt: null, expiresAt: { gt: now } },
          select: { kind: true, lastUsedAt: true },
        },
      },
    }),
  ]);
  return {
    enabled,
    apiKey: keyHint?.value ? { hint: keyHint.value, createdAt: keyCreated?.value ?? null } : null,
    // Only clients that were actually authorised are interesting to the admin.
    clients: clients
      .filter((c) => c.tokens.length > 0)
      .map((c) => ({
        clientId: c.clientId,
        clientName: c.clientName,
        redirectHosts: [...new Set(parseRedirectUris(c.redirectUris).map((u) => { try { return new URL(u).host; } catch { return u; } }))],
        createdAt: c.createdAt.toISOString(),
        lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
      })),
  };
}

/** Creates (or replaces) the static read-only key. The plain key is returned once. */
export async function generateMcpApiKey(): Promise<string> {
  const key = newSecret(STATIC_KEY_PREFIX);
  const rows = [
    { key: SETTING_KEY_HASH, value: sha256(key) },
    { key: SETTING_KEY_HINT, value: `${key.slice(0, 9)}…${key.slice(-4)}` },
    { key: SETTING_KEY_CREATED, value: new Date().toISOString() },
  ];
  for (const r of rows) {
    await prisma.globalSetting.upsert({ where: { key: r.key }, update: { value: r.value }, create: r });
  }
  return key;
}

export async function deleteMcpApiKey(): Promise<void> {
  await prisma.globalSetting.deleteMany({ where: { key: { in: [SETTING_KEY_HASH, SETTING_KEY_HINT, SETTING_KEY_CREATED] } } });
}

export async function revokeMcpClient(clientId: string): Promise<void> {
  await prisma.mcpOAuthClient.deleteMany({ where: { clientId } });
}

export async function revokeAllMcpClients(): Promise<void> {
  await prisma.mcpOAuthClient.deleteMany({});
}

/** Nightly housekeeping: expired codes/tokens and abandoned registrations. */
export async function cleanupMcpOAuth(): Promise<{ codes: number; tokens: number; clients: number }> {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600_000);
  const codes = await prisma.mcpOAuthCode.deleteMany({ where: { expiresAt: { lt: dayAgo } } });
  const tokens = await prisma.mcpOAuthToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: dayAgo } }] },
  });
  const clients = await prisma.mcpOAuthClient.deleteMany({
    where: { tokens: { none: {} }, createdAt: { lt: new Date(now.getTime() - 7 * 24 * 3600_000) } },
  });
  return { codes: codes.count, tokens: tokens.count, clients: clients.count };
}
