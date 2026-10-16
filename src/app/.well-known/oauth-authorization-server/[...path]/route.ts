import { authorizationServerHandlers } from "@/lib/mcp/metadata-routes";

// RFC 8414 authorization-server metadata (also served for clients that try
// OpenID discovery or a path-suffixed variant first).
export const dynamic = "force-dynamic";
export const { GET, OPTIONS } = authorizationServerHandlers;
