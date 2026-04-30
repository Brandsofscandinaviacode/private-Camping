"use client";

import { useEffect, useState } from "react";
import { Plus, Home, Building2, Caravan, MapPin, Tent, BedDouble, Anchor } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createUnit, getResourceTypes } from "@/lib/actions";

type LucideIcon = typeof Home;
const ICONS: Record<string, LucideIcon> = {
  Home, Building2, Caravan, MapPin, Tent, BedDouble, Anchor,
};

interface ResourceType {
  id: number;
  name: string;
  icon: string;
  defaultUnitType: string;
}

export function AddUnitDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [resourceTypeId, setResourceTypeId] = useState<number | null>(null);
  const [resourceTypes, setResourceTypes] = useState<ResourceType[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    getResourceTypes().then((types) => {
      const list = types.map((t) => ({
        id: t.id,
        name: t.name,
        icon: t.icon,
        defaultUnitType: t.defaultUnitType,
      }));
      setResourceTypes(list);
      if (list.length > 0 && resourceTypeId === null) {
        setResourceTypeId(list[0].id);
      }
    });
  }, [open, resourceTypeId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !resourceTypeId) return;
    setLoading(true);
    try {
      const rt = resourceTypes.find((r) => r.id === resourceTypeId);
      const type = (rt?.defaultUnitType || "CABIN") as "CABIN" | "SEASONAL" | "CARAVAN" | "PITCH";
      await createUnit(name.trim(), type, resourceTypeId);
      setName("");
      setOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Fejl ved oprettelse");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="h-4 w-4 mr-2" />
        Tilføj enhed
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tilføj ny enhed</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <Label htmlFor="unit-name">Navn</Label>
            <Input
              id="unit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="F.eks. 1, A3, 12..."
              autoFocus
              className="mt-1"
            />
          </div>
          <div>
            <Label>Ressourcetype</Label>
            {resourceTypes.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-2">
                Ingen ressourcetyper. Opret én under <strong>Indstillinger → Enheder</strong>.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 mt-2 max-h-[280px] overflow-y-auto">
                {resourceTypes.map((rt) => {
                  const Icon = ICONS[rt.icon] || Home;
                  return (
                    <button
                      type="button"
                      key={rt.id}
                      onClick={() => setResourceTypeId(rt.id)}
                      className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                        resourceTypeId === rt.id
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border hover:border-muted-foreground/30"
                      }`}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{rt.name}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <Button type="submit" disabled={loading || !name.trim() || !resourceTypeId} className="w-full">
            {loading ? "Opretter..." : "Opret enhed"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
