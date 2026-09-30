import { prisma } from "@/lib/prisma";

/**
 * All GlobalSetting rows as a key → value map. Server-only and deliberately
 * NOT a server action: the map includes secrets (API key, QuickPay/HA tokens),
 * so it must never be callable from the browser. Admin UI uses the
 * auth-guarded `getGlobalSettings` action instead.
 */
export async function readGlobalSettings(): Promise<Record<string, string>> {
  const settings = await prisma.globalSetting.findMany();
  return Object.fromEntries(settings.map((s) => [s.key, s.value]));
}
