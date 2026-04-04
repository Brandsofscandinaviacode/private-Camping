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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
      <Card
        className={`group hover:border-primary/50 transition-all cursor-pointer ${
          isOccupied ? "border-l-4 border-l-primary" : "border-l-4 border-l-transparent"
        }`}
      >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-muted flex items-center justify-center">
                <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <CardTitle className="text-base">{unit.name}</CardTitle>
            </div>
            <Badge
              variant={isOccupied ? "default" : "secondary"}
              className={isOccupied ? "bg-primary/20 text-primary border-primary/30" : ""}
            >
              {isOccupied ? "Optaget" : "Ledig"}
            </Badge>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">{typeLabels[unit.type]}</span>
            {unit.isLongTerm && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground">Langtid</span>
            )}
          </div>
          {displayGuest && (
            <p className="text-sm text-foreground/70 mt-1">{displayGuest}</p>
          )}
        </CardHeader>
        <CardContent>
          {haStates && !haStates.haReachable && (
            <div className="flex items-center gap-1 text-xs text-orange-400 mb-2">
              <WifiOff className="h-3 w-3" />
              Hardware utilgængelig
            </div>
          )}

          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {hw?.hasElectricity && (
              <div className="flex items-center gap-1">
                {haStates?.powerOn ? (
                  <Zap className="h-3.5 w-3.5 text-yellow-400" />
                ) : (
                  <ZapOff className="h-3.5 w-3.5 text-muted-foreground/50" />
                )}
                <span>{haStates?.powerOn ? "Tændt" : "Slukket"}</span>
              </div>
            )}
            {hw?.hasClimate && haStates?.temperature !== null && (
              <div className="flex items-center gap-1">
                <Thermometer className="h-3.5 w-3.5 text-blue-400" />
                <span>{haStates?.temperature}°C</span>
              </div>
            )}
            {hw?.hasSmartLock && (
              <div className="flex items-center gap-1">
                {haStates?.locked ? (
                  <Lock className="h-3.5 w-3.5 text-red-400" />
                ) : (
                  <Unlock className="h-3.5 w-3.5 text-primary" />
                )}
              </div>
            )}
            {hw?.hasWater && (
              <div className="flex items-center gap-1">
                <Droplets className="h-3.5 w-3.5 text-blue-400" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
