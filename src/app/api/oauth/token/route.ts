import {
  handleTokenRequest,
  isMcpEnabled,
  jsonResponse,
  mcpDisabledResponse,
  preflightResponse,
  requestOrigin,
} from "@/lib/mcp/oauth";
import { readFormBody } from "@/lib/mcp/form-body";

// POST /api/oauth/token — authorization_code (PKCE) and refresh_token grants.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isMcpEnabled())) return mcpDisabledResponse();
  const form = await readFormBody(req);
  if (!form) return jsonResponse({ error: "invalid_request", error_description: "Unreadable request body" }, 400);
  const result = await handleTokenRequest(form, req.headers.get("authorization"), requestOrigin(req));
  return jsonResponse(result.body, result.status, { Pragma: "no-cache", ...(result.headers ?? {}) });
}

export function OPTIONS() {
  return preflightResponse();
}
