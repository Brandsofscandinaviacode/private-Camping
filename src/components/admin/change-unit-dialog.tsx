"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Loader2, Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { changeStayUnit, getMoveTargets } from "@/lib/stay-actions";
import type { MoveTarget } from "@/lib/stay-corrections";
import { normalizeSearchText } from "@/lib/booking-list";
import { showStayReceipt } from "./stay-receipt";

const STATE_LABEL: Record<MoveTarget["state"], { text: string; cls: string }> = {
  free: { text: "Ledig", cls: "bg-emerald-500/10 text-emerald-700" },
  reserved: { text: "Reserveret", cls: "bg-amber-500/10 text-amber-700" },
  occupied: { text: "Optaget", cls: "bg-blue-500/10 text-blue-700" },
};

/**
 * "Skift enhed": move a reservation or a checked-in guest to another unit.
 * Same booking, portal link, balance and laundry credit; for a checked-in
 * guest on metered units the meters and relays follow (see changeStayUnit).
 */
export function ChangeUnitDialog({
  sessionId,
  guestName,
  unitName,
  isActive,
  triggerLabel = "Skift enhed",
}: {
  sessionId: number;
  guestName: string;
  unitName: string;
  isActive: boolean;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<MoveTarget[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [onlyFree, setOnlyFree] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [confirmConflicts, setConfirmConflicts] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getMoveTargets(sessionId);
      if (res.ok) setTargets(res.targets);
      else setError(res.message);
    } catch {
      setError("Enhederne kunne ikke hentes. Prøv igen.");
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (next) {
      setTargets(null);
      setQuery("");
      setOnlyFree(true);
      setSelected(null);
      setConfirmConflicts(null);
      void load();
    }
  }

  const visible = useMemo(() => {
    if (!targets) return [];
    const nq = normalizeSearchText(query);
    return targets.filter((t) => {
      if (t.current) return false;
      if (nq) return normalizeSearchText(`${t.name} ${t.group}`).includes(nq);
      // A checked-in guest can't move onto an occupied unit.
      return onlyFree ? t.state === "free" : !(isActive && t.state === "occupied");
    });
  }, [targets, query, onlyFree, isActive]);

  // Group headers in list order
  const rows = useMemo(() => {
    let last = "";
    return visible.map((t) => {
      const header = t.group !== last ? t.group : null;
      last = t.group;
      return { t, header };
    });
  }, [visible]);

  const chosen = targets?.find((t) => t.id === selected) ?? null;

  function submit(confirm: boolean) {
    if (!chosen) {
      setError("Vælg den enhed, gæsten skal flyttes til.");
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const res = await changeStayUnit(sessionId, chosen.id, { confirmConflicts: confirm });
        if (!res.ok) {
          if (res.needsConfirmation && res.conflicts) setConfirmConflicts(res.conflicts);
          else setError(res.message);
          return;
        }
        setOpen(false);
        if (res.receipt) showStayReceipt(res.receipt);
        router.refresh();
      } catch {
        setError("Flytningen fejlede. Prøv igen.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Skift enhed for {guestName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Nu: <span className="text-foreground font-medium">{unitName}</span>. Bookingen, gæstelinket
            {isActive ? ", saldoen og vaskekreditten" : ""} følger med.
            {isActive && " Har enhederne måler/relæ, aflæses og skiftes de automatisk."}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-40">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Søg enhed, fx 97"
                aria-label="Søg enhed"
                className="w-full h-9 pl-8 pr-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:border-primary"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
              Kun ledige
            </label>
          </div>

          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Henter enheder…
            </p>
          )}

          {targets && (
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border/60" role="radiogroup" aria-label="Ny enhed">
              {rows.length === 0 && <p className="text-sm text-muted-foreground p-3">Ingen enheder matcher.</p>}
              {rows.map(({ t, header }) => {
                const blocked = isActive && t.state === "occupied";
                const label = STATE_LABEL[t.state];
                return (
                  <div key={t.id}>
                    {header && <p className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground bg-muted/40">{header}</p>}
                    <label className={`flex items-start gap-2.5 px-3 py-2 ${blocked ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-muted/40"}`}>
                      <input
                        type="radio"
                        name={`move-${sessionId}`}
                        checked={selected === t.id}
                        disabled={blocked}
                        onChange={() => { setSelected(t.id); setConfirmConflicts(null); setError(null); }}
                        className="mt-1 h-4 w-4 accent-primary"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{t.name}</span>
                          <span className={`text-[11px] px-1.5 py-0.5 rounded ${label.cls}`}>{label.text}</span>
                          {t.hasHardware && <span className="text-[11px] text-muted-foreground">måler/relæ</span>}
                        </span>
                        {t.conflicts.length > 0 && (
                          <span className="block text-xs text-muted-foreground mt-0.5">{t.conflicts.join(" · ")}</span>
                        )}
                      </span>
                    </label>
                  </div>
                );
              })}
            </div>
          )}

          {confirmConflicts && chosen && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1.5 text-sm text-amber-900">
              <p className="flex items-start gap-1.5 font-medium">
                <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
                {chosen.name} er ikke ledig i hele perioden:
              </p>
              <ul className="list-disc pl-6 text-xs space-y-0.5">
                {confirmConflicts.map((c) => <li key={c}>{c}</li>)}
              </ul>
              <p className="text-xs">Flyt alligevel, og ret den anden booking bagefter?</p>
            </div>
          )}

          {error && <p role="alert" className="text-sm p-2 rounded-lg bg-red-50 text-red-600">{error}</p>}

          <div className="flex gap-2">
            {confirmConflicts ? (
              <Button variant="destructive" onClick={() => submit(true)} disabled={pending}>
                {pending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Flyt alligevel
              </Button>
            ) : (
              <Button onClick={() => submit(false)} disabled={pending || !chosen}>
                {pending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {chosen ? `Flyt til ${chosen.name}` : "Vælg enhed"}
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
