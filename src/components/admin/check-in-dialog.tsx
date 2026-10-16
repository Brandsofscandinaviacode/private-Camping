"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { addDaysToKey, checkOutDateError, prepaidAmountError, todayKey } from "@/lib/check-in";
import { fmtShortDate } from "@/lib/format";
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
}

export function CheckInDialog({
  unitId,
  unitName,
  isLongTerm = false,
  hasHardware = false,
  hasMeters = false,
  notify = { email: false, sms: false },
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setGuestName("");
    setGuestEmail("");
    setGuestPhone("");
    setBookingRef("");
    // A walk-in usually stays one night; long-term tenants may stay open-ended.
    setExpectedCheckOut(isLongTerm ? "" : addDaysToKey(todayKey(), 1));
    setBillingMode("POSTPAID");
    setPrepaidAmount("");
    setError(null);
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
      amount = parseFloat(prepaidAmount);
      const amountError = prepaidAmountError(amount);
      if (amountError) {
        setError(amountError);
        return;
      }
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
        { requireExpectedCheckOut: true },
      );
      if (!res.ok) {
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
      <DialogTrigger render={<Button className="w-full" />}>
        <LogIn className="h-4 w-4 mr-2" />
        Check-in
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
            hasMeters={hasMeters}
          />

          <WelcomeHint notify={notify} />

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
