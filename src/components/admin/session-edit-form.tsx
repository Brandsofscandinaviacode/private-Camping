"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateSessionDetails } from "@/lib/actions";

interface SessionEditFormProps {
  sessionId: number;
  guestName: string;
  guestEmail: string;
  bookingRef: string;
  notes: string;
}

export function SessionEditForm({
  sessionId,
  guestName: initialName,
  guestEmail: initialEmail,
  bookingRef: initialRef,
  notes: initialNotes,
}: SessionEditFormProps) {
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [values, setValues] = useState({
    guestName: initialName,
    guestEmail: initialEmail,
    bookingRef: initialRef,
    notes: initialNotes,
  });

  function handleSave() {
    startTransition(async () => {
      await updateSessionDetails(sessionId, values);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="font-semibold">Redigér booking</h2>
      </div>
      <div className="p-5 space-y-4">
        <div>
          <Label className="text-sm text-muted-foreground">Gæstenavn</Label>
          <Input
            value={values.guestName}
            onChange={(e) => setValues((v) => ({ ...v, guestName: e.target.value }))}
            className="mt-1"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm text-muted-foreground">Booking nr.</Label>
            <Input
              value={values.bookingRef}
              onChange={(e) => setValues((v) => ({ ...v, bookingRef: e.target.value }))}
              placeholder="BK-001"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-sm text-muted-foreground">Email</Label>
            <Input
              type="email"
              value={values.guestEmail}
              onChange={(e) => setValues((v) => ({ ...v, guestEmail: e.target.value }))}
              placeholder="gæst@email.dk"
              className="mt-1"
            />
          </div>
        </div>
        <div>
          <Label className="text-sm text-muted-foreground">Bemærkninger</Label>
          <textarea
            className="w-full h-20 text-sm border rounded-lg px-3 py-2 mt-1 bg-background text-foreground resize-none border-border"
            value={values.notes}
            onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
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
