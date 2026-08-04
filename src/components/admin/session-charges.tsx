import { WashingMachine, ShowerHead, Zap, Droplets } from "lucide-react";
import { getSessionCharges } from "@/lib/actions";

/**
 * Running account for a stay — what the guest has spent so far, without
 * waiting for an invoice to be generated.
 */
export async function SessionCharges({ sessionId }: { sessionId: number }) {
  const { charges, electricity, water, servicesTotal, total } = await getSessionCharges(sessionId);

  const hasUtilities = electricity.cost > 0 || water.cost > 0;

  if (charges.length === 0 && !hasUtilities) {
    return (
      <div className="p-5 text-sm text-muted-foreground text-center">
        Ingen forbrug registreret endnu.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {charges.map((c) => (
        <div key={c.id} className="flex items-center gap-3 px-5 py-3">
          <span className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
            {c.kind === "LAUNDRY" ? (
              <WashingMachine className="h-4 w-4 text-blue-600" />
            ) : (
              <ShowerHead className="h-4 w-4 text-cyan-600" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium truncate">{c.label}</span>
              {c.pending && (
                <span className="text-[11px] leading-4 bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-px rounded-md">
                  I gang
                </span>
              )}
              {c.paymentStatus === "PAID" ? (
                <span className="text-[11px] leading-4 bg-green-50 text-green-700 border border-green-200 px-1.5 py-px rounded-md">
                  Betalt
                </span>
              ) : c.paymentStatus === "PREPAID" ? (
                <span className="text-[11px] leading-4 bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-px rounded-md">
                  Forudbetalt
                </span>
              ) : (
                <span className="text-[11px] leading-4 bg-muted text-muted-foreground px-1.5 py-px rounded-md">
                  Ikke betalt
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(c.occurredAt).toLocaleString("da-DK", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {c.detail && ` · ${c.detail}`}
            </p>
          </div>
          <span className="text-sm font-medium tabular-nums whitespace-nowrap">
            {c.amount.toFixed(2)} DKK
          </span>
        </div>
      ))}

      {electricity.cost > 0 && (
        <div className="flex items-center gap-3 px-5 py-3">
          <span className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Zap className="h-4 w-4 text-amber-500" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">El</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {electricity.kwh.toFixed(2)} kWh løbende
            </p>
          </div>
          <span className="text-sm font-medium tabular-nums whitespace-nowrap">
            {electricity.cost.toFixed(2)} DKK
          </span>
        </div>
      )}

      {water.cost > 0 && (
        <div className="flex items-center gap-3 px-5 py-3">
          <span className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Droplets className="h-4 w-4 text-blue-500" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Vand</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {water.liters.toFixed(0)} L løbende
            </p>
          </div>
          <span className="text-sm font-medium tabular-nums whitespace-nowrap">
            {water.cost.toFixed(2)} DKK
          </span>
        </div>
      )}

      <div className="flex items-center justify-between px-5 py-3.5 bg-muted/40">
        <div>
          <span className="text-sm font-semibold">Forbrug i alt</span>
          {charges.length > 0 && hasUtilities && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Heraf {servicesTotal.toFixed(2)} DKK for services
            </p>
          )}
        </div>
        <span className="text-base font-bold tabular-nums">
          {total.toFixed(2)} <span className="text-xs font-normal text-muted-foreground">DKK</span>
        </span>
      </div>
    </div>
  );
}
