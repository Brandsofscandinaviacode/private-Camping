"use client";

import { useState, useTransition } from "react";
import { Plus, Save, Trash2, Loader2, WashingMachine, Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  createLaundryMachine,
  updateLaundryMachine,
  deleteLaundryMachine,
} from "@/lib/actions";

interface Machine {
  id: number;
  name: string;
  kind: string;
  source: "HA" | "MQTT";
  switchEntityId: string | null;
  mqttPrefix: string | null;
  mqttComponent: string | null;
  durationMinutes: number;
  pricePerUse: number;
  enabled: boolean;
  code: string | null;
  location: string | null;
}

type KindFilter = "WASHER" | "DRYER" | "ALL";

interface LaundrySettingsProps {
  machines: Machine[];
  kind?: KindFilter;
}

function MachineRow({ machine, kindLocked }: { machine: Machine; kindLocked: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState({
    name: machine.name,
    kind: machine.kind,
    source: machine.source,
    switchEntityId: machine.switchEntityId ?? "",
    mqttPrefix: machine.mqttPrefix ?? "",
    mqttComponent: machine.mqttComponent ?? "",
    durationMinutes: String(machine.durationMinutes),
    pricePerUse: String(machine.pricePerUse),
    enabled: machine.enabled,
    code: machine.code ?? "",
    location: machine.location ?? "",
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleSave() {
    setError(null);
    if (values.code && !/^\d{4}$/.test(values.code)) {
      setError("Koden skal være 4 cifre");
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
        await updateLaundryMachine(machine.id, {
          name: values.name,
          kind: values.kind,
          source: values.source,
          switchEntityId: values.source === "HA" ? values.switchEntityId.trim() || null : null,
          mqttPrefix: values.source === "MQTT" ? values.mqttPrefix.trim() || null : null,
          mqttComponent: values.source === "MQTT" ? values.mqttComponent.trim() || null : null,
          durationMinutes: parseInt(values.durationMinutes, 10) || 60,
          pricePerUse: parseFloat(values.pricePerUse) || 0,
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
      await deleteLaundryMachine(machine.id);
    });
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {values.kind === "DRYER" ? (
            <Wind className="h-4 w-4 text-muted-foreground" />
          ) : (
            <WashingMachine className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium text-sm">{machine.name}</span>
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
            placeholder="switch.washing_machine"
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
      <div className={`grid ${kindLocked ? "grid-cols-1" : "grid-cols-2"} gap-3`}>
        {!kindLocked && (
          <div>
            <Label className="text-xs text-muted-foreground">Type</Label>
            <select
              value={values.kind}
              onChange={(e) => setValues((v) => ({ ...v, kind: e.target.value }))}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="WASHER">Vaskemaskine</option>
              <option value="DRYER">Tørretumbler</option>
            </select>
          </div>
        )}
        <div>
          <Label className="text-xs text-muted-foreground">Varighed (minutter)</Label>
          <Input
            type="number"
            value={values.durationMinutes}
            onChange={(e) => setValues((v) => ({ ...v, durationMinutes: e.target.value }))}
            className="mt-1"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Pris pr. vask (DKK)</Label>
          <Input
            type="number"
            step="0.5"
            value={values.pricePerUse}
            onChange={(e) => setValues((v) => ({ ...v, pricePerUse: e.target.value }))}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">
            4-cifret kode ({values.kind === "DRYER" ? "3xxx" : "2xxx"})
          </Label>
          <Input
            value={values.code}
            onChange={(e) => setValues((v) => ({ ...v, code: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
            placeholder={values.kind === "DRYER" ? "3001" : "2001"}
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Lokation</Label>
        <Input
          value={values.location}
          onChange={(e) => setValues((v) => ({ ...v, location: e.target.value }))}
          placeholder="Bygning A, Vaskerum 1"
          className="mt-1"
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" disabled={isPending} onClick={handleSave}>
          <Save className="h-3 w-3 mr-1.5" />
          {saved ? "Gemt!" : "Gem"}
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

export function LaundrySettings({ machines, kind = "ALL" }: LaundrySettingsProps) {
  const kindLocked = kind !== "ALL";
  const filteredMachines = kindLocked ? machines.filter((m) => m.kind === kind) : machines;

  const titles = {
    WASHER: {
      heading: "Vaskemaskiner",
      description:
        "Tilføj vaskemaskiner som gæster kan betale og starte fra gæsteportalen. Hver maskine styres af et Shelly-relæ via Home Assistant.",
      addLabel: "Tilføj vaskemaskine",
      newHeading: "Ny vaskemaskine",
      emptyLabel: "Ingen vaskemaskiner oprettet endnu.",
      placeholder: "Vaskemaskine 1",
    },
    DRYER: {
      heading: "Tørretumblere",
      description:
        "Tilføj tørretumblere som gæster kan betale og starte fra gæsteportalen. Hver tumbler styres af et Shelly-relæ via Home Assistant.",
      addLabel: "Tilføj tørretumbler",
      newHeading: "Ny tørretumbler",
      emptyLabel: "Ingen tørretumblere oprettet endnu.",
      placeholder: "Tørretumbler 1",
    },
    ALL: {
      heading: "Vaskerum",
      description:
        "Tilføj vaskemaskiner og tørretumblere som gæster kan betale og starte fra gæsteportalen. Hver maskine styres af et Shelly-relæ via Home Assistant.",
      addLabel: "Tilføj maskine",
      newHeading: "Ny maskine",
      emptyLabel: "Ingen maskiner oprettet endnu.",
      placeholder: "Vaskemaskine 1",
    },
  } as const;
  const t = titles[kind];

  const [isPending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<"WASHER" | "DRYER">(kindLocked ? kind : "WASHER");
  const [newSource, setNewSource] = useState<"HA" | "MQTT">("HA");
  const [newEntity, setNewEntity] = useState("");
  const [newMqttPrefix, setNewMqttPrefix] = useState("");
  const [newMqttComponent, setNewMqttComponent] = useState("switch:0");
  const [newDuration, setNewDuration] = useState("60");
  const [newPrice, setNewPrice] = useState("25");
  const [newCode, setNewCode] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const newEndpointValid =
    newSource === "HA" ? newEntity.trim().length > 0
      : newMqttPrefix.trim().length > 0 && newMqttComponent.trim().length > 0;

  function handleAdd() {
    if (!newName.trim() || !newEndpointValid) return;
    setAddError(null);
    if (newCode && !/^\d{4}$/.test(newCode)) {
      setAddError("Koden skal være 4 cifre");
      return;
    }
    startTransition(async () => {
      try {
        await createLaundryMachine({
          name: newName.trim(),
          kind: newKind,
          source: newSource,
          switchEntityId: newSource === "HA" ? newEntity.trim() || null : null,
          mqttPrefix: newSource === "MQTT" ? newMqttPrefix.trim() || null : null,
          mqttComponent: newSource === "MQTT" ? newMqttComponent.trim() || null : null,
          durationMinutes: parseInt(newDuration, 10) || 60,
          pricePerUse: parseFloat(newPrice) || 25,
          code: newCode.trim() || null,
          location: newLocation.trim() || null,
        });
        setNewName("");
        setNewKind(kindLocked ? kind : "WASHER");
        setNewSource("HA");
        setNewEntity("");
        setNewMqttPrefix("");
        setNewMqttComponent("switch:0");
        setNewDuration("60");
        setNewPrice("25");
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
        <h2 className="text-lg font-semibold mb-1">{t.heading}</h2>
        <p className="text-sm text-muted-foreground mb-5">{t.description}</p>
      </div>

      {filteredMachines.length === 0 && !showAdd && (
        <p className="text-sm text-muted-foreground py-4">{t.emptyLabel}</p>
      )}

      <div className="space-y-3">
        {filteredMachines.map((m) => (
          <MachineRow key={m.id} machine={m} kindLocked={kindLocked} />
        ))}
      </div>

      {showAdd ? (
        <div className="rounded-xl border border-border/60 bg-card shadow-sm p-5 space-y-3">
          <h3 className="font-medium text-sm">{t.newHeading}</h3>
          <div className={`grid ${kindLocked ? "grid-cols-1" : "grid-cols-2"} gap-3`}>
            <div>
              <Label className="text-xs text-muted-foreground">Navn *</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t.placeholder}
                className="mt-1"
                autoFocus
              />
            </div>
            {!kindLocked && (
              <div>
                <Label className="text-xs text-muted-foreground">Type</Label>
                <select
                  value={newKind}
                  onChange={(e) => setNewKind(e.target.value as "WASHER" | "DRYER")}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="WASHER">Vaskemaskine</option>
                  <option value="DRYER">Tørretumbler</option>
                </select>
              </div>
            )}
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
          {newSource === "HA" ? (
            <div>
              <Label className="text-xs text-muted-foreground">Switch Entity ID *</Label>
              <Input
                value={newEntity}
                onChange={(e) => setNewEntity(e.target.value)}
                placeholder="switch.washer_1"
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Varighed (min)</Label>
              <Input
                type="number"
                value={newDuration}
                onChange={(e) => setNewDuration(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Pris (DKK)</Label>
              <Input
                type="number"
                step="0.5"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">4-cifret kode ({newKind === "DRYER" ? "3xxx" : "2xxx"})</Label>
              <Input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder={newKind === "DRYER" ? "3001" : "2001"}
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
          {t.addLabel}
        </Button>
      )}
    </div>
  );
}
