"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cancelServiceUse } from "@/lib/service-actions";
import { PAY_METHOD_LABELS, type RefundChoice, type RefundPlan } from "@/lib/service-billing";

/** For server-rendered lists (a booking's "Forbrug og køb"): re-render after cancelling. */
export function ServiceLineCancel(props: { kind: "LAUNDRY" | "SHOWER"; id: number; label: string; plan: RefundPlan }) {
  const router = useRouter();
  return <ServiceCancelDialog {...props} size="xs" onDone={() => router.refresh()} />;
}

/**
 * "Annullér og refundér" for one laundry/shower use — on Services, in the
 * history and in a booking's "Forbrug og køb". Shows what will be given back
 * (balance, bill, credit or desk payout) and asks for a reason.
 */
export function ServiceCancelDialog({
  kind,
  id,
  label,
  plan,
  onDone,
  size = "sm",
}: {
  kind: "LAUNDRY" | "SHOWER";
  id: number;
  label: string;
  plan: RefundPlan;
  onDone?: (message: string) => void;
  size?: "sm" | "xs";
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [choice, setChoice] = useState<RefundChoice | null>(plan.defaultChoice);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!plan.allowed) return null;

  const paysOut = plan.automatic !== null || (choice !== null && choice !== "NONE" && plan.amount > 0) || plan.creditBack > 0;

  function handleOpenChange(o: boolean) {
    setOpen(o);
    if (o) {
      setReason("");
      setChoice(plan.defaultChoice);
      setError(null);
    }
  }

  async function submit() {
    if (!reason.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await cancelServiceUse(kind, id, reason.trim(), plan.choices.length > 0 ? choice : null);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setOpen(false);
      onDone?.(res.message);
    } catch {
      setError("Annulleringen fejlede — prøv igen");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size={size} variant="ghost" className="text-muted-foreground hover:text-destructive" />}>
        <Undo2 className="h-3.5 w-3.5" />
        Annullér og refundér
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Annullér {label}</DialogTitle>
          <DialogDescription>{plan.explanation}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {plan.choices.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Pengene gives tilbage som</Label>
              <div className="flex flex-wrap gap-1.5">
                {plan.choices.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setChoice(c)}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      choice === c ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
                    }`}
                  >
                    {c === "NONE" ? "Ingen refusion" : PAY_METHOD_LABELS[c]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`cancel-reason-${kind}-${id}`} className="text-xs text-muted-foreground">Årsag</Label>
            <Input
              id={`cancel-reason-${kind}-${id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Fx maskinen startede ikke"
              autoFocus
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <Button variant="destructive" disabled={loading || !reason.trim()} onClick={submit}>
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {paysOut ? "Annullér og refundér" : "Annullér"}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Fortryd
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
