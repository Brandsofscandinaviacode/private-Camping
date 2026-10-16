// Shared GET/OPTIONS handlers for the OAuth discovery documents under
// /.well-known. They 404 while MCP access is switched off, so the app does
// not advertise an authorization server nobody enabled.

import {
  authorizationServerMetadata,
  isMcpEnabled,
  jsonResponse,
  preflightResponse,
  protectedResourceMetadata,
  requestOrigin,
} from "@/lib/mcp/oauth";

async function serve(req: Request, build: (origin: string) => unknown): Promise<Response> {
  if (!(await isMcpEnabled())) return jsonResponse({ error: "not_found" }, 404);
  // Discovery documents are public and identical per host — allow caching.
  return jsonResponse(build(requestOrigin(req)), 200, { "Cache-Control": "public, max-age=300" });
}

export const protectedResourceHandlers = {
  GET: (req: Request) => serve(req, protectedResourceMetadata),
  OPTIONS: () => preflightResponse(),
};

export const authorizationServerHandlers = {
  GET: (req: Request) => serve(req, authorizationServerMetadata),
  OPTIONS: () => preflightResponse(),
};
