import Link from "next/link";
import { Users, CalendarDays, LogIn, LogOut, Zap, Droplets, TrendingUp, ChevronRight } from "lucide-react";
import { UNIT_STATE } from "@/lib/unit-state";
import { fmtRelativeDay, fmtShortDate, fmtTime, siteDayKey } from "@/lib/format";
import { todayHref } from "@/lib/today";

// da-DK number helpers
const kr = (n: number) => n.toFixed(2).replace(".", ",");
const one = (n: number) => n.toFixed(1).replace(".", ",");

interface KpiProps {
  total: number;
  /** Checked in. */
  occupied: number;
  /** On site per the booking, not checked in. */
  arrived?: number;
  reserved: number;
  vacant: number;
  totalUsage: {
    totalKwhPerHour: number; totalWaterLitersPerHour: number; unitCount: number;
    meteredUnits?: number; latestReadingAt?: string | null;
  } | null;
  elPricing: { mode: string; pricePerKwh: number; spotPrice: number | null } | null;
  movements: {
    arrivals: number;
    departures: number;
    /** time is the booking's arrival — only a date for imported bookings. */
    nextCheckIn: { time: string; unitName: string; guestName?: string } | null;
  };
  /** Weekly kWh totals (oldest first) for the sparkline under "Forbrug nu". */
  history?: { period: string; el: number; water: number }[];
}

