"use client";

import { useState } from "react";
import { AlertTriangle, LogIn } from "lucide-react";
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
  const [billingMode, setBillingMode] = useState<"PREPAID" | "POSTPAID">("POSTPAID");
  const [prepaidAmount, setPrepaidAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Kopiér");
  const [result, setResult] = useState<{
    guestPortalToken: string;
    hardwareFailures?: { op: string; context: string; error: string }[];
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!guestName.trim()) return;
    setLoading(true);
    try {
      const res = await checkIn(
        unitId,
        guestName.trim(),
        guestEmail.trim() || undefined,
        guestPhone.trim() || undefined,
        bookingRef.trim() || undefined,
        expectedCheckOut || undefined,
        billingMode,
        billingMode === "PREPAID" ? parseFloat(prepaidAmount) || 0 : undefined,
      );
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
    setBillingMode("POSTPAID");
    setPrepaidAmount("");
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

            {/* Billing mode */}
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
                  <p className="text-xs text-muted-foreground mt-1">
                    Gæsten kan følge forbruget mod dette beløb. Ubrugt beløb refunderes ikke.
                  </p>
                </div>
              )}
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
