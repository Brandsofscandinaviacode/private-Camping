"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Zap,
  ZapOff,
  Flame,
  Lock,
  Unlock,
  Thermometer,
  WifiOff,
  Snowflake,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { togglePower, toggleHeating, toggleLock, setTemperature, toggleWinterMode } from "@/lib/actions";
import { fmtAge } from "@/lib/unit-state";

interface UnitControlsProps {
  unitId: number;
  hardware: {
    hasElectricity: boolean;
    hasHeating: boolean;
    hasWater: boolean;
    hasClimate: boolean;
    hasSmartLock: boolean;
  };
  haStates: {
    powerOn: boolean | null;
    powerAgeMs?: number | null;
    heatingOn: boolean | null;
    winterModeEnabled: boolean;
    temperature: number | null;
    locked: boolean | null;
    haReachable: boolean;
    hasPowerSwitch?: boolean;
    hasHeatingSwitch?: boolean;
    offlineReason?: string | null;
  } | null;
  /** A guest is checked in — switching the power off asks first. */
  occupied?: boolean;
}

type Busy = "power-on" | "power-off" | "heat-on" | "heat-off" | "winter" | "lock" | "temp" | null;

/** A cached relay state older than this is shown with its age. */
const STATE_AGE_NOTE_MS = 2 * 60_000;

function StateText({ on, unknownLabel = "Ukendt" }: { on: boolean | null; unknownLabel?: string }) {
  if (on === null) return <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{unknownLabel}</span>;
  return <span className={`text-xs font-medium ${on ? "text-foreground/70" : "text-muted-foreground"}`}>{on ? "Tændt" : "Slukket"}</span>;
}

