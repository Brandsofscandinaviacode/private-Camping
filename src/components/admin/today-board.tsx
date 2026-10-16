"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, Gauge, LogIn, LogOut, Mail, Phone, UserCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookingActivateButton } from "./booking-activate-button";
import { BookingCheckoutButton } from "./booking-checkout-button";
import { BulkCheckInDialog } from "./bulk-check-in-dialog";
import { ChangeDepartureDialog } from "./change-departure-dialog";
import { CancelReservationButton } from "./stay-correction-buttons";
import { fmtRelativeDay, fmtShortDate, fmtTime } from "@/lib/format";
import { fmtMoney, type SettlementTone } from "@/lib/settlement-shared";
import { dayKeyDate } from "@/lib/stay-corrections";
import { TODAY_ANCHORS, type TodayOverview, type TodayRow, type TodaySectionKey } from "@/lib/today";

const MONEY_TONE: Record<SettlementTone, string> = {
  red: "text-red-600",
  emerald: "text-emerald-600",
  blue: "text-blue-600",
  amber: "text-amber-700",
  muted: "text-muted-foreground",
};

/** A booking day: "i dag", "i morgen", "12. sep." — imported bookings have no time. */
function day(key: string | null): string {
  return key ? fmtRelativeDay(dayKeyDate(key)) : "—";
}

/** "12. sep." — the arrival column, where "i dag" would say nothing. */
function shortDay(key: string): string {
  return fmtShortDate(dayKeyDate(key));
}

