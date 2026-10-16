"use client";

import { useState } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { methodLabel, type PaymentListRow } from "@/lib/payments-shared";
import { fmtMoney } from "@/lib/settlement-shared";
import { fmtTime } from "@/lib/format";
import { ReversePaymentButton } from "./payment-list";

/** The day's ledger rows on "Kasse i dag", newest first, with receipt and "Fortryd". */
export function TillRows({ rows, currency = "DKK" }: { rows: PaymentListRow[]; currency?: string }) {
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div>
      {message && <p className="mx-5 mt-3 text-sm p-2.5 rounded-lg bg-emerald-50 text-emerald-700 print:hidden">{message}</p>}
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const muted = r.reversed || r.reversesId != null;
          return (
            <li key={r.id} className="flex items-start gap-3 px-5 py-3 break-inside-avoid">
              <span className="text-xs tabular-nums text-muted-foreground w-11 shrink-0 pt-0.5">{fmtTime(r.createdAt)}</span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${muted ? "text-muted-foreground" : "font-medium"}`}>
                  {r.purpose}
                  {r.kind === "INVOICE" && r.invoiceId ? ` · faktura nr. ${r.invoiceId}` : ""}
                  {r.reversed && <span className="ml-1.5 text-[11px] font-normal px-1.5 py-0.5 rounded bg-muted">Fortrudt</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {methodLabel(r.method)}
                  {r.createdBy ? ` · ${r.createdBy}` : ""}
                  {r.sessionId ? (
                    <>
                      {" · "}
                      <Link href={`/admin/bookings/${r.sessionId}`} className="hover:underline text-foreground">
                        {r.guestName}{r.unitName ? ` (${r.unitName})` : ""}
                      </Link>
                    </>
                  ) : r.unitName ? ` · ${r.unitName}` : ""}
                </p>
                {r.note && <p className="text-xs text-muted-foreground break-words">{r.note}</p>}
                {r.reversal && (
                  <p className="text-xs text-muted-foreground">
                    Fortrudt {fmtTime(r.reversal.at)}{r.reversal.by ? ` af ${r.reversal.by}` : ""}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={`text-sm tabular-nums whitespace-nowrap ${r.reversed ? "line-through text-muted-foreground" : r.amount < 0 ? "text-red-600" : "font-medium"}`}>
                  {fmtMoney(r.amount, currency)}
                </span>
                <div className="flex gap-1 print:hidden">
                  {r.sessionId && r.reversesId == null && (
                    <Link href={`/admin/bookings/${r.sessionId}/receipt/${r.id}`}>
                      <Button variant="ghost" size="xs" className="text-muted-foreground" aria-label="Kvittering">
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  )}
                  {!r.reverseBlock && (
                    <ReversePaymentButton payment={r} group={r.group} currency={currency} onDone={setMessage} />
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
