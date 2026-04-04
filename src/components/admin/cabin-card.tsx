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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CabinCardProps {
  cabin: {
    id: number;
    name: string;
    status: string;
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

export function CabinCard({ cabin, haStates, activeGuestName }: CabinCardProps) {
  const isOccupied = cabin.status === "OCCUPIED";
  const hw = cabin.hardware;

  return (
    <Link href={`/admin/cabins/${cabin.id}`}>
      <Card
        className={`hover:shadow-md transition-shadow cursor-pointer ${
          isOccupied ? "border-l-4 border-l-green-500" : "border-l-4 border-l-gray-300"
        }`}
      >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{cabin.name}</CardTitle>
            <Badge variant={isOccupied ? "default" : "secondary"}>
              {isOccupied ? "Optaget" : "Ledig"}
            </Badge>
          </div>
          {activeGuestName && (
            <p className="text-sm text-muted-foreground">{activeGuestName}</p>
          )}
        </CardHeader>
        <CardContent>
          {haStates && !haStates.haReachable && (
            <div className="flex items-center gap-1 text-xs text-orange-500 mb-2">
              <WifiOff className="h-3 w-3" />
              Hardware utilgængelig
            </div>
          )}

          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            {hw?.hasElectricity && (
              <div className="flex items-center gap-1">
                {haStates?.powerOn ? (
                  <Zap className="h-4 w-4 text-yellow-500" />
                ) : (
                  <ZapOff className="h-4 w-4 text-gray-400" />
                )}
                <span>{haStates?.powerOn ? "Tændt" : "Slukket"}</span>
              </div>
            )}

            {hw?.hasClimate && haStates?.temperature !== null && (
              <div className="flex items-center gap-1">
                <Thermometer className="h-4 w-4 text-blue-500" />
                <span>{haStates?.temperature}°C</span>
              </div>
            )}

            {hw?.hasSmartLock && (
              <div className="flex items-center gap-1">
                {haStates?.locked ? (
                  <Lock className="h-4 w-4 text-red-500" />
                ) : (
                  <Unlock className="h-4 w-4 text-green-500" />
                )}
                <span>{haStates?.locked ? "Låst" : "Ulåst"}</span>
              </div>
            )}

            {hw?.hasWater && (
              <div className="flex items-center gap-1">
                <Droplets className="h-4 w-4 text-blue-400" />
                <span>Vand</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
