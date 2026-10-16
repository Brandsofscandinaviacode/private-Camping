import { protectedResourceHandlers } from "@/lib/mcp/metadata-routes";

// RFC 9728 protected-resource metadata (plain and /api/mcp path-suffixed).
export const dynamic = "force-dynamic";
export const { GET, OPTIONS } = protectedResourceHandlers;