function Contact({ row }: { row: TodayRow }) {
  if (row.guestPhone) {
    return (
      <a href={`tel:${row.guestPhone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 hover:text-foreground">
        <Phone className="h-3.5 w-3.5" />
        {row.guestPhone}
      </a>
    );
  }
  // Booking.com guests often come without a phone number
  if (row.guestEmail) {
    return (
      <a href={`mailto:${row.guestEmail}`} className="inline-flex items-center gap-1 hover:text-foreground min-w-0">
        <Mail className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate max-w-[14rem]">{row.guestEmail}</span>
      </a>
    );
  }
  return <span className="opacity-60">Ingen telefon</span>;
}

/** Where the row stands today, in a few words. */
function Progress({ row, kind }: { row: TodayRow; kind: TodaySectionKey }) {
  if (row.status === "ACTIVE" && kind === "arrivals" && row.checkedInAt) {
    return <span className="text-blue-600 font-medium">Tjekket ind kl. {fmtTime(row.checkedInAt)}</span>;
  }
  if (row.status === "COMPLETED" && row.checkedOutAt) {
    return <span className="text-emerald-600 font-medium">Tjekket ud kl. {fmtTime(row.checkedOutAt)}</span>;
  }
  if (row.status === "PENDING" && kind === "departures") {
    return <span title="Rejser i dag uden at være tjekket ind i CampSense – afregnes i booking-systemet">Ikke tjekket ind</span>;
  }
  if (kind === "overdue") {
    return <span className="text-red-600 font-medium">Skulle være rejst {day(row.departureKey)}</span>;
  }
  return null;
}

function Row({
  row,
  kind,
  notify,
  selectable,
  checked,
  onToggle,
}: {
  row: TodayRow;
  kind: TodaySectionKey;
  notify: { email: boolean; sms: boolean };
  selectable: boolean;
  checked: boolean;
  onToggle: (id: number) => void;
}) {
  const done = (kind === "arrivals" && row.status === "ACTIVE") || row.status === "COMPLETED";
  const open = row.status === "PENDING";
  return (
    <li className={`flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-2 px-4 sm:px-5 py-3 ${done ? "bg-muted/30" : ""}`}>
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {selectable ? (
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggle(row.sessionId)}
            className="mt-1 h-4 w-4 accent-primary shrink-0"
            aria-label={`Vælg ${row.unitName} – ${row.guestName}`}
          />
        ) : (
          <span className="w-4 shrink-0 hidden sm:block" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <Link href={`/admin/bookings/${row.sessionId}`} className="hover:underline underline-offset-2 min-w-0">
              <span className={`font-semibold ${done ? "text-muted-foreground" : ""}`}>{row.unitName}</span>
              <span className="ml-2">{row.guestName}</span>
            </Link>
            {row.hasMeters && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground" title="Enheden har målere">
                <Gauge className="h-3 w-3" />måler
              </span>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-muted-foreground mt-0.5">
            <Contact row={row} />
            <span className="tabular-nums">
              {shortDay(row.arrivalKey)} → {row.departureKey ? day(row.departureKey) : "åben"}
            </span>
            <Progress row={row} kind={kind} />
            {row.money && (
              <span className={MONEY_TONE[row.money.tone]}>
                {row.money.label}
                {row.money.amount != null && <b className="font-semibold tabular-nums"> {fmtMoney(row.money.amount)}</b>}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end pl-7 sm:pl-0 shrink-0">
        {open && row.canCheckIn && kind !== "departures" && (
          <BookingActivateButton
            compact
            stayOnPage
            sessionId={row.sessionId}
            guestName={row.guestName}
            unitId={row.unitId}
            unitName={row.unitRawName}
            arrivalDate={row.arrivalKey}
            isLongTerm={row.isLongTerm}
            hasHardware={row.hasHardware}
            hasMeters={row.hasMeters}
            notify={notify}
            initialEmail={row.guestEmail}
            initialPhone={row.guestPhone}
            initialBookingRef={row.bookingRef}
            initialExpectedCheckOut={row.departureKey}
            externallyLinked={row.externallyLinked}
          />
        )}
        {row.status === "ACTIVE" && kind !== "arrivals" && (
          <BookingCheckoutButton
            compact
            sessionId={row.sessionId}
            guestName={row.guestName}
            unitName={row.unitRawName}
            expectedCheckOut={row.departureKey}
            isLongTerm={row.isLongTerm}
          />
        )}
        {kind === "overdue" && (
          <ChangeDepartureDialog
            sessionId={row.sessionId}
            current={row.departureKey}
            arrival={row.arrivalKey}
            isActive
            allowOpen={row.isLongTerm}
            linkedLabel={row.linkedLabel}
          />
        )}
        {open && (
          <CancelReservationButton
            sessionId={row.sessionId}
            guestName={row.guestName}
            arrived={row.canCheckIn}
            linkedLabel={row.linkedLabel}
          />
        )}
        {/* On a phone the name opens the booking, so the actions stay on one line */}
        <Link href={`/admin/bookings/${row.sessionId}`} className="hidden sm:inline-flex">
          <Button variant="ghost" size="sm" aria-label={`Åbn booking for ${row.guestName}`}>
            Åbn
            <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
          </Button>
        </Link>
      </div>
    </li>
  );
}

function SectionBlock({
  kind,
  title,
  icon: Icon,
  tint,
  hint,
  empty,
  rows,
  notify,
  selected,
  onToggle,
  onToggleAll,
}: {
  kind: TodaySectionKey;
  title: string;
  icon: LucideIcon;
  tint: string;
  hint: React.ReactNode;
  empty: string;
  rows: TodayRow[];
  notify: { email: boolean; sms: boolean };
  selected: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: (ids: number[], on: boolean) => void;
}) {
  const selectableIds = kind === "arrivals" || kind === "arrived"
    ? rows.filter((r) => r.status === "PENDING" && r.canCheckIn).map((r) => r.sessionId)
    : [];
  const allOn = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const open = rows.filter((r) => !((kind === "arrivals" && r.status === "ACTIVE") || r.status === "COMPLETED")).length;

  return (
    <section id={TODAY_ANCHORS[kind]} className="scroll-mt-4 rounded-2xl border border-border/60 bg-card shadow-sm" aria-label={title}>
      <div className="px-4 sm:px-5 py-3.5 border-b border-border flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="font-semibold flex items-center gap-2">
          <span className={`h-7 w-7 rounded-lg flex items-center justify-center ${tint}`}>
            <Icon className="h-[15px] w-[15px]" />
          </span>
          {title}
          <span className="text-sm font-medium text-muted-foreground tabular-nums">
            {open !== rows.length ? `${open} af ${rows.length}` : rows.length}
          </span>
        </h2>
        {selectableIds.length > 1 && (
          <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={allOn}
              onChange={(e) => onToggleAll(selectableIds, e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Vælg alle
          </label>
        )}
        <p className="basis-full text-xs text-muted-foreground">{hint}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((r) => (
            <Row
              key={r.sessionId}
              row={r}
              kind={kind}
              notify={notify}
              selectable={selectableIds.includes(r.sessionId)}
              checked={selected.has(r.sessionId)}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** "I dag": the four lists with their actions, and "Tjek valgte ind". */
export function TodayBoard({ overview, notify }: { overview: TodayOverview; notify: { email: boolean; sms: boolean } }) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkKey, setBulkKey] = useState(0);

  // Only rows that can still be checked in count — a refresh may have
  // checked a guest in elsewhere or moved them to another list.
  const checkInable = useMemo(
    () => new Map([...overview.arrivals, ...overview.arrived].filter((r) => r.status === "PENDING" && r.canCheckIn).map((r) => [r.sessionId, r])),
    [overview],
  );
  const selectedRows = [...selected].map((id) => checkInable.get(id)).filter((r): r is TodayRow => !!r);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(ids: number[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function openBulk() {
    setBulkKey((k) => k + 1);
    setBulkOpen(true);
  }

  const pendingDepartures = overview.departures.filter((r) => r.status === "PENDING").length;
  const common = { notify, selected, onToggle: toggle, onToggleAll: toggleAll };

  return (
    <div className="space-y-5">
      {/* Jump links — handy on a phone, where the lists get long */}
      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Dagens lister">
        {([
          ["arrivals", "Ankommer i dag", overview.arrivals.length],
          ["arrived", "Ikke tjekket ind", overview.arrived.length],
          ["departures", "Rejser i dag", overview.departures.length],
          ["overdue", "Overskredet", overview.overdue.length],
        ] as const).map(([key, label, n]) => (
          <a
            key={key}
            href={`#${TODAY_ANCHORS[key]}`}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${
              key === "overdue" && n > 0 ? "border-red-200 text-red-700 hover:bg-red-50" : "border-border hover:border-foreground/20"
            }`}
          >
            {label} <b className="tabular-nums">{n}</b>
          </a>
        ))}
      </nav>

      <SectionBlock
        kind="arrivals"
        title="Ankommer i dag"
        icon={LogIn}
        tint="bg-emerald-500/10 text-emerald-600"
        hint="Reservationer med ankomst i dag og gæster, der er tjekket ind i dag."
        empty="Ingen ankomster i dag."
        rows={overview.arrivals}
        {...common}
      />
      <SectionBlock
        kind="arrived"
        title="Ankommet, men ikke tjekket ind"
        icon={UserCheck}
        tint="bg-amber-500/10 text-amber-600"
        hint={
          <>
            På pladsen ifølge bookingen fra en tidligere dag, men ikke tjekket ind i CampSense — vælg flere og tjek dem ind på én gang.
            {pendingDepartures > 0 && ` ${pendingDepartures === 1 ? "1 gæst, der rejser" : `${pendingDepartures} gæster, der rejser`} i dag, står under Rejser i dag.`}
          </>
        }
        empty="Ingen — alle ankomne gæster er tjekket ind."
        rows={overview.arrived}
        {...common}
      />
      <SectionBlock
        kind="departures"
        title="Rejser i dag"
        icon={LogOut}
        tint="bg-blue-500/10 text-blue-600"
        hint="Planlagt afrejse i dag — også gæster, der aldrig blev tjekket ind (til rengøring) — og ophold tjekket ud i dag."
        empty="Ingen afrejser i dag."
        rows={overview.departures}
        {...common}
      />
      <SectionBlock
        kind="overdue"
        title="Overskredet"
        icon={AlertTriangle}
        tint="bg-red-500/10 text-red-600"
        hint="Stadig tjekket ind efter planlagt afrejse — tjek ud eller ret afrejsen."
        empty="Ingen overskredne ophold."
        rows={overview.overdue}
        {...common}
      />

      {(selectedRows.length > 0 || bulkOpen) && (
        <div className="sticky bottom-4 z-20 print:hidden">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card shadow-lg px-4 py-3">
            <p className="text-sm">
              <b className="tabular-nums">{selectedRows.length}</b> valgt
            </p>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Ryd valg
            </Button>
            <Button className="ml-auto" onClick={openBulk} disabled={selectedRows.length === 0}>
              <LogIn className="h-4 w-4 mr-2" />
              Tjek valgte ind
            </Button>
          </div>
        </div>
      )}
      {bulkOpen && (
        <BulkCheckInDialog
          key={bulkKey}
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          rows={selectedRows}
          notify={notify}
          onDone={(ids) => setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))))}
        />
      )}
    </div>
  );
}
