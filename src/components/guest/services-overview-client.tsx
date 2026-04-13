"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Droplets,
  WashingMachine,
  Wind,
  Search,
  MapPin,
  Tent,
  XCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { resolveServiceCode } from "@/lib/actions";

interface Shower {
  id: number;
  name: string;
  location: string | null;
  pricePerMinute: number;
  minMinutes: number;
  maxMinutes: number;
  code: string | null;
}
interface Machine {
  id: number;
  name: string;
  location: string | null;
  pricePerUse: number;
  durationMinutes: number;
  code: string | null;
  groupToken: string | null;
}
interface ServicesPayload {
  showers: Shower[];
  washers: Machine[];
  dryers: Machine[];
}

type Tab = "showers" | "washers" | "dryers";

function groupByLocation<T extends { location: string | null }>(items: T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = item.location?.trim() || "Øvrige";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, "da-DK"));
}

export function ServicesOverviewClient({ services }: { services: ServicesPayload }) {
  const [tab, setTab] = useState<Tab>("showers");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);

  function renderShower(item: Shower) {
    return (
      <Link
        key={`shower-${item.id}`}
        href={`/shower/${item.id}`}
        className="block rounded-lg border border-border hover:border-sky-500/40 hover:bg-sky-500/5 transition-colors px-4 py-3"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-lg bg-sky-500/10 flex items-center justify-center shrink-0">
              <Droplets className="h-4 w-4 text-sky-600" />
            </div>
            <div className="min-w-0">
              <div className="font-medium truncate">{item.name}</div>
              <div className="text-xs text-muted-foreground">
                {item.pricePerMinute.toFixed(2)} DKK/min &middot; {item.minMinutes}–{item.maxMinutes} min
              </div>
            </div>
          </div>
          {item.code && (
            <span className="text-xs font-mono text-muted-foreground tabular-nums">
              #{item.code}
            </span>
          )}
        </div>
      </Link>
    );
  }

  function renderMachine(item: Machine, Icon: typeof WashingMachine) {
    const disabled = !item.groupToken;
    const content = (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{item.name}</div>
            <div className="text-xs text-muted-foreground">
              {item.pricePerUse.toFixed(0)} DKK &middot; {item.durationMinutes} min
            </div>
          </div>
        </div>
        {item.code && (
          <span className="text-xs font-mono text-muted-foreground tabular-nums">
            #{item.code}
          </span>
        )}
      </div>
    );
    return disabled ? (
      <div
        key={`m-${item.id}`}
        className="block rounded-lg border border-border opacity-60 px-4 py-3 cursor-not-allowed"
        title="Ikke tilknyttet et vaskerum med QR-gruppe"
      >
        {content}
      </div>
    ) : (
      <Link
        key={`m-${item.id}`}
        href={`/laundry/${item.groupToken}`}
        className="block rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors px-4 py-3"
      >
        {content}
      </Link>
    );
  }

  const showerGroups = useMemo(() => groupByLocation(services.showers), [services.showers]);
  const washerGroups = useMemo(() => groupByLocation(services.washers), [services.washers]);
  const dryerGroups = useMemo(() => groupByLocation(services.dryers), [services.dryers]);

  async function handleCodeSubmit(e?: FormEvent) {
    if (e) e.preventDefault();
    setCodeError(null);
    if (!/^\d{4}$/.test(code)) {
      setCodeError("Indtast 4 cifre");
      return;
    }
    setCodeLoading(true);
    try {
      const resolved = await resolveServiceCode(code);
      if (!resolved) {
        setCodeError("Ukendt kode");
        setCodeLoading(false);
        return;
      }
      if (resolved.type === "shower") {
        window.location.href = `/shower/${resolved.id}`;
        return;
      }
      if (resolved.groupToken) {
        window.location.href = `/laundry/${resolved.groupToken}`;
        return;
      }
      setCodeError("Kode ikke tilknyttet en side");
      setCodeLoading(false);
    } catch {
      setCodeError("Noget gik galt");
      setCodeLoading(false);
    }
  }

  const tabs: { id: Tab; label: string; icon: typeof Droplets; count: number }[] = [
    { id: "showers", label: "Bade", icon: Droplets, count: services.showers.length },
    { id: "washers", label: "Vask", icon: WashingMachine, count: services.washers.length },
    { id: "dryers", label: "Tørretumbler", icon: Wind, count: services.dryers.length },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-background px-4 pt-6 pb-8 text-center relative overflow-hidden">
        <div className="relative z-10">
          <h1 className="text-2xl font-bold">Services</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Vælg en service — eller indtast den 4-cifrede kode fra skiltet
          </p>
        </div>
      </div>

      <div className="max-w-md mx-auto w-full px-4 py-4 space-y-4 flex-1">
        {/* Code entry */}
        <Card>
          <CardContent className="p-4">
            <form onSubmit={handleCodeSubmit} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  inputMode="numeric"
                  maxLength={4}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 4));
                    setCodeError(null);
                  }}
                  placeholder="1001"
                  className="pl-9 h-11 text-lg font-mono tabular-nums tracking-widest"
                />
              </div>
              <Button type="submit" className="h-11" disabled={codeLoading || code.length !== 4}>
                {codeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Gå"}
              </Button>
            </form>
            {codeError && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
                <XCircle className="h-3.5 w-3.5" />
                {codeError}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
                <span className="text-xs opacity-60">({t.count})</span>
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="space-y-4">
          {tab === "showers" && (
            showerGroups.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-muted-foreground"><p className="text-sm">Ingen bade</p></CardContent></Card>
            ) : showerGroups.map(([location, items]) => (
              <div key={location}>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 px-1">
                  <MapPin className="h-3 w-3" />
                  {location}
                </div>
                <div className="space-y-2">{items.map(renderShower)}</div>
              </div>
            ))
          )}
          {tab === "washers" && (
            washerGroups.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-muted-foreground"><p className="text-sm">Ingen vaskemaskiner</p></CardContent></Card>
            ) : washerGroups.map(([location, items]) => (
              <div key={location}>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 px-1">
                  <MapPin className="h-3 w-3" />
                  {location}
                </div>
                <div className="space-y-2">{items.map((m) => renderMachine(m, WashingMachine))}</div>
              </div>
            ))
          )}
          {tab === "dryers" && (
            dryerGroups.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-muted-foreground"><p className="text-sm">Ingen tørretumblere</p></CardContent></Card>
            ) : dryerGroups.map(([location, items]) => (
              <div key={location}>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 px-1">
                  <MapPin className="h-3 w-3" />
                  {location}
                </div>
                <div className="space-y-2">{items.map((m) => renderMachine(m, Wind))}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <p className="text-[10px] text-center text-muted-foreground/40 pb-4 flex items-center justify-center gap-1">
        <Tent className="h-3 w-3" />
        CampSense
      </p>
    </div>
  );
}
