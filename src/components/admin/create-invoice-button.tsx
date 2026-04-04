"use client";

import { useTransition } from "react";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createMonthlyInvoice } from "@/lib/actions";

export function CreateInvoiceButton({ unitId }: { unitId: number }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => startTransition(async () => { await createMonthlyInvoice(unitId); })}
    >
      <Receipt className="h-3.5 w-3.5 mr-1" />
      {isPending ? "Opretter..." : "Ny faktura"}
    </Button>
  );
}
