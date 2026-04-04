"use client";

import { useState } from "react";
import { Plus, Home, Caravan, MapPin } from "lucide-react";
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
  { value: "CABIN" as const, label: "Hytte", icon: Home },
  { value: "CARAVAN" as const, label: "Campingvogn", icon: Caravan },
  { value: "PITCH" as const, label: "Plads", icon: MapPin },
];

export function AddUnitDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"CABIN" | "CARAVAN" | "PITCH">("CABIN");
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
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="unit-name">Navn</Label>
            <Input
              id="unit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="F.eks. Hytte 1, Vogn A3, Plads 12..."
              autoFocus
            />
          </div>
          <div>
            <Label>Type</Label>
            <div className="grid grid-cols-3 gap-2 mt-1.5">
              {unitTypes.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    type="button"
                    key={t.value}
                    onClick={() => setType(t.value)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-sm transition-colors ${
                      type === t.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-muted-foreground/30"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {t.label}
                  </button>
                );
              })}
            </div>
            {type === "CARAVAN" && (
              <p className="text-xs text-muted-foreground mt-2">
                Campingvogn sættes automatisk op til langtidsleje med månedlig fakturering.
              </p>
            )}
          </div>
          <Button type="submit" disabled={loading || !name.trim()} className="w-full">
            {loading ? "Opretter..." : "Opret enhed"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
