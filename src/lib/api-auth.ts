import { NextRequest } from "next/server";
import { timingSafeEqual, createHash } from "crypto";
import { prisma } from "./prisma";

// Constant-time compare (hashing first equalises lengths).
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// API authentication via Bearer token stored in global settings (key: "api_key")
export async function authenticateAPI(req: NextRequest): Promise<{ ok: boolean; error?: string }> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, error: "Missing Authorization header. Use: Bearer <api_key>" };
  }

  const token = authHeader.slice(7);
  const setting = await prisma.globalSetting.findUnique({ where: { key: "api_key" } });

  if (!setting?.value) {
    return { ok: false, error: "API key not configured. Set it in Settings > System." };
  }

  if (!safeEqual(token, setting.value)) {
    return { ok: false, error: "Invalid API key" };
  }

  return { ok: true };
}
