"use client";

import { useState } from "react";
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
  Menu,
  X,
  Tent,
} from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";

const navItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, section: "Oversigt" },
  { href: "/admin/bookings", label: "Bookinger", icon: BookOpen, section: "Oversigt", badge: true },
  { href: "/admin/elpriser", label: "Elpriser", icon: Zap, section: "Oversigt" },
  { href: "/admin/services", label: "Services", icon: WashingMachine, section: "Oversigt" },
  { href: "/admin/economy", label: "Økonomi", icon: Wallet, section: "System" },
  { href: "/admin/settings", label: "Indstillinger", icon: Settings, section: "System" },
  { href: "/admin/help", label: "Hjælp", icon: HelpCircle, section: "System" },
];

interface MobileSidebarProps {
  username: string;
  unpaidCount: number;
}

export function MobileSidebar({ username, unpaidCount }: MobileSidebarProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
        <Link href="/admin" className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-sidebar-primary to-sidebar-primary/80 flex items-center justify-center">
            <Tent className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-base font-bold text-sidebar-accent-foreground">CampSense</span>
        </Link>
        <button onClick={() => setOpen(true)} className="p-2 rounded-lg hover:bg-sidebar-accent transition-colors">
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Overlay */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-sidebar text-sidebar-foreground flex flex-col animate-in slide-in-from-left duration-200">
            <div className="px-5 py-4 border-b border-sidebar-border flex items-center justify-between">
              <span className="text-base font-semibold text-sidebar-accent-foreground">CampSense</span>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-sidebar-accent">
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 px-3 pt-4 overflow-y-auto">
              {["Oversigt", "System"].map((section) => (
                <div key={section}>
                  <p className="px-3 mb-2 mt-4 first:mt-0 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
                    {section}
                  </p>
                  <div className="space-y-0.5">
                    {navItems
                      .filter((item) => item.section === section)
                      .map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setOpen(false)}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                              isActive
                                ? "bg-sidebar-primary text-white font-medium shadow-md shadow-sidebar-primary/20"
                                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            }`}
                          >
                            <Icon className="h-[18px] w-[18px]" />
                            {item.label}
                            {item.badge && unpaidCount > 0 && (
                              <span className="ml-auto inline-flex items-center justify-center h-5 min-w-5 px-1.5 text-[10px] font-semibold rounded-full bg-red-500 text-white">
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

            <div className="px-4 py-4 border-t border-sidebar-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-sidebar-primary/80 to-sidebar-primary flex items-center justify-center text-xs font-bold text-white">
                    {username?.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm text-sidebar-foreground">{username}</span>
                </div>
                <LogoutButton />
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
