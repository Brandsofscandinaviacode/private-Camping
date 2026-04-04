"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
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
import { createCabin } from "@/lib/actions";

export function AddCabinDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await createCabin(name.trim());
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
        Tilføj hytte
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tilføj ny hytte</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="cabin-name">Navn</Label>
            <Input
              id="cabin-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="F.eks. Hytte 1, Plads A3..."
              autoFocus
            />
          </div>
          <Button type="submit" disabled={loading || !name.trim()}>
            {loading ? "Opretter..." : "Opret hytte"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
