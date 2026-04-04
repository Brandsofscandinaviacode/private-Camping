"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Redigér booking</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs">Gæstenavn</Label>
          <Input
            value={values.guestName}
            onChange={(e) => setValues((v) => ({ ...v, guestName: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Booking nr.</Label>
            <Input
              value={values.bookingRef}
              onChange={(e) => setValues((v) => ({ ...v, bookingRef: e.target.value }))}
              placeholder="BK-001"
            />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input
              type="email"
              value={values.guestEmail}
              onChange={(e) => setValues((v) => ({ ...v, guestEmail: e.target.value }))}
              placeholder="gæst@email.dk"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Bemærkninger</Label>
          <textarea
            className="w-full h-20 text-sm border rounded-lg px-3 py-2 bg-input text-foreground resize-none"
            value={values.notes}
            onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
            placeholder="Interne noter..."
          />
        </div>
        <Button onClick={handleSave} disabled={isPending} size="sm">
          <Save className="h-3.5 w-3.5 mr-1" />
          {isPending ? "Gemmer..." : saved ? "Gemt!" : "Gem ændringer"}
        </Button>
      </CardContent>
    </Card>
  );
}
