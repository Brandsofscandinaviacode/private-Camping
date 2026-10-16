import Link from "next/link";
import Form from "next/form";
import { Banknote, ChevronLeft, ChevronRight, Receipt, Smartphone, CreditCard, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageShell, PageHeader, Section, Kpi, KpiGrid, EmptyState } from "@/components/admin/admin-ui";
import { EconomySubnav } from "@/components/admin/economy-subnav";
import { PrintButton } from "@/components/admin/print-button";
import { TillRows } from "@/components/admin/till-rows";
import { getTillReport } from "@/lib/payment-actions";
import { fmtMoney } from "@/lib/settlement-shared";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { todayKey } from "@/lib/check-in";

export const dynamic = "force-dynamic";

const kr = (v: number) => fmtMoney(v);
// Table cells: the column header carries the currency.
const num = (v: number) => (Math.abs(v) < 0.005 ? 0 : v).toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function TillPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const report = await getTillReport(date);
  const { summary: s } = report;
  const methodNet = (m: string) => s.byMethod.find((x) => x.method === m)?.net ?? 0;
  // Methods with no rows that day are left out of the table (Kontant always shows).
  const methodRows = s.byMethod.filter((m) => m.count > 0 || m.method === "CASH");
  const href = (d: string) => `/admin/economy/kasse?date=${d}`;

  return (
    <PageShell width="5xl">
      <div className="print:hidden space-y-6">
        <PageHeader title="Økonomi" icon={Wallet} subtitle="Kasse: alle betalinger taget og udbetalt — til afstemning ved dagens slutning." />
        <EconomySubnav />
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link href={href(report.prev)} aria-label="Dagen før">
          <Button variant="outline" size="sm"><ChevronLeft className="h-4 w-4" /></Button>
        </Link>
        <Form action="/admin/economy/kasse" className="flex items-center gap-2">
          <Input type="date" name="date" defaultValue={report.date} max={todayKey()} className="w-auto h-8" aria-label="Dato" />
          <Button type="submit" variant="outline" size="sm">Vis</Button>
        </Form>
        {report.next && (
          <Link href={href(report.next)} aria-label="Dagen efter">
            <Button variant="outline" size="sm"><ChevronRight className="h-4 w-4" /></Button>
          </Link>
        )}
        {!report.isToday && (
          <Link href="/admin/economy/kasse"><Button variant="ghost" size="sm">I dag</Button></Link>
        )}
        <div className="ml-auto"><PrintButton /></div>
      </div>

      <div>
        <h2 className="text-lg font-semibold">
          Kasseopgørelse {fmtDate(`${report.date}T12:00:00Z`)}{report.isToday ? " (i dag)" : ""}
        </h2>
        <p className="text-xs text-muted-foreground">
          {report.campName ? `${report.campName} · ` : ""}Udskrevet {fmtDateTime(new Date())} · {s.count} posteringer
        </p>
      </div>

      <KpiGrid cols={4}>
        <Kpi label="Kontant" icon={Banknote} tint="emerald" value={kr(methodNet("CASH"))} meta="Netto i kassen i dag" />
        <Kpi label="MobilePay" icon={Smartphone} tint="blue" value={kr(methodNet("MOBILEPAY"))} />
        <Kpi label="Kortterminal" icon={CreditCard} tint="violet" value={kr(methodNet("CARD_TERMINAL"))} />
        <Kpi label="I alt ved skranken" icon={Receipt} tint="primary" value={kr(s.deskNet)} meta={s.onlineNet !== 0 ? `+ ${kr(s.onlineNet)} online (QuickPay)` : "Alle betalingsmåder"} />
      </KpiGrid>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2 items-start">
        <Section title="Pr. betalingsmåde (DKK)" bodyClassName="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="text-left font-medium px-5 py-2">Metode</th>
                <th className="text-right font-medium px-2 py-2">Antal</th>
                <th className="text-right font-medium px-2 py-2 hidden sm:table-cell">Ind</th>
                <th className="text-right font-medium px-2 py-2 hidden sm:table-cell">Ud</th>
                <th className="text-right font-medium px-5 py-2">Netto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {methodRows.map((m) => (
                <tr key={m.method}>
                  <td className="px-5 py-2">
                    {m.label}
                    {m.method === "QUICKPAY" && <span className="block text-[11px] text-muted-foreground">Online — ikke i kassen</span>}
                  </td>
                  <td className="text-right px-2 py-2 tabular-nums whitespace-nowrap">{m.count}</td>
                  <td className="text-right px-2 py-2 tabular-nums whitespace-nowrap hidden sm:table-cell">{num(m.received)}</td>
                  <td className="text-right px-2 py-2 tabular-nums whitespace-nowrap hidden sm:table-cell">{m.paidOut > 0 ? `-${num(m.paidOut)}` : "—"}</td>
                  <td className="text-right px-5 py-2 tabular-nums font-medium whitespace-nowrap">{num(m.net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/30">
                <td className="px-5 py-2 font-medium" colSpan={4}>I alt ved skranken</td>
                <td className="text-right px-5 py-2 tabular-nums font-semibold whitespace-nowrap">{num(s.deskNet)}</td>
              </tr>
            </tfoot>
          </table>
        </Section>

        <div className="space-y-6">
          <Section title="Pr. medarbejder (DKK)" bodyClassName="overflow-x-auto">
            {s.byUser.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">Ingen betalinger.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {s.byUser.map((u) => (
                    <tr key={u.user}>
                      <td className="px-5 py-2">
                        <span className="font-medium">{u.user}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {u.byMethod.map((m) => `${m.label} ${num(m.net)}`).join(" · ")}
                        </span>
                      </td>
                      <td className="text-right px-2 py-2 tabular-nums text-muted-foreground">{u.count}</td>
                      <td className="text-right px-5 py-2 tabular-nums font-medium whitespace-nowrap">{num(u.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Pr. formål (DKK)" bodyClassName="overflow-x-auto">
            {s.byPurpose.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">Ingen betalinger.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {s.byPurpose.map((p) => (
                    <tr key={p.purpose}>
                      <td className="px-5 py-2">{p.purpose}</td>
                      <td className="text-right px-2 py-2 tabular-nums text-muted-foreground">{p.count}</td>
                      <td className="text-right px-5 py-2 tabular-nums font-medium whitespace-nowrap">{num(p.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>
      </div>

      <Section title={`Posteringer (${report.rows.length})`} bodyClassName="">
        {report.rows.length === 0 ? (
          <EmptyState icon={Banknote} title="Ingen betalinger denne dag" hint="Indbetalinger, betalinger, udbetalinger og vask/bad ved skranken vises her." />
        ) : (
          <TillRows rows={report.rows} />
        )}
      </Section>

      <p className="text-[11px] text-muted-foreground">
        Fortrudte betalinger står med en modpost samme dag, som de blev fortrudt — begge tæller med, så nettoen er det, der faktisk er i kassen.
      </p>
    </PageShell>
  );
}
