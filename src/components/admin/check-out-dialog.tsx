"use client";

import { useState } from "react";
import { AlertTriangle, LogOut } from "lucide-react";
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
  autoPowerOff?: boolean;
}

export function CheckOutDialog({
  sessionId,
  guestName,
  unitName,
  autoPowerOff = false,
}: CheckOutDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    totalElectricityCost: number | null;
    totalWaterCost: number | null;
    totalCost: number | null;
    hardwareFailures?: { op: string; context: string; error: string }[];
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
              {autoPowerOff
                ? "Systemet vil aflæse målere, beregne forbrug, slukke strøm og låse døren."
                : "Systemet vil aflæse målere og beregne forbrug."}
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
            {result.hardwareFailures && result.hardwareFailures.length > 0 && (
              <div className="p-3 rounded-lg border border-amber-300 bg-amber-50">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-800">
                      Nogle hardware-handlinger fejlede — tjek manuelt:
                    </p>
                    <ul className="mt-1.5 space-y-1 text-amber-800/90 list-disc list-inside">
                      {result.hardwareFailures.map((f, i) => (
                        <li key={i}>
                          <span className="font-medium">{f.op}</span>
                          <span className="text-xs text-amber-700/80"> — {f.error}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
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
