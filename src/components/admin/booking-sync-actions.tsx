"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveBookingSyncConflict, syncBookingsNow } from "@/lib/actions";

/** "Hent nu" on the booking-sync status line. */
export function BookingSyncNowButton({ label = "Hent nu" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => {
        const r = await syncBookingsNow().catch(() => ({ ok: false, message: "Hentning fejlede — prøv igen" }));
        if (r.ok) toast.success(r.message);
        else toast.error(r.message);
        router.refresh();
      })}
      className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline disabled:opacity-60"
    >
      <RefreshCw className={`h-3 w-3 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Henter…" : label}
    </button>
  );
}

/** [Brug den] [Behold min] for one field the booking system disagrees on. */
export function SyncConflictButtons({ sessionId, field }: { sessionId: number; field: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const choose = (choice: "booking" | "mine") => startTransition(async () => {
    const r = await resolveBookingSyncConflict(sessionId, field, choice)
      .catch(() => ({ ok: false, message: "Kunne ikke gemme valget — prøv igen" }));
    if (r.ok) toast.success(r.message);
    else toast.error(r.message);
    router.refresh();
  });

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <Button size="xs" variant="outline" disabled={pending} onClick={() => choose("booking")}>Brug den</Button>
      <Button size="xs" variant="ghost" disabled={pending} onClick={() => choose("mine")}>Behold min</Button>
    </div>
  );
}
