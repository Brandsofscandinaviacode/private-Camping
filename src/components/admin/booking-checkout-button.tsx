"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2, FileText, TriangleAlert, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { checkOutWithStatement, getCheckoutPreview } from "@/lib/actions";
import {
  fmtAge,
  fmtMoney,
  type CheckoutMeterInfo,
  type CheckoutMeterMode,
  type CheckoutOptions,
  type CheckoutPreview,
} from "@/lib/settlement-shared";
import { fmtDateTime } from "@/lib/format";

interface BookingCheckoutButtonProps {
  sessionId: number;
  guestName: string;
  unitName: string;
}

/**
 * The one check-out flow (booking page and unit page): shows what the stay
 * settles to and how fresh each meter reading is before the operator confirms,
 * then opens the printable statement.
 */
export function BookingCheckoutButton({
  sessionId,
  guestName,
  unitName,
}: BookingCheckoutButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [meterMode, setMeterMode] = useState<CheckoutMeterMode | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  async function loadPreview() {
    setLoadingPreview(true);
    setError("");
    try {
      const res = await getCheckoutPreview(sessionId);
      if (res.ok) setPreview(res.preview);
      else setError(res.message);
    } catch {
      setError("Afregningen kunne ikke hentes. Prøv igen.");
    } finally {
      setLoadingPreview(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (submitting) return;
    setOpen(next);
    if (next) {
      setPreview(null);
      setMeterMode(null);
      setManual({});
      setNote("");
      void loadPreview();
    }
  }

  const staleMeters = preview?.meters.filter((m) => m.stale) ?? [];
  const canUseLast = staleMeters.length > 0 && staleMeters.every((m) => m.lastValue != null);
  const needsChoice = staleMeters.length > 0;

  function num(key: string): number | null {
    const raw = manual[key]?.replace(",", ".").trim();
    if (!raw) return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : NaN;
  }

  function manualOptions(): CheckoutOptions["manual"] {
    const out: NonNullable<CheckoutOptions["manual"]> = {};
    for (const m of staleMeters) {
      const end = num(`${m.key}-end`);
      const start = num(`${m.key}-start`);
      if (m.key === "el") { out.endKwh = end; out.startKwh = start; }
      if (m.key === "heat") { out.endHeatingKwh = end; out.startHeatingKwh = start; }
      if (m.key === "water") { out.endWaterLiters = end; out.startWaterLiters = start; }
    }
    return out;
  }

  function validationError(): string | null {
    if (!needsChoice) return null;
    if (!meterMode) return "Vælg hvordan målerne skal afregnes.";
    if (meterMode === "NONE" && !note.trim()) return "Skriv en note om, hvorfor der ikke afregnes yderligere.";
    if (meterMode === "MANUAL") {
      for (const m of staleMeters) {
        const end = num(`${m.key}-end`);
        if (end === null) return `Indtast slutaflæsning for ${m.label.toLowerCase()}.`;
        if (Number.isNaN(end)) return `Slutaflæsningen for ${m.label.toLowerCase()} er ikke et tal.`;
        const base = m.lastValue ?? num(`${m.key}-start`);
        if (base === null) return `Indtast også startaflæsning for ${m.label.toLowerCase()}.`;
        if (Number.isNaN(base)) return `Startaflæsningen for ${m.label.toLowerCase()} er ikke et tal.`;
        if (end < base) return `Slutaflæsningen for ${m.label.toLowerCase()} er lavere end ${base.toLocaleString("da-DK")} ${m.unit}.`;
      }
    }
    return null;
  }

  async function handleCheckOut() {
    const invalid = validationError();
    if (invalid) {
      setError(invalid);
      return;
    }
    setSubmitting(true);
    setError("");
    const options: CheckoutOptions = { note: note.trim() || undefined };
    if (needsChoice && meterMode) {
      options.meterMode = meterMode;
      if (meterMode === "MANUAL") options.manual = manualOptions();
    }
    try {
      const res = await checkOutWithStatement(sessionId, options);
      if (!res.ok) {
        setError(res.message);
        setSubmitting(false);
        return;
      }
      setOpen(false);
      router.push(`/admin/bookings/${sessionId}/statement`);
    } catch {
      setError("Udtjek fejlede. Prøv igen.");
      setSubmitting(false);
    }
  }

  // Extra cost of a manual reading, for the operator to sanity-check.
  function manualExtra(m: CheckoutMeterInfo): number | null {
    if (!preview || meterMode !== "MANUAL") return null;
    const end = num(`${m.key}-end`);
    const base = m.lastValue ?? num(`${m.key}-start`);
    if (end === null || base === null || Number.isNaN(end) || Number.isNaN(base) || end < base) return null;
    return (end - base) * (m.unit === "L" ? preview.waterPrice : preview.elPrice);
  }

  const s = preview?.settlement;
  const currency = s?.currency ?? "DKK";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="destructive" className="w-full" />}>
        <LogOut className="h-4 w-4 mr-2" />
        Check-out &amp; opgørelse
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Check-out fra {unitName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm">
            Tjek <strong>{guestName}</strong> ud fra <strong>{unitName}</strong>.
          </p>

          {loadingPreview && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Henter afregning og måleraflæsninger…
            </div>
          )}

          {s && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5 text-sm">
              {s.prepaid ? (
                <>
                  <Line label="Forudbetalt" value={fmtMoney(s.prepaid.deposited, currency)} />
                  <Line label="El og vand" value={`-${fmtMoney(s.prepaid.usedElWater, currency)}`} />
                  {s.prepaid.usedServices > 0 && <Line label="Vask/bad fra saldo" value={`-${fmtMoney(s.prepaid.usedServices, currency)}`} />}
                  {s.totals.servicesOnAccount > 0 && <Line label="Vask/bad på regning" value={fmtMoney(s.totals.servicesOnAccount, currency)} />}
                </>
              ) : (
                <>
                  {/* What the stay itself bills; invoiced periods are in "Åbne fakturaer". */}
                  {(s.remainder.electricityCost > 0 || preview?.meters.some((m) => m.key !== "water")) && (
                    <Line label={s.invoices.length > 0 ? "El siden sidste faktura" : "El"} value={fmtMoney(s.remainder.electricityCost, currency)} />
                  )}
                  {(s.remainder.waterCost > 0 || preview?.meters.some((m) => m.key === "water")) && (
                    <Line label="Vand" value={fmtMoney(s.remainder.waterCost, currency)} />
                  )}
                  {s.totals.servicesOnAccount > 0 && <Line label="Vask/bad på regning" value={fmtMoney(s.totals.servicesOnAccount, currency)} />}
                  {s.totals.stayPrice > 0 && <Line label="Opholdspris" value={fmtMoney(s.totals.stayPrice, currency)} />}
                  {s.totals.invoicesOpen > 0 && <Line label="Åbne fakturaer" value={fmtMoney(s.totals.invoicesOpen, currency)} />}
                </>
              )}
              {s.paid > 0 && <Line label="Allerede betalt" value={`-${fmtMoney(s.paid, currency)}`} />}
              <div className="flex justify-between items-baseline pt-1.5 mt-1 border-t border-border">
                {s.owed > 0 ? (
                  <>
                    <span className="font-semibold">Til betaling ved udtjek</span>
                    <span className="font-bold tabular-nums text-red-600">{fmtMoney(s.owed, currency)}</span>
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-emerald-700">Intet at betale</span>
                    {s.prepaid && s.refundDue > 0 && (
                      <span className="text-xs text-muted-foreground">Ubrugt saldo {fmtMoney(s.refundDue, currency)}</span>
                    )}
                  </>
                )}
              </div>
              {s.totals.servicesPaidAtPurchase > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Vask/bad for {fmtMoney(s.totals.servicesPaidAtPurchase, currency)} er allerede betalt ved køb.
                </p>
              )}
            </div>
          )}

          {preview && preview.meters.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Gauge className="h-3.5 w-3.5" /> Målere
              </p>
              {preview.meters.map((m) => (
                <div
                  key={m.key}
                  className={`text-xs rounded-md px-2.5 py-1.5 ${m.stale ? "bg-amber-50 text-amber-800 border border-amber-200" : "bg-muted/40"}`}
                >
                  <span className="font-medium">{m.label}:</span>{" "}
                  {m.lastValue != null ? `${m.lastValue.toLocaleString("da-DK", { maximumFractionDigits: 2 })} ${m.unit}` : "ingen aflæsning"}
                  {m.online
                    ? " – aflæst nu"
                    : m.lastReadAt
                      ? ` – målt ${fmtDateTime(m.lastReadAt)} (${fmtAge(m.lastReadAt)})`
                      : ""}
                  {!m.online && <span className="font-medium"> · offline</span>}
                </div>
              ))}
            </div>
          )}

          {needsChoice && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-2.5">
              <p className="text-xs text-amber-900 flex items-start gap-1.5">
                <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {staleMeters.length === 1 ? "Måleren" : "Målerne"} kan ikke aflæses nu. Vælg hvordan forbruget skal afregnes:
              </p>
              {canUseLast && (
                <Choice
                  checked={meterMode === "LAST"}
                  onChange={() => setMeterMode("LAST")}
                  title="Brug sidste aflæsning"
                  hint="Forbrug efter sidste måling afregnes ikke."
                />
              )}
              <Choice
                checked={meterMode === "MANUAL"}
                onChange={() => setMeterMode("MANUAL")}
                title="Indtast slutaflæsning"
                hint="Aflæs måleren på stedet. Kun forbruget siden sidste aflæsning lægges til."
              />
              {meterMode === "MANUAL" && preview && (
                <div className="space-y-2 pl-6">
                  {staleMeters.map((m) => {
                    const extra = manualExtra(m);
                    return (
                      <div key={m.key} className="space-y-1">
                        <div className="grid grid-cols-2 gap-2">
                          {m.lastValue == null && (
                            <div>
                              <Label className="text-[11px] text-muted-foreground">{m.label} start ({m.unit})</Label>
                              <Input inputMode="decimal" value={manual[`${m.key}-start`] ?? ""} onChange={(e) => setManual((v) => ({ ...v, [`${m.key}-start`]: e.target.value }))} className="h-8 mt-0.5" />
                            </div>
                          )}
                          <div>
                            <Label className="text-[11px] text-muted-foreground">{m.label} slut ({m.unit})</Label>
                            <Input inputMode="decimal" value={manual[`${m.key}-end`] ?? ""} onChange={(e) => setManual((v) => ({ ...v, [`${m.key}-end`]: e.target.value }))} className="h-8 mt-0.5" />
                          </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {m.lastValue != null && `Sidst målt ${m.lastValue.toLocaleString("da-DK", { maximumFractionDigits: 2 })} ${m.unit}. `}
                          Afregnes til {fmtMoney(m.unit === "L" ? preview.waterPrice : preview.elPrice, currency)}/{m.unit}
                          {extra != null && ` — ${fmtMoney(extra, currency)} ekstra`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
              <Choice
                checked={meterMode === "NONE"}
                onChange={() => setMeterMode("NONE")}
                title="Ingen yderligere el-afregning"
                hint="Kun det allerede målte forbrug afregnes. Kræver en note."
              />
            </div>
          )}

          {preview && (
            <div>
              <Label className="text-xs text-muted-foreground">
                Note {meterMode === "NONE" ? "(påkrævet)" : "(valgfri)"}
              </Label>
              <textarea
                className="w-full h-16 text-sm border rounded-lg px-3 py-2 mt-1 bg-background text-foreground resize-none border-border"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={meterMode === "NONE" ? "Fx måler defekt, aftalt fast pris" : "Gemmes på bookingen"}
              />
            </div>
          )}

          {preview && (
            <p className="text-xs text-muted-foreground">
              {preview.powerOff ? "Strømmen slukkes jf. indstillingerne. " : ""}
              Derefter vises opgørelsen, som kan udskrives.
            </p>
          )}

          {error && (
            <div className="text-xs p-2 rounded-lg bg-red-50 text-red-600">{error}</div>
          )}
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={handleCheckOut}
              disabled={submitting || loadingPreview || !preview}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Checker ud...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  Bekræft &amp; vis opgørelse
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
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

function Choice({ checked, onChange, title, hint }: { checked: boolean; onChange: () => void; title: string; hint: string }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input type="radio" checked={checked} onChange={onChange} className="mt-0.5 h-4 w-4 accent-primary" />
      <span>
        <span className="text-sm font-medium block">{title}</span>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
