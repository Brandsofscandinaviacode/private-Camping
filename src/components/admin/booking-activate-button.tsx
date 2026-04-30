"use client";

import { useState, useTransition } from "react";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { activateBookingSession } from "@/lib/actions";

interface Props {
  sessionId: number;
  guestName: string;
  unitName: string;
}

export function BookingActivateButton({ sessionId, guestName, unitName }: Props) {
  const [open, setOpen] = useState(false);
  const [billingMode, setBillingMode] = useState<"PREPAID" | "POSTPAID">("POSTPAID");
  const [prepaidAmount, setPrepaidAmount] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleActivate() {
    setError(null);
    startTransition(async () => {
      try {
        await activateBookingSession(
          sessionId,
          billingMode,
          billingMode === "PREPAID" ? parseFloat(prepaidAmount) || 0 : undefined,
        );
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Check-in fejlede");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="w-full" />}>
        <LogIn className="h-4 w-4 mr-2" />
        Check ind
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Check-in: {guestName}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Aktivér booking på <span className="font-medium text-foreground">{unitName}</span>.
          Strøm tændes, målere aflæses.
        </p>

        <div className="space-y-2">
          <Label>Afregning</Label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setBillingMode("POSTPAID")}
              className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                billingMode === "POSTPAID"
                  ? "border-primary bg-primary/5 text-primary font-medium"
                  : "border-border text-muted-foreground hover:border-foreground/20"
              }`}
            >
              Bagudbetalt
              <span className="block text-xs mt-0.5 font-normal opacity-70">Betaler ved checkout</span>
            </button>
            <button
              type="button"
              onClick={() => setBillingMode("PREPAID")}
              className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                billingMode === "PREPAID"
                  ? "border-primary bg-primary/5 text-primary font-medium"
                  : "border-border text-muted-foreground hover:border-foreground/20"
              }`}
            >
              Forudbetalt
              <span className="block text-xs mt-0.5 font-normal opacity-70">Allerede betalt i kassen</span>
            </button>
          </div>
          {billingMode === "PREPAID" && (
            <div>
              <Label htmlFor="prepaid-amount">Forudbetalt beløb (DKK)</Label>
              <Input
                id="prepaid-amount"
                type="number"
                step="0.01"
                min="0"
                value={prepaidAmount}
                onChange={(e) => setPrepaidAmount(e.target.value)}
                placeholder="F.eks. 500"
                className="mt-1"
              />
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <Button onClick={handleActivate} disabled={isPending} className="w-full">
          {isPending ? "Checker ind..." : "Bekræft check-in"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
