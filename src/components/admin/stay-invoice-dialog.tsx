"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createStayInvoice, getStayInvoicePreview } from "@/lib/actions";
import { fmtDate } from "@/lib/format";
import { fmtMoney, roundOre } from "@/lib/settlement-shared";
import type { StayInvoicePreview } from "@/lib/stay-corrections";

function parseNum(raw: string): number | null {
  const t = raw.replace(",", ".").trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

/**
 * "Lav mellemfaktura" for a checked-in postpaid stay: el/water so far from the
 * meters, or — on a unit without an el meter — a reading the desk enters at a
 * kWh price it chooses, plus laundry/shower on the bill.
 */
export function StayInvoiceDialog({ sessionId }: { sessionId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<StayInvoicePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getStayInvoicePreview(sessionId);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setPreview(res.preview);
      setStart(res.preview.previousKwh != null ? String(res.preview.previousKwh) : "");
      setPrice(String(res.preview.priceOverride ?? res.preview.fixedPricePerKwh));
    } catch {
      setError("Fakturaen kunne ikke forberedes. Prøv igen.");
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (next) {
      setPreview(null);
      setStart("");
      setEnd("");
      setPrice("");
      void load();
    }
  }

  const startNum = parseNum(start);
  const endNum = parseNum(end);
  const priceNum = parseNum(price);
  // A hand reading is only sent when the desk entered a new one.
  const reading = !!preview && !preview.metered && end.trim() !== "";
  const kwh = startNum != null && endNum != null && !Number.isNaN(startNum) && !Number.isNaN(endNum) && endNum >= startNum ? endNum - startNum : null;
  const manualCost = kwh != null && priceNum != null && !Number.isNaN(priceNum) ? roundOre(kwh * priceNum) : null;
  const total = preview
    ? roundOre(preview.electricityCost + preview.waterCost + preview.servicesCost + (reading ? manualCost ?? 0 : 0))
    : 0;

  function validationError(): string | null {
    if (!preview || preview.metered || !reading) return null;
    if (startNum == null || Number.isNaN(startNum)) return "Skriv den forrige aflæsning (kWh).";
    if (endNum == null || Number.isNaN(endNum)) return "Den nye aflæsning er ikke et tal.";
    if (endNum < startNum) return `Den nye aflæsning er lavere end ${startNum.toLocaleString("da-DK")} kWh.`;
    if (priceNum == null || Number.isNaN(priceNum) || priceNum <= 0) return "Skriv prisen pr. kWh.";
    return null;
  }

  function submit() {
    const invalid = validationError();
    if (invalid) {
      setError(invalid);
      return;
    }
    if (total < 1) {
      setError("Der er intet at fakturere endnu (under 1 kr.).");
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const res = await createStayInvoice(
          sessionId,
          reading ? { manualEl: { startKwh: startNum!, endKwh: endNum!, pricePerKwh: priceNum! } } : {},
        );
        if (!res.ok) {
          setError(res.message);
          return;
        }
        toast.success(res.message);
        setOpen(false);
        router.refresh();
      } catch {
        setError("Fakturaen kunne ikke oprettes. Prøv igen.");
      }
    });
  }

  const cur = preview?.currency ?? "DKK";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Receipt className="h-3.5 w-3.5 mr-1" />
        Lav mellemfaktura
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mellemfaktura</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Henter forbrug…
            </p>
          )}

          {preview && (
            <>
              <p className="text-sm text-muted-foreground">
                Periode {fmtDate(preview.periodStart)} – {fmtDate(preview.periodEnd)}
                {preview.invoiceCount > 0 && ` · ${preview.invoiceCount} tidligere ${preview.invoiceCount === 1 ? "faktura" : "fakturaer"}`}
              </p>

              {!preview.metered && (
                <div className="rounded-lg border border-border p-3 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Enheden har ingen elmåler i CampSense. Aflæs måleren på pladsen – eller lad feltet stå tomt for kun at fakturere vask/bad.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor={`inv-start-${sessionId}`} className="text-xs">Forrige aflæsning (kWh)</Label>
                      <Input
                        id={`inv-start-${sessionId}`}
                        inputMode="decimal"
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                        readOnly={preview.previousKwhSource === "invoice"}
                        className="h-8 mt-0.5"
                      />
                      {preview.previousKwhSource === "invoice" && <p className="text-[11px] text-muted-foreground mt-0.5">Fra sidste faktura</p>}
                    </div>
                    <div>
                      <Label htmlFor={`inv-end-${sessionId}`} className="text-xs">Ny aflæsning (kWh)</Label>
                      <Input id={`inv-end-${sessionId}`} inputMode="decimal" value={end} onChange={(e) => setEnd(e.target.value)} className="h-8 mt-0.5" autoFocus />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor={`inv-price-${sessionId}`} className="text-xs">Pris pr. kWh ({cur})</Label>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <Input id={`inv-price-${sessionId}`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="h-8 w-24" />
                      <Button type="button" variant="outline" size="xs" onClick={() => setPrice(String(preview.fixedPricePerKwh))}>
                        Fast pris {preview.fixedPricePerKwh.toLocaleString("da-DK")}
                      </Button>
                      {preview.effectivePricePerKwh != null && Math.abs(preview.effectivePricePerKwh - preview.fixedPricePerKwh) > 0.005 && (
                        <Button type="button" variant="outline" size="xs" onClick={() => setPrice(String(roundOre(preview.effectivePricePerKwh!)))}>
                          Aktuel pris {roundOre(preview.effectivePricePerKwh).toLocaleString("da-DK")}
                        </Button>
                      )}
                    </div>
                    {preview.priceOverride != null && <p className="text-[11px] text-muted-foreground mt-0.5">Bookingen har en aftalt pris.</p>}
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5 text-sm">
                {preview.metered && <Line label="El (målt)" value={fmtMoney(preview.electricityCost, cur)} />}
                {preview.waterCost > 0 && <Line label="Vand (målt)" value={fmtMoney(preview.waterCost, cur)} />}
                {!preview.metered && preview.electricityCost > 0 && <Line label="El målt før flytning" value={fmtMoney(preview.electricityCost, cur)} />}
                {reading && (
                  <Line
                    label={kwh != null ? `El ${kwh.toLocaleString("da-DK", { maximumFractionDigits: 2 })} kWh` : "El"}
                    value={manualCost != null ? fmtMoney(manualCost, cur) : "—"}
                  />
                )}
                {preview.servicesCost > 0 && <Line label="Vask/bad på regning" value={fmtMoney(preview.servicesCost, cur)} />}
                <div className="flex justify-between items-baseline pt-1.5 mt-1 border-t border-border font-semibold">
                  <span>I alt</span>
                  <span className="tabular-nums">{fmtMoney(total, cur)}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Fakturaen hører til opholdet og indgår i slutopgørelsen ved udtjek (betalte fakturaer trækkes fra). Den sendes ikke af sig selv – brug &quot;Send betalingslink&quot; på fakturaen, eller giv den til gæsten.
              </p>
            </>
          )}

          {error && <p role="alert" className="text-sm p-2 rounded-lg bg-red-50 text-red-600">{error}</p>}

          <div className="flex gap-2">
            <Button onClick={submit} disabled={pending || loading || !preview}>
              {pending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Opret faktura
            </Button>
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              Annullér
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
