"use client";

import { useState, useTransition } from "react";
import { Plus, Save, Trash2, Loader2, WashingMachine } from "lucide-react";
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
  switchEntityId: string;
  durationMinutes: number;
  pricePerUse: number;
  enabled: boolean;
}

interface LaundrySettingsProps {
  machines: Machine[];
}

function MachineRow({ machine }: { machine: Machine }) {
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState({
    name: machine.name,
    switchEntityId: machine.switchEntityId,
    durationMinutes: String(machine.durationMinutes),
    pricePerUse: String(machine.pricePerUse),
    enabled: machine.enabled,
  });
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleSave() {
    startTransition(async () => {
      await updateLaundryMachine(machine.id, {
        name: values.name,
        switchEntityId: values.switchEntityId,
        durationMinutes: parseInt(values.durationMinutes, 10) || 60,
        pricePerUse: parseFloat(values.pricePerUse) || 0,
        enabled: values.enabled,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteLaundryMachine(machine.id);
    });
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <WashingMachine className="h-4 w-4 text-muted-foreground" />
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
          <Label className="text-xs text-muted-foreground">Switch Entity ID</Label>
          <Input
            value={values.switchEntityId}
            onChange={(e) => setValues((v) => ({ ...v, switchEntityId: e.target.value }))}
            placeholder="switch.washing_machine"
            className="mt-1"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Varighed (minutter)</Label>
          <Input
            type="number"
            value={values.durationMinutes}
            onChange={(e) => setValues((v) => ({ ...v, durationMinutes: e.target.value }))}
            className="mt-1"
          />
        </div>
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
      </div>
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

export function LaundrySettings({ machines }: LaundrySettingsProps) {
  const [isPending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEntity, setNewEntity] = useState("");
  const [newDuration, setNewDuration] = useState("60");
  const [newPrice, setNewPrice] = useState("25");

  function handleAdd() {
    if (!newName.trim() || !newEntity.trim()) return;
    startTransition(async () => {
      await createLaundryMachine({
        name: newName.trim(),
        switchEntityId: newEntity.trim(),
        durationMinutes: parseInt(newDuration, 10) || 60,
        pricePerUse: parseFloat(newPrice) || 25,
      });
      setNewName("");
      setNewEntity("");
      setNewDuration("60");
      setNewPrice("25");
      setShowAdd(false);
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold mb-1">Vaskerum</h2>
        <p className="text-sm text-muted-foreground mb-5">
          Tilføj vaskemaskiner og tørretumblere som gæster kan betale og starte fra gæsteportalen.
          Hver maskine styres af et Shelly-relæ via Home Assistant.
        </p>
      </div>

      {machines.length === 0 && !showAdd && (
        <p className="text-sm text-muted-foreground py-4">
          Ingen maskiner oprettet endnu.
        </p>
      )}

      <div className="space-y-3">
        {machines.map((m) => (
          <MachineRow key={m.id} machine={m} />
        ))}
      </div>

      {showAdd ? (
        <div className="rounded-xl border bg-card shadow-sm p-5 space-y-3">
          <h3 className="font-medium text-sm">Ny maskine</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Navn *</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Vaskemaskine 1"
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Switch Entity ID *</Label>
              <Input
                value={newEntity}
                onChange={(e) => setNewEntity(e.target.value)}
                placeholder="switch.washer_1"
                className="mt-1"
              />
            </div>
          </div>
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
          <div className="flex gap-2">
            <Button size="sm" disabled={isPending || !newName.trim() || !newEntity.trim()} onClick={handleAdd}>
              {isPending ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Plus className="h-3 w-3 mr-1.5" />}
              Tilføj
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Annullér</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Tilføj maskine
        </Button>
      )}
    </div>
  );
}