// Tiny inline bar sparkline — the last 8 weeks of electricity, latest in amber.
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 0.01);
  const w = 8, gap = 3, h = 28;
  return (
    <svg width={values.length * (w + gap)} height={h} className="mt-3 block" role="img" aria-label="Elforbrug de seneste uger">
      {values.map((v, i) => {
        const bh = Math.max(2, (v / max) * h);
        const last = i === values.length - 1;
        return (
          <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={2}
            className={last ? "fill-amber-500" : "fill-muted-foreground/30"} />
        );
      })}
    </svg>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border/60 bg-card shadow-sm p-5 ${className}`}>
      {children}
    </div>
  );
}

function Label({ icon: Icon, tint, children }: { icon: typeof Users; tint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
      <span className={`h-7 w-7 rounded-lg flex items-center justify-center ${tint}`}>
        <Icon className="h-[15px] w-[15px]" />
      </span>
      {children}
    </div>
  );
}

/** "kl. 09.44" today, otherwise "13. sep. kl. 11.26". */
function readingTime(iso: string): string {
  const sameDay = siteDayKey(iso) === siteDayKey(new Date());
  return sameDay ? `kl. ${fmtTime(iso)}` : `${fmtShortDate(iso)} kl. ${fmtTime(iso)}`;
}

export function DashboardKpis({ total, occupied, arrived = 0, reserved, vacant, totalUsage, elPricing, movements, history = [] }: KpiProps) {
  // Occupancy follows the bookings: a guest Danplanner lists as on site is
  // here, checked in or not (check-in stays manual).
  const onSite = occupied + arrived;
  const pct = total > 0 ? Math.round((onSite / total) * 100) : 0;
  const share = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const metered = totalUsage?.meteredUnits;
  const answering = totalUsage?.unitCount ?? 0;
  // Nothing fresh to show: "—", never an old rate as "now"
  const usageLive = !!totalUsage && answering > 0;
  // Imported bookings carry no real arrival time: the day, never a clock time.
  const nextDay = movements.nextCheckIn ? fmtRelativeDay(movements.nextCheckIn.time) : null;
  const showPrice = elPricing && elPricing.mode !== "fixed";

  return (
    <div className={`grid gap-4 grid-cols-1 sm:grid-cols-2 ${showPrice ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
      {/* Belægning */}
      <Card>
        <Label icon={Users} tint="bg-primary/10 text-primary">Belægning</Label>
        <p className="text-[30px] font-bold tracking-tight tabular-nums mt-3 leading-none">
          {pct}<span className="text-sm font-medium text-muted-foreground ml-0.5">%</span>
        </p>
        <p className="text-[12.5px] text-muted-foreground mt-2">
          Optaget iflg. booking <b className="text-foreground font-semibold tabular-nums">{onSite}</b> · heraf <b className="text-foreground font-semibold tabular-nums">{occupied}</b> tjekket ind
        </p>
        <div className="h-[7px] rounded-full bg-muted overflow-hidden mt-3 flex">
          <span className={`h-full ${UNIT_STATE.occ.dot}`} style={{ width: `${share(occupied)}%` }} />
          <span className={`h-full ${UNIT_STATE.arr.dot}`} style={{ width: `${share(arrived)}%` }} />
          <span className={`h-full ${UNIT_STATE.res.dot}`} style={{ width: `${share(reserved)}%` }} />
        </div>
        <div className="flex flex-wrap gap-x-3.5 gap-y-1 mt-2.5 text-[11.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5" title={UNIT_STATE.occ.label}><i className={`h-2 w-2 rounded-full ${UNIT_STATE.occ.dot}`} />{occupied} tjekket ind</span>
          {arrived > 0 && <span className="inline-flex items-center gap-1.5" title={UNIT_STATE.arr.label}><i className={`h-2 w-2 rounded-full ${UNIT_STATE.arr.dot}`} />{arrived} ikke tjekket ind</span>}
          {reserved > 0 && <span className="inline-flex items-center gap-1.5" title={UNIT_STATE.res.label}><i className={`h-2 w-2 rounded-full ${UNIT_STATE.res.dot}`} />{reserved} res.</span>}
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-muted-foreground/30" />{vacant} ledige</span>
        </div>
      </Card>

      {/* I dag */}
      <Card>
        <div className="flex items-center justify-between gap-2">
          <Label icon={CalendarDays} tint="bg-blue-500/10 text-blue-600">I dag</Label>
          <Link href="/admin/today" className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center">
            Dagsliste<ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="flex mt-2.5">
          <Link href={todayHref("arrivals")} className="flex-1 rounded-lg -m-1 p-1 hover:bg-muted/50 transition-colors">
            <p className="text-[28px] font-bold tracking-tight tabular-nums leading-none">{movements.arrivals}</p>
            <p className="text-xs text-muted-foreground mt-1.5 inline-flex items-center gap-1.5">
              <LogIn className="h-3.5 w-3.5 text-emerald-500" />Ankomster
            </p>
          </Link>
          <div className="flex-1 border-l border-border pl-4">
            <Link href={todayHref("departures")} className="block rounded-lg -m-1 p-1 hover:bg-muted/50 transition-colors">
              <p className="text-[28px] font-bold tracking-tight tabular-nums leading-none">{movements.departures}</p>
              <p className="text-xs text-muted-foreground mt-1.5 inline-flex items-center gap-1.5">
                <LogOut className="h-3.5 w-3.5 text-muted-foreground" />Afrejser
              </p>
            </Link>
          </div>
        </div>
        <p className="text-[12.5px] text-muted-foreground mt-3 truncate">
          {movements.nextCheckIn
            ? <>Næste check-in <b className="text-foreground font-semibold">{nextDay}</b> · {movements.nextCheckIn.unitName}{movements.nextCheckIn.guestName && <> · {movements.nextCheckIn.guestName}</>}</>
            : "Ingen kommende ankomster"}
        </p>
      </Card>

      {/* Forbrug nu — only the few units with meters; hidden on phones */}
      <Card className="hidden sm:block">
        <Label icon={Zap} tint="bg-amber-500/10 text-amber-600">Forbrug nu</Label>
        <p className="text-[30px] font-bold tracking-tight tabular-nums mt-3 leading-none">
          {usageLive ? (totalUsage!.totalKwhPerHour * 1000).toFixed(0) : "—"}
          <span className="text-sm font-medium text-muted-foreground ml-0.5">W</span>
        </p>
        {usageLive ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[12.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-amber-500" />{kr(totalUsage!.totalKwhPerHour)} kWh/t
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Droplets className="h-3.5 w-3.5 text-blue-500" />{one(totalUsage!.totalWaterLitersPerHour)} L/t
            </span>
            {metered !== undefined && answering < metered && (
              <span className="text-amber-700">{answering} af {metered} målere svarer</span>
            )}
          </div>
        ) : !totalUsage ? (
          <p className="mt-3 text-[12.5px] text-muted-foreground">Ingen forbindelse til målerne lige nu</p>
        ) : metered === 0 ? (
          <p className="mt-3 text-[12.5px] text-muted-foreground">Ingen enheder med målere</p>
        ) : (
          <p className="mt-3 text-[12.5px] text-amber-700">
            {metered !== undefined ? `0 af ${metered} målere svarer` : "Ingen målere svarer"}
            {totalUsage.latestReadingAt && <> · senest målt {readingTime(totalUsage.latestReadingAt)}</>}
          </p>
        )}
        <Sparkline values={history.slice(-8).map((h) => h.el)} />
      </Card>

      {/* Elpris nu */}
      {showPrice && (
        <Card className="hidden sm:block">
          <Label icon={TrendingUp} tint="bg-emerald-500/10 text-emerald-600">Elpris nu</Label>
          <p className="text-[30px] font-bold tracking-tight tabular-nums mt-3 leading-none">
            {kr(elPricing!.pricePerKwh)}<span className="text-sm font-medium text-muted-foreground ml-1">kr/kWh</span>
          </p>
          <p className="text-[12.5px] text-muted-foreground mt-3">
            {elPricing!.spotPrice !== null
              ? <>Spot {kr(elPricing!.spotPrice)} + tillæg</>
              : "Venter på spotpriser (kør cron)"}
            {" · "}{elPricing!.mode === "minimum" ? "Minimumspris" : "Spot + tillæg"}
          </p>
        </Card>
      )}
    </div>
  );
}
