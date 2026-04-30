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
  initialEmail?: string | null;
  initialPhone?: string | null;
  initialBookingRef?: string | null;
  initialExpectedCheckOut?: string | null;
}

export function BookingActivateButton({
  sessionId,
  guestName,
  unitName,
  initialEmail,
  initialPhone,
  initialBookingRef,
  initialExpectedCheckOut,
}: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(guestName);
  const [email, setEmail] = useState(initialEmail ?? "");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [bookingRef, setBookingRef] = useState(initialBookingRef ?? "");
  const [expectedCheckOut, setExpectedCheckOut] = useState(initialExpectedCheckOut ?? "");
  const [billingMode, setBillingMode] = useState<"PREPAID" | "POSTPAID">("POSTPAID");
  const [prepaidAmount, setPrepaidAmount] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleActivate() {
    if (!name.trim()) {
      setError("Gæstens navn er påkrævet");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await activateBookingSession(
          sessionId,
          billingMode,
          billingMode === "PREPAID" ? parseFloat(prepaidAmount) || 0 : undefined,
          {
            guestName: name.trim(),
            guestEmail: email.trim() || null,
            guestPhone: phone.trim() || null,
            bookingRef: bookingRef.trim() || null,
            expectedCheckOut: expectedCheckOut || null,
          },
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
          <DialogTitle>Check-in til {unitName}</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Data er hentet fra booking-systemet. Tjek og ret hvis nødvendigt, og vælg afregningsform.
        </p>

        <div className="space-y-4">
          <div>
            <Label htmlFor="activate-name">Gæstens navn *</Label>
            <Input
              id="activate-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Fornavn Efternavn"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="activate-email">Email</Label>
              <Input
                id="activate-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="gæst@email.dk"
              />
            </div>
            <div>
              <Label htmlFor="activate-phone">Telefon</Label>
              <Input
                id="activate-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+4512345678"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="activate-ref">Booking nr.</Label>
              <Input
                id="activate-ref"
                value={bookingRef}
                onChange={(e) => setBookingRef(e.target.value)}
                placeholder="F.eks. BK-001"
              />
            </div>
            <div>
              <Label htmlFor="activate-checkout">Forventet checkout</Label>
              <Input
                id="activate-checkout"
                type="date"
                value={expectedCheckOut}
                onChange={(e) => setExpectedCheckOut(e.target.value)}
              />
            </div>
          </div>

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
        </div>

        <p className="text-xs text-muted-foreground">
          Systemet tænder strøm, aflæser målere og sender gæsteportal-link.
        </p>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <Button onClick={handleActivate} disabled={isPending || !name.trim()} className="w-full">
          {isPending ? "Checker ind..." : "Bekræft check-in"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
