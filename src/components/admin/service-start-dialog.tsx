"use client";

import { useState } from "react";
import { Play, Loader2, WifiOff, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { adminStartService, getStaysForServiceCharge } from "@/lib/service-actions";
import { PAY_METHOD_LABELS, type DeskStartMethod } from "@/lib/service-billing";

type Stay = Awaited<ReturnType<typeof getStaysForServiceCharge>>[number];

export type StartTarget =
  | {
      kind: "LAUNDRY";
      id: number;
      name: string;
      durationMinutes: number;
      pricePerUse: number;
      programs: { id: number; name: string; durationMinutes: number; pricePerUse: number }[];
      online: boolean | null;
    }
  | {
      kind: "SHOWER";
      id: number;
      name: string;
      pricePerMinute: number;
      minMinutes: number;
      maxMinutes: number;
      online: boolean | null;
    };

const METHODS: { value: DeskStartMethod; label: string }[] = [
  { value: "CASH", label: PAY_METHOD_LABELS.CASH },
  { value: "MOBILEPAY", label: PAY_METHOD_LABELS.MOBILEPAY },
  { value: "CARD_TERMINAL", label: PAY_METHOD_LABELS.CARD_TERMINAL },
  { value: "STAY", label: "På opholdet" },
  { value: "FREE", label: "Gratis" },
];

function defaults(t: StartTarget) {
  if (t.kind === "LAUNDRY") {
    const p = t.programs[0];
    return {
      programId: p?.id ?? null,
      minutes: String(p?.durationMinutes ?? t.durationMinutes),
      price: String(p?.pricePerUse ?? t.pricePerUse),
    };
  }
  const mins = Math.min(t.maxMinutes, Math.max(t.minMinutes, 10));
  return { programId: null, minutes: String(mins), price: (mins * t.pricePerMinute).toFixed(2) };
}

/**
 * "Start for gæst": start a machine or shower from the desk with the program
 * or minutes, the price and how the guest paid — so the till and the guest's
 * bill match what really happened.
 */
export function ServiceStartDialog({ target, onStarted }: { target: StartTarget; onStarted: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [programId, setProgramId] = useState<number | null>(null);
  const [minutes, setMinutes] = useState("");
  const [price, setPrice] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [method, setMethod] = useState<DeskStartMethod>("CASH");
  const [stays, setStays] = useState<Stay[] | null>(null);
  const [stayQuery, setStayQuery] = useState("");
  const [stayId, setStayId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(o: boolean) {
    setOpen(o);
    if (!o) return;
    const d = defaults(target);
    setProgramId(d.programId);
    setMinutes(d.minutes);
    setPrice(d.price);
    setPriceTouched(false);
    setMethod("CASH");
    setStayId(null);
    setStayQuery("");
    setNote("");
    setError(null);
  }

  function pickMethod(m: DeskStartMethod) {
    setMethod(m);
    if (m === "STAY" && stays === null) {
      getStaysForServiceCharge().then(setStays).catch(() => setStays([]));
    }
  }

  function pickProgram(id: number) {
    if (target.kind !== "LAUNDRY") return;
    const p = target.programs.find((x) => x.id === id);
    if (!p) return;
    setProgramId(p.id);
    setMinutes(String(p.durationMinutes));
    setPrice(String(p.pricePerUse));
  }

  function changeMinutes(v: string) {
    setMinutes(v);
    if (target.kind === "SHOWER" && !priceTouched) {
      const n = parseInt(v, 10);
      if (n > 0) setPrice((n * target.pricePerMinute).toFixed(2));
    }
  }

  const selectedStay = stays?.find((s) => s.id === stayId) ?? null;
  const q = stayQuery.trim().toLowerCase();
  const stayMatches = (stays ?? [])
    .filter((s) => !q || s.unitName.toLowerCase().includes(q) || s.guestName.toLowerCase().includes(q))
    .slice(0, 8);
  const priceNum = parseFloat(price.replace(",", "."));
  const canSubmit =
    parseInt(minutes, 10) > 0 &&
    (method === "FREE" ? note.trim().length > 0 : priceNum > 0) &&
    (method !== "STAY" || stayId !== null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await adminStartService({
        kind: target.kind,
        id: target.id,
        programId: target.kind === "LAUNDRY" ? programId : null,
        minutes: parseInt(minutes, 10),
        price: method === "FREE" ? 0 : priceNum,
        method,
        stayId: method === "STAY" ? stayId : null,
        note: note.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setOpen(false);
      onStarted(res.message);
    } catch {
      setError("Kunne ikke starte — prøv igen");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" className="flex-1" />}>
        <Play className="h-3.5 w-3.5" />
        Start for gæst
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start {target.name}</DialogTitle>
          <DialogDescription>
            {target.kind === "LAUNDRY" ? "Vælg program og hvordan gæsten har betalt." : "Vælg minutter og hvordan gæsten har betalt."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {target.online === false && (
            <p className="flex items-start gap-2 text-xs rounded-lg bg-red-50 text-red-700 border border-red-200 px-3 py-2">
              <WifiOff className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Enheden er offline — starten mislykkes sandsynligvis. Der registreres ingen betaling, hvis den ikke starter.
            </p>
          )}

          {target.kind === "LAUNDRY" && target.programs.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Program</Label>
              <div className="grid gap-1.5">
                {target.programs.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickProgram(p.id)}
                    className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      programId === p.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                    }`}
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.durationMinutes} min · {p.pricePerUse.toFixed(0)} DKK</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`start-min-${target.kind}-${target.id}`} className="text-xs text-muted-foreground">Minutter</Label>
              <Input
                id={`start-min-${target.kind}-${target.id}`}
                type="number"
                min="1"
                value={minutes}
                onChange={(e) => changeMinutes(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`start-price-${target.kind}-${target.id}`} className="text-xs text-muted-foreground">Pris (DKK)</Label>
              <Input
                id={`start-price-${target.kind}-${target.id}`}
                type="number"
                min="0"
                step="0.5"
                value={method === "FREE" ? "0" : price}
                disabled={method === "FREE"}
                onChange={(e) => { setPrice(e.target.value); setPriceTouched(true); }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Betaling</Label>
            <div className="flex flex-wrap gap-1.5">
              {METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => pickMethod(m.value)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    method === m.value ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {method === "STAY" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Gæstens ophold (tjekket ind)</Label>
              {selectedStay ? (
                <div className="flex items-center justify-between rounded-md border border-primary bg-primary/5 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{selectedStay.unitName} · {selectedStay.guestName}</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedStay.balance !== null
                        ? `Forudbetalt — trækkes fra saldo (${selectedStay.balance.toFixed(2)} DKK)`
                        : "Skrives på regningen og betales ved udtjek"}
                    </p>
                  </div>
                  <Button size="xs" variant="ghost" onClick={() => setStayId(null)}>Skift</Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={stayQuery}
                      onChange={(e) => setStayQuery(e.target.value)}
                      placeholder="Søg plads eller gæst"
                      className="pl-8"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border">
                    {stays === null ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">Henter ophold…</p>
                    ) : stayMatches.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">Ingen tjekket-ind ophold matcher</p>
                    ) : (
                      stayMatches.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setStayId(s.id)}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                          <span className="truncate"><span className="font-medium">{s.unitName}</span> · {s.guestName}</span>
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            {s.balance !== null ? `Saldo ${s.balance.toFixed(0)} DKK` : "Regning"}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`start-note-${target.kind}-${target.id}`} className="text-xs text-muted-foreground">
              {method === "FREE" ? "Hvorfor gratis? (krævet)" : "Note (valgfri)"}
            </Label>
            <Input
              id={`start-note-${target.kind}-${target.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={method === "FREE" ? "Fx kompensation — maskinen stoppede" : "Fx gæstens navn eller plads"}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <Button disabled={loading || !canSubmit} onClick={submit}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Start {target.kind === "SHOWER" ? "badet" : "maskinen"}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Fortryd
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
