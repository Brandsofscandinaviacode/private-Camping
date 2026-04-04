"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { checkOut } from "@/lib/actions";

interface CheckOutDialogProps {
  sessionId: number;
  guestName: string;
  unitName: string;
}

export function CheckOutDialog({
  sessionId,
  guestName,
  unitName,
}: CheckOutDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    totalElectricityCost: number | null;
    totalWaterCost: number | null;
    totalCost: number | null;
  } | null>(null);

  async function handleCheckOut() {
    setLoading(true);
    try {
      const res = await checkOut(sessionId);
      setResult(res);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Check-out fejlede");
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setOpen(false);
    setResult(null);
  }

  const formatDKK = (v: number | null) =>
    v !== null ? `${v.toFixed(2)} DKK` : "—";

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleClose())}>
      <DialogTrigger render={<Button variant="destructive" className="w-full" />}>
        <LogOut className="h-4 w-4 mr-2" />
        Check-out
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Check-out fra {unitName}</DialogTitle>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <p>
              Er du sikker på at du vil checke <strong>{guestName}</strong> ud
              fra <strong>{unitName}</strong>?
            </p>
            <p className="text-sm text-muted-foreground">
              Systemet vil aflæse målere, beregne forbrug, slukke strøm og låse
              døren.
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={handleCheckOut}
                disabled={loading}
              >
                {loading ? "Checker ud..." : "Bekræft check-out"}
              </Button>
              <Button variant="outline" onClick={handleClose}>
                Annullér
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-primary/10 border border-primary/20 rounded-lg">
              <p className="font-medium text-primary">
                Check-out gennemført!
              </p>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Elforbrug:</span>
                <span className="font-medium">
                  {formatDKK(result.totalElectricityCost)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Vandforbrug:</span>
                <span className="font-medium">
                  {formatDKK(result.totalWaterCost)}
                </span>
              </div>
              <div className="flex justify-between border-t pt-2 font-bold">
                <span>Total:</span>
                <span>{formatDKK(result.totalCost)}</span>
              </div>
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
