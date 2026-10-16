"use client";

import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { Bot, Check, Copy, KeyRound, Loader2, Plug, ShieldCheck, Terminal, Trash2, TriangleAlert, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/admin/admin-ui";
import {
  setMcpEnabledAction,
  generateMcpApiKeyAction,
  deleteMcpApiKeyAction,
  revokeMcpClientAction,
  revokeAllMcpClientsAction,
  type McpSettingsState,
} from "@/lib/mcp/admin-actions";

// Fixed time zone so the server render and hydration print the same string.
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("da-DK", { timeZone: "Europe/Copenhagen", dateStyle: "medium", timeStyle: "short" });
}

/** Redirect hosts that belong to Claude itself or a local client (Claude Code). */
function isClaudeHost(host: string): boolean {
  const h = host.replace(/:\d+$/, "").toLowerCase();
  return ["claude.ai", "claude.com", "localhost", "127.0.0.1", "[::1]"].includes(h);
}

async function copyText(text: string): Promise<boolean> {
  try {
    // navigator.clipboard is undefined on plain-HTTP LAN installs
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (await copyText(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("Kunne ikke kopiere — markér teksten og kopiér manuelt.");
    }
  }

  return (
    <div className="flex items-start gap-2">
      <code className="flex-1 min-w-0 rounded-lg border border-border/60 bg-muted/50 px-3 py-2 text-xs font-mono break-all select-all">
        {value}
      </code>
      <Button variant="outline" size="sm" onClick={handleCopy} className="mt-0.5">
        {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Kopieret" : "Kopiér"}
      </Button>
    </div>
  );
}

export function McpSettings({ state }: { state: McpSettingsState | null }) {
  if (!state) {
    return (
      <div className="rounded-xl border border-border/60 bg-card shadow-sm p-5">
        <div className="flex items-start gap-2.5 text-sm p-3 rounded-lg bg-red-50 text-red-700">
          <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Kunne ikke indlæse MCP-indstillingerne. Tjek at databasen er migreret (prisma migrate deploy) og se
            serverloggen.
          </span>
        </div>
      </div>
    );
  }
  return <McpSettingsInner state={state} />;
}

function McpSettingsInner({ state }: { state: McpSettingsState }) {
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [enabled, setOptimisticEnabled] = useOptimistic(state.enabled);
  // The plain key only exists in this component's memory, right after generation.
  const [newKey, setNewKey] = useState<string | null>(null);

  const busy = (id: string) => isPending && busyId === id;

  // Without a real Site-URL, fall back to the address the admin is using now.
  const mcpUrl = state.siteUrlIsPlaceholder && state.detectedEndpointUrl ? state.detectedEndpointUrl : state.endpointUrl;
  const urlUnreachable = state.siteUrlIsPlaceholder && !state.detectedEndpointUrl;

  function run(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    startTransition(async () => {
      try {
        await fn();
      } catch {
        toast.error("Noget gik galt — prøv igen.");
      }
    });
  }

  function handleToggle(next: boolean) {
    run("toggle", async () => {
      setOptimisticEnabled(next);
      await setMcpEnabledAction(next);
      toast.success(next ? "MCP-adgang er slået til" : "MCP-adgang er slået fra");
    });
  }

  function handleGenerateKey() {
    if (state.apiKey && !window.confirm("Generér en ny nøgle? Den nuværende nøgle holder op med at virke med det samme.")) return;
    run("generate", async () => {
      const { key } = await generateMcpApiKeyAction();
      setNewKey(key);
      toast.success("Ny læse-nøgle genereret — kopiér den nu");
    });
  }

  function handleDeleteKey() {
    if (!window.confirm("Slet læse-nøglen? Klienter der bruger den mister adgangen med det samme.")) return;
    run("delete-key", async () => {
      await deleteMcpApiKeyAction();
      setNewKey(null);
      toast.success("Læse-nøglen er slettet");
    });
  }

  function handleRevoke(clientId: string, name: string) {
    if (!window.confirm(`Fjern adgang for "${name}"? Appen skal godkendes igen, før den kan læse data.`)) return;
    run(`revoke-${clientId}`, async () => {
      await revokeMcpClientAction(clientId);
      toast.success(`Adgang fjernet for ${name}`);
    });
  }

  function handleRevokeAll() {
    if (!window.confirm("Fjern adgang for alle forbundne apps? De skal godkendes igen, før de kan læse data.")) return;
    run("revoke-all", async () => {
      await revokeAllMcpClientsAction();
      toast.success("Adgang fjernet for alle forbundne apps");
    });
  }

  return (
    <div className="space-y-5">
      {/* On/off */}
      <div className="rounded-xl border border-border/60 bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            Claude / MCP
          </h2>
          {enabled ? <StatusBadge tone="emerald">Aktiv</StatusBadge> : <StatusBadge tone="muted">Slået fra</StatusBadge>}
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium">Aktivér MCP-adgang</p>
              <p className="text-xs text-muted-foreground mt-1">
                Lader Claude læse live data fra CampSense: enheder, målere og forbrug, bookinger og ophold (inkl.
                gæstenavne), fakturaer, services og logs. Slået fra som standard.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 pt-0.5">
              {busy("toggle") && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              <Switch checked={enabled} onCheckedChange={(checked) => handleToggle(checked)} disabled={busy("toggle")} />
            </div>
          </div>
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>
              Adgangen er skrivebeskyttet — Claude kan ikke ændre, oprette eller slette noget. Data som Claude henter,
              indgår i din samtale med Claude. Når adgangen er slået fra, afvises alle forespørgsler, også fra apps der
              allerede er forbundet.
            </span>
          </div>
        </div>
      </div>

      {/* URL + how to connect */}
      <div className="rounded-xl border border-border/60 bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold flex items-center gap-2">
            <Plug className="h-4 w-4 text-muted-foreground" />
            Tilføj i Claude
          </h2>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">MCP-URL</p>
            <CopyField value={mcpUrl} />
          </div>

          {state.siteUrlIsPlaceholder && (
            <div className="flex items-start gap-2.5 text-sm p-3 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
              <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Site-URL er ikke sat</p>
                <p className="text-xs mt-0.5">
                  {urlUnreachable
                    ? "URL'en peger på localhost, som Claude ikke kan nå. "
                    : "URL'en ovenfor er gættet ud fra adressen i din browser. "}
                  Sæt den offentlige adresse under Generelt → Site URL. Claude forbinder fra internettet, så adressen skal
                  være offentligt tilgængelig via https.
                </p>
              </div>
            </div>
          )}

          {!enabled && (
            <p className="text-xs text-muted-foreground">Slå MCP-adgang til ovenfor, før du forbinder Claude.</p>
          )}

          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Claude.ai (web, desktop og mobil)</p>
            <ol className="list-decimal pl-4 space-y-0.5">
              <li>Åbn claude.ai → <strong>Indstillinger</strong> → <strong>Connectors</strong>.</li>
              <li>Vælg <strong>Tilføj brugerdefineret connector</strong>, giv den navnet CampSense og indsæt URL&apos;en ovenfor.</li>
              <li>Klik <strong>Forbind</strong> — du sendes til CampSense, hvor du logger ind som admin og godkender læseadgang.</li>
            </ol>

            <p className="font-medium text-foreground pt-1 flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5" />
              Claude Code
            </p>
            <CopyField value={`claude mcp add --transport http campsense ${mcpUrl}`} />
            <p>Kør derefter <code className="bg-background px-1 rounded">/mcp</code> i Claude Code og log ind som admin for at godkende.</p>
          </div>
        </div>
      </div>

      {/* Static read-only key */}
      <div className="rounded-xl border border-border/60 bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            Læse-nøgle
          </h2>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <p className="text-xs text-muted-foreground">
            Alternativ til login for klienter der kun understøtter en fast header. Bruges som{" "}
            <code className="bg-muted px-1 rounded">Authorization: Bearer &lt;nøgle&gt;</code> og giver samme
            skrivebeskyttede adgang. Virker kun, når MCP-adgang er slået til.
          </p>

          {newKey && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
              <p className="text-sm font-medium text-emerald-800">Din nye læse-nøgle</p>
              <CopyField value={newKey} />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-emerald-800">
                  Gem nøglen nu — den vises ikke igen. Mister du den, kan du generere en ny.
                </p>
                <Button variant="ghost" size="sm" onClick={() => setNewKey(null)}>
                  Skjul
                </Button>
              </div>
            </div>
          )}

          {state.apiKey ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-xs">{state.apiKey.hint}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Oprettet {formatDate(state.apiKey.createdAt)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={handleGenerateKey} disabled={isPending}>
                  {busy("generate") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  Generér ny
                </Button>
                <Button variant="destructive" size="sm" onClick={handleDeleteKey} disabled={isPending}>
                  {busy("delete-key") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Slet
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={handleGenerateKey} disabled={isPending}>
              {busy("generate") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              Generér nøgle
            </Button>
          )}
        </div>
      </div>

      {/* Connected apps */}
      <div className="rounded-xl border border-border/60 bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Unplug className="h-4 w-4 text-muted-foreground" />
            Forbundne apps
          </h2>
          {state.clients.length > 0 && (
            <Button variant="destructive" size="sm" onClick={handleRevokeAll} disabled={isPending}>
              {busy("revoke-all") && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Fjern al adgang
            </Button>
          )}
        </div>
        <div className="px-5 py-2 text-sm">
          {state.clients.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3">
              Ingen apps er forbundet endnu. Når du godkender Claude, vises forbindelsen her.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {state.clients.map((c) => {
                const name = c.clientName || "Ukendt app";
                const foreign = c.redirectHosts.filter((h) => !isClaudeHost(h));
                return (
                  <li key={c.clientId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium truncate">{name}</p>
                      <p className="text-xs text-muted-foreground break-all">
                        {c.redirectHosts.join(", ") || "—"}
                      </p>
                      {foreign.length > 0 && (
                        <p className="text-xs text-amber-700 flex items-center gap-1">
                          <TriangleAlert className="h-3 w-3 shrink-0" />
                          Ikke en Claude-adresse — fjern adgangen, hvis du ikke kender appen.
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Forbundet {formatDate(c.createdAt)} · Sidst brugt {c.lastUsedAt ? formatDate(c.lastUsedAt) : "aldrig"}
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="shrink-0 self-start sm:self-center"
                      onClick={() => handleRevoke(c.clientId, name)}
                      disabled={isPending}
                    >
                      {busy(`revoke-${c.clientId}`) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Fjern adgang
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
