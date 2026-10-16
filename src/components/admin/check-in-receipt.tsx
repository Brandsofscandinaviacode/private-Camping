"use client";

import { useSyncExternalStore } from "react";
import { AlertTriangle, CheckCircle2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CheckInReceipt } from "@/lib/check-in";
import { ReceiptLines } from "./check-in-fields";
import { PortalHandover } from "./guest-portal-handover";

// A check-in refreshes the page, and the dialog that started it unmounts
// (the unit/booking switches state). The receipt is therefore kept in this
// small module store and shown by a host on the booking page.
let current: CheckInReceipt | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function showCheckInReceipt(receipt: CheckInReceipt) {
  current = receipt;
  emit();
}

function dismissReceipt() {
  current = null;
  emit();
}

/**
 * Shows the receipt of a check-in of this booking until the desk closes it.
 * Without a sessionId (a list page such as "I dag"), any check-in's receipt.
 */
export function CheckInReceiptHost({ sessionId, siteUrl }: { sessionId?: number; siteUrl: string }) {
  const receipt = useSyncExternalStore(subscribe, () => current, () => null);
  if (!receipt || (sessionId !== undefined && receipt.sessionId !== sessionId)) return null;

  const problem = receipt.lines.some((l) => l.tone === "error");
  return (
    <Dialog open onOpenChange={(open) => { if (!open) dismissReceipt(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Check-in gennemført</DialogTitle>
        </DialogHeader>
        <div
          className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${
            problem ? "border-amber-200 bg-amber-50 text-amber-800" : "border-primary/20 bg-primary/10 text-primary"
          }`}
        >
          {problem ? <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> : <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />}
          <p>
            {receipt.guestName} er tjekket ind på {receipt.unitName}.
            {problem && " Ikke alt lykkedes – se herunder."}
          </p>
        </div>
        <ReceiptLines lines={receipt.lines} />
        {receipt.deposit && (
          <a
            href={`/admin/bookings/${receipt.sessionId}/receipt/${receipt.deposit.paymentId}?print=1`}
            target="_blank"
            rel="noopener"
          >
            <Button type="button" variant="outline" size="sm" className="w-full">
              <Printer className="h-4 w-4 mr-2" />
              Udskriv kvittering for forudbetalingen
            </Button>
          </a>
        )}
        <div className="border-t border-border pt-3">
          <PortalHandover sessionId={receipt.sessionId} portalPath={receipt.portalPath} siteUrl={siteUrl} />
        </div>
        <Button type="button" onClick={dismissReceipt} className="w-full">
          Luk
        </Button>
      </DialogContent>
    </Dialog>
  );
}
