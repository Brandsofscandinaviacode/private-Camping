import {
  handleRevocationRequest,
  isMcpEnabled,
  jsonResponse,
  mcpDisabledResponse,
  preflightResponse,
} from "@/lib/mcp/oauth";
import { readFormBody } from "@/lib/mcp/form-body";

// POST /api/oauth/revoke — RFC 7009 token revocation.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isMcpEnabled())) return mcpDisabledResponse();
  const form = await readFormBody(req);
  if (!form) return jsonResponse({ error: "invalid_request", error_description: "Unreadable request body" }, 400);
  const result = await handleRevocationRequest(form, req.headers.get("authorization"));
  return jsonResponse(result.body, result.status, result.headers ?? {});
}

export function OPTIONS() {
  return preflightResponse();
}
