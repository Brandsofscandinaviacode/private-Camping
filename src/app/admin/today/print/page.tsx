import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AutoPrint, PrintButton } from "@/components/admin/print-button";
import { getGlobalSettings } from "@/lib/actions";
import { getTodayOverview } from "@/lib/today-actions";
import { SITE_TIME_ZONE, fmtDateTime, fmtRelativeDay, fmtShortDate, fmtTime } from "@/lib/format";
import { fmtMoney } from "@/lib/settlement-shared";
import { dayKeyDate } from "@/lib/stay-corrections";
import type { TodayRow } from "@/lib/today";

export const dynamic = "force-dynamic";

// One A4 sheet for the morning round and cleaning.
const PRINT_CSS = `@media print {
  @page { size: A4 portrait; margin: 1cm; }
  html { font-size: 13px; }
}`;

const longDate = new Intl.DateTimeFormat("da-DK", { timeZone: SITE_TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" });

function day(key: string | null): string {
  return key ? fmtRelativeDay(dayKeyDate(key)) : "åben";
}

function contact(r: TodayRow): string {
  return r.guestPhone || r.guestEmail || "—";
}

function status(r: TodayRow, kind: "arrivals" | "departures" | "overdue"): string {
  if (r.status === "ACTIVE" && kind === "arrivals" && r.checkedInAt) return `Tjekket ind ${fmtTime(r.checkedInAt)}`;
  if (r.status === "COMPLETED" && r.checkedOutAt) return `Tjekket ud ${fmtTime(r.checkedOutAt)}`;
  if (r.status === "PENDING" && kind === "departures") return "Ikke tjekket ind";
  if (r.status === "PENDING") return "Reserveret";
  if (kind === "overdue") return `Skulle rejse ${day(r.departureKey)}`;
  return "Tjekket ind";
}

function money(r: TodayRow): string {
  if (!r.money) return "";
  return r.money.amount != null ? `${r.money.label} ${fmtMoney(r.money.amount)}` : r.money.label;
}

function Table({ title, rows, kind, empty }: { title: string; rows: TodayRow[]; kind: "arrivals" | "departures" | "overdue"; empty: string }) {
  return (
    <section className="break-inside-avoid">
      <h2 className="text-sm font-bold border-b-2 border-black pb-0.5 mb-1">
        {title} <span className="font-normal">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-600 py-1">{empty}</p>
      ) : (
        <table className="w-full text-xs border-collapse table-fixed">
          {/* Same columns in every table, so the sheet reads as one list */}
          <colgroup>
            <col className="w-[3%]" />
            <col className="w-[15%]" />
            <col className="w-[17%]" />
            <col className="w-[17%]" />
            <col className="w-[14%]" />
            <col className="w-[16%]" />
            <col className="w-[18%]" />
          </colgroup>
          <thead>
            <tr className="text-left text-gray-600">
              <th className="py-0.5 font-normal" aria-label="Afkrydsning" />
              <th className="py-0.5 pr-2 font-medium">Enhed</th>
              <th className="py-0.5 pr-2 font-medium">Gæst</th>
              <th className="py-0.5 pr-2 font-medium">Telefon</th>
              <th className="py-0.5 pr-2 font-medium">Periode</th>
              <th className="py-0.5 pr-2 font-medium">Status</th>
              <th className="py-0.5 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sessionId} className="border-t border-gray-300 align-top">
                <td className="py-1">
                  <span className="inline-block h-3 w-3 border border-black" />
                </td>
                <td className="py-1 pr-2 font-semibold">{r.unitName}</td>
                <td className="py-1 pr-2">{r.guestName}</td>
                <td className="py-1 pr-2 break-all">{contact(r)}</td>
                <td className="py-1 pr-2 whitespace-nowrap">
                  {fmtShortDate(dayKeyDate(r.arrivalKey))} → {day(r.departureKey)}
                </td>
                <td className="py-1 pr-2">
                  {status(r, kind)}
                  {money(r) && <span className="block">{money(r)}</span>}
                </td>
                <td className="py-1 border-b border-dotted border-gray-400" />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default async function TodayPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ print?: string }>;
}) {
  const { print } = await searchParams;
  const [o, settings] = await Promise.all([getTodayOverview(), getGlobalSettings()]);
  const camp = settings.camp_name?.trim() || null;
  const date = longDate.format(new Date(o.generatedAt));

  return (
    <div className="p-4 sm:p-6 lg:p-10 print:p-0">
      <style>{PRINT_CSS}</style>
      {print === "1" && <AutoPrint />}
      <div className="max-w-3xl mx-auto mb-6 flex items-center justify-between gap-2 print:hidden">
        <Link href="/admin/today">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Tilbage til I dag
          </Button>
        </Link>
        <PrintButton />
      </div>

      <div className="max-w-3xl mx-auto bg-white text-black rounded-xl border border-border/60 shadow-sm p-6 space-y-4 print:shadow-none print:border-0 print:rounded-none print:max-w-none print:p-0">
        <div className="flex items-baseline justify-between gap-4 border-b border-gray-300 pb-2">
          <div>
            {camp && <p className="text-xs text-gray-600">{camp}</p>}
            <h1 className="text-lg font-bold">Dagsliste · {date}</h1>
          </div>
          <p className="text-[11px] text-gray-600 text-right shrink-0">Udskrevet {fmtDateTime(o.generatedAt)}</p>
        </div>

        <Table title="Ankommer i dag" rows={o.arrivals} kind="arrivals" empty="Ingen ankomster i dag." />
        <Table title="Rejser i dag" rows={o.departures} kind="departures" empty="Ingen afrejser i dag." />
        <Table title="Overskredet" rows={o.overdue} kind="overdue" empty="Ingen overskredne ophold." />

        {o.arrived.length > 0 && (
          <p className="text-[11px] text-gray-600 border-t border-gray-300 pt-2">
            Desuden {o.arrived.length === 1 ? "1 gæst" : `${o.arrived.length} gæster`} på pladsen ifølge bookingen, som ikke er tjekket ind i CampSense (se I dag).
          </p>
        )}
      </div>
    </div>
  );
}
