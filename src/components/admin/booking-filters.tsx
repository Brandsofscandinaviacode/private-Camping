"use client";

import Link from "next/link";

interface BookingFiltersProps {
  activeFilter: string;
  unpaidCount: number;
}

const filters = [
  { value: "all", label: "Alle" },
  { value: "active", label: "Aktive" },
  { value: "unpaid", label: "Ubetalt" },
  { value: "paid", label: "Betalt" },
];

export function BookingFilters({ activeFilter, unpaidCount }: BookingFiltersProps) {
  return (
    <div className="flex gap-0.5 bg-muted/50 p-0.5 rounded-md w-fit">
      {filters.map((f) => (
        <Link
          key={f.value}
          href={`/admin/bookings${f.value === "all" ? "" : `?filter=${f.value}`}`}
          className={`px-3 py-1.5 text-xs rounded transition-colors relative ${
            activeFilter === f.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {f.label}
          {f.value === "unpaid" && unpaidCount > 0 && (
            <span className="ml-1 inline-flex items-center justify-center h-3.5 min-w-3.5 px-1 text-[9px] font-semibold rounded-full bg-destructive/80 text-white">
              {unpaidCount}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
