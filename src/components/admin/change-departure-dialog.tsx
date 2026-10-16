"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { changeExpectedCheckOut } from "@/lib/stay-actions";
import { LONG_STAY_WARN_NIGHTS, addDaysToKey, nightsBetween, nightsLabel, todayKey } from "@/lib/check-in";
import { fmtShortDate } from "@/lib/format";
import { dayKeyDate } from "@/lib/stay-corrections";

/**
 * "Ændr afrejse": extend or shorten a reservation or a checked-in stay, with
 * a check against other bookings on the unit.
 */
export function ChangeDepartureDialog({
  sessionId,
  current,
  arrival,
  isActive,
  allowOpen,
  linkedLabel,
}: {
  sessionId: number;
  /** Planned departure "YYYY-MM-DD", or null. */
  current: string | null;
  /** Arrival day "YYYY-MM-DD". */
  arrival: string;
  isActive: boolean;
  /** Long-term unit: may stay open-ended. */
  allowOpen: boolean;
  linkedLabel: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const today = todayKey();
  // Earliest allowed: today, and after the arrival for a reservation.
  const min = !isActive && arrival >= today ? addDaysToKey(arrival, 1) : today;

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (next) {
      setValue(current ?? "");
      setConflicts(null);
      setError(null);
    }
    setOpen(next);
  }

  function shift(days: number) {
    const base = value && value >= min ? value : current && current >= min ? current : min;
    const next = addDaysToKey(base, days);
    setValue(next < min ? min : next);
    setConflicts(null);
  }

  function submit(confirm: boolean) {
    if (!value && !allowOpen) {
      setError("Vælg en dato.");
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const res = await changeExpectedCheckOut(sessionId, value || null, { confirmConflicts: confirm });
        if (!res.ok) {
          if (res.needsConfirmation && res.conflicts) setConflicts(res.conflicts);
          else setError(res.message);
          return;
        }
        toast.success(res.message);
        setOpen(false);
        router.refresh();
      } catch {
        setError("Afrejsen kunne ikke gemmes. Prøv igen.");
      }
    });
  }

  const nights = value ? nightsBetween(arrival, value) : null;
  const changed = (value || null) !== current;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="xs" />}>
        <CalendarClock className="h-3 w-3 mr-1" />
        Ændr afrejse
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ændr afrejse</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Nu: <span className="text-foreground font-medium">{current ? fmtShortDate(dayKeyDate(current)) : "ingen planlagt afrejse"}</span>
          </p>
          <div>
            <Label htmlFor={`departure-${sessionId}`}>Ny afrejse</Label>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <Input
                id={`departure-${sessionId}`}
                type="date"
                min={min}
                value={value}
                onChange={(e) => { setValue(e.target.value); setConflicts(null); }}
                className="w-auto"
              />
              <div className="flex gap-1">
                <Button type="button" variant="outline" size="sm" onClick={() => shift(-1)} title="En nat færre">−1</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => shift(1)} title="En nat mere">+1 nat</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => shift(7)} title="En uge mere">+7</Button>
                {isActive && (
                  <Button type="button" variant="outline" size="sm" onClick={() => { setValue(today); setConflicts(null); }}>
                    Rejser i dag
                  </Button>
                )}
              </div>
            </div>
            {nights !== null && nights >= 0 && (
              <p className="text-xs text-muted-foreground mt-1">{nightsLabel(nights)} i alt fra ankomst</p>
            )}
            {nights !== null && nights > LONG_STAY_WARN_NIGHTS && !allowOpen && (
              <p className="text-xs text-amber-700 mt-1">Opholdet bliver {nightsLabel(nights)} – er datoen rigtig?</p>
            )}
            {allowOpen && !value && <p className="text-xs text-muted-foreground mt-1">Tomt felt = åbent ophold uden planlagt afrejse.</p>}
          </div>

          {conflicts && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1.5 text-sm text-amber-900">
              <p className="flex items-start gap-1.5 font-medium">
                <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
                Den nye afrejse rammer en anden booking:
              </p>
              <ul className="list-disc pl-6 text-xs space-y-0.5">
                {conflicts.map((c) => <li key={c}>{c}</li>)}
              </ul>
              <p className="text-xs">Vælg en anden dato, flyt en af bookingerne – eller gem alligevel.</p>
            </div>
          )}
          {linkedLabel && <p className="text-xs text-muted-foreground">Husk også at rette datoen i {linkedLabel}. CampSense beholder din dato.</p>}
          {error && <p role="alert" className="text-sm p-2 rounded-lg bg-red-50 text-red-600">{error}</p>}

          <div className="flex gap-2">
            {conflicts ? (
              <Button variant="destructive" onClick={() => submit(true)} disabled={pending}>
                {pending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Gem alligevel
              </Button>
            ) : (
              <Button onClick={() => submit(false)} disabled={pending || !changed}>
                {pending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Gem afrejse
              </Button>
            )}
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              Annullér
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
