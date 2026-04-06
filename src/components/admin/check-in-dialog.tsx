"use client";

import { useState, useCallback } from "react";
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

function copyToClipboard(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

export function CheckInDialog({ unitId, unitName }: CheckInDialogProps) {
  const [open, setOpen] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [bookingRef, setBookingRef] = useState("");
  const [expectedCheckOut, setExpectedCheckOut] = useState("");
  const [loading, setLoading] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Kopiér");
  const [result, setResult] = useState<{
    guestPortalToken: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!guestName.trim()) return;
    setLoading(true);
    try {
      const res = await checkIn(unitId, guestName.trim(), guestEmail.trim() || undefined, guestPhone.trim() || undefined, bookingRef.trim() || undefined, expectedCheckOut || undefined);
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
    setGuestEmail("");
    setGuestPhone("");
    setBookingRef("");
    setExpectedCheckOut("");
    setResult(null);
    setCopyLabel("Kopiér");
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
              <Label htmlFor="guest-name">Gæstens navn *</Label>
              <Input
                id="guest-name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Fornavn Efternavn"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="guest-email">Email</Label>
                <Input
                  id="guest-email"
                  type="email"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  placeholder="gæst@email.dk"
                />
              </div>
              <div>
                <Label htmlFor="guest-phone">Telefon</Label>
                <Input
                  id="guest-phone"
                  type="tel"
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                  placeholder="+4512345678"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="booking-ref">Booking nr.</Label>
                <Input
                  id="booking-ref"
                  value={bookingRef}
                  onChange={(e) => setBookingRef(e.target.value)}
                  placeholder="F.eks. BK-001"
                />
              </div>
              <div>
                <Label htmlFor="expected-checkout">Forventet checkout</Label>
                <Input
                  id="expected-checkout"
                  type="date"
                  value={expectedCheckOut}
                  onChange={(e) => setExpectedCheckOut(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Systemet tænder strøm, aflæser målere og opretter gæsteportal.
              Gæsten modtager et link via SMS og/eller email (hvis aktiveret).
            </p>
            <Button type="submit" disabled={loading || !guestName.trim()} className="w-full">
              {loading ? "Checker ind..." : "Bekræft check-in"}
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-primary/10 border border-primary/20 rounded-lg">
              <p className="font-medium text-primary">Check-in gennemført!</p>
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
                  onClick={() => {
                    copyToClipboard(guestUrl);
                    setCopyLabel("Kopieret!");
                    setTimeout(() => setCopyLabel("Kopiér"), 2000);
                  }}
                >
                  {copyLabel}
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
