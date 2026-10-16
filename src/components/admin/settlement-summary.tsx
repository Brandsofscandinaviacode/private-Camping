import { Receipt } from "lucide-react";
import {
  fmtMoney,
  paymentMethodLabel,
  settlementHeadline,
  type Settlement,
  type SettlementTone,
} from "@/lib/settlement-shared";
import { fmtDate, fmtDateTime } from "@/lib/format";

const TONE: Record<SettlementTone, { box: string; amount: string }> = {
  red: { box: "bg-red-50 border-red-200/70", amount: "text-red-600" },
  emerald: { box: "bg-emerald-50 border-emerald-200/70", amount: "text-emerald-700" },
  blue: { box: "bg-blue-50 border-blue-200/70", amount: "text-blue-700" },
  amber: { box: "bg-amber-50 border-amber-200/70", amount: "text-amber-700" },
  muted: { box: "bg-muted/50 border-border", amount: "text-muted-foreground" },
};

/**
 * The booking page's money card: one figure from the settlement (what the
 * guest owes, has paid, or is running up), with the working behind it
 * folded away. Presentational — actions are passed in as children.
 */
export function SettlementSummary({ settlement: s, children }: { settlement: Settlement; children?: React.ReactNode }) {
  const head = settlementHeadline(s);
  const tone = TONE[head.tone];
  const cur = s.currency;
  const t = s.totals;
  const hasWorking = t.totalCost > 0.005 || s.payments.length > 0 || !!s.prepaid;

  return (
    <section className="rounded-xl border border-border/60 bg-card shadow-sm" aria-label="Afregning">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Receipt className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="font-semibold">Afregning</h2>
      </div>
      <div className="p-5 space-y-4">
        <div className={`rounded-lg border p-4 ${tone.box}`}>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{head.label}</p>
          {head.amount != null && (
            <p className={`text-2xl font-bold tabular-nums mt-1 ${tone.amount}`}>{fmtMoney(head.amount, cur)}</p>
          )}
          {s.state === "PAID" && s.lastPayment && (
            <p className="text-xs text-muted-foreground mt-1">
              {fmtDate(s.lastPayment.at)}
              {s.lastPayment.method ? ` · ${paymentMethodLabel(s.lastPayment.method)}` : " · markeret som betalt"}
            </p>
          )}
          {head.hint && <p className="text-xs text-muted-foreground mt-1">{head.hint}</p>}
        </div>

        {hasWorking && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none">
              Vis udregning
            </summary>
            <div className="mt-3 space-y-1.5">
              {s.prepaid ? (
                <>
                  <Row label="Forudbetalt" value={fmtMoney(s.prepaid.deposited, cur)} />
                  <Row label="El og vand" value={`-${fmtMoney(s.prepaid.usedElWater, cur)}`} />
                  {s.prepaid.usedServices > 0 && <Row label="Vask/bad fra saldo" value={`-${fmtMoney(s.prepaid.usedServices, cur)}`} />}
                  <Row
                    strong
                    label={s.prepaid.remaining < 0 ? "Overtræk" : s.sessionStatus === "ACTIVE" ? "Resterende saldo" : "Ubrugt saldo"}
                    value={fmtMoney(Math.abs(s.prepaid.remaining), cur)}
                  />
                  {s.prepaid.refunded > 0 && <Row label="Udbetalt af saldoen" value={`-${fmtMoney(s.prepaid.refunded, cur)}`} />}
                  {t.servicesOnAccount > 0 && <Row label="Vask/bad på regning" value={fmtMoney(t.servicesOnAccount, cur)} />}
                  {t.servicesPaidAtPurchase > 0 && (
                    <p className="text-[11px] text-muted-foreground">Vask/bad for {fmtMoney(t.servicesPaidAtPurchase, cur)} er betalt ved køb.</p>
                  )}
                </>
              ) : (
                <>
                  {t.electricityCost > 0 && <Row label="El" value={fmtMoney(t.electricityCost, cur)} />}
                  {t.waterCost > 0 && <Row label="Vand" value={fmtMoney(t.waterCost, cur)} />}
                  {t.servicesCost > 0 && <Row label="Vask og bad" value={fmtMoney(t.servicesCost, cur)} />}
                  {t.stayPrice > 0 && <Row label="Opholdspris" value={fmtMoney(t.stayPrice, cur)} />}
                  <Row strong label={s.state === "RUNNING" ? "Forbrug indtil nu" : "Forbrug i alt"} value={fmtMoney(t.totalCost, cur)} />
                  {t.servicesPaidAtPurchase > 0 && <Row label="Betalt ved køb" value={`-${fmtMoney(t.servicesPaidAtPurchase, cur)}`} />}
                  {t.invoicesPaid > 0 && <Row label="Betalte fakturaer" value={`-${fmtMoney(t.invoicesPaid, cur)}`} />}
                  {t.invoicesOpen > 0 && <p className="text-[11px] text-muted-foreground">Heraf faktureret, ikke betalt: {fmtMoney(t.invoicesOpen, cur)}</p>}
                </>
              )}
              {s.paid !== 0 && <Row label="Betalinger" value={`-${fmtMoney(s.paid, cur)}`} />}
              {s.paidWithoutRecord && <p className="text-[11px] text-muted-foreground">Markeret som betalt uden registreret beløb.</p>}
            </div>
          </details>
        )}

        {s.payments.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Betalinger</p>
            <ul className="space-y-1 text-xs">
              {s.payments.map((p) => (
                <li key={p.id} className={`flex justify-between gap-3 ${p.reversed ? "text-muted-foreground line-through" : ""}`}>
                  <span className="min-w-0 truncate">
                    {fmtDateTime(p.createdAt)} · {paymentMethodLabel(p.method)}
                    {p.reversesId != null ? " · modpost" : ""}
                    {p.createdBy ? ` · ${p.createdBy}` : ""}
                  </span>
                  <span className="tabular-nums shrink-0">{fmtMoney(p.amount, cur)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {children}
      </div>
    </section>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "font-medium pt-1 border-t border-border" : ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
