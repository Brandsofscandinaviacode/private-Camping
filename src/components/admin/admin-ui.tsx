import Link from "next/link";
import type { LucideIcon } from "lucide-react";

/**
 * Shared admin UI kit — codifies the redesigned dashboard ("front page") style
 * so every admin screen reads as one product.
 *
 * Design rules baked in here:
 *  • Brand orange (`--primary`) = brand + primary actions ONLY. Never a status.
 *  • Status palette: blue = aktiv/optaget · amber = reserveret · emerald = betalt/ledig
 *    · red = problem/ubetalt.
 *  • Surfaces: rounded-2xl, border-border/60, bg-card, shadow-sm. Calm + roomy.
 *  • Every page opens with <PageHeader>.
 *
 * All components are presentational (no "use client") so they work in server components.
 */

// ──────────────────────────────────────────────
// Page header — consistent top of every admin page
// ──────────────────────────────────────────────
export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  iconTint = "bg-primary/10 text-primary",
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  icon?: LucideIcon;
  iconTint?: string;
  children?: React.ReactNode; // right-aligned actions
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <span className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${iconTint}`}>
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}

// ──────────────────────────────────────────────
// Card surface + section with header
// ──────────────────────────────────────────────
export function Surface({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`rounded-2xl border border-border/60 bg-card shadow-sm ${className}`}>{children}</div>;
}

export function Section({
  title,
  icon: Icon,
  actions,
  children,
  bodyClassName = "p-5",
}: {
  title?: React.ReactNode;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <Surface>
      {title && (
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
          <h2 className="font-semibold flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
            {title}
          </h2>
          {actions}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </Surface>
  );
}

// ──────────────────────────────────────────────
// KPI card + grid — matches the dashboard attention zone
// ──────────────────────────────────────────────
const KPI_TINTS = {
  primary: "bg-primary/10 text-primary",
  blue: "bg-blue-500/10 text-blue-600",
  amber: "bg-amber-500/10 text-amber-600",
  emerald: "bg-emerald-500/10 text-emerald-600",
  red: "bg-red-500/10 text-red-600",
  violet: "bg-violet-500/10 text-violet-600",
} as const;
export type KpiTint = keyof typeof KPI_TINTS;

export function Kpi({
  label,
  icon: Icon,
  tint = "primary",
  value,
  unit,
  meta,
  valueClass = "",
}: {
  label: string;
  icon: LucideIcon;
  tint?: KpiTint;
  value: React.ReactNode;
  unit?: string;
  meta?: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <Surface className="p-5">
      <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <span className={`h-7 w-7 rounded-lg flex items-center justify-center ${KPI_TINTS[tint]}`}>
          <Icon className="h-[15px] w-[15px]" />
        </span>
        {label}
      </div>
      <p className={`text-[28px] font-bold tracking-tight tabular-nums mt-3 leading-none ${valueClass}`}>
        {value}
        {unit && <span className="text-sm font-medium text-muted-foreground ml-1">{unit}</span>}
      </p>
      {meta && <p className="text-[12.5px] text-muted-foreground mt-2.5">{meta}</p>}
    </Surface>
  );
}

export function KpiGrid({ cols = 4, children }: { cols?: 3 | 4 | 5; children: React.ReactNode }) {
  const map = { 3: "xl:grid-cols-3", 4: "xl:grid-cols-4", 5: "lg:grid-cols-5" } as const;
  return <div className={`grid gap-4 grid-cols-1 sm:grid-cols-2 ${map[cols]}`}>{children}</div>;
}

// ──────────────────────────────────────────────
// Alert banner — consolidated, actionable
// ──────────────────────────────────────────────
const ALERT_STYLES = {
  red: { wrap: "border-red-200/80 bg-red-50/80 hover:bg-red-100/80", icon: "bg-red-100 text-red-500", text: "text-red-700", action: "text-red-600 border-red-200" },
  amber: { wrap: "border-amber-200/80 bg-amber-50/80 hover:bg-amber-100/80", icon: "bg-amber-100 text-amber-600", text: "text-amber-800", action: "text-amber-700 border-amber-300" },
  blue: { wrap: "border-blue-200/80 bg-blue-50/80 hover:bg-blue-100/80", icon: "bg-blue-100 text-blue-600", text: "text-blue-800", action: "text-blue-700 border-blue-300" },
} as const;

export function AlertBanner({
  tone = "amber",
  icon: Icon,
  children,
  actionLabel,
  href,
}: {
  tone?: keyof typeof ALERT_STYLES;
  icon: LucideIcon;
  children: React.ReactNode;
  actionLabel?: string;
  href?: string;
}) {
  const s = ALERT_STYLES[tone];
  const inner = (
    <div className={`flex items-center gap-3.5 rounded-xl border px-4 py-3 transition-all ${s.wrap} ${href ? "cursor-pointer" : ""}`}>
      <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${s.icon}`}>
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <p className={`text-sm flex-1 ${s.text}`}>{children}</p>
      {actionLabel && <span className={`text-xs font-semibold border rounded-lg px-3 py-1.5 whitespace-nowrap ${s.action}`}>{actionLabel}</span>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

// ──────────────────────────────────────────────
// Status badge — single source of truth for status colours
// ──────────────────────────────────────────────
const BADGE_STYLES = {
  blue: "bg-blue-500/10 text-blue-600",
  amber: "bg-amber-500/10 text-amber-600",
  emerald: "bg-emerald-500/10 text-emerald-600",
  red: "bg-red-500/10 text-red-600",
  muted: "bg-muted text-muted-foreground",
} as const;
const DOT_STYLES = {
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  red: "bg-red-500",
  muted: "bg-muted-foreground/40",
} as const;
export type BadgeTone = keyof typeof BADGE_STYLES;

export function StatusBadge({ tone, children, pulse = false }: { tone: BadgeTone; children: React.ReactNode; pulse?: boolean }) {
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-medium inline-flex items-center gap-1.5 ${BADGE_STYLES[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_STYLES[tone]} ${pulse ? "animate-pulse" : ""}`} />
      {children}
    </span>
  );
}

// Booking status → tone + label (shared by bookings list, economy, booking detail)
export function bookingTone(status: string, paymentStatus?: string): { tone: BadgeTone; label: string; pulse?: boolean } {
  if (status === "PENDING") return { tone: "amber", label: "Reserveret" };
  if (status === "ACTIVE") return { tone: "blue", label: "Aktiv", pulse: true };
  if (status === "COMPLETED" && paymentStatus === "UNPAID") return { tone: "red", label: "Ubetalt" };
  if (paymentStatus === "PAID") return { tone: "emerald", label: "Betalt" };
  return { tone: "muted", label: "" };
}

// ──────────────────────────────────────────────
// Empty state
// ──────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
      <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
        <Icon className="h-7 w-7 opacity-60" />
      </div>
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm">{hint}</p>}
    </div>
  );
}

// ──────────────────────────────────────────────
// Page wrapper — consistent padding + max width
// ──────────────────────────────────────────────
export function PageShell({ width = "5xl", children }: { width?: "3xl" | "4xl" | "5xl" | "7xl"; children: React.ReactNode }) {
  const map = { "3xl": "max-w-3xl", "4xl": "max-w-4xl", "5xl": "max-w-5xl", "7xl": "max-w-7xl" } as const;
  return <div className={`p-4 sm:p-6 lg:p-10 space-y-6 ${map[width]}`}>{children}</div>;
}
