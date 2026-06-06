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
  { value: "active", label: "Aktive", dot: "bg-blue-500" },
  { value: "pending", label: "Reserveret", dot: "bg-amber-500" },
  { value: "unpaid", label: "Ubetalt", dot: "bg-red-500" },
  { value: "paid", label: "Betalt", dot: "bg-emerald-500" },
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
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <nav aria-label="Booking filtre" className="flex gap-1.5 flex-wrap" role="tablist">
        {filters.map((f) => {
          const active = activeFilter === f.value;
          return (
            <Link
              key={f.value}
              href={buildUrl(f.value, search.trim())}
              role="tab"
              aria-selected={active}
              className={`text-[13px] font-medium px-3 py-2 rounded-lg border transition inline-flex items-center gap-1.5 ${
                active
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card text-muted-foreground border-border hover:border-foreground/20"
              }`}
            >
              {f.dot && <span className={`h-1.5 w-1.5 rounded-full ${f.dot}`} />}
              {f.label}
              {f.value === "unpaid" && unpaidCount > 0 && (
                <span className={`inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] font-bold rounded-full ${active ? "bg-background/25 text-background" : "bg-red-500 text-white"}`}>
                  {unpaidCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="sm:flex-1" />
      <form onSubmit={handleSearch} className="relative w-full sm:max-w-xs" role="search" aria-label="Søg bookinger">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Søg navn, booking nr., email…"
          aria-label="Søg efter bookinger"
          className="w-full h-10 pl-9 pr-8 text-sm rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        {search && (
          <button type="button" onClick={clearSearch} aria-label="Ryd søgning" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </form>
    </div>
  );
}
