import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createCampSenseMcpServer } from "@/lib/mcp/server";
import {
  authenticateMcpRequest,
  corsHeaders,
  isMcpEnabled,
  jsonResponse,
  mcpDisabledResponse,
  preflightResponse,
  requestOrigin,
  unauthorizedResponse,
  type McpAuth,
} from "@/lib/mcp/oauth";
import { runWithApiAuth } from "@/lib/auth-context";
import { logger } from "@/lib/logger";

// /api/mcp — read-only MCP endpoint (Streamable HTTP, stateless).
//
// Every POST gets its own McpServer + transport and a plain JSON response, so
// nothing is kept between requests and no SSE stream is held open. A missing
// or invalid bearer token returns 401 with WWW-Authenticate pointing at the
// protected-resource metadata — that is what starts Claude's OAuth flow.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Gate shared by every method: MCP switched on, and a valid bearer. */
async function authorize(req: Request): Promise<McpAuth | Response> {
  if (!(await isMcpEnabled())) return mcpDisabledResponse();
  const result = await authenticateMcpRequest(req);
  if (!result.ok) return unauthorizedResponse(requestOrigin(req), result.reason);
  return result.auth;
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
  headers.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Stateless mode has no standalone SSE stream (GET) and no session to end (DELETE). */
function methodNotAllowed(): Response {
  return jsonResponse(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed — this server is stateless; use POST." }, id: null },
    405,
    { Allow: "POST, OPTIONS" },
  );
}

export async function OPTIONS() {
  return preflightResponse();
}

export async function POST(req: Request) {
  let gate: McpAuth | Response;
  try {
    gate = await authorize(req);
  } catch (e) {
    logger.error("mcp", "Godkendelse af MCP-kald fejlede", e instanceof Error ? e.message : String(e));
    return jsonResponse({ error: "server_error", error_description: "Authorization check failed" }, 500);
  }
  if (gate instanceof Response) return gate;

  const server = createCampSenseMcpServer({ auth: gate });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 1024 * 1024,
  });
  try {
    await server.connect(transport);
    // Tool handlers also wrap themselves; this covers anything else the SDK
    // dispatches during the request.
    const res = await runWithApiAuth(() => transport.handleRequest(req));
    return withCors(res);
  } catch (e) {
    logger.error("mcp", "MCP-kald fejlede", e instanceof Error ? e.message : String(e));
    return jsonResponse({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }, 500);
  } finally {
    // With enableJsonResponse the response body is complete once handleRequest
    // resolves, so closing here cannot cut it off.
    await server.close().catch(() => {});
  }
}

export async function GET(req: Request) {
  const gate = await authorize(req).catch(() => null);
  if (gate instanceof Response) return gate;
  return methodNotAllowed();
}

export async function DELETE(req: Request) {
  const gate = await authorize(req).catch(() => null);
  if (gate instanceof Response) return gate;
  return methodNotAllowed();
}
