"use server";

// Admin controls for Claude / MCP access (Indstillinger → Claude / MCP).
// Every export is a server action reachable from the browser, so each one
// starts with requireAuth(). Nothing here returns a secret except the freshly
// generated read-only key, which is shown to the admin exactly once.

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { readGlobalSettings } from "@/lib/settings";
import { getBaseUrl, isPlaceholderBaseUrl } from "@/lib/base-url";
import { logger } from "@/lib/logger";
import {
  getMcpAdminOverview,
  setMcpEnabled,
  generateMcpApiKey,
  deleteMcpApiKey,
  revokeMcpClient,
  revokeAllMcpClients,
  originFromHeaders,
  mcpResourceUrl,
} from "./oauth";

export type McpSettingsState = Awaited<ReturnType<typeof getMcpAdminOverview>> & {
  endpointUrl: string;
  siteUrlIsPlaceholder: boolean;
  /** MCP URL as seen from the admin's current browser address — a hint when Site-URL isn't set. */
  detectedEndpointUrl: string | null;
};

const SETTINGS_PATH = "/admin/settings";

export async function getMcpSettingsState(): Promise<McpSettingsState> {
  await requireAuth();
  const [overview, settings, h] = await Promise.all([getMcpAdminOverview(), readGlobalSettings(), headers()]);
  const baseUrl = getBaseUrl(settings);
  const siteUrlIsPlaceholder = isPlaceholderBaseUrl(baseUrl);

  let detectedEndpointUrl: string | null = null;
  if (siteUrlIsPlaceholder) {
    const origin = originFromHeaders(h);
    if (!isPlaceholderBaseUrl(origin)) detectedEndpointUrl = mcpResourceUrl(origin);
  }

  return {
    ...overview,
    endpointUrl: mcpResourceUrl(baseUrl),
    siteUrlIsPlaceholder,
    detectedEndpointUrl,
  };
}

export async function setMcpEnabledAction(enabled: boolean): Promise<void> {
  await requireAuth();
  if (typeof enabled !== "boolean") throw new Error("Ugyldig værdi");
  await setMcpEnabled(enabled);
  logger.info("mcp", enabled ? "MCP-adgang aktiveret" : "MCP-adgang deaktiveret");
  revalidatePath(SETTINGS_PATH);
}

export async function generateMcpApiKeyAction(): Promise<{ key: string }> {
  await requireAuth();
  const key = await generateMcpApiKey();
  logger.info("mcp", "Ny læse-nøgle til MCP genereret");
  revalidatePath(SETTINGS_PATH);
  return { key };
}

export async function deleteMcpApiKeyAction(): Promise<void> {
  await requireAuth();
  await deleteMcpApiKey();
  logger.info("mcp", "Læse-nøgle til MCP slettet");
  revalidatePath(SETTINGS_PATH);
}

export async function revokeMcpClientAction(clientId: string): Promise<void> {
  await requireAuth();
  if (typeof clientId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(clientId)) {
    throw new Error("Ugyldigt klient-id");
  }
  await revokeMcpClient(clientId);
  logger.info("mcp", "MCP-adgang fjernet for én forbundet app");
  revalidatePath(SETTINGS_PATH);
}

export async function revokeAllMcpClientsAction(): Promise<void> {
  await requireAuth();
  await revokeAllMcpClients();
  logger.info("mcp", "MCP-adgang fjernet for alle forbundne apps");
  revalidatePath(SETTINGS_PATH);
}
