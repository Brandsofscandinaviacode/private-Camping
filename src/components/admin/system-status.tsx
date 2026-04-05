"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle,
  XCircle,
  Clock,
  Database,
  Activity,
  MessageSquare,
  Mail,
  Bell,
  Zap,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSystemStatus, updateMultipleSettings } from "@/lib/actions";

interface StatusData {
  cronLastRun: string | null;
  cronLastStatus: string | null;
  cronAlerts: string;
  totalLogs: number;
  latestLogTime: string | null;
  unitCount: number;
  sessionCount: number;
  invoiceCount: number;
  alarmEnabled: boolean;
  smsEnabled: boolean;
  emailEnabled: boolean;
  invoiceEmailEnabled: boolean;
  autoPowerOff: boolean;
  apiKey: string;
}

export function SystemStatus() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [testingCron, setTestingCron] = useState(false);
  const [cronTestResult, setCronTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);

  async function loadStatus() {
    setLoading(true);
    try {
      const data = await getSystemStatus();
      setStatus(data);
      setApiKey(data.apiKey || "");
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function handleTestCron() {
    setTestingCron(true);
    setCronTestResult(null);
    try {
      const res = await fetch("/api/cron");
      const json = await res.json();
      if (json.ok) {
        setCronTestResult({ ok: true, message: `Cron kørte succesfuldt. ${json.alerts} alarmer.` });
      } else {
        setCronTestResult({ ok: false, message: json.error || "Ukendt fejl" });
      }
      await loadStatus();
    } catch (e) {
      setCronTestResult({ ok: false, message: e instanceof Error ? e.message : "Netværksfejl" });
    } finally {
      setTestingCron(false);
    }
  }

  function formatTime(iso: string | null) {
    if (!iso) return "Aldrig";
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return "Lige nu";
    if (diffMin < 60) return `${diffMin} min. siden`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} time${diffHours > 1 ? "r" : ""} siden`;
    return d.toLocaleString("da-DK");
  }

  function cronIsHealthy(): boolean {
    if (!status?.cronLastRun) return false;
    const lastRun = new Date(status.cronLastRun);
    const diffMs = Date.now() - lastRun.getTime();
    // Healthy if ran within last 30 minutes
    return diffMs < 30 * 60 * 1000 && status.cronLastStatus === "ok";
  }

  if (loading) {
    return (
      <div className="rounded-xl border bg-card shadow-sm p-8 text-center">
        <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  if (!status) return null;

  const healthy = cronIsHealthy();

  return (
    <div className="space-y-5">
      {/* Cron Status */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold">Cron job (forbrugslogning)</h2>
          <div className="flex items-center gap-2">
            {healthy ? (
              <span className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-2.5 py-1 rounded-full">
                <CheckCircle className="h-3.5 w-3.5" />
                Kører
              </span>
            ) : status.cronLastRun ? (
              <span className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">
                <Clock className="h-3.5 w-3.5" />
                Forsinket
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 px-2.5 py-1 rounded-full">
                <XCircle className="h-3.5 w-3.5" />
                Ikke konfigureret
              </span>
            )}
          </div>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Sidst kørt
            </span>
            <span className="font-medium">{formatTime(status.cronLastRun)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Status
            </span>
            <span className={`font-medium ${status.cronLastStatus === "ok" ? "text-green-600" : status.cronLastStatus ? "text-red-600" : "text-muted-foreground"}`}>
              {status.cronLastStatus === "ok" ? "OK" : status.cronLastStatus || "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground flex items-center gap-2">
              <Database className="h-4 w-4" />
              Målinger logget
            </span>
            <span className="font-medium tabular-nums">{status.totalLogs.toLocaleString("da-DK")}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Aktive alarmer
            </span>
            <span className={`font-medium tabular-nums ${parseInt(status.cronAlerts) > 0 ? "text-amber-600" : ""}`}>
              {status.cronAlerts}
            </span>
          </div>

          <div className="pt-2">
            <Button variant="outline" size="sm" onClick={handleTestCron} disabled={testingCron}>
              {testingCron ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {testingCron ? "Kører..." : "Kør cron nu"}
            </Button>
            {cronTestResult && (
              <div className={`mt-3 flex items-start gap-2.5 text-sm p-3 rounded-lg ${
                cronTestResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
              }`}>
                {cronTestResult.ok ? <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 shrink-0 mt-0.5" />}
                <span>{cronTestResult.message}</span>
              </div>
            )}
          </div>

          {!status.cronLastRun && (
            <div className="mt-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground space-y-1.5">
              <p className="font-medium">Opsætning af cron:</p>
              <p>Kør dette på din Raspberry Pi:</p>
              <code className="block bg-background p-2 rounded text-xs font-mono">
                crontab -e
              </code>
              <p>Tilføj denne linje:</p>
              <code className="block bg-background p-2 rounded text-xs font-mono break-all">
                */15 * * * * curl -s http://localhost:3000/api/cron &gt; /dev/null
              </code>
              <p>Dette logger forbrug hvert 15. minut.</p>
            </div>
          )}
        </div>
      </div>

      {/* Feature Status Overview */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">System oversigt</h2>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-4 pb-3 border-b border-border">
            <div className="text-center">
              <p className="text-2xl font-bold tabular-nums">{status.unitCount}</p>
              <p className="text-xs text-muted-foreground">Enheder</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold tabular-nums">{status.sessionCount}</p>
              <p className="text-xs text-muted-foreground">Ophold</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold tabular-nums">{status.invoiceCount}</p>
              <p className="text-xs text-muted-foreground">Fakturaer</p>
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <StatusRow icon={MessageSquare} label="SMS-notifikationer" enabled={status.smsEnabled} />
            <StatusRow icon={Mail} label="Email-notifikationer" enabled={status.emailEnabled} />
            <StatusRow icon={Mail} label="Faktura-email (fastliggere)" enabled={status.invoiceEmailEnabled} />
            <StatusRow icon={Bell} label="Forbrugsalarm" enabled={status.alarmEnabled} />
            <StatusRow icon={Zap} label="Auto-slukning ved check-out" enabled={status.autoPowerOff} />
          </div>
        </div>
      </div>

      {/* API Configuration */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold">REST API</h2>
          <a
            href="/api-docs"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            Åbn API-dokumentation &rarr;
          </a>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div>
            <Label className="text-sm text-muted-foreground">API-nøgle</Label>
            <div className="flex gap-2 mt-1">
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setApiKeySaved(false); }}
                placeholder="Indtast en API-nøgle for ekstern adgang"
                className="text-sm"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await updateMultipleSettings([{ key: "api_key", value: apiKey }]);
                  setApiKeySaved(true);
                  setTimeout(() => setApiKeySaved(false), 3000);
                }}
              >
                {apiKeySaved ? "Gemt!" : "Gem"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              Bruges som <code className="bg-muted px-1 rounded">Authorization: Bearer &lt;nøgle&gt;</code> til API-kald
            </p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Tilgængelige endpoints:</p>
            <p><code className="bg-background px-1 rounded">GET /api/v1/units</code> — Hent alle enheder</p>
            <p><code className="bg-background px-1 rounded">GET /api/v1/sessions</code> — Hent sessioner</p>
            <p><code className="bg-background px-1 rounded">POST /api/v1/sessions</code> — Check-in (fra booking-system)</p>
            <p><code className="bg-background px-1 rounded">PATCH /api/v1/sessions</code> — Check-out, sæt pris, markér betalt</p>
            <p><code className="bg-background px-1 rounded">GET /api/v1/consumption</code> — Forbrugsdata</p>
            <p><code className="bg-background px-1 rounded">GET /api/docs</code> — OpenAPI spec (JSON)</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ icon: Icon, label, enabled }: { icon: typeof CheckCircle; label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </span>
      {enabled ? (
        <span className="flex items-center gap-1 text-xs text-green-600">
          <CheckCircle className="h-3.5 w-3.5" />
          Aktiv
        </span>
      ) : (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <XCircle className="h-3.5 w-3.5" />
          Deaktiveret
        </span>
      )}
    </div>
  );
}
