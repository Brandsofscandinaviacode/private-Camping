import Link from "next/link";
import { Tent } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { LogoutButton } from "@/components/auth/logout-button";
import { MobileSidebar } from "@/components/admin/mobile-sidebar";
import { SidebarNav } from "@/components/admin/sidebar-nav";
import { AdminThemeProvider } from "@/components/admin/theme-provider";
import { ThemeToggle } from "@/components/admin/theme-toggle";
import { getUnpaidCount } from "@/lib/actions";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, unpaidCount] = await Promise.all([
    requireAuth(),
    getUnpaidCount(),
  ]);

  return (
    <AdminThemeProvider>
    <div className="flex flex-col md:flex-row h-full min-h-screen">
      {/* Mobile top bar + drawer */}
      <MobileSidebar username={session.username || "admin"} unpaidCount={unpaidCount} />

      {/* Desktop Sidebar — hidden on mobile */}
      <aside className="hidden md:flex w-60 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex-col shrink-0">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <Link href="/admin" className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sidebar-primary to-sidebar-primary/80 flex items-center justify-center shadow-md shadow-sidebar-primary/20">
              <Tent className="h-4.5 w-4.5 text-sidebar-primary-foreground" />
            </div>
            <span className="text-base font-bold tracking-tight text-sidebar-accent-foreground">CampSense</span>
          </Link>
        </div>

        <SidebarNav unpaidCount={unpaidCount} />

        <div className="px-4 py-4 border-t border-sidebar-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-sidebar-primary/80 to-sidebar-primary flex items-center justify-center text-xs font-bold text-white">
                {session.username?.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm text-sidebar-foreground">
                {session.username}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <LogoutButton />
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-background">
        {children}
      </main>
    </div>
    </AdminThemeProvider>
  );
}
