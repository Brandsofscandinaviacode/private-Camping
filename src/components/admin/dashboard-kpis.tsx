import { Users, CalendarDays, LogIn, LogOut, Zap, Droplets, TrendingUp } from "lucide-react";

// da-DK number helpers
const kr = (n: number) => n.toFixed(2).replace(".", ",");
const one = (n: number) => n.toFixed(1).replace(".", ",");

interface KpiProps {
  total: number;
  occupied: number;
  reserved: number;
  vacant: number;
  totalUsage: { totalKwhPerHour: number; totalWaterLitersPerHour: number; unitCount: number } | null;
  elPricing: { mode: string; pricePerKwh: number; spotPrice: number | null } | null;
  movements: {
    arrivals: number;
    departures: number;
    nextCheckIn: { time: string; unitName: string } | null;
  };
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card shadow-sm p-5">
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

export function DashboardKpis({ total, occupied, reserved, vacant, totalUsage, elPricing, movements }: KpiProps) {
  const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
  const occW = total > 0 ? (occupied / total) * 100 : 0;
  const resW = total > 0 ? (reserved / total) * 100 : 0;
  const nextTime = movements.nextCheckIn
    ? new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit" }).format(new Date(movements.nextCheckIn.time))
    : null;
  const showPrice = elPricing && elPricing.mode !== "fixed";

  return (
    <div className={`grid gap-4 grid-cols-1 sm:grid-cols-2 ${showPrice ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
      {/* Belægning */}
      <Card>
        <Label icon={Users} tint="bg-primary/10 text-primary">Belægning</Label>
        <p className="text-[30px] font-bold tracking-tight tabular-nums mt-3 leading-none">
          {pct}<span className="text-sm font-medium text-muted-foreground ml-0.5">%</span>
        </p>
        <div className="h-[7px] rounded-full bg-muted overflow-hidden mt-3.5 flex">
          <span className="h-full bg-blue-500" style={{ width: `${occW}%` }} />
          <span className="h-full bg-amber-500" style={{ width: `${resW}%` }} />
        </div>
        <div className="flex flex-wrap gap-x-3.5 gap-y-1 mt-2.5 text-[11.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-blue-500" />{occupied} optaget</span>
          {reserved > 0 && <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-amber-500" />{reserved} res.</span>}
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-muted-foreground/30" />{vacant} ledige</span>
        </div>
      </Card>

      {/* I dag */}
      <Card>
        <Label icon={CalendarDays} tint="bg-blue-500/10 text-blue-600">I dag</Label>
        <div className="flex mt-2.5">
          <div className="flex-1">
            <p className="text-[28px] font-bold tracking-tight tabular-nums leading-none">{movements.arrivals}</p>
            <p className="text-xs text-muted-foreground mt-1.5 inline-flex items-center gap-1.5">
              <LogIn className="h-3.5 w-3.5 text-emerald-500" />Ankomster
            </p>
          </div>
          <div className="flex-1 border-l border-border pl-4">
            <p className="text-[28px] font-bold tracking-tight tabular-nums leading-none">{movements.departures}</p>
            <p className="text-xs text-muted-foreground mt-1.5 inline-flex items-center gap-1.5">
              <LogOut className="h-3.5 w-3.5 text-muted-foreground" />Afrejser
            </p>
          </div>
        </div>
        <p className="text-[12.5px] text-muted-foreground mt-3">
          {movements.nextCheckIn
            ? <>Næste check-in <b className="text-foreground font-semibold">{nextTime}</b> · {movements.nextCheckIn.unitName}</>
            : "Ingen flere ankomster i dag"}
        </p>
      </Card>

      {/* Forbrug nu */}
      <Card>
        <Label icon={Zap} tint="bg-amber-500/10 text-amber-600">Forbrug nu</Label>
        <p className="text-[30px] font-bold tracking-tight tabular-nums mt-3 leading-none">
          {totalUsage ? (totalUsage.totalKwhPerHour * 1000).toFixed(0) : "0"}
          <span className="text-sm font-medium text-muted-foreground ml-0.5">W</span>
        </p>
        <div className="flex items-center gap-4 mt-3 text-[12.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-amber-500" />{totalUsage ? kr(totalUsage.totalKwhPerHour) : "0,00"} kWh/t
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Droplets className="h-3.5 w-3.5 text-blue-500" />{totalUsage ? one(totalUsage.totalWaterLitersPerHour) : "0,0"} L/t
          </span>
        </div>
      </Card>

      {/* Elpris nu */}
      {showPrice && (
        <Card>
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
