"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Settings,
  BookOpen,
  Zap,
  Wallet,
  WashingMachine,
  HelpCircle,
} from "lucide-react";

const navItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, section: "Oversigt", exact: true },
  { href: "/admin/bookings", label: "Bookinger", icon: BookOpen, section: "Oversigt", badge: true },
  { href: "/admin/elpriser", label: "Elpriser", icon: Zap, section: "Oversigt" },
  { href: "/admin/services", label: "Services", icon: WashingMachine, section: "Oversigt" },
  { href: "/admin/economy", label: "Økonomi", icon: Wallet, section: "System" },
  { href: "/admin/settings", label: "Indstillinger", icon: Settings, section: "System" },
  { href: "/admin/help", label: "Hjælp", icon: HelpCircle, section: "System" },
];

interface SidebarNavProps {
  unpaidCount: number;
}

export function SidebarNav({ unpaidCount }: SidebarNavProps) {
  const pathname = usePathname();

  function isActive(item: typeof navItems[0]) {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(item.href + "/");
  }

  return (
    <nav className="flex-1 px-3 pt-5">
      {(["Oversigt", "System"] as const).map((section) => (
        <div key={section}>
          <p className="px-3 mb-2 mt-4 first:mt-0 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/30">
            {section}
          </p>
          <div className="space-y-1">
            {navItems
              .filter((item) => item.section === section)
              .map((item) => {
                const Icon = item.icon;
                const active = isActive(item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                      active
                        ? "bg-sidebar-primary text-white font-medium shadow-md shadow-sidebar-primary/20"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                    {item.label}
                    {item.badge && unpaidCount > 0 && (
                      <span className={`ml-auto inline-flex items-center justify-center h-5 min-w-5 px-1.5 text-[10px] font-bold rounded-full ${
                        active ? "bg-white/20 text-white" : "bg-red-500 text-white"
                      }`}>
                        {unpaidCount}
                      </span>
                    )}
                  </Link>
                );
              })}
          </div>
        </div>
      ))}
    </nav>
  );
}
