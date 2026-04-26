"use client";

import { useState } from "react";
import Link from "next/link";
import { Droplets, Loader2, Minus, Plus, ArrowLeft, Tent, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createShowerPayment } from "@/lib/actions";

interface Shower {
  id: number;
  name: string;
  location: string | null;
  pricePerMinute: number;
  minMinutes: number;
  maxMinutes: number;
  available: boolean;
}

export function ShowerBuyClient({ shower }: { shower: Shower }) {
  const [minutes, setMinutes] = useState<number>(
    Math.min(10, Math.max(shower.minMinutes, Math.floor((shower.minMinutes + shower.maxMinutes) / 2)))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const price = +(minutes * shower.pricePerMinute).toFixed(2);

  function dec() {
    setMinutes((m) => Math.max(shower.minMinutes, m - 1));
  }
  function inc() {
    setMinutes((m) => Math.min(shower.maxMinutes, m + 1));
  }

  async function handleBuy() {
    setLoading(true);
    setError(null);
    try {
      const res = await createShowerPayment(shower.id, minutes);
      if (!res.ok) {
        setError(res.message);
        setLoading(false);
        return;
      }
      if (res.paymentLink) {
        window.location.href = res.paymentLink;
        return;
      }
      if (res.showerSessionId) {
        // Access token is held in an httpOnly cookie set by the server action
        // that created the session — don't put it in the URL.
        window.location.href = `/shower/active/${res.showerSessionId}`;
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Der opstod en fejl");
      setLoading(false);
    }
  }

  if (!shower.available) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="max-w-md mx-auto w-full px-4 py-8 flex-1 flex flex-col justify-center">
          <Card>
            <CardContent className="py-8 text-center">
              <XCircle className="h-10 w-10 mx-auto mb-3 text-orange-500" />
              <h1 className="text-lg font-bold">{shower.name} er optaget</h1>
              <p className="text-sm text-muted-foreground mt-2">
                Prøv igen om et par minutter, eller vælg et andet bad.
              </p>
              <Link href="/services">
                <Button variant="outline" className="mt-5" size="sm">
                  <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                  Se alle services
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-br from-sky-500/15 via-sky-400/5 to-background px-4 pt-6 pb-10 text-center relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-sky-500/5" />
        <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-sky-500/5" />
        <div className="relative z-10">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-sky-500 to-sky-600 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-sky-500/20">
            <Droplets className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-bold">{shower.name}</h1>
          {shower.location && (
            <p className="text-muted-foreground text-sm mt-1">{shower.location}</p>
          )}
        </div>
      </div>

      <div className="max-w-md mx-auto w-full px-4 py-4 space-y-4 -mt-4 flex-1">
        <Card>
          <CardContent className="p-5 space-y-5">
            <div>
              <p className="text-sm text-muted-foreground text-center">
                {shower.pricePerMinute.toFixed(2)} DKK pr. minut
              </p>
              <p className="text-xs text-muted-foreground/70 text-center mt-1">
                {shower.minMinutes}–{shower.maxMinutes} min
              </p>
            </div>

            {/* Minute picker */}
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="icon"
                className="h-12 w-12 rounded-full"
                onClick={dec}
                disabled={minutes <= shower.minMinutes}
              >
                <Minus className="h-5 w-5" />
              </Button>
              <div className="text-center w-24">
                <div className="text-4xl font-bold tabular-nums">{minutes}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">min</div>
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-12 w-12 rounded-full"
                onClick={inc}
                disabled={minutes >= shower.maxMinutes}
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>

            {/* Quick picks */}
            <div className="grid grid-cols-4 gap-2">
              {[5, 10, 15, 20]
                .filter((n) => n >= shower.minMinutes && n <= shower.maxMinutes)
                .map((n) => (
                  <button
                    key={n}
                    onClick={() => setMinutes(n)}
                    className={`py-2 rounded-lg text-sm font-medium border transition-colors ${
                      minutes === n
                        ? "border-sky-500 bg-sky-500/10 text-sky-700"
                        : "border-border hover:border-sky-500/40"
                    }`}
                  >
                    {n} min
                  </button>
                ))}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-sm text-muted-foreground">Samlet pris</span>
              <span className="text-2xl font-bold tabular-nums">
                {price.toFixed(2)} <span className="text-sm text-muted-foreground">DKK</span>
              </span>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <XCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              className="w-full h-12 text-base"
              size="lg"
              disabled={loading}
              onClick={handleBuy}
            >
              {loading ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Opretter betaling...
                </>
              ) : (
                `Betal ${price.toFixed(0)} DKK & start`
              )}
            </Button>

            <p className="text-[11px] text-muted-foreground text-center">
              Du kan pause timeren op til 5 minutter ad gangen, og købe ekstra tid undervejs.
            </p>
          </CardContent>
        </Card>

        <Link href="/services">
          <Button variant="ghost" size="sm" className="w-full">
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
            Alle services
          </Button>
        </Link>
      </div>

      <p className="text-[10px] text-center text-muted-foreground/40 pb-4 flex items-center justify-center gap-1">
        <Tent className="h-3 w-3" />
        CampSense
      </p>
    </div>
  );
}
