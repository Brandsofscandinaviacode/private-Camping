import {
  isMcpEnabled,
  jsonResponse,
  mcpDisabledResponse,
  preflightResponse,
  registerClient,
} from "@/lib/mcp/oauth";

// POST /api/oauth/register — RFC 7591 dynamic client registration.
// Open by design (MCP clients register themselves); registering grants
// nothing until an admin approves the client on /oauth/authorize.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isMcpEnabled())) return mcpDisabledResponse();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_client_metadata", error_description: "Body must be JSON" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "invalid_client_metadata", error_description: "Body must be a JSON object" }, 400);
  }
  const result = await registerClient(body as Record<string, unknown>);
  if (!result.ok) return jsonResponse({ error: result.error, error_description: result.description }, result.status);
  return jsonResponse(result.body, 201);
}

export function OPTIONS() {
  return preflightResponse();
}
