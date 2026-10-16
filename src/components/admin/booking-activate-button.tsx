"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
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
import { checkOutDateError, formatBookingRef, isProviderBookingRef, prepaidAmountError } from "@/lib/check-in";
import { fmtRelativeDay, fmtShortDate } from "@/lib/format";
import {
  BillingModeField,
  CheckOutDateField,
  HardwarePrecheck,
  NoHardwareNote,
  TECHNICAL_ERROR,
  WelcomeHint,
} from "./check-in-fields";
import { showCheckInReceipt } from "./check-in-receipt";

interface Props {
  sessionId: number;
  guestName: string;
  unitId: number;
  unitName: string;
  /** Booking arrival day, "YYYY-MM-DD" (imported bookings carry no time). */
  arrivalDate: string;
  isLongTerm?: boolean;
  hasHardware?: boolean;
  hasMeters?: boolean;
  notify?: { email: boolean; sms: boolean };
  initialEmail?: string | null;
  initialPhone?: string | null;
  initialBookingRef?: string | null;
  initialExpectedCheckOut?: string | null;
}

export function BookingActivateButton({
  sessionId,
  guestName,
  unitId,
  unitName,
  arrivalDate,
  isLongTerm = false,
  hasHardware = false,
  hasMeters = false,
  notify = { email: false, sms: false },
  initialEmail,
  initialPhone,
  initialBookingRef,
  initialExpectedCheckOut,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
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

  // "danplanner:227359" is the sync key: shown read-only, never sent back.
  const refLocked = isProviderBookingRef(initialBookingRef);
  const arrival = `${arrivalDate}T12:00:00Z`;

  // Start from the booking's current data each time (a sync may have changed it).
  function handleOpenChange(next: boolean) {
    if (next) {
      setName(guestName);
      setEmail(initialEmail ?? "");
      setPhone(initialPhone ?? "");
      setBookingRef(initialBookingRef ?? "");
      setExpectedCheckOut(initialExpectedCheckOut ?? "");
      setBillingMode("POSTPAID");
      setPrepaidAmount("");
      setError(null);
    }
    setOpen(next);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isPending) return;
    if (!name.trim()) {
      setError("Gæstens navn er påkrævet.");
      return;
    }
    const dateError = checkOutDateError(expectedCheckOut, { required: !isLongTerm });
    if (dateError) {
      setError(dateError);
      return;
    }
    let amount: number | undefined;
    if (billingMode === "PREPAID") {
      amount = parseFloat(prepaidAmount);
      const amountError = prepaidAmountError(amount);
      if (amountError) {
        setError(amountError);
        return;
      }
    }

    // Only what the desk changed, so untouched booking data isn't marked as
    // corrected by hand.
    const updates: Parameters<typeof activateBookingSession>[3] = {};
    if (name.trim() !== guestName) updates.guestName = name.trim();
    if ((email.trim() || null) !== (initialEmail || null)) updates.guestEmail = email.trim() || null;
    if ((phone.trim() || null) !== (initialPhone || null)) updates.guestPhone = phone.trim() || null;
    if (!refLocked && (bookingRef.trim() || null) !== (initialBookingRef || null)) updates.bookingRef = bookingRef.trim() || null;
    if (expectedCheckOut !== (initialExpectedCheckOut ?? "")) updates.expectedCheckOut = expectedCheckOut || null;

    setError(null);
    startTransition(async () => {
      try {
        const res = await activateBookingSession(sessionId, billingMode, amount, updates);
        if (!res.ok) {
          setError(res.message);
          return;
        }
        // This dialog disappears when the page refreshes; the booking page
        // shows the receipt with the portal QR code.
        showCheckInReceipt(res.receipt);
        setOpen(false);
        if (pathname !== `/admin/bookings/${sessionId}`) router.push(`/admin/bookings/${sessionId}`);
      } catch {
        setError(TECHNICAL_ERROR);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button className="w-full" />}>
        <LogIn className="h-4 w-4 mr-2" />
        Check ind
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Check-in til {unitName}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Gæst</dt>
              <dd className="font-medium">{guestName}</dd>
              <dt className="text-muted-foreground">Ankomst</dt>
              <dd>
                {fmtShortDate(arrival)}
                {fmtRelativeDay(arrival) !== fmtShortDate(arrival) && ` (${fmtRelativeDay(arrival)})`}
              </dd>
              {refLocked && (
                <>
                  <dt className="text-muted-foreground">Booking</dt>
                  <dd title="Bookingnummeret kommer fra booking-systemet og kan ikke ændres her">
                    {formatBookingRef(initialBookingRef)}
                  </dd>
                </>
              )}
            </dl>
            {hasHardware ? <HardwarePrecheck unitId={unitId} /> : <NoHardwareNote />}
          </div>

          <p className="text-xs text-muted-foreground">
            Data er hentet fra booking-systemet. Tjek og ret hvis nødvendigt, og vælg afregningsform.
          </p>

          <div>
            <Label htmlFor="activate-name">Gæstens navn *</Label>
            <Input
              id="activate-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Fornavn Efternavn"
              required
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
          <CheckOutDateField
            id="activate-checkout"
            value={expectedCheckOut}
            onChange={setExpectedCheckOut}
            fromKey={arrivalDate}
            required={!isLongTerm}
            allowOpen={isLongTerm}
          />
          {!refLocked && (
            <div>
              <Label htmlFor="activate-ref">Booking nr.</Label>
              <Input
                id="activate-ref"
                value={bookingRef}
                onChange={(e) => setBookingRef(e.target.value)}
                placeholder="Valgfrit"
              />
            </div>
          )}

          <BillingModeField
            idPrefix="activate"
            mode={billingMode}
            onModeChange={setBillingMode}
            amount={prepaidAmount}
            onAmountChange={setPrepaidAmount}
            hasMeters={hasMeters}
          />

          <WelcomeHint notify={notify} />

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? "Checker ind..." : "Bekræft check-in"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
