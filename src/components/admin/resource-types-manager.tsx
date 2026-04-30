"use client";

import { useState, useTransition } from "react";
import {
  Home, Building2, Caravan, MapPin, Tent, BedDouble, Anchor,
  Plus, Trash2, GripVertical, Save, Loader2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createResourceType,
  updateResourceType,
  deleteResourceType,
  reorderResourceTypes,
} from "@/lib/actions";

type LucideIcon = typeof Home;
const ICONS: Record<string, LucideIcon> = {
  Home, Building2, Caravan, MapPin, Tent, BedDouble, Anchor,
};
const ICON_NAMES = Object.keys(ICONS);

const UNIT_TYPE_LABELS: Record<string, string> = {
  CABIN: "Korttid (hytte/lejlighed)",
  SEASONAL: "Fastligger (langtidsleje)",
  CARAVAN: "Korttid (campingvogn)",
  PITCH: "Korttid (plads)",
};

interface ResourceType {
  id: number;
  name: string;
  icon: string;
  sortOrder: number;
  defaultUnitType: string;
  externalId: string | null;
  externalProvider: string | null;
  _count: { units: number };
}

export function ResourceTypesManager({ initialTypes }: { initialTypes: ResourceType[] }) {
  const [types, setTypes] = useState(initialTypes);
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newType, setNewType] = useState({ name: "", icon: "Home", defaultUnitType: "CABIN" });

  function handleAdd() {
    if (!newType.name.trim()) return;
    startTransition(async () => {
      const created = await createResourceType({
        name: newType.name.trim(),
        icon: newType.icon,
        defaultUnitType: newType.defaultUnitType as "CABIN" | "SEASONAL" | "CARAVAN" | "PITCH",
      });
      setTypes((prev) => [...prev, { ...created, _count: { units: 0 } }]);
      setNewType({ name: "", icon: "Home", defaultUnitType: "CABIN" });
      setShowAdd(false);
    });
  }

  function handleUpdate(id: number, data: Partial<ResourceType>) {
    setTypes((prev) => prev.map((t) => (t.id === id ? { ...t, ...data } : t)));
    startTransition(async () => {
      await updateResourceType(id, {
        name: data.name,
        icon: data.icon,
        defaultUnitType: data.defaultUnitType as "CABIN" | "SEASONAL" | "CARAVAN" | "PITCH" | undefined,
      });
    });
  }

  function handleDelete(id: number) {
    const t = types.find((x) => x.id === id);
    const msg = t && t._count.units > 0
      ? `Slet "${t.name}"? ${t._count.units} enheder bliver placeret som "Ukategoriseret" og skal manuelt flyttes til en anden type.`
      : `Slet "${t?.name}"?`;
    if (!confirm(msg)) return;
    setTypes((prev) => prev.filter((x) => x.id !== id));
    startTransition(async () => {
      await deleteResourceType(id);
    });
  }

  function handleDrop(targetId: number) {
    if (draggingId === null || draggingId === targetId) return;
    const newOrder = [...types];
    const fromIdx = newOrder.findIndex((t) => t.id === draggingId);
    const toIdx = newOrder.findIndex((t) => t.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, moved);
    setTypes(newOrder);
    setDraggingId(null);
    startTransition(async () => {
      await reorderResourceTypes(newOrder.map((t) => t.id));
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/60 bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Ressourcetyper</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Definér selv hvordan dine enheder grupperes på dashboard og forsiden. Træk i håndtaget for at omarrangere.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}>
            <Plus className="h-4 w-4 mr-1" />
            Ny type
          </Button>
        </div>

        {showAdd && (
          <div className="p-4 border-b border-border bg-muted/30 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Navn</Label>
                <Input
                  value={newType.name}
                  onChange={(e) => setNewType({ ...newType, name: e.target.value })}
                  placeholder="f.eks. Hytter"
                  className="mt-1"
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                />
              </div>
              <div>
                <Label className="text-xs">Ikon</Label>
                <select
                  value={newType.icon}
                  onChange={(e) => setNewType({ ...newType, icon: e.target.value })}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Standardtype</Label>
                <select
                  value={newType.defaultUnitType}
                  onChange={(e) => setNewType({ ...newType, defaultUnitType: e.target.value })}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {Object.entries(UNIT_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={!newType.name.trim() || isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Opret
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowAdd(false)}>Annullér</Button>
            </div>
          </div>
        )}

        <div className="divide-y divide-border">
          {types.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">Ingen ressourcetyper endnu.</p>
          ) : types.map((t) => {
            const Icon = ICONS[t.icon] || Home;
            const isEditing = editingId === t.id;
            return (
              <div
                key={t.id}
                draggable
                onDragStart={() => setDraggingId(t.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(t.id)}
                onDragEnd={() => setDraggingId(null)}
                className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                  draggingId === t.id ? "opacity-40" : "hover:bg-muted/40"
                }`}
              >
                <GripVertical className="h-4 w-4 text-muted-foreground/40 cursor-move shrink-0" />
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                {isEditing ? (
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Input
                      value={t.name}
                      onChange={(e) => setTypes((p) => p.map((x) => x.id === t.id ? { ...x, name: e.target.value } : x))}
                      onBlur={() => handleUpdate(t.id, { name: t.name })}
                      className="h-8"
                    />
                    <select
                      value={t.icon}
                      onChange={(e) => handleUpdate(t.id, { icon: e.target.value })}
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm h-8"
                    >
                      {ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <select
                      value={t.defaultUnitType}
                      onChange={(e) => handleUpdate(t.id, { defaultUnitType: e.target.value })}
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm h-8"
                    >
                      {Object.entries(UNIT_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t._count.units} enheder &middot; {UNIT_TYPE_LABELS[t.defaultUnitType] || t.defaultUnitType}
                      {t.externalId && ` · ${t.externalProvider} #${t.externalId}`}
                    </p>
                  </div>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingId(isEditing ? null : t.id)}
                    className="h-8 w-8 p-0"
                  >
                    {isEditing ? <X className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(t.id)}
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