export function CabinControls({
  unitId,
  hardware,
  haStates,
  occupied = false,
}: UnitControlsProps) {
  const [, startTransition] = useTransition();
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [powerOn, setPowerOn] = useState<boolean | null>(haStates?.powerOn ?? null);
  const [heatingOn, setHeatingOn] = useState<boolean | null>(haStates?.heatingOn ?? null);
  const [locked, setLocked] = useState<boolean | null>(haStates?.locked ?? null);
  const [winterMode, setWinterMode] = useState(haStates?.winterModeEnabled ?? false);
  const [tempValue, setTempValue] = useState(haStates?.temperature?.toString() ?? "21");

  if (!haStates) {
    return (
      <div className="rounded-xl border border-border/60 bg-card shadow-sm p-5">
        <div className="flex items-center gap-2 text-muted-foreground">
          <WifiOff className="h-5 w-5" />
          <span className="font-medium">Kunne ikke hente hardwarestatus</span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">Genindlæs siden om lidt.</p>
      </div>
    );
  }

  // Older callers don't send the switch flags — fall back to the feature flags
  const showPower = haStates.hasPowerSwitch ?? hardware.hasElectricity;
  const showHeating = haStates.hasHeatingSwitch ?? hardware.hasHeating;
  const hasControls = showPower || showHeating || hardware.hasSmartLock || hardware.hasClimate;
  if (!hasControls && !haStates.offlineReason) return null;

  // Server action results carry the Danish error; nothing is flipped until the
  // device has confirmed.
  function run(kind: Exclude<Busy, null>, action: () => Promise<{ ok: boolean; message?: string }>, onOk: () => void, okText?: string) {
    setBusy(kind);
    setError(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (res.ok) {
          onOk();
          if (okText) toast.success(okText);
          router.refresh();
        } else {
          setError(res.message ?? "Handlingen mislykkedes.");
          toast.error(res.message ?? "Handlingen mislykkedes.");
        }
      } catch {
        const msg = "Ingen forbindelse til serveren — intet er ændret. Prøv igen.";
        setError(msg);
        toast.error(msg);
      } finally {
        setBusy(null);
      }
    });
  }

  function setPower(on: boolean) {
    if (!on && occupied && !window.confirm("Der er en gæst tjekket ind. Vil du slukke strømmen på enheden?")) return;
    run(on ? "power-on" : "power-off", () => togglePower(unitId, on), () => setPowerOn(on), on ? "Strømmen er tændt" : "Strømmen er slukket");
  }

  function setHeating(on: boolean) {
    run(on ? "heat-on" : "heat-off", () => toggleHeating(unitId, on), () => setHeatingOn(on), on ? "Varmen er tændt" : "Varmen er slukket");
  }

  const disabled = busy !== null;
  const spin = (k: Busy) => busy === k ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null;

  // Known state → one button for the opposite. Unknown (device silent) → both,
  // so the desk can still try; nothing pretends the relay is off.
  function switchButtons(on: boolean | null, onSet: (v: boolean) => void, kinds: [Busy, Busy]) {
    if (on === null) {
      return (
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => onSet(true)}>{spin(kinds[0])}Tænd</Button>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => onSet(false)}>{spin(kinds[1])}Sluk</Button>
        </div>
      );
    }
    return (
      <Button variant={on ? "destructive" : "default"} size="sm" disabled={disabled} onClick={() => onSet(!on)}>
        {spin(on ? kinds[1] : kinds[0])}
        {on ? "Sluk" : "Tænd"}
      </Button>
    );
  }

  const powerAge = haStates.powerAgeMs ?? null;
  const showPowerAge = powerOn !== null && powerOn === haStates.powerOn && powerAge !== null && powerAge > STATE_AGE_NOTE_MS;

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="font-semibold">Hardware kontrol</h2>
      </div>
      <div className="p-5 space-y-4">
        {haStates.offlineReason && (
          <div className="rounded-lg border border-amber-200/80 bg-amber-50/80 dark:bg-amber-500/10 dark:border-amber-500/30 px-3.5 py-2.5">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <WifiOff className="h-4 w-4 shrink-0" />
              Hardwaren svarer ikke — tilstanden er ukendt
            </p>
            <p className="text-xs text-amber-700/90 dark:text-amber-300/80 mt-1 break-words">{haStates.offlineReason}</p>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
        )}

        {showPower && (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {powerOn ? (
                <Zap className="h-5 w-5 text-yellow-500 shrink-0" />
              ) : (
                <ZapOff className="h-5 w-5 text-muted-foreground/40 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="leading-tight">Strøm</p>
                <p className="leading-tight">
                  <StateText on={powerOn} />
                  {showPowerAge && <span className="text-xs text-muted-foreground"> · sidst set for {fmtAge(powerAge!)} siden</span>}
                </p>
              </div>
            </div>
            {switchButtons(powerOn, setPower, ["power-on", "power-off"])}
          </div>
        )}

        {showHeating && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Flame className={`h-5 w-5 shrink-0 ${heatingOn ? "text-orange-500" : "text-muted-foreground/40"}`} />
                <div className="min-w-0">
                  <p className="leading-tight flex items-center gap-2">
                    Varme
                    {winterMode && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 flex items-center gap-1">
                        <Snowflake className="h-3 w-3" />
                        Vinterdrift
                      </span>
                    )}
                  </p>
                  <p className="leading-tight"><StateText on={heatingOn} /></p>
                </div>
              </div>
              {switchButtons(heatingOn, setHeating, ["heat-on", "heat-off"])}
            </div>
            <div className="flex items-center justify-between pl-7">
              <span className="text-sm text-muted-foreground">Vinterdrift (hold varme ved checkout)</span>
              <Button
                variant={winterMode ? "default" : "outline"}
                size="sm"
                disabled={disabled}
                onClick={() => {
                  const next = !winterMode;
                  run("winter", async () => { await toggleWinterMode(unitId, next); return { ok: true }; }, () => setWinterMode(next));
                }}
              >
                {busy === "winter" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Snowflake className="h-3.5 w-3.5 mr-1" />}
                {winterMode ? "Aktiv" : "Inaktiv"}
              </Button>
            </div>
          </div>
        )}

        {hardware.hasSmartLock && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {locked === false ? (
                <Unlock className="h-5 w-5 text-primary" />
              ) : (
                <Lock className="h-5 w-5 text-muted-foreground/50" />
              )}
              <div>
                <p className="leading-tight">Lås</p>
                <p className="leading-tight">
                  {locked === null
                    ? <StateText on={null} />
                    : <span className="text-xs font-medium text-muted-foreground">{locked ? "Låst" : "Åben"}</span>}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => {
                const next = locked === false; // open → lock; locked or unknown → unlock
                run("lock", () => toggleLock(unitId, next), () => setLocked(next), next ? "Døren er låst" : "Døren er låst op");
              }}
            >
              {spin("lock")}
              {locked === false ? "Lås" : "Lås op"}
            </Button>
          </div>
        )}

        {hardware.hasClimate && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Thermometer className="h-5 w-5 text-blue-500" />
              <span>
                {haStates.temperature !== null ? `${haStates.temperature}°C` : "—"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min="15"
                max="25"
                value={tempValue}
                onChange={(e) => setTempValue(e.target.value)}
                aria-label="Ønsket temperatur"
                className="w-16 h-8 text-sm border rounded-md px-2 bg-background border-border"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => run("temp", () => setTemperature(unitId, parseFloat(tempValue)), () => {}, "Temperaturen er sat")}
              >
                {spin("temp")}
                Sæt
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
