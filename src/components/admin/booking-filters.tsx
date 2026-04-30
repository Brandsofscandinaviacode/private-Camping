"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

interface BookingFiltersProps {
  activeFilter: string;
  unpaidCount: number;
  searchQuery: string;
}

const filters = [
  { value: "all", label: "Alle" },
  { value: "active", label: "Aktive" },
  { value: "pending", label: "Reserveret" },
  { value: "unpaid", label: "Ubetalt" },
  { value: "paid", label: "Betalt" },
];

function buildUrl(filter: string, search: string): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (search) params.set("q", search);
  const qs = params.toString();
  return `/admin/bookings${qs ? `?${qs}` : ""}`;
}

export function BookingFilters({ activeFilter, unpaidCount, searchQuery }: BookingFiltersProps) {
  const router = useRouter();
  const [search, setSearch] = useState(searchQuery);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(buildUrl(activeFilter, search.trim()));
  }

  function clearSearch() {
    setSearch("");
    router.push(buildUrl(activeFilter, ""));
  }

  return (
    <div className="space-y-3">
      <nav aria-label="Booking filtre" className="flex gap-1 bg-muted/80 p-1 rounded-xl w-fit border border-border/40" role="tablist">
        {filters.map((f) => (
          <Link
            key={f.value}
            href={buildUrl(f.value, search.trim())}
            role="tab"
            aria-selected={activeFilter === f.value}
            aria-label={f.value === "unpaid" && unpaidCount > 0 ? `${f.label} (${unpaidCount})` : f.label}
            className={`px-4 py-2 text-sm rounded-lg transition-all relative ${
              activeFilter === f.value
                ? "bg-card text-foreground shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-card/50"
            }`}
          >
            {f.label}
            {f.value === "unpaid" && unpaidCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] font-bold rounded-full bg-red-500 text-white">
                {unpaidCount}
              </span>
            )}
          </Link>
        ))}
      </nav>
      <form onSubmit={handleSearch} className="relative max-w-sm" role="search" aria-label="Søg bookinger">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Søg navn, booking nr., email..."
          aria-label="Søg efter bookinger"
          className="w-full h-9 pl-9 pr-8 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
        {search && (
          <button
            type="button"
            onClick={clearSearch}
            aria-label="Ryd søgning"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </form>
    </div>
  );
}
