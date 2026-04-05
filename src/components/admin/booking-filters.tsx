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
    <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
      {filters.map((f) => (
        <Link
          key={f.value}
          href={`/admin/bookings${f.value === "all" ? "" : `?filter=${f.value}`}`}
          className={`px-4 py-2 text-sm rounded-md transition-colors relative ${
            activeFilter === f.value
              ? "bg-card text-foreground shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {f.label}
          {f.value === "unpaid" && unpaidCount > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] font-semibold rounded-full bg-red-500 text-white">
              {unpaidCount}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
