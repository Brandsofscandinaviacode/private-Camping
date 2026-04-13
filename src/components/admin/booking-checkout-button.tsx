"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { checkOutWithStatement } from "@/lib/actions";

interface BookingCheckoutButtonProps {
  sessionId: number;
  guestName: string;
  unitName: string;
}

export function BookingCheckoutButton({
  sessionId,
  guestName,
  unitName,
}: BookingCheckoutButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCheckOut() {
    setLoading(true);
    setError("");
    try {
      await checkOutWithStatement(sessionId);
      setOpen(false);
      router.push(`/admin/bookings/${sessionId}/statement`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check-out fejlede");
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!loading ? setOpen(o) : undefined)}>
      <DialogTrigger render={<Button variant="destructive" className="w-full" />}>
        <LogOut className="h-4 w-4 mr-2" />
        Check-out &amp; opgørelse
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Check-out fra {unitName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm">
            Er du sikker på at du vil checke <strong>{guestName}</strong> ud fra{" "}
            <strong>{unitName}</strong>?
          </p>
          <p className="text-xs text-muted-foreground">
            Systemet aflæser målere, beregner forbrug, lukker ned jf.
            indstillingerne og opretter en afsluttende faktura hvis der er
            ubetalt forbrug. Du bliver derefter sendt til en opgørelse der kan
            udskrives.
          </p>
          {error && (
            <div className="text-xs p-2 rounded-lg bg-red-50 text-red-600">{error}</div>
          )}
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={handleCheckOut}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Checker ud...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  Bekræft &amp; vis opgørelse
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Annullér
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
