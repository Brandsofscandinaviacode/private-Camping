"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, TriangleAlert } from "lucide-react";
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
import { addDaysToKey, checkOutDateError, prepaidAmountError, todayKey } from "@/lib/check-in";
import { fmtShortDate } from "@/lib/format";
import { parseAmount, type DeskPaymentMethod } from "@/lib/payments-shared";
import {
  BillingModeField,
  CheckOutDateField,
  HardwarePrecheck,
  NoHardwareNote,
  TECHNICAL_ERROR,
  WelcomeHint,
} from "./check-in-fields";
import { showCheckInReceipt } from "./check-in-receipt";

interface CheckInDialogProps {
  unitId: number;
  unitName: string;
  /** Long-term units may be checked in without a planned checkout. */
  isLongTerm?: boolean;
  hasHardware?: boolean;
  hasMeters?: boolean;
  notify?: { email: boolean; sms: boolean };
  /**
   * Open reservation on the unit. When its stay has started, a walk-in needs
   * the desk's OK; a later one is only mentioned (the server checks the dates).
   */
  reservation?: { guestName: string; period: string; started: boolean } | null;
}

export function CheckInDialog({
  unitId,
  unitName,
  isLongTerm = false,
  hasHardware = false,
  hasMeters = false,
  notify = { email: false, sms: false },
  reservation = null,
}: CheckInDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [bookingRef, setBookingRef] = useState("");
  const [expectedCheckOut, setExpectedCheckOut] = useState("");
  const [billingMode, setBillingMode] = useState<"PREPAID" | "POSTPAID">("POSTPAID");
  const [prepaidAmount, setPrepaidAmount] = useState("");
  const [prepaidMethod, setPrepaidMethod] = useState<DeskPaymentMethod>("CASH");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reservation conflicts the desk has to accept before a walk-in
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  function reset() {
    setGuestName("");
    setGuestEmail("");
    setGuestPhone("");
    setBookingRef("");
    // A walk-in usually stays one night; long-term tenants may stay open-ended.
    setExpectedCheckOut(isLongTerm ? "" : addDaysToKey(todayKey(), 1));
    setBillingMode("POSTPAID");
    setPrepaidAmount("");
    setPrepaidMethod("CASH");
    setError(null);
    setConflicts(null);
    setConfirmed(false);
  }

  function handleOpenChange(next: boolean) {
    if (next) reset();
    setOpen(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const name = guestName.trim();
    if (!name) {
      setError("Skriv gæstens navn.");
      return;
    }
    const dateError = checkOutDateError(expectedCheckOut, { required: !isLongTerm });
    if (dateError) {
      setError(dateError);
      return;
    }
    let amount: number | undefined;
    if (billingMode === "PREPAID") {
      amount = parseAmount(prepaidAmount) ?? undefined;
      const amountError = prepaidAmountError(amount);
      if (amountError) {
        setError(amountError);
        return;
      }
    }
    const mustConfirm = !!conflicts || !!reservation?.started;
    if (mustConfirm && !confirmed) {
      setError("Enheden er reserveret. Sæt flueben for at checke walk-in-gæsten ind alligevel.");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const res = await checkIn(
        unitId,
        name,
        guestEmail.trim() || undefined,
        guestPhone.trim() || undefined,
        bookingRef.trim() || undefined,
        expectedCheckOut || undefined,
        billingMode,
        amount,
        {
          requireExpectedCheckOut: true,
          prepaidMethod: billingMode === "PREPAID" ? prepaidMethod : undefined,
          checkReservations: true,
          allowReservationConflict: confirmed,
        },
      );
      if (!res.ok) {
        if (res.reservationConflicts) {
          setConflicts(res.reservationConflicts);
          setConfirmed(false);
          setError(null);
          return;
        }
        setError(res.message);
        return;
      }
      // The unit page switches to "Aktuel gæst" and drops this dialog, so the
      // receipt, QR code and portal link are shown on the booking page.
      showCheckInReceipt(res.receipt);
      setOpen(false);
      router.push(`/admin/bookings/${res.sessionId}`);
    } catch {
      setError(TECHNICAL_ERROR);
    } finally {
      setLoading(false);
    }
  }

  const today = todayKey();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button className="w-full" variant={reservation ? "outline" : "default"} />}>
        <LogIn className="h-4 w-4 mr-2" />
        {reservation ? "Walk-in på enheden" : "Check-in"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Check-in til {unitName}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
            <p className="text-sm">
              Walk-in · ankomst i dag ({fmtShortDate(new Date())})
            </p>
            {hasHardware ? <HardwarePrecheck unitId={unitId} /> : <NoHardwareNote />}
          </div>

          <div>
            <Label htmlFor="guest-name">Gæstens navn *</Label>
            <Input
              id="guest-name"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Fornavn Efternavn"
              required
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
          <CheckOutDateField
            id="expected-checkout"
            value={expectedCheckOut}
            onChange={setExpectedCheckOut}
            fromKey={today}
            required={!isLongTerm}
            allowOpen={isLongTerm}
            warnLong={!isLongTerm}
          />
          <div>
            <Label htmlFor="booking-ref">Booking nr.</Label>
            <Input
              id="booking-ref"
              value={bookingRef}
              onChange={(e) => setBookingRef(e.target.value)}
              placeholder="Valgfrit"
            />
          </div>

          <BillingModeField
            idPrefix="checkin"
            mode={billingMode}
            onModeChange={setBillingMode}
            amount={prepaidAmount}
            onAmountChange={setPrepaidAmount}
            method={prepaidMethod}
            onMethodChange={setPrepaidMethod}
            hasMeters={hasMeters}
          />

          <WelcomeHint notify={notify} />

          {reservation && !reservation.started && !conflicts && (
            <p className="text-xs text-muted-foreground">
              Næste reservation: {reservation.guestName} {reservation.period}. Overlapper udtjekket den, bliver du spurgt.
            </p>
          )}
          {(reservation?.started || conflicts) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2 text-sm text-amber-900">
              <p className="flex items-start gap-1.5 font-medium">
                <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
                {conflicts
                  ? conflicts.join(" · ")
                  : `Reserveret til ${reservation!.guestName} ${reservation!.period}`}{" "}
                – fortsæt?
              </p>
              <p className="text-xs">Reservationen bliver liggende. Flyt eller annullér den bagefter, hvis gæsten skal have en anden enhed.</p>
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-4 w-4 accent-primary" />
                Ja, check walk-in-gæsten ind alligevel
              </label>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Checker ind..." : "Bekræft check-in"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
