"use client";

import { useState } from "react";
import { Plus, Home, Caravan, MapPin, Anchor } from "lucide-react";
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
import { createUnit } from "@/lib/actions";

const unitTypes = [
  { value: "CABIN" as const, label: "Hytte", icon: Home, desc: "Korttidsleje" },
  { value: "SEASONAL" as const, label: "Fastligger", icon: Anchor, desc: "Langtidsleje med månedlig fakturering" },
  { value: "CARAVAN" as const, label: "Campingvogn", icon: Caravan, desc: "Korttidsleje" },
  { value: "PITCH" as const, label: "Plads", icon: MapPin, desc: "Korttidsleje (telt/vogn)" },
];

export function AddUnitDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"CABIN" | "SEASONAL" | "CARAVAN" | "PITCH">("CABIN");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await createUnit(name.trim(), type);
      setName("");
      setType("CABIN");
      setOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Fejl ved oprettelse");
    } finally {
      setLoading(false);
    }
  }

  const selectedType = unitTypes.find((t) => t.value === type);

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
            <Label>Type</Label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {unitTypes.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    type="button"
                    key={t.value}
                    onClick={() => setType(t.value)}
                    className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                      type === t.value
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:border-muted-foreground/30"
                    }`}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">{t.label}</p>
                      <p className="text-xs text-muted-foreground">{t.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <Button type="submit" disabled={loading || !name.trim()} className="w-full">
            {loading ? "Opretter..." : "Opret enhed"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
