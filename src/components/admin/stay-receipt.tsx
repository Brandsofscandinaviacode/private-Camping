"use client";

import { useSyncExternalStore } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { StayReceipt } from "@/lib/stay-corrections";
import { ReceiptLines } from "./check-in-fields";

// What a correction (change unit, undo check-in/check-out) really did, shown
// like the check-in receipt. The page refreshes after the action and the
// button that started it may disappear, so the receipt lives in this small
// module store and a host on the booking page shows it.
let current: StayReceipt | null = null;
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

export function showStayReceipt(receipt: StayReceipt) {
  current = receipt;
  emit();
}

function dismiss() {
  current = null;
  emit();
}

export function StayReceiptHost({ sessionId }: { sessionId: number }) {
  const receipt = useSyncExternalStore(subscribe, () => current, () => null);
  if (!receipt || receipt.sessionId !== sessionId) return null;

  const problem = receipt.lines.some((l) => l.tone === "error");
  return (
    <Dialog open onOpenChange={(open) => { if (!open) dismiss(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{receipt.title}</DialogTitle>
        </DialogHeader>
        <div
          className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${
            problem ? "border-amber-200 bg-amber-50 text-amber-800" : "border-primary/20 bg-primary/10 text-primary"
          }`}
        >
          {problem ? <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> : <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />}
          <p>
            {receipt.summary}
            {problem && " Ikke alt lykkedes – se herunder."}
          </p>
        </div>
        <ReceiptLines lines={receipt.lines} />
        <Button type="button" onClick={dismiss} className="w-full">
          Luk
        </Button>
      </DialogContent>
    </Dialog>
  );
}
