"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Loader2, RotateCcw, Undo2, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  cancelReservation,
  releaseUnit,
  reopenReservation,
  setMonthlyInvoicing,
  undoCheckIn,
  undoCheckOut,
} from "@/lib/stay-actions";
import { fmtShortDate, fmtTime } from "@/lib/format";
import { type CancelReason, type StayActionResult } from "@/lib/stay-corrections";
import { showStayReceipt } from "./stay-receipt";

const FAILED = "Handlingen fejlede. Prøv igen.";

function Choice({ checked, onChange, title, hint }: { checked: boolean; onChange: () => void; title: string; hint: string }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input type="radio" checked={checked} onChange={onChange} className="mt-0.5 h-4 w-4 accent-primary" />
      <span>
        <span className="text-sm font-medium block">{title}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="text-sm p-2 rounded-lg bg-red-50 text-red-600">{message}</p>;
}

// ──────────────────────────────────────────────
// Annullér / udeblevet / genåbn
// ──────────────────────────────────────────────

/** "Annullér / udeblevet" on an open reservation. */
export function CancelReservationButton({
  sessionId,
  guestName,
  arrived,
  linkedLabel,
}: {
  sessionId: number;
  guestName: string;
  /** The arrival day has come — "Udeblevet" is the likely choice. */
  arrived: boolean;
  /** "Danplanner" when the booking comes from a booking system. */
  linkedLabel: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<CancelReason>("CANCELLED");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (next) {
      setReason(arrived ? "NO_SHOW" : "CANCELLED");
      setNote("");
      setError(null);
    }
    setOpen(next);
  }

  function submit() {
    startTransition(async () => {
      setError(null);
      try {
        const res = await cancelReservation(sessionId, reason, note);
        if (!res.ok) {
          setError(res.message);
          return;
        }
        toast.success(res.message);
        setOpen(false);
        router.refresh();
      } catch {
        setError(FAILED);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Ban className="h-3.5 w-3.5 mr-1" />
        Annullér / udeblevet
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Luk reservationen for {guestName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2.5">
            <Choice
              checked={reason === "CANCELLED"}
              onChange={() => setReason("CANCELLED")}
              title="Annulleret"
              hint="Gæsten har afbestilt, eller bookingen er flyttet."
            />
            <Choice
              checked={reason === "NO_SHOW"}
              onChange={() => setReason("NO_SHOW")}
              title="Udeblevet"
              hint="Gæsten kom ikke."
            />
          </div>
          <div>
            <Label htmlFor={`cancel-note-${sessionId}`} className="text-xs text-muted-foreground">Note (valgfri)</Label>
            <textarea
              id={`cancel-note-${sessionId}`}
              className="w-full h-16 text-sm border rounded-lg px-3 py-2 mt-1 bg-background text-foreground resize-none border-border"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Gemmes på bookingen"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Reservationen forsvinder fra ankomstlisten og tællerne, og enheden er fri. Det kan fortrydes med &quot;Genåbn&quot;.
            {linkedLabel && ` ${linkedLabel} ændres ikke, og synkroniseringen genopliver den ikke.`}
          </p>
          <ErrorText message={error} />
          <div className="flex gap-2">
            <Button variant="destructive" onClick={submit} disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {reason === "NO_SHOW" ? "Markér som udeblevet" : "Annullér reservation"}
            </Button>
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              Fortryd
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Genåbn" on a cancelled / no-show reservation. */
export function ReopenReservationButton({ sessionId }: { sessionId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(async () => {
        try {
          const res = await reopenReservation(sessionId);
          if (res.ok) toast.success(res.message);
          else toast.error(res.message);
        } catch {
          toast.error(FAILED);
        }
        router.refresh();
      })}
    >
      <RotateCcw className="h-3.5 w-3.5 mr-1" />
      {pending ? "Genåbner…" : "Genåbn"}
    </Button>
  );
}

// ──────────────────────────────────────────────
// Fortryd check-in / udtjek
// ──────────────────────────────────────────────

function handleReceipt(res: StayActionResult, router: ReturnType<typeof useRouter>): string | null {
  if (!res.ok) return res.message;
  if (res.receipt) showStayReceipt(res.receipt);
  else toast.success(res.message);
  router.refresh();
  return null;
}

/** "Fortryd check-in" — the first minutes after a check-in, while nothing is billed. */
export function UndoCheckInButton({
  sessionId,
  guestName,
  unitName,
  deadline,
  imported,
  prepaidText,
}: {
  sessionId: number;
  guestName: string;
  unitName: string;
  /** ISO time the undo window closes. */
  deadline: string;
  /** Imported booking: goes back to a reservation. A walk-in is cancelled by default. */
  imported: boolean;
  /** "500,00 DKK" when the guest prepaid at check-in. */
  prepaidText: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cancel, setCancel] = useState(!imported);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (next) {
      setCancel(!imported);
      setError(null);
    }
    setOpen(next);
  }

  function submit() {
    startTransition(async () => {
      setError(null);
      try {
        const res = await undoCheckIn(sessionId, { cancel });
        const err = handleReceipt(res, router);
        if (err) setError(err);
        else setOpen(false);
      } catch {
        setError(FAILED);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Undo2 className="h-3.5 w-3.5 mr-1" />
        Fortryd check-in
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fortryd check-in</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p>
            <strong>{guestName}</strong> bliver tjekket ud af <strong>{unitName}</strong> igen, som om check-in aldrig skete:
            enheden bliver ledig, og strømmen slukkes. Muligt til kl. {fmtTime(deadline)}.
          </p>
          <p className="text-xs text-muted-foreground">Forkert enhed? Brug hellere &quot;Skift enhed&quot; – så beholder gæsten booking og link.</p>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={cancel} onChange={(e) => setCancel(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
            <span>
              <span className="font-medium block">Annullér også bookingen</span>
              <span className="text-xs text-muted-foreground">
                {imported ? "Ellers står den igen som reservation på sin ankomstdag." : "Walk-in registreret ved en fejl. Ellers står den som reservation."}
              </span>
            </span>
          </label>
          {prepaidText && (
            <p className="text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-800 p-2">
              Gæsten har forudbetalt {prepaidText}. Beløbet skal gives tilbage.
            </p>
          )}
          <ErrorText message={error} />
          <div className="flex gap-2">
            <Button variant="destructive" onClick={submit} disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Fortryd check-in
            </Button>
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              Behold
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Fortryd udtjek" — within a day, before any payment or invoice. */
export function UndoCheckOutButton({
  sessionId,
  guestName,
  unitName,
  deadline,
}: {
  sessionId: number;
  guestName: string;
  unitName: string;
  deadline: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      setError(null);
      try {
        const res = await undoCheckOut(sessionId);
        const err = handleReceipt(res, router);
        if (err) setError(err);
        else setOpen(false);
      } catch {
        setError(FAILED);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) { setOpen(next); setError(null); } }}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Undo2 className="h-3.5 w-3.5 mr-1" />
        Fortryd udtjek
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fortryd udtjek</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p>
            <strong>{guestName}</strong> bliver tjekket ind på <strong>{unitName}</strong> igen. Opgørelsen nulstilles og laves
            på ny ved næste udtjek, og strømmen tændes. Forbrug siden udtjek kommer med.
          </p>
          <p className="text-xs text-muted-foreground">Muligt til {fmtTime(deadline)} ({fmtShortDate(deadline)}), så længe der ikke er registreret betaling eller faktura efter udtjek.</p>
          <ErrorText message={error} />
          <div className="flex gap-2">
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Tjek ind igen
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Behold udtjek
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────
// Frigør enhed / månedsafregning
// ──────────────────────────────────────────────

/** A unit marked occupied with nobody checked in: set it vacant (ends a tenancy). */
export function ReleaseUnitButton({ unitId, unitName, tenantName }: { unitId: number; unitName: string; tenantName: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const label = tenantName ? "Afslut lejemål og frigør" : "Frigør enhed";
  return (
    <Button
      variant="outline"
      className="w-full"
      disabled={pending}
      onClick={() => {
        const question = tenantName
          ? `Afslut lejemålet for ${tenantName} og frigør ${unitName}? Lejerens gæsteportal og månedsfakturering stopper.`
          : `Sæt ${unitName} til ledig?`;
        if (!window.confirm(question)) return;
        startTransition(async () => {
          try {
            const res = await releaseUnit(unitId);
            if (res.ok) toast.success(res.message);
            else toast.error(res.message);
          } catch {
            toast.error(FAILED);
          }
          router.refresh();
        });
      }}
    >
      <Unlock className="h-4 w-4 mr-2" />
      {pending ? "Frigør…" : label}
    </Button>
  );
}

/** "Månedsafregning" on a long postpaid stay. */
export function MonthlyInvoicingSwitch({ sessionId, on }: { sessionId: number; on: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex items-center justify-between gap-2 cursor-pointer" title="Påmindelse om mellemfaktura hver måned. Enheder med måler faktureres automatisk, når fakturaudsendelse er slået til.">
      <span className="text-muted-foreground">Månedsafregning</span>
      <Switch
        size="sm"
        checked={on}
        disabled={pending}
        onCheckedChange={(checked) => startTransition(async () => {
          try {
            const res = await setMonthlyInvoicing(sessionId, checked);
            if (res.ok) toast.success(res.message);
            else toast.error(res.message);
          } catch {
            toast.error(FAILED);
          }
          router.refresh();
        })}
      />
    </label>
  );
}
