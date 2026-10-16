import { WashingMachine, ShowerHead, Zap, Droplets } from "lucide-react";
import { getSessionCharges } from "@/lib/actions";
import { ServiceLineCancel } from "@/components/admin/service-cancel-dialog";

const BADGE_CLASSES = {
  emerald: "bg-green-50 text-green-700 border border-green-200",
  blue: "bg-blue-50 text-blue-700 border border-blue-200",
  amber: "bg-amber-50 text-amber-700 border border-amber-200",
  red: "bg-red-50 text-red-700 border border-red-200",
  muted: "bg-muted text-muted-foreground border border-border",
} as const;

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
              <span className={`text-[11px] leading-4 px-1.5 py-px rounded-md ${BADGE_CLASSES[c.payment.tone]}`}>
                {c.payment.label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(c.occurredAt).toLocaleString("da-DK", {
                timeZone: "Europe/Copenhagen",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {c.detail && ` · ${c.detail}`}
              {c.creditUsed > 0 && ` · + ${c.creditUsed.toFixed(2)} DKK kredit`}
            </p>
          </div>
          <div className="flex flex-col items-end gap-0.5 shrink-0">
            <span className={`text-sm font-medium tabular-nums whitespace-nowrap ${c.cancelled ? "line-through text-muted-foreground" : ""}`}>
              {c.amount.toFixed(2)} DKK
            </span>
            <ServiceLineCancel kind={c.kind} id={c.rowId} label={c.label} plan={c.refund} />
          </div>
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
