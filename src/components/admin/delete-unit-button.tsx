"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteUnit } from "@/lib/actions";

export function DeleteUnitButton({ unitId, unitName }: { unitId: number; unitName: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function handleDelete() {
    startTransition(async () => {
      await deleteUnit(unitId);
      router.push("/admin");
    });
  }

  if (!confirming) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)} className="text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600">
        <Trash2 className="h-4 w-4 mr-2" />
        Slet enhed
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-red-500">Slet {unitName}?</span>
      <Button size="sm" variant="destructive" onClick={handleDelete} disabled={isPending}>
        {isPending ? "Sletter..." : "Bekræft"}
      </Button>
      <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={isPending}>
        Annullér
      </Button>
    </div>
  );
}
