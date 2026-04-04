"use client";

import { useState } from "react";
import { LogIn } from "lucide-react";
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
import { checkIn } from "@/lib/actions";

interface CheckInDialogProps {
  unitId: number;
  unitName: string;
}

export function CheckInDialog({ unitId, unitName }: CheckInDialogProps) {
  const [open, setOpen] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    guestPortalToken: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!guestName.trim()) return;
    setLoading(true);
    try {
      const res = await checkIn(unitId, guestName.trim());
      setResult(res);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Check-in fejlede");
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setOpen(false);
    setGuestName("");
    setResult(null);
  }

  const guestUrl =
    typeof window !== "undefined" && result
      ? `${window.location.origin}/guest/${result.guestPortalToken}`
      : "";

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleClose())}>
      <DialogTrigger render={<Button className="w-full" />}>
        <LogIn className="h-4 w-4 mr-2" />
        Check-in
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Check-in til {unitName}</DialogTitle>
        </DialogHeader>

        {!result ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="guest-name">Gæstens navn</Label>
              <Input
                id="guest-name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Fornavn Efternavn"
                autoFocus
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Systemet vil automatisk tænde for strøm, aflæse målere og oprette
              en gæsteportal.
            </p>
            <Button type="submit" disabled={loading || !guestName.trim()}>
              {loading ? "Checker ind..." : "Bekræft check-in"}
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-primary/10 border border-primary/20 rounded-lg">
              <p className="font-medium text-primary">
                Check-in gennemført!
              </p>
              <p className="text-sm text-primary/80 mt-1">
                Strøm tændt, målere aflæst, gæsteportal oprettet.
              </p>
            </div>
            <div>
              <Label>Gæsteportal link</Label>
              <div className="flex gap-2 mt-1">
                <Input value={guestUrl} readOnly className="text-xs" />
                <Button
                  variant="outline"
                  onClick={() => navigator.clipboard.writeText(guestUrl)}
                >
                  Kopiér
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Del dette link med gæsten, så de kan se deres forbrug.
              </p>
            </div>
            <Button onClick={handleClose} variant="outline" className="w-full">
              Luk
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
