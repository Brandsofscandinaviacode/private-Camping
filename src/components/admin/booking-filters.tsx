"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { bookingListUrl } from "@/lib/booking-list";

interface BookingFiltersProps {
  activeFilter: string;
  unpaidCount: number;
  arrivedCount?: number;
  overdueCount?: number;
  /** Plain counts shown on the chips (not attention badges). */
  counts?: { active: number; pending: number; expired: number };
  searchQuery: string;
}

const filters = [
  { value: "all", label: "Alle" },
  { value: "active", label: "Tjekket ind", dot: "bg-blue-500" },
  { value: "pending", label: "Reserveret", dot: "bg-amber-500" },
  { value: "arrived", label: "Ankommet, ikke tjekket ind", dot: "bg-amber-500" },
  { value: "overdue", label: "Overskredet", dot: "bg-red-500" },
  { value: "unpaid", label: "Ubetalt", dot: "bg-red-500" },
  { value: "paid", label: "Betalt", dot: "bg-emerald-500" },
  { value: "expired", label: "Udløbne", dot: "bg-muted-foreground/40" },
];

function buildUrl(filter: string, search: string): string {
  return bookingListUrl({ filter, q: search });
}

export function BookingFilters({ activeFilter, unpaidCount, arrivedCount = 0, overdueCount = 0, counts, searchQuery }: BookingFiltersProps) {
  const router = useRouter();
  const [search, setSearch] = useState(searchQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" jumps to the search box from anywhere on the page
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
              {(() => {
                const count = f.value === "unpaid" ? unpaidCount : f.value === "arrived" ? arrivedCount : f.value === "overdue" ? overdueCount : 0;
                if (count <= 0) return null;
                const badge = f.value === "arrived" ? "bg-amber-500 text-white" : "bg-red-500 text-white";
                return (
                  <span className={`inline-flex items-center justify-center h-4 min-w-4 px-1 text-[10px] font-bold rounded-full ${active ? "bg-background/25 text-background" : badge}`}>
                    {count}
                  </span>
                );
              })()}
              {counts && (f.value === "active" || f.value === "pending" || f.value === "expired") && (
                <span className={`tabular-nums ${active ? "opacity-70" : "opacity-60"}`}>({counts[f.value]})</span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="sm:flex-1" />
      <form onSubmit={handleSearch} className="relative w-full sm:max-w-xs" role="search" aria-label="Søg bookinger">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Søg plads, navn, booking nr., telefon…"
          aria-label="Søg efter bookinger"
          aria-keyshortcuts="/"
          className="w-full h-10 pl-9 pr-8 text-sm rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        {search ? (
          <button type="button" onClick={clearSearch} aria-label="Ryd søgning" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <kbd className="hidden sm:inline-flex absolute right-2 top-1/2 -translate-y-1/2 h-5 items-center rounded border border-border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground pointer-events-none" aria-hidden="true">/</kbd>
        )}
      </form>
    </div>
  );
}
