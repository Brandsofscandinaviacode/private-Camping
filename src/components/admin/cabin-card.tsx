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
  ChevronRight,
} from "lucide-react";

const typeIcons: Record<string, typeof Home> = {
  CABIN: Home,
  CARAVAN: Caravan,
  PITCH: MapPin,
};

const typeLabels: Record<string, string> = {
  CABIN: "Hytte",
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
    <Link href={`/admin/units/${unit.id}`}>
      <div
        className={`group rounded-lg border bg-card p-4 hover:border-primary/30 transition-all cursor-pointer ${
          isOccupied ? "border-l-2 border-l-primary" : ""
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-muted flex items-center justify-center">
              <TypeIcon className="h-3 w-3 text-muted-foreground" />
            </div>
            <span className="text-sm font-medium">{unit.name}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`text-[11px] px-1.5 py-0.5 rounded ${
              isOccupied
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            }`}>
              {isOccupied ? "Optaget" : "Ledig"}
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
          </div>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] text-muted-foreground">{typeLabels[unit.type]}</span>
          {unit.isLongTerm && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground">Langtid</span>
          )}
        </div>

        {/* Guest */}
        {displayGuest && (
          <p className="text-xs text-foreground/60 mb-3 truncate">{displayGuest}</p>
        )}

        {/* HA Status */}
        {haStates && !haStates.haReachable && (
          <div className="flex items-center gap-1 text-[11px] text-orange-400/80 mb-2">
            <WifiOff className="h-3 w-3" />
            Utilgængelig
          </div>
        )}

        <div className="flex flex-wrap gap-2.5 text-[11px] text-muted-foreground">
          {hw?.hasElectricity && (
            <div className="flex items-center gap-1">
              {haStates?.powerOn ? (
                <Zap className="h-3 w-3 text-yellow-400/80" />
              ) : (
                <ZapOff className="h-3 w-3 text-muted-foreground/40" />
              )}
              <span>{haStates?.powerOn ? "Tændt" : "Slukket"}</span>
            </div>
          )}
          {hw?.hasClimate && haStates?.temperature !== null && (
            <div className="flex items-center gap-1">
              <Thermometer className="h-3 w-3 text-blue-400/80" />
              <span>{haStates?.temperature}°C</span>
            </div>
          )}
          {hw?.hasSmartLock && (
            <div className="flex items-center gap-1">
              {haStates?.locked ? (
                <Lock className="h-3 w-3 text-muted-foreground/50" />
              ) : (
                <Unlock className="h-3 w-3 text-primary/70" />
              )}
            </div>
          )}
          {hw?.hasWater && (
            <div className="flex items-center gap-1">
              <Droplets className="h-3 w-3 text-blue-400/80" />
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
