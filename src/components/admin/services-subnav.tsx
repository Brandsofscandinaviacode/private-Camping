"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, WashingMachine, Wind, Droplets } from "lucide-react";

const tabs = [
  { href: "/admin/services", label: "Oversigt", icon: LayoutDashboard, exact: true },
  { href: "/admin/services/showers", label: "Bade", icon: Droplets },
  { href: "/admin/services/washers", label: "Vaskemaskiner", icon: WashingMachine },
  { href: "/admin/services/dryers", label: "Tørretumblere", icon: Wind },
];

export function ServicesSubnav() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 border-b border-border overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
