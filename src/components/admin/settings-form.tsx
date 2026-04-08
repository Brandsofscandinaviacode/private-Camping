"use client";

import { useState, useTransition, useRef } from "react";
import { Save, Wifi, WifiOff, Loader2, Upload, Trash2, Send, Cloud, ChevronDown, ChevronRight, Copy, Check, ExternalLink, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateMultipleSettings, testHAConnection, testSMS, testEmail, testQuickPay, testSendInvoice, addShellyDevice } from "@/lib/actions";

interface SettingsFormProps {
  settings: Record<string, string>;
}

// Shared save hook
function useSave(values: Record<string, string>) {
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function handleSave() {
    startTransition(async () => {
      await updateMultipleSettings(
        Object.entries(values).map(([key, value]) => ({ key, value }))
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  }

  return { isPending, saved, handleSave, setSaved };
}

function SaveButton({ isPending, saved, onClick }: { isPending: boolean; saved: boolean; onClick: () => void }) {
  return (
    <Button onClick={onClick} disabled={isPending} size="sm">
      <Save className="h-4 w-4 mr-2" />
      {isPending ? "Gemmer..." : saved ? "Gemt!" : "Gem indstillinger"}
    </Button>
  );
}

// ─── GENERAL TAB ───
export function GeneralSettings({ settings }: SettingsFormProps) {
  const [invoiceTestLoading, setInvoiceTestLoading] = useState(false);
  const [invoiceTestResult, setInvoiceTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [values, setValues] = useState({
    site_url: settings.site_url || "http://localhost:3000",
    price_per_kwh: settings.price_per_kwh || "2.50",
    price_per_liter_water: settings.price_per_liter_water || "0.05",
    currency: settings.currency || "DKK",
    pricing_mode: settings.pricing_mode || "fixed",
    el_surcharge: settings.el_surcharge || "0.50",
    eds_price_area: settings.eds_price_area || "DK1",
    default_occupied_temp: settings.default_occupied_temp || "21",
    default_vacant_temp: settings.default_vacant_temp || "15",
    auto_power_off_on_checkout: settings.auto_power_off_on_checkout || "false",
    invoice_email_enabled: settings.invoice_email_enabled || "false",
    invoice_email_day: settings.invoice_email_day || "1",
    alarm_enabled: settings.alarm_enabled || "false",
    alarm_kwh_threshold: settings.alarm_kwh_threshold || "10",
    alarm_water_threshold: settings.alarm_water_threshold || "500",
    alarm_hours_window: settings.alarm_hours_window || "24",
    main_meter_water_entity: settings.main_meter_water_entity || "",
    main_meter_el_entity: settings.main_meter_el_entity || "",
    main_meter_leak_enabled: settings.main_meter_leak_enabled || "false",
    main_meter_leak_threshold_liters: settings.main_meter_leak_threshold_liters || "10",
    main_meter_leak_hours: settings.main_meter_leak_hours || "3",
  });
  const { isPending, saved, handleSave } = useSave(values);

  function h(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  return (
    <div className="space-y-5">
      {/* Site URL */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Site URL</h2>
        </div>
        <div className="p-5">
          <Label htmlFor="site_url" className="text-sm text-muted-foreground">URL til CampSense</Label>
          <Input id="site_url" value={values.site_url} onChange={(e) => h("site_url", e.target.value)} placeholder="http://192.168.1.100:3000" className="mt-1" />
          <p className="text-xs text-muted-foreground mt-1.5">Bruges til links i SMS og email-notifikationer</p>
        </div>
      </div>

      {/* Pricing */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border"><h2 className="font-semibold">Elpriser</h2></div>
        <div className="p-5 space-y-4">
          <div>
            <Label className="text-sm text-muted-foreground">Prismodel</Label>
            <select value={values.pricing_mode} onChange={(e) => h("pricing_mode", e.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="fixed">Fast pris per kWh</option>
              <option value="minimum">Minimumspris (spot kan lægge til)</option>
              <option value="spot">Spotpris + tillæg</option>
            </select>
          </div>

          {values.pricing_mode === "fixed" && (
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              Gæsten betaler altid den faste pris per kWh, uanset elspotprisen.
            </div>
          )}

          {values.pricing_mode === "minimum" && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
              Fast pris er minimumsprisen. Hvis spotprisen overstiger den faste pris, lægges forskellen oven i gæstens pris. Gæsten ser kun den samlede kWh-pris.
            </div>
          )}

          {values.pricing_mode === "spot" && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
              Gæsten betaler den aktuelle spotpris + et fast tillæg. Gæsten ser kun den samlede kWh-pris — tillægget er skjult.
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm text-muted-foreground">
                {values.pricing_mode === "spot" ? "Tillæg per kWh (DKK)" : "Fast pris per kWh (DKK)"}
              </Label>
              {values.pricing_mode === "spot" ? (
                <Input type="number" step="0.01" value={values.el_surcharge} onChange={(e) => h("el_surcharge", e.target.value)} className="mt-1" />
              ) : (
                <Input type="number" step="0.01" value={values.price_per_kwh} onChange={(e) => h("price_per_kwh", e.target.value)} className="mt-1" />
              )}
            </div>
            {values.pricing_mode !== "fixed" && (
              <div>
                <Label className="text-sm text-muted-foreground">Prisområde</Label>
                <select value={values.eds_price_area} onChange={(e) => h("eds_price_area", e.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="DK1">DK1 — Vest for Storebælt</option>
                  <option value="DK2">DK2 — Øst for Storebælt</option>
                </select>
              </div>
            )}
          </div>

          {values.pricing_mode !== "fixed" && (
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              Spotpriser hentes automatisk fra <a href="https://www.energidataservice.dk" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">Energi Data Service</a> (opdateres hvert 5. minut).
            </div>
          )}
        </div>
      </div>

      {/* Water + Currency */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border"><h2 className="font-semibold">Vand & valuta</h2></div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm text-muted-foreground">Pris per liter vand</Label>
              <Input type="number" step="0.01" value={values.price_per_liter_water} onChange={(e) => h("price_per_liter_water", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Valuta</Label>
              <Input value={values.currency} onChange={(e) => h("currency", e.target.value)} className="mt-1" />
            </div>
          </div>
        </div>
      </div>

      {/* Temperatures */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border"><h2 className="font-semibold">Standard temperaturer</h2></div>
        <div className="p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm text-muted-foreground">Optaget (°C)</Label>
              <Input type="number" value={values.default_occupied_temp} onChange={(e) => h("default_occupied_temp", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Ledig (°C)</Label>
              <Input type="number" value={values.default_vacant_temp} onChange={(e) => h("default_vacant_temp", e.target.value)} className="mt-1" />
            </div>
          </div>
        </div>
      </div>

      {/* Check-out */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border"><h2 className="font-semibold">Check-out</h2></div>
        <div className="p-5">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={values.auto_power_off_on_checkout === "true"} onChange={(e) => h("auto_power_off_on_checkout", e.target.checked ? "true" : "false")} className="mt-0.5 h-4 w-4 accent-primary" />
            <div>
              <p className="text-sm font-medium">Sluk strøm automatisk ved check-out</p>
              <p className="text-xs text-muted-foreground mt-0.5">Når en gæst checker ud, slukkes strømmen og døren låses automatisk</p>
            </div>
          </label>
        </div>
      </div>

      {/* Faktura-email */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border"><h2 className="font-semibold">Faktura (fastliggere)</h2></div>
        <div className="p-5 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={values.invoice_email_enabled === "true"} onChange={(e) => h("invoice_email_enabled", e.target.checked ? "true" : "false")} className="mt-0.5 h-4 w-4 accent-primary" />
            <div>
              <p className="text-sm font-medium">Send faktura automatisk via email/SMS</p>
              <p className="text-xs text-muted-foreground mt-0.5">Fastliggere modtager automatisk en faktura med link til gæsteportalen</p>
            </div>
          </label>
          {values.invoice_email_enabled === "true" && (
            <div className="space-y-3">
              <div>
                <Label className="text-sm text-muted-foreground">Send faktura den</Label>
                <select value={values.invoice_email_day} onChange={(e) => h("invoice_email_day", e.target.value)} className="mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="1">1. i måneden</option>
                  <option value="14">14. i måneden</option>
                  <option value="last">Sidste dag i måneden</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1.5">Fakturaen dækker forbruget fra den foregående måned</p>
              </div>
              <div className="pt-1">
                <Button variant="outline" size="sm" onClick={async () => {
                  setInvoiceTestLoading(true);
                  setInvoiceTestResult(null);
                  try {
                    const res = await testSendInvoice();
                    setInvoiceTestResult(res);
                  } catch {
                    setInvoiceTestResult({ ok: false, message: "Uventet fejl" });
                  } finally {
                    setInvoiceTestLoading(false);
                  }
                }} disabled={invoiceTestLoading}>
                  {invoiceTestLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                  {invoiceTestLoading ? "Sender..." : "Test: send seneste faktura"}
                </Button>
                {invoiceTestResult && (
                  <div className={`mt-2 text-sm p-2.5 rounded-lg ${invoiceTestResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                    {invoiceTestResult.message}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Alarm */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border"><h2 className="font-semibold">Forbrugsalarm</h2></div>
        <div className="p-5 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={values.alarm_enabled === "true"} onChange={(e) => h("alarm_enabled", e.target.checked ? "true" : "false")} className="mt-0.5 h-4 w-4 accent-primary" />
            <div>
              <p className="text-sm font-medium">Aktivér forbrugsalarm</p>
              <p className="text-xs text-muted-foreground mt-0.5">Få besked hvis en enhed bruger over grænseværdien</p>
            </div>
          </label>
          {values.alarm_enabled === "true" && (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm text-muted-foreground">El-grænse (kWh)</Label>
                  <Input type="number" step="0.5" value={values.alarm_kwh_threshold} onChange={(e) => h("alarm_kwh_threshold", e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Vand-grænse (liter)</Label>
                  <Input type="number" step="10" value={values.alarm_water_threshold} onChange={(e) => h("alarm_water_threshold", e.target.value)} className="mt-1" />
                </div>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Tidsvindue (timer)</Label>
                <Input type="number" value={values.alarm_hours_window} onChange={(e) => h("alarm_hours_window", e.target.value)} className="mt-1 w-24" />
                <p className="text-xs text-muted-foreground mt-1.5">Alarm udløses hvis grænsen overskrides inden for dette antal timer</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main meter leak detection */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border"><h2 className="font-semibold">Hovedmåler / lækageovervågning</h2></div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm text-muted-foreground">Hovedmåler el (HA entity)</Label>
              <Input value={values.main_meter_el_entity} onChange={(e) => h("main_meter_el_entity", e.target.value)} placeholder="sensor.main_power_meter" className="mt-1" />
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Hovedmåler vand (HA entity)</Label>
              <Input value={values.main_meter_water_entity} onChange={(e) => h("main_meter_water_entity", e.target.value)} placeholder="sensor.main_water_meter" className="mt-1" />
            </div>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={values.main_meter_leak_enabled === "true"} onChange={(e) => h("main_meter_leak_enabled", e.target.checked ? "true" : "false")} className="mt-0.5 h-4 w-4 accent-primary" />
            <div>
              <p className="text-sm font-medium">Lækagealarm (konstant forbrug)</p>
              <p className="text-xs text-muted-foreground mt-0.5">Advar hvis hovedmåleren registrerer løbende forbrug over en periode (f.eks. vandlæk)</p>
            </div>
          </label>
          {values.main_meter_leak_enabled === "true" && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <Label className="text-sm text-muted-foreground">Min. forbrug pr. time (liter)</Label>
                <Input type="number" step="1" value={values.main_meter_leak_threshold_liters} onChange={(e) => h("main_meter_leak_threshold_liters", e.target.value)} className="mt-1" />
                <p className="text-xs text-muted-foreground mt-1.5">Alarm hvis forbruget er over denne grænse i alle timer</p>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Antal sammenhængende timer</Label>
                <Input type="number" step="1" value={values.main_meter_leak_hours} onChange={(e) => h("main_meter_leak_hours", e.target.value)} className="mt-1" />
                <p className="text-xs text-muted-foreground mt-1.5">Alarm hvis forbruget er konstant i dette antal timer</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <SaveButton isPending={isPending} saved={saved} onClick={handleSave} />
    </div>
  );
}

// ─── HOME ASSISTANT TAB ───
export function HASettings({ settings }: SettingsFormProps) {
  const [values, setValues] = useState({
    ha_url: settings.ha_url || "http://homeassistant.local:8123",
    ha_token: settings.ha_token || "",
  });
  const { isPending, saved, handleSave } = useSave(values);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const isCloudflareUrl = values.ha_url.includes("cloudflare") || values.ha_url.startsWith("https://");

  function h(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      await updateMultipleSettings(Object.entries(values).map(([key, value]) => ({ key, value })));
      const result = await testHAConnection();
      setTestResult(result);
    } catch {
      setTestResult({ ok: false, message: "Uventet fejl under test" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Connection */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border"><h2 className="font-semibold">Forbindelse</h2></div>
        <div className="p-5 space-y-4">
          <div>
            <Label className="text-sm text-muted-foreground">HA URL</Label>
            <Input value={values.ha_url} onChange={(e) => h("ha_url", e.target.value)} placeholder="https://ha.din-camping.campsense.net" className="mt-1" />
            <p className="text-xs text-muted-foreground mt-1.5">
              {isCloudflareUrl ? (
                <span className="flex items-center gap-1 text-green-600">
                  <Shield className="h-3 w-3" /> Sikker forbindelse via HTTPS
                </span>
              ) : (
                "Lokal: http://IP:8123 — Cloud: https://ha.din-domæne.dk (via Cloudflare Tunnel)"
              )}
            </p>
          </div>
          <div>
            <Label className="text-sm text-muted-foreground">Long-Lived Access Token</Label>
            <Input type="password" value={values.ha_token} onChange={(e) => h("ha_token", e.target.value)} placeholder="Indsæt dit HA access token" className="mt-1" />
            <p className="text-xs text-muted-foreground mt-1.5">HA &rarr; Profil &rarr; Langvarige adgangstokener</p>
          </div>
          <div className="pt-1">
            <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wifi className="h-4 w-4 mr-2" />}
              {testing ? "Tester..." : "Test forbindelse"}
            </Button>
            {testResult && (
              <div className={`mt-3 flex items-start gap-2.5 text-sm p-3 rounded-lg ${testResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {testResult.ok ? <Wifi className="h-4 w-4 shrink-0 mt-0.5" /> : <WifiOff className="h-4 w-4 shrink-0 mt-0.5" />}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>
        </div>
      </div>
      <SaveButton isPending={isPending} saved={saved} onClick={handleSave} />

      {/* Cloudflare Tunnel Guide */}
      <CloudflareTunnelGuide />

      {/* Add Shelly Device */}
      <AddShellyDevice />
    </div>
  );
}

// ── Cloudflare Tunnel Setup Guide ──
function CloudflareTunnelGuide() {
  const [expanded, setExpanded] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2000);
  }

  const CopyBtn = ({ text, id }: { text: string; id: string }) => (
    <button
      onClick={() => copyToClipboard(text, id)}
      className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 hover:bg-background border text-muted-foreground hover:text-foreground transition-colors"
      title="Kopier"
    >
      {copiedCmd === id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <button
        className="w-full px-5 py-4 flex items-center justify-between text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Cloud className="h-4 w-4 text-orange-500" />
          <h2 className="font-semibold">Cloudflare Tunnel opsætning</h2>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Guide</span>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-5 border-t pt-5">
          {/* What is it */}
          <div className="bg-blue-50 text-blue-800 rounded-lg p-4 text-sm space-y-2">
            <p className="font-medium">Hvad er Cloudflare Tunnel?</p>
            <p>
              Cloudflare Tunnel gør det muligt at tilgå din Home Assistant fra internettet <strong>uden offentlig IP</strong> og
              uden at åbne porte i din router. Din Raspberry Pi opretter en sikker, udgående forbindelse til Cloudflare,
              som derefter giver CampSense adgang via HTTPS.
            </p>
            <p className="text-xs text-blue-600">Gratis at bruge — kræver kun en Cloudflare-konto og et domæne.</p>
          </div>

          {/* Prerequisites */}
          <div>
            <h3 className="font-medium mb-2">Forudsætninger</h3>
            <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
              <li>En Cloudflare-konto (gratis)</li>
              <li>Dit domæne tilføjet til Cloudflare (DNS)</li>
              <li>SSH-adgang til din Raspberry Pi</li>
              <li>Home Assistant kørende på Pi&apos;en (port 8123)</li>
            </ul>
          </div>

          {/* Step 1 */}
          <div>
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <span className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs">1</span>
              Installer cloudflared på Raspberry Pi
            </h3>
            <div className="relative bg-muted rounded-lg p-3 pr-10 font-mono text-sm overflow-x-auto">
              <CopyBtn id="install" text="curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o cloudflared.deb && sudo dpkg -i cloudflared.deb" />
              <code>curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o cloudflared.deb<br />sudo dpkg -i cloudflared.deb</code>
            </div>
          </div>

          {/* Step 2 */}
          <div>
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <span className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs">2</span>
              Log ind og opret tunnel
            </h3>
            <div className="relative bg-muted rounded-lg p-3 pr-10 font-mono text-sm overflow-x-auto">
              <CopyBtn id="login" text="cloudflared tunnel login&#10;cloudflared tunnel create ha-camping" />
              <code>cloudflared tunnel login<br />cloudflared tunnel create ha-camping</code>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              En browser åbnes — log ind med din Cloudflare-konto og vælg dit domæne.
              Notér det <strong>Tunnel ID</strong> der vises efter <code>tunnel create</code>.
            </p>
          </div>

          {/* Step 3 */}
          <div>
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <span className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs">3</span>
              Konfigurer tunnel
            </h3>
            <p className="text-sm text-muted-foreground mb-2">
              Opret filen <code>~/.cloudflared/config.yml</code> på din Pi:
            </p>
            <div className="relative bg-muted rounded-lg p-3 pr-10 font-mono text-sm overflow-x-auto whitespace-pre">
              <CopyBtn id="config" text={`tunnel: DIT_TUNNEL_ID\ncredentials-file: /home/pi/.cloudflared/DIT_TUNNEL_ID.json\n\ningress:\n  - hostname: ha.din-camping.campsense.net\n    service: http://localhost:8123\n    originRequest:\n      noTLSVerify: true\n  - service: http_status:404`} />
              <code>{`tunnel: DIT_TUNNEL_ID
credentials-file: /home/pi/.cloudflared/DIT_TUNNEL_ID.json

ingress:
  - hostname: ha.din-camping.campsense.net
    service: http://localhost:8123
    originRequest:
      noTLSVerify: true
  - service: http_status:404`}</code>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Erstat <code>DIT_TUNNEL_ID</code> med dit faktiske tunnel ID og
              <code> ha.din-camping.campsense.net</code> med dit ønskede subdomæne.
            </p>
          </div>

          {/* Step 4 */}
          <div>
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <span className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs">4</span>
              Tilføj DNS-record
            </h3>
            <div className="relative bg-muted rounded-lg p-3 pr-10 font-mono text-sm overflow-x-auto">
              <CopyBtn id="dns" text="cloudflared tunnel route dns ha-camping ha.din-camping.campsense.net" />
              <code>cloudflared tunnel route dns ha-camping ha.din-camping.campsense.net</code>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Dette opretter automatisk en CNAME-record i Cloudflare DNS.
            </p>
          </div>

          {/* Step 5 */}
          <div>
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <span className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs">5</span>
              Start som service (kør automatisk ved boot)
            </h3>
            <div className="relative bg-muted rounded-lg p-3 pr-10 font-mono text-sm overflow-x-auto">
              <CopyBtn id="service" text="sudo cloudflared service install&#10;sudo systemctl enable cloudflared&#10;sudo systemctl start cloudflared" />
              <code>sudo cloudflared service install<br />sudo systemctl enable cloudflared<br />sudo systemctl start cloudflared</code>
            </div>
          </div>

          {/* Step 6 */}
          <div>
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <span className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs">6</span>
              Konfigurer Home Assistant
            </h3>
            <p className="text-sm text-muted-foreground mb-2">
              Tilføj dette til din <code>configuration.yaml</code> i Home Assistant:
            </p>
            <div className="relative bg-muted rounded-lg p-3 pr-10 font-mono text-sm overflow-x-auto whitespace-pre">
              <CopyBtn id="hayaml" text={`http:\n  use_x_forwarded_for: true\n  trusted_proxies:\n    - 127.0.0.1\n    - 172.16.0.0/12`} />
              <code>{`http:
  use_x_forwarded_for: true
  trusted_proxies:
    - 127.0.0.1
    - 172.16.0.0/12`}</code>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Genstart Home Assistant efter ændringen.
            </p>
          </div>

          {/* Step 7 */}
          <div>
            <h3 className="font-medium mb-2 flex items-center gap-2">
              <span className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs">7</span>
              Opdater CampSense
            </h3>
            <p className="text-sm text-muted-foreground">
              Sæt <strong>HA URL</strong> ovenfor til din tunnel-adresse, f.eks.:
            </p>
            <div className="bg-muted rounded-lg p-3 font-mono text-sm mt-2">
              <code>https://ha.din-camping.campsense.net</code>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Klik <strong>Gem indstillinger</strong> og derefter <strong>Test forbindelse</strong> for at bekræfte.
            </p>
          </div>

          {/* Troubleshooting */}
          <div className="bg-amber-50 text-amber-800 rounded-lg p-4 text-sm space-y-2">
            <p className="font-medium">Fejlfinding</p>
            <ul className="space-y-1 list-disc pl-5 text-xs">
              <li><strong>502 Bad Gateway</strong> — Home Assistant er ikke startet, eller <code>service</code> i config.yml peger forkert. Prøv <code>http://localhost:8123</code>.</li>
              <li><strong>Tunnel er offline</strong> — Kør <code>sudo systemctl status cloudflared</code> på Pi&apos;en for at se status.</li>
              <li><strong>DNS ikke fundet</strong> — Vent 2-5 minutter efter DNS-tilføjelse. Tjek med <code>dig ha.din-camping.campsense.net</code>.</li>
              <li><strong>401 Unauthorized i CampSense</strong> — Dit HA Long-Lived Access Token er forkert eller udløbet. Opret et nyt i HA &rarr; Profil.</li>
            </ul>
          </div>

          {/* Security note */}
          <div className="bg-green-50 text-green-800 rounded-lg p-4 text-sm space-y-1">
            <p className="font-medium flex items-center gap-1.5"><Shield className="h-4 w-4" /> Sikkerhed</p>
            <p className="text-xs">
              Cloudflare Tunnel krypterer al trafik mellem CampSense og din Home Assistant med TLS.
              Ingen porte er åbne i din router, og din Pi&apos;s IP-adresse er skjult bag Cloudflare.
              Kombiner med HA&apos;s Long-Lived Access Token for fuld autentificering.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function AddShellyDevice() {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("80");
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleAdd() {
    setAdding(true);
    setResult(null);
    try {
      const res = await addShellyDevice(host.trim(), parseInt(port, 10) || 80);
      setResult(res);
      if (res.ok) setHost("");
    } catch {
      setResult({ ok: false, message: "Uventet fejl" });
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="font-semibold">Tilføj Shelly enhed</h2>
      </div>
      <div className="p-5 space-y-4">
        <p className="text-sm text-muted-foreground">
          Tilføj en ny Shelly enhed til Home Assistant. Enheden skal være på samme netværk.
        </p>
        <div className="flex gap-3">
          <div className="flex-1">
            <Label className="text-sm text-muted-foreground">Host (IP-adresse)</Label>
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.100"
              className="mt-1"
            />
          </div>
          <div className="w-24">
            <Label className="text-sm text-muted-foreground">Port</Label>
            <Input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="80"
              className="mt-1"
            />
          </div>
        </div>
        <Button
          variant="default"
          size="sm"
          disabled={adding || !host.trim()}
          onClick={handleAdd}
        >
          {adding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {adding ? "Tilføjer..." : "Tilføj enhed"}
        </Button>
        {result && (
          <div className={`text-sm p-3 rounded-lg ${result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {result.message}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── NOTIFICATIONS TAB ───
export function NotificationSettings({ settings }: SettingsFormProps) {
  const [smsTestNumber, setSmsTestNumber] = useState("");
  const [smsTestResult, setSmsTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [smsTesting, setSmsTesting] = useState(false);
  const [emailTestAddr, setEmailTestAddr] = useState("");
  const [emailTestResult, setEmailTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [emailTesting, setEmailTesting] = useState(false);

  async function handleTestSMS() {
    setSmsTesting(true);
    setSmsTestResult(null);
    try {
      // Save settings first so Twilio credentials are up to date
      await updateMultipleSettings(Object.entries(values).map(([key, value]) => ({ key, value })));
      const result = await testSMS(smsTestNumber);
      setSmsTestResult(result);
    } catch {
      setSmsTestResult({ ok: false, message: "Uventet fejl" });
    } finally {
      setSmsTesting(false);
    }
  }

  async function handleTestEmail() {
    setEmailTesting(true);
    setEmailTestResult(null);
    try {
      // Save settings first so SMTP credentials are up to date
      await updateMultipleSettings(Object.entries(values).map(([key, value]) => ({ key, value })));
      const result = await testEmail(emailTestAddr);
      setEmailTestResult(result);
    } catch {
      setEmailTestResult({ ok: false, message: "Uventet fejl" });
    } finally {
      setEmailTesting(false);
    }
  }

  const [values, setValues] = useState({
    notifications_sms_enabled: settings.notifications_sms_enabled || "false",
    twilio_account_sid: settings.twilio_account_sid || "",
    twilio_auth_token: settings.twilio_auth_token || "",
    twilio_phone_number: settings.twilio_phone_number || "",
    notifications_email_enabled: settings.notifications_email_enabled || "false",
    smtp_host: settings.smtp_host || "",
    smtp_port: settings.smtp_port || "587",
    smtp_user: settings.smtp_user || "",
    smtp_pass: settings.smtp_pass || "",
    smtp_from: settings.smtp_from || "",
    // Templates
    template_checkin_sms: settings.template_checkin_sms || "Hej {{navn}}! Velkommen til {{enhed}}. Se dit forbrug her: {{link}}",
    template_checkin_email_subject: settings.template_checkin_email_subject || "Velkommen til {{enhed}} — CampSense",
    template_checkin_email_body: settings.template_checkin_email_body || "<h2>Velkommen, {{navn}}!</h2><p>Du er checket ind på <strong>{{enhed}}</strong>.</p><p>Se dit forbrug via din gæsteportal:</p><p><a href=\"{{link}}\">Åbn gæsteportal</a></p>",
    template_invoice_sms: settings.template_invoice_sms || "Hej {{navn}}, din faktura for {{periode}} på {{beløb}} DKK er klar. Se detaljer: {{link}}",
    template_invoice_email_subject: settings.template_invoice_email_subject || "Faktura for {{periode}} — CampSense",
    template_invoice_email_body: settings.template_invoice_email_body || "<h2>Faktura for {{periode}}</h2><p>Hej {{navn}},</p><p>Din faktura for <strong>{{enhed}}</strong> er klar.</p><p style=\"font-size:24px;font-weight:bold\">{{beløb}} DKK</p><p><a href=\"{{link}}\">Se faktura</a></p>",
  });
  const { isPending, saved, handleSave } = useSave(values);

  function h(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  const tagInfo = (
    <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
      <p className="font-medium text-foreground">Tilgængelige tags:</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span><code className="bg-background px-1 rounded">{"{{navn}}"}</code> — Gæstens navn</span>
        <span><code className="bg-background px-1 rounded">{"{{enhed}}"}</code> — Enhedens navn</span>
        <span><code className="bg-background px-1 rounded">{"{{link}}"}</code> — Link til gæsteportal</span>
        <span><code className="bg-background px-1 rounded">{"{{dato}}"}</code> — Dags dato</span>
        <span><code className="bg-background px-1 rounded">{"{{beløb}}"}</code> — Faktura-beløb</span>
        <span><code className="bg-background px-1 rounded">{"{{periode}}"}</code> — Faktura-periode</span>
        <span><code className="bg-background px-1 rounded">{"{{email}}"}</code> — Gæstens email</span>
        <span><code className="bg-background px-1 rounded">{"{{telefon}}"}</code> — Gæstens telefon</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* SMS */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border"><h2 className="font-semibold">SMS (Twilio)</h2></div>
        <div className="p-5 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={values.notifications_sms_enabled === "true"} onChange={(e) => h("notifications_sms_enabled", e.target.checked ? "true" : "false")} className="mt-0.5 h-4 w-4 accent-primary" />
            <div>
              <p className="text-sm font-medium">Aktivér SMS-notifikationer</p>
              <p className="text-xs text-muted-foreground mt-0.5">Send SMS til gæster ved check-in og faktura</p>
            </div>
          </label>
          {values.notifications_sms_enabled === "true" && (
            <div className="space-y-3 pt-1">
              <div>
                <Label className="text-sm text-muted-foreground">Account SID</Label>
                <Input value={values.twilio_account_sid} onChange={(e) => h("twilio_account_sid", e.target.value)} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className="mt-1" />
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Auth Token</Label>
                <Input type="password" value={values.twilio_auth_token} onChange={(e) => h("twilio_auth_token", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Telefonnummer (afsender)</Label>
                <Input value={values.twilio_phone_number} onChange={(e) => h("twilio_phone_number", e.target.value)} placeholder="+45XXXXXXXX" className="mt-1" />
              </div>
              <div className="pt-2 border-t border-border mt-3">
                <p className="text-sm font-medium mb-2">Test SMS</p>
                <div className="flex gap-2">
                  <Input
                    value={smsTestNumber}
                    onChange={(e) => setSmsTestNumber(e.target.value)}
                    placeholder="+45XXXXXXXX"
                    className="flex-1"
                  />
                  <Button variant="outline" size="sm" onClick={handleTestSMS} disabled={smsTesting || !smsTestNumber.trim()}>
                    {smsTesting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    {smsTesting ? "Sender..." : "Send test-SMS"}
                  </Button>
                </div>
                {smsTestResult && (
                  <div className={`mt-2 text-sm p-2.5 rounded-lg ${smsTestResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                    {smsTestResult.message}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Email */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border"><h2 className="font-semibold">Email (SMTP)</h2></div>
        <div className="p-5 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={values.notifications_email_enabled === "true"} onChange={(e) => h("notifications_email_enabled", e.target.checked ? "true" : "false")} className="mt-0.5 h-4 w-4 accent-primary" />
            <div>
              <p className="text-sm font-medium">Aktivér email-notifikationer</p>
              <p className="text-xs text-muted-foreground mt-0.5">Send email til gæster ved check-in og faktura</p>
            </div>
          </label>
          {values.notifications_email_enabled === "true" && (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm text-muted-foreground">SMTP Host</Label>
                  <Input value={values.smtp_host} onChange={(e) => h("smtp_host", e.target.value)} placeholder="smtp.gmail.com" className="mt-1" />
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Port</Label>
                  <Input type="number" value={values.smtp_port} onChange={(e) => h("smtp_port", e.target.value)} className="mt-1" />
                </div>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Brugernavn</Label>
                <Input value={values.smtp_user} onChange={(e) => h("smtp_user", e.target.value)} placeholder="din@email.dk" className="mt-1" />
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Adgangskode</Label>
                <Input type="password" value={values.smtp_pass} onChange={(e) => h("smtp_pass", e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Afsender-adresse (valgfri)</Label>
                <Input value={values.smtp_from} onChange={(e) => h("smtp_from", e.target.value)} placeholder="noreply@camping.dk" className="mt-1" />
              </div>
              <div className="pt-2 border-t border-border mt-3">
                <p className="text-sm font-medium mb-2">Test email</p>
                <div className="flex gap-2">
                  <Input
                    value={emailTestAddr}
                    onChange={(e) => setEmailTestAddr(e.target.value)}
                    placeholder="din@email.dk"
                    className="flex-1"
                  />
                  <Button variant="outline" size="sm" onClick={handleTestEmail} disabled={emailTesting || !emailTestAddr.trim()}>
                    {emailTesting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    {emailTesting ? "Sender..." : "Send test-email"}
                  </Button>
                </div>
                {emailTestResult && (
                  <div className={`mt-2 text-sm p-2.5 rounded-lg ${emailTestResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                    {emailTestResult.message}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Templates */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border"><h2 className="font-semibold">Skabeloner</h2></div>
        <div className="p-5 space-y-5">
          {tagInfo}

          {/* Check-in templates */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Check-in besked</h3>
            <div>
              <Label className="text-sm text-muted-foreground">SMS-skabelon</Label>
              <textarea
                value={values.template_checkin_sms}
                onChange={(e) => h("template_checkin_sms", e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Email-emne</Label>
              <Input value={values.template_checkin_email_subject} onChange={(e) => h("template_checkin_email_subject", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Email-indhold (HTML)</Label>
              <textarea
                value={values.template_checkin_email_body}
                onChange={(e) => h("template_checkin_email_body", e.target.value)}
                rows={5}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono text-xs"
              />
            </div>
          </div>

          <div className="border-t border-border" />

          {/* Invoice templates */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Faktura-besked</h3>
            <div>
              <Label className="text-sm text-muted-foreground">SMS-skabelon</Label>
              <textarea
                value={values.template_invoice_sms}
                onChange={(e) => h("template_invoice_sms", e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Email-emne</Label>
              <Input value={values.template_invoice_email_subject} onChange={(e) => h("template_invoice_email_subject", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm text-muted-foreground">Email-indhold (HTML)</Label>
              <textarea
                value={values.template_invoice_email_body}
                onChange={(e) => h("template_invoice_email_body", e.target.value)}
                rows={5}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono text-xs"
              />
            </div>
          </div>
        </div>
      </div>

      <SaveButton isPending={isPending} saved={saved} onClick={handleSave} />
    </div>
  );
}

// ─── PAYMENT TAB (QuickPay) ───
export function PaymentSettings({ settings }: SettingsFormProps) {
  const [values, setValues] = useState({
    quickpay_enabled: settings.quickpay_enabled || "false",
    quickpay_api_key: settings.quickpay_api_key || "",
    quickpay_private_key: settings.quickpay_private_key || "",
  });
  const { isPending, saved, handleSave } = useSave(values);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  function h(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      await updateMultipleSettings(Object.entries(values).map(([key, value]) => ({ key, value })));
      const result = await testQuickPay();
      setTestResult(result);
    } catch {
      setTestResult({ ok: false, message: "Uventet fejl under test" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">QuickPay</h2>
        </div>
        <div className="p-5 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={values.quickpay_enabled === "true"} onChange={(e) => h("quickpay_enabled", e.target.checked ? "true" : "false")} className="mt-0.5 h-4 w-4 accent-primary" />
            <div>
              <p className="text-sm font-medium">Aktivér QuickPay betaling</p>
              <p className="text-xs text-muted-foreground mt-0.5">Gæster kan betale online via QuickPay betalingslink</p>
            </div>
          </label>
          {values.quickpay_enabled === "true" && (
            <div className="space-y-3 pt-1">
              <div>
                <Label className="text-sm text-muted-foreground">API-nøgle</Label>
                <Input type="password" value={values.quickpay_api_key} onChange={(e) => h("quickpay_api_key", e.target.value)} placeholder="Din QuickPay API-nøgle" className="mt-1" />
                <p className="text-xs text-muted-foreground mt-1.5">Findes under Indstillinger &rarr; Integration &rarr; API i QuickPay Manager</p>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Privat nøgle (til callback-verifikation)</Label>
                <Input type="password" value={values.quickpay_private_key} onChange={(e) => h("quickpay_private_key", e.target.value)} placeholder="Din QuickPay private key" className="mt-1" />
                <p className="text-xs text-muted-foreground mt-1.5">Bruges til at verificere callbacks fra QuickPay. Findes under Indstillinger &rarr; Integration &rarr; API</p>
              </div>
              <div className="pt-1">
                <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
                  {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wifi className="h-4 w-4 mr-2" />}
                  {testing ? "Tester..." : "Test forbindelse"}
                </Button>
                {testResult && (
                  <div className={`mt-3 flex items-start gap-2.5 text-sm p-3 rounded-lg ${testResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                    {testResult.ok ? <Wifi className="h-4 w-4 shrink-0 mt-0.5" /> : <WifiOff className="h-4 w-4 shrink-0 mt-0.5" />}
                    <span>{testResult.message}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Sådan virker det</h2>
        </div>
        <div className="p-5 text-sm text-muted-foreground space-y-2">
          <p>1. Gæsten ser en <strong>&quot;Betal online&quot;</strong> knap på sin gæsteportal</p>
          <p>2. Ved klik oprettes en betaling hos QuickPay og gæsten sendes til betalingsvinduet</p>
          <p>3. Når betalingen er gennemført, sender QuickPay en callback til CampSense</p>
          <p>4. Betalingsstatus opdateres automatisk til &quot;Betalt&quot;</p>
          <p className="pt-2 text-xs">Callback URL: <code className="bg-muted px-1.5 py-0.5 rounded">{"{site_url}"}/api/quickpay/callback</code></p>
        </div>
      </div>

      <SaveButton isPending={isPending} saved={saved} onClick={handleSave} />
    </div>
  );
}

// ─── GUEST PORTAL TAB ───
const unitTypeLabels: Record<string, string> = {
  cabin: "Hytte",
  seasonal: "Fastligger",
  caravan: "Campingvogn",
  pitch: "Plads",
};

const langLabels: Record<string, string> = {
  da: "Dansk",
  en: "English",
  de: "Deutsch",
};

const unitTypes = ["cabin", "seasonal", "caravan", "pitch"] as const;
const langs = ["da", "en", "de"] as const;

function buildPracticalInfoState(settings: Record<string, string>) {
  const state: Record<string, string> = { site_map_url: settings.site_map_url || "" };
  for (const type of unitTypes) {
    for (const lang of langs) {
      const key = `practical_info_${type}_${lang}`;
      // Fallback: if per-lang key doesn't exist, use the old non-lang key for DA
      state[key] = settings[key] || (lang === "da" ? settings[`practical_info_${type}`] || "" : "");
    }
  }
  return state;
}

export function GuestPortalSettings({ settings }: SettingsFormProps) {
  const [values, setValues] = useState(buildPracticalInfoState(settings));
  const { isPending, saved, handleSave } = useSave(values);
  const [uploading, setUploading] = useState(false);
  const [activeLang, setActiveLang] = useState<string>("da");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function h(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/site-map", { method: "POST", body: formData });
      const data = await res.json();
      if (data.url) {
        h("site_map_url", data.url);
      }
    } catch {
      alert("Upload fejlede");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Practical info per unit type per language */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Praktiske oplysninger</h2>
          <p className="text-xs text-muted-foreground mt-1">Vises på gæstesiden pr. enhedstype og sprog. HTML understøttes (&lt;b&gt;, &lt;ul&gt;, &lt;a&gt;, &lt;h3&gt; osv.)</p>
        </div>
        <div className="p-5 space-y-4">
          {/* Language tabs */}
          <div className="flex gap-1 border-b border-border pb-0">
            {langs.map((lang) => (
              <button
                key={lang}
                onClick={() => setActiveLang(lang)}
                className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                  activeLang === lang ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {langLabels[lang]}
              </button>
            ))}
          </div>
          {unitTypes.map((type) => {
            const key = `practical_info_${type}_${activeLang}`;
            return (
              <div key={`${type}-${activeLang}`}>
                <Label className="text-sm font-medium">{unitTypeLabels[type]}</Label>
                <textarea
                  value={values[key] || ""}
                  onChange={(e) => h(key, e.target.value)}
                  placeholder={`Praktisk info for ${unitTypeLabels[type].toLowerCase()} (${langLabels[activeLang]})...`}
                  rows={4}
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Site map */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Pladskort</h2>
          <p className="text-xs text-muted-foreground mt-1">Upload et billede af campingpladsen. Vises på gæstesiden.</p>
        </div>
        <div className="p-5 space-y-3">
          {values.site_map_url ? (
            <div className="space-y-3">
              <img src={values.site_map_url} alt="Pladskort" className="w-full max-h-64 object-contain rounded-lg border" />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  <Upload className="h-4 w-4 mr-2" />
                  {uploading ? "Uploader..." : "Erstat billede"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => h("site_map_url", "")}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Fjern
                </Button>
              </div>
            </div>
          ) : (
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground mb-3">Intet pladskort uploadet</p>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                {uploading ? "Uploader..." : "Upload billede"}
              </Button>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
        </div>
      </div>

      <SaveButton isPending={isPending} saved={saved} onClick={handleSave} />
    </div>
  );
}
