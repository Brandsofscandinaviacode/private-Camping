"use client";

import { useState, useTransition } from "react";
import { Save, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateSessionDetails, resendGuestNotification } from "@/lib/actions";

interface SessionEditFormProps {
  sessionId: number;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  bookingRef: string;
  notes: string;
  expectedCheckOut: string;
  startKwh: number | null;
  endKwh: number | null;
  startWaterLiters: number | null;
  endWaterLiters: number | null;
  isActive: boolean;
}

export function SessionEditForm({
  sessionId,
  guestName: initialName,
  guestEmail: initialEmail,
  guestPhone: initialPhone,
  bookingRef: initialRef,
  notes: initialNotes,
  expectedCheckOut: initialCheckOut,
  startKwh: initialStartKwh,
  endKwh: initialEndKwh,
  startWaterLiters: initialStartWater,
  endWaterLiters: initialEndWater,
  isActive,
}: SessionEditFormProps) {
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState("");
  const [values, setValues] = useState({
    guestName: initialName,
    guestEmail: initialEmail,
    guestPhone: initialPhone,
    bookingRef: initialRef,
    notes: initialNotes,
    expectedCheckOut: initialCheckOut,
    startKwh: initialStartKwh !== null ? String(initialStartKwh) : "",
    endKwh: initialEndKwh !== null ? String(initialEndKwh) : "",
    startWaterLiters: initialStartWater !== null ? String(initialStartWater) : "",
    endWaterLiters: initialEndWater !== null ? String(initialEndWater) : "",
  });

  function handleSave() {
    startTransition(async () => {
      await updateSessionDetails(sessionId, {
        guestName: values.guestName,
        guestEmail: values.guestEmail,
        guestPhone: values.guestPhone,
        bookingRef: values.bookingRef,
        notes: values.notes,
        expectedCheckOut: values.expectedCheckOut,
        startKwh: values.startKwh !== "" ? parseFloat(values.startKwh) : null,
        endKwh: values.endKwh !== "" ? parseFloat(values.endKwh) : null,
        startWaterLiters: values.startWaterLiters !== "" ? parseFloat(values.startWaterLiters) : null,
        endWaterLiters: values.endWaterLiters !== "" ? parseFloat(values.endWaterLiters) : null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  }

  async function handleResend() {
    setResending(true);
    setResendMsg("");
    try {
      await resendGuestNotification(sessionId);
      setResendMsg("Sendt!");
      setTimeout(() => setResendMsg(""), 4000);
    } catch (e) {
      setResendMsg(e instanceof Error ? e.message : "Fejl ved afsendelse");
    } finally {
      setResending(false);
    }
  }

  function h(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold">Redigér booking</h2>
        <Button variant="outline" size="sm" onClick={handleResend} disabled={resending}>
          {resending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
          {resending ? "Sender..." : "Gensend SMS/email"}
        </Button>
      </div>
      {resendMsg && (
        <div className={`mx-5 mt-3 text-sm p-2 rounded-lg ${resendMsg === "Sendt!" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
          {resendMsg}
        </div>
      )}
      <div className="p-5 space-y-4">
        <div>
          <Label className="text-sm text-muted-foreground">Gæstenavn</Label>
          <Input
            value={values.guestName}
            onChange={(e) => h("guestName", e.target.value)}
            className="mt-1"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm text-muted-foreground">Email</Label>
            <Input
              type="email"
              value={values.guestEmail}
              onChange={(e) => h("guestEmail", e.target.value)}
              placeholder="gæst@email.dk"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-sm text-muted-foreground">Telefon</Label>
            <Input
              type="tel"
              value={values.guestPhone}
              onChange={(e) => h("guestPhone", e.target.value)}
              placeholder="+4512345678"
              className="mt-1"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm text-muted-foreground">Booking nr.</Label>
            <Input
              value={values.bookingRef}
              onChange={(e) => h("bookingRef", e.target.value)}
              placeholder="BK-001"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-sm text-muted-foreground">Forventet checkout</Label>
            <Input
              type="date"
              value={values.expectedCheckOut}
              onChange={(e) => h("expectedCheckOut", e.target.value)}
              className="mt-1"
            />
          </div>
        </div>

        {/* Consumption editing */}
        <div className="pt-2 border-t border-border">
          <p className="text-xs font-medium text-muted-foreground mb-3">Forbrug (manuel redigering)</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">El start (kWh)</Label>
              <Input
                type="number"
                step="0.01"
                value={values.startKwh}
                onChange={(e) => h("startKwh", e.target.value)}
                placeholder="—"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">El slut (kWh)</Label>
              <Input
                type="number"
                step="0.01"
                value={values.endKwh}
                onChange={(e) => h("endKwh", e.target.value)}
                placeholder={isActive ? "Aktiv" : "—"}
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <Label className="text-xs text-muted-foreground">Vand start (L)</Label>
              <Input
                type="number"
                step="1"
                value={values.startWaterLiters}
                onChange={(e) => h("startWaterLiters", e.target.value)}
                placeholder="—"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Vand slut (L)</Label>
              <Input
                type="number"
                step="1"
                value={values.endWaterLiters}
                onChange={(e) => h("endWaterLiters", e.target.value)}
                placeholder={isActive ? "Aktiv" : "—"}
                className="mt-1"
              />
            </div>
          </div>
        </div>

        <div>
          <Label className="text-sm text-muted-foreground">Bemærkninger</Label>
          <textarea
            className="w-full h-20 text-sm border rounded-lg px-3 py-2 mt-1 bg-background text-foreground resize-none border-border"
            value={values.notes}
            onChange={(e) => h("notes", e.target.value)}
            placeholder="Interne noter..."
          />
        </div>
        <Button onClick={handleSave} disabled={isPending} size="sm">
          <Save className="h-4 w-4 mr-2" />
          {isPending ? "Gemmer..." : saved ? "Gemt!" : "Gem ændringer"}
        </Button>
      </div>
    </div>
  );
}
