"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WashingMachine, ShowerHead, Banknote, History } from "lucide-react";
import { getServiceHistory } from "@/lib/service-actions";
import { Section, StatusBadge, EmptyState } from "@/components/admin/admin-ui";
import { ServiceCancelDialog } from "@/components/admin/service-cancel-dialog";
import { fmtShortDate, fmtTime, fmtRelativeDay } from "@/lib/format";

type History = Awaited<ReturnType<typeof getServiceHistory>>;

function dkk(n: number) {
  return n.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const DAY_OPTIONS = [
  { value: 1, label: "I dag" },
  { value: 7, label: "7 dage" },
  { value: 30, label: "30 dage" },
];
const KIND_OPTIONS = [
  { value: "ALL", label: "Alle" },
  { value: "LAUNDRY", label: "Vask" },
  { value: "SHOWER", label: "Bad" },
];

/**
 * Who used which machine/shower, what it cost and how it was paid — to answer
 * "did my wash go through?" and to count the till at the end of the day.
 */
export function ServicesHistory({ history }: { history: History }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const { today } = history;

  function href(days: number, kind: string) {
    return `/admin/services/history?days=${days}&kind=${kind}`;
  }

  return (
    <div className="space-y-6">
      <Section title={<><Banknote className="h-4 w-4" />I dag ved skranken</>}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {today.desk.map((d) => (
            <div key={d.method} className="rounded-lg border border-border/60 p-3">
              <p className="text-xs text-muted-foreground">{d.label}</p>
              <p className="text-lg font-bold tabular-nums mt-1">{dkk(d.total)} <span className="text-xs font-normal text-muted-foreground">DKK</span></p>
              {d.refunded > 0 && <p className="text-[11px] text-muted-foreground">heraf {dkk(d.refunded)} refunderet</p>}
            </div>
          ))}
          <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">I alt i kassen</p>
            <p className="text-lg font-bold tabular-nums mt-1">{dkk(today.deskTotal)} <span className="text-xs font-normal text-muted-foreground">DKK</span></p>
            <p className="text-[11px] text-muted-foreground">{today.uses} brug i dag</p>
          </div>
        </div>
        {(today.other.length > 0 || today.creditUsed > 0) && (
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Ikke i kassen:</span>
            {today.other.map((o) => (
              <span key={o.channel}>
                {o.label}: {o.count}× {o.total > 0 && `· ${dkk(o.total)} DKK`}
              </span>
            ))}
            {today.creditUsed > 0 && <span>Servicekredit brugt: {dkk(today.creditUsed)} DKK</span>}
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Kassen tæller betalinger taget i receptionen for vask, bad og servicekredit i dag, minus refusioner.
        </p>
      </Section>

      <div className="flex flex-wrap items-center gap-2">
        {DAY_OPTIONS.map((o) => (
          <Link
            key={o.value}
            href={href(o.value, history.kind)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              history.days === o.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </Link>
        ))}
        <span className="w-px h-5 bg-border mx-1" />
        {KIND_OPTIONS.map((o) => (
          <Link
            key={o.value}
            href={href(history.days, o.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              history.kind === o.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </Link>
        ))}
      </div>

      {message && <div className="text-sm p-3 rounded-lg bg-green-50 text-green-700">{message}</div>}

      <Section title={<><History className="h-4 w-4" />Brug ({history.rows.length})</>} bodyClassName="">
        {history.rows.length === 0 ? (
          <EmptyState icon={WashingMachine} title="Ingen brug i perioden" />
        ) : (
          <div className="divide-y divide-border">
            {history.rows.map((r) => (
              <div key={r.key} className="flex items-start gap-3 px-5 py-3">
                <span className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                  {r.kind === "LAUNDRY" ? <WashingMachine className="h-4 w-4 text-blue-600" /> : <ShowerHead className="h-4 w-4 text-cyan-600" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{r.label}</span>
                    {r.detail && <span className="text-xs text-muted-foreground">{r.detail}</span>}
                    <StatusBadge tone={r.payment.tone}>{r.payment.label}</StatusBadge>
                    {r.state !== "Færdig" && r.state !== "Annulleret" && <StatusBadge tone="blue" pulse>{r.state}</StatusBadge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {history.days === 1 ? fmtTime(r.startedAt) : `${fmtRelativeDay(r.startedAt)} ${fmtTime(r.startedAt)}`}
                    {" · "}
                    {r.stayId ? (
                      <Link href={`/admin/bookings/${r.stayId}`} className="hover:underline text-foreground">
                        {r.guestName}{r.unitName && ` (${r.unitName})`}
                      </Link>
                    ) : r.source}
                    {r.stayId && r.source.startsWith("Skranken") && ` · ${r.source}`}
                    {r.creditUsed > 0 && ` · ${dkk(r.creditUsed)} DKK kredit`}
                    {r.note && ` · ${r.note}`}
                  </p>
                  {r.cancel && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Annulleret {fmtShortDate(r.cancel.at)} {fmtTime(r.cancel.at)}{r.cancel.by ? ` af ${r.cancel.by}` : ""}{r.cancel.reason ? ` — ${r.cancel.reason}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-sm font-medium tabular-nums whitespace-nowrap ${r.cancel ? "line-through text-muted-foreground" : ""}`}>
                    {dkk(r.amount)} DKK
                  </span>
                  <ServiceCancelDialog
                    kind={r.kind}
                    id={r.id}
                    label={r.label}
                    plan={r.refund}
                    size="xs"
                    onDone={(text) => { setMessage(text); router.refresh(); }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
