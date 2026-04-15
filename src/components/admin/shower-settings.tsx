"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Plus, Save, Trash2, Loader2, Droplets, QrCode, Download } from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  createShower,
  updateShower,
  deleteShower,
} from "@/lib/actions";

interface Shower {
  id: number;
  name: string;
  source: "HA" | "MQTT";
  switchEntityId: string | null;
  mqttPrefix: string | null;
  mqttComponent: string | null;
  pricePerMinute: number;
  minMinutes: number;
  maxMinutes: number;
  enabled: boolean;
  code: string | null;
  location: string | null;
}

interface Props {
  showers: Shower[];
  baseUrl: string;
}

function QRPreview({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, setRendered] = useState(false);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, {
        width: 200,
        margin: 2,
        color: { dark: "#000000", light: "#FFFFFF" },
      }).then(() => setRendered(true));
    }
  }, [url]);

  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <canvas ref={canvasRef} className="rounded-lg border border-border/60" />
      <p className="text-[10px] text-muted-foreground text-center break-all max-w-[200px]">{url}</p>
    </div>
  );
}

function ShowerRow({ shower, baseUrl }: { shower: Shower; baseUrl: string }) {
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState({
    name: shower.name,
    source: shower.source,
    switchEntityId: shower.switchEntityId ?? "",
    mqttPrefix: shower.mqttPrefix ?? "",
    mqttComponent: shower.mqttComponent ?? "",
    pricePerMinute: String(shower.pricePerMinute),
    minMinutes: String(shower.minMinutes),
    maxMinutes: String(shower.maxMinutes),
    enabled: shower.enabled,
    code: shower.code ?? "",
    location: shower.location ?? "",
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const qrUrl = (() => {
    const base = baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
    return `${base}/shower/${shower.id}`;
  })();

  async function downloadQR() {
    try {
      const dataUrl = await QRCode.toDataURL(qrUrl, {
        width: 512,
        margin: 2,
        color: { dark: "#000000", light: "#FFFFFF" },
      });
      const a = document.createElement("a");
      a.download = `qr-bad-${shower.name.toLowerCase().replace(/\s+/g, "-")}.png`;
      a.href = dataUrl;
      a.click();
    } catch (e) {
      console.error("QR generation error:", e);
    }
  }

  function handleSave() {
    setError(null);
    if (values.code && !/^1\d{3}$/.test(values.code)) {
      setError("Kode skal være 4 cifre og starte med 1 (1xxx)");
      return;
    }
    if (values.source === "HA" && !values.switchEntityId.trim()) {
      setError("Entity ID er påkrævet når kilden er Home Assistant");
      return;
    }
    if (values.source === "MQTT" && (!values.mqttPrefix.trim() || !values.mqttComponent.trim())) {
      setError("MQTT prefix og komponent er påkrævet");
      return;
    }
    startTransition(async () => {
      try {
        await updateShower(shower.id, {
          name: values.name,
          source: values.source,
          switchEntityId: values.source === "HA" ? values.switchEntityId.trim() || null : null,
          mqttPrefix: values.source === "MQTT" ? values.mqttPrefix.trim() || null : null,
          mqttComponent: values.source === "MQTT" ? values.mqttComponent.trim() || null : null,
          pricePerMinute: parseFloat(values.pricePerMinute) || 0,
          minMinutes: parseInt(values.minMinutes, 10) || 2,
          maxMinutes: parseInt(values.maxMinutes, 10) || 30,
          enabled: values.enabled,
          code: values.code.trim() || null,
          location: values.location.trim() || null,
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Kunne ikke gemme");
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteShower(shower.id);
    });
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Droplets className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">{shower.name}</span>
        </div>
        <Switch
          checked={values.enabled}
          onCheckedChange={(checked) => setValues((v) => ({ ...v, enabled: checked }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Navn</Label>
          <Input
            value={values.name}
            onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Hardware-kilde</Label>
          <select
            value={values.source}
            onChange={(e) => setValues((v) => ({ ...v, source: e.target.value as "HA" | "MQTT" }))}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="HA">Home Assistant</option>
            <option value="MQTT">MQTT (Shelly direkte)</option>
          </select>
        </div>
      </div>
      {values.source === "HA" ? (
        <div>
          <Label className="text-xs text-muted-foreground">Switch Entity ID</Label>
          <Input
            value={values.switchEntityId}
            onChange={(e) => setValues((v) => ({ ...v, switchEntityId: e.target.value }))}
            placeholder="switch.shower_1"
            className="mt-1"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">MQTT Prefix</Label>
            <Input
              value={values.mqttPrefix}
              onChange={(e) => setValues((v) => ({ ...v, mqttPrefix: e.target.value }))}
              placeholder="shellyplus1pm-abc123"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Komponent</Label>
            <Input
              value={values.mqttComponent}
              onChange={(e) => setValues((v) => ({ ...v, mqttComponent: e.target.value }))}
              placeholder="switch:0"
              className="mt-1"
            />
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Pris pr. min (DKK)</Label>
          <Input
            type="number"
            step="0.25"
            value={values.pricePerMinute}
            onChange={(e) => setValues((v) => ({ ...v, pricePerMinute: e.target.value }))}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Min. min</Label>
          <Input
            type="number"
            value={values.minMinutes}
            onChange={(e) => setValues((v) => ({ ...v, minMinutes: e.target.value }))}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Max. min</Label>
          <Input
            type="number"
            value={values.maxMinutes}
            onChange={(e) => setValues((v) => ({ ...v, maxMinutes: e.target.value }))}
            className="mt-1"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">4-cifret kode (1xxx)</Label>
          <Input
            value={values.code}
            onChange={(e) => setValues((v) => ({ ...v, code: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
            placeholder="1001"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Lokation</Label>
          <Input
            value={values.location}
            onChange={(e) => setValues((v) => ({ ...v, location: e.target.value }))}
            placeholder="Bygning A"
            className="mt-1"
          />
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {showQR && <QRPreview url={qrUrl} />}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" disabled={isPending} onClick={handleSave}>
          <Save className="h-3 w-3 mr-1.5" />
          {saved ? "Gemt!" : "Gem"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowQR((v) => !v)}>
          <QrCode className="h-3 w-3 mr-1.5" />
          {showQR ? "Skjul QR" : "Vis QR"}
        </Button>
        <Button variant="outline" size="sm" onClick={downloadQR}>
          <Download className="h-3 w-3 mr-1.5" />
          Download PNG
        </Button>
        {!confirmDelete ? (
          <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3 w-3 mr-1.5" />
            Slet
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="destructive" size="sm" disabled={isPending} onClick={handleDelete}>
              Bekræft slet
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
              Annullér
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ShowerSettings({ showers, baseUrl }: Props) {
  const [isPending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSource, setNewSource] = useState<"HA" | "MQTT">("HA");
  const [newEntity, setNewEntity] = useState("");
  const [newMqttPrefix, setNewMqttPrefix] = useState("");
  const [newMqttComponent, setNewMqttComponent] = useState("switch:0");
  const [newPrice, setNewPrice] = useState("2");
  const [newMin, setNewMin] = useState("2");
  const [newMax, setNewMax] = useState("30");
  const [newCode, setNewCode] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const newEndpointValid =
    newSource === "HA" ? newEntity.trim().length > 0
      : newMqttPrefix.trim().length > 0 && newMqttComponent.trim().length > 0;

  function handleAdd() {
    if (!newName.trim() || !newEndpointValid) return;
    setAddError(null);
    if (newCode && !/^1\d{3}$/.test(newCode)) {
      setAddError("Kode skal være 4 cifre og starte med 1 (1xxx)");
      return;
    }
    startTransition(async () => {
      try {
        await createShower({
          name: newName.trim(),
          source: newSource,
          switchEntityId: newSource === "HA" ? newEntity.trim() || null : null,
          mqttPrefix: newSource === "MQTT" ? newMqttPrefix.trim() || null : null,
          mqttComponent: newSource === "MQTT" ? newMqttComponent.trim() || null : null,
          pricePerMinute: parseFloat(newPrice) || 2,
          minMinutes: parseInt(newMin, 10) || 2,
          maxMinutes: parseInt(newMax, 10) || 30,
          code: newCode.trim() || null,
          location: newLocation.trim() || null,
        });
        setNewName("");
        setNewSource("HA");
        setNewEntity("");
        setNewMqttPrefix("");
        setNewMqttComponent("switch:0");
        setNewPrice("2");
        setNewMin("2");
        setNewMax("30");
        setNewCode("");
        setNewLocation("");
        setShowAdd(false);
      } catch (e) {
        setAddError(e instanceof Error ? e.message : "Kunne ikke tilføje");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold mb-1">Bade</h2>
        <p className="text-sm text-muted-foreground mb-5">
          Opret bade med Shelly-ventil. Gæster køber et antal minutter og kan
          pause op til 5 min. undervejs. Hver session auto-lukker når tiden er gået.
        </p>
      </div>

      {showers.length === 0 && !showAdd && (
        <p className="text-sm text-muted-foreground py-4">
          Ingen bade oprettet endnu.
        </p>
      )}

      <div className="space-y-3">
        {showers.map((s) => (
          <ShowerRow key={s.id} shower={s} baseUrl={baseUrl} />
        ))}
      </div>

      {showAdd ? (
        <div className="rounded-xl border border-border/60 bg-card shadow-sm p-5 space-y-3">
          <h3 className="font-medium text-sm">Nyt bad</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Navn *</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Bad 1"
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Hardware-kilde</Label>
              <select
                value={newSource}
                onChange={(e) => setNewSource(e.target.value as "HA" | "MQTT")}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="HA">Home Assistant</option>
                <option value="MQTT">MQTT (Shelly direkte)</option>
              </select>
            </div>
          </div>
          {newSource === "HA" ? (
            <div>
              <Label className="text-xs text-muted-foreground">Switch Entity ID *</Label>
              <Input
                value={newEntity}
                onChange={(e) => setNewEntity(e.target.value)}
                placeholder="switch.shower_1"
                className="mt-1"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">MQTT Prefix *</Label>
                <Input
                  value={newMqttPrefix}
                  onChange={(e) => setNewMqttPrefix(e.target.value)}
                  placeholder="shellyplus1pm-abc123"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Komponent *</Label>
                <Input
                  value={newMqttComponent}
                  onChange={(e) => setNewMqttComponent(e.target.value)}
                  placeholder="switch:0"
                  className="mt-1"
                />
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Pris/min (DKK)</Label>
              <Input
                type="number"
                step="0.25"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Min. min</Label>
              <Input
                type="number"
                value={newMin}
                onChange={(e) => setNewMin(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Max. min</Label>
              <Input
                type="number"
                value={newMax}
                onChange={(e) => setNewMax(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">4-cifret kode (1xxx)</Label>
              <Input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="1001"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Lokation</Label>
              <Input
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                placeholder="Bygning A"
                className="mt-1"
              />
            </div>
          </div>
          {addError && <p className="text-xs text-red-600">{addError}</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={isPending || !newName.trim() || !newEndpointValid} onClick={handleAdd}>
              {isPending ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Plus className="h-3 w-3 mr-1.5" />}
              Tilføj
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Annullér</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Tilføj bad
        </Button>
      )}
    </div>
  );
}
