"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createMonthlyInvoice } from "@/lib/actions";

export function CreateInvoiceButton({ unitId }: { unitId: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() => startTransition(async () => {
          setError(null);
          try {
            const res = await createMonthlyInvoice(unitId);
            if (!res.ok) setError(res.message);
            else router.refresh();
          } catch {
            setError("Fakturaen kunne ikke oprettes. Prøv igen.");
          }
        })}
      >
        <Receipt className="h-3.5 w-3.5 mr-1" />
        {isPending ? "Opretter..." : "Ny faktura"}
      </Button>
      {error && <p className="text-xs text-red-600 max-w-60 text-right" role="alert">{error}</p>}
    </div>
  );
}
