"use client";

import Link from "next/link";
import {
  Zap,
  ZapOff,
  Thermometer,
  Lock,
  Unlock,
  Droplets,
  WifiOff,
  Home,
  Caravan,
  MapPin,
  Anchor,
  ChevronRight,
} from "lucide-react";

const typeIcons: Record<string, typeof Home> = {
  CABIN: Home,
  SEASONAL: Anchor,
  CARAVAN: Caravan,
  PITCH: MapPin,
};

const typeLabels: Record<string, string> = {
  CABIN: "Hytte",
  SEASONAL: "Fastligger",
  CARAVAN: "Campingvogn",
  PITCH: "Plads",
};

interface UnitCardProps {
  unit: {
    id: number;
    name: string;
    type: string;
    status: string;
    isLongTerm: boolean;
    longTermGuestName: string | null;
    hardware: {
      hasElectricity: boolean;
      hasWater: boolean;
      hasClimate: boolean;
      hasSmartLock: boolean;
    } | null;
  };
  haStates: {
    powerOn: boolean | null;
    temperature: number | null;
    locked: boolean | null;
    haReachable: boolean;
  } | null;
  activeGuestName: string | null;
}

export function UnitCard({ unit, haStates, activeGuestName }: UnitCardProps) {
  const isOccupied = unit.status === "OCCUPIED";
  const hw = unit.hardware;
  const TypeIcon = typeIcons[unit.type] || Home;
  const displayGuest = activeGuestName || unit.longTermGuestName;

  return (
    <Link href={`/admin/units/${unit.id}`} className="h-full block">
      <div
        className={`group rounded-xl border border-border/60 bg-card p-5 shadow-sm hover:shadow-lg hover:border-primary/30 transition-all cursor-pointer h-full min-h-[160px] flex flex-col ${
          isOccupied ? "border-l-[3px] border-l-primary" : ""
        }`}
      >
        {/* Header row */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
              isOccupied ? "bg-primary/10" : "bg-muted"
            }`}>
              <TypeIcon className={`h-5 w-5 ${isOccupied ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <div>
              <p className="text-base font-semibold leading-tight">{unit.name}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{typeLabels[unit.type]}</p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground/20 group-hover:text-primary group-hover:translate-x-0.5 transition-all mt-1" />
        </div>

        {/* Status */}
        <div className="flex items-center gap-2 mb-3">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium inline-flex items-center gap-1.5 ${
            isOccupied
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isOccupied ? "bg-primary animate-pulse" : "bg-muted-foreground/40"}`} />
            {isOccupied ? "Optaget" : "Ledig"}
          </span>
          {unit.isLongTerm && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              Langtid
            </span>
          )}
        </div>

        {/* Guest */}
        {displayGuest && (
          <p className="text-sm text-foreground/70 mb-3 truncate">{displayGuest}</p>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* HA Status */}
        {haStates && !haStates.haReachable && (
          <div className="flex items-center gap-1.5 text-xs text-orange-500 mb-1">
            <WifiOff className="h-3.5 w-3.5" />
            HA utilgængelig
          </div>
        )}

        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          {hw?.hasElectricity && (
            <div className="flex items-center gap-1.5">
              {haStates?.powerOn ? (
                <Zap className="h-4 w-4 text-yellow-500" />
              ) : (
                <ZapOff className="h-4 w-4 text-muted-foreground/30" />
              )}
              <span className="text-xs">{haStates?.powerOn ? "Tændt" : "Slukket"}</span>
            </div>
          )}
          {hw?.hasClimate && haStates?.temperature !== null && (
            <div className="flex items-center gap-1.5">
              <Thermometer className="h-4 w-4 text-blue-500" />
              <span className="text-xs">{haStates?.temperature}°C</span>
            </div>
          )}
          {hw?.hasSmartLock && (
            <div className="flex items-center gap-1.5">
              {haStates?.locked ? (
                <Lock className="h-4 w-4 text-muted-foreground/40" />
              ) : (
                <Unlock className="h-4 w-4 text-primary" />
              )}
            </div>
          )}
          {hw?.hasWater && (
            <div className="flex items-center gap-1.5">
              <Droplets className="h-4 w-4 text-blue-500" />
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
