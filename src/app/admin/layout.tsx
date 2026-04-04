import Link from "next/link";
import { LayoutDashboard, Settings, Tent, BookOpen } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { LogoutButton } from "@/components/auth/logout-button";
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
    <div className="flex h-full min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col shrink-0">
        <div className="p-6 border-b border-sidebar-border">
          <Link href="/admin" className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Tent className="h-4 w-4 text-primary" />
            </div>
            <span className="text-lg font-bold tracking-tight">CampFlow</span>
          </Link>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <Link
            href="/admin"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <LayoutDashboard className="h-4 w-4" />
            Oversigt
          </Link>
          <Link
            href="/admin/bookings"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <BookOpen className="h-4 w-4" />
            Bookinger
            {unpaidCount > 0 && (
              <span className="ml-auto inline-flex items-center justify-center h-5 min-w-5 px-1.5 text-[10px] font-bold rounded-full bg-destructive text-destructive-foreground">
                {unpaidCount}
              </span>
            )}
          </Link>
          <Link
            href="/admin/settings"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <Settings className="h-4 w-4" />
            Indstillinger
          </Link>
        </nav>
        <div className="p-4 border-t border-sidebar-border space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-sidebar-foreground/70">
              {session.username}
            </span>
            <LogoutButton />
          </div>
          <p className="text-[11px] text-sidebar-foreground/40">
            CampFlow v1.0
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
