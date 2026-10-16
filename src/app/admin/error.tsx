"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Safety net for unexpected errors in the admin pages. In production Next.js
// hides the server's message, so this page explains in Danish what to do
// instead of showing the generic English text.
export default function AdminError({
  error,
  unstable_retry,
  reset,
}: {
  error: Error & { digest?: string };
  unstable_retry?: () => void;
  reset?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const retry = unstable_retry ?? reset;

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-xl">
      <div className="rounded-xl border border-red-200/80 bg-red-50/60 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-red-100 text-red-600 flex items-center justify-center shrink-0">
            <TriangleAlert className="h-[18px] w-[18px]" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-red-800">Noget gik galt</h1>
            <p className="text-sm text-red-700 mt-1">
              Siden kunne ikke vises, eller handlingen blev ikke gennemført. Prøv igen. Sker det igen, så kontakt
              support og oplys fejlkoden.
            </p>
            {error.digest && (
              <p className="text-xs text-red-600/80 mt-2">
                Fejlkode: <span className="font-mono">{error.digest}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {retry && (
            <Button type="button" onClick={() => retry()}>
              <RotateCw className="h-4 w-4 mr-2" />
              Prøv igen
            </Button>
          )}
          <Link href="/admin">
            <Button type="button" variant="outline">
              Til dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
