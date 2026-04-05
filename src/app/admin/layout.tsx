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
      <aside className="w-56 bg-sidebar border-r border-sidebar-border flex flex-col shrink-0">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <Link href="/admin" className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center">
              <Tent className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <div>
              <span className="text-sm font-semibold tracking-tight">CampFlow</span>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-3 pt-5">
          <p className="px-3 mb-2 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
            Oversigt
          </p>
          <div className="space-y-0.5">
            <Link
              href="/admin"
              className="flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </Link>
            <Link
              href="/admin/bookings"
              className="flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <BookOpen className="h-4 w-4" />
              Bookinger
              {unpaidCount > 0 && (
                <span className="ml-auto inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 text-[10px] font-semibold rounded-full bg-destructive/80 text-white">
                  {unpaidCount}
                </span>
              )}
            </Link>
          </div>

          <p className="px-3 mt-6 mb-2 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
            System
          </p>
          <div className="space-y-0.5">
            <Link
              href="/admin/settings"
              className="flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <Settings className="h-4 w-4" />
              Indstillinger
            </Link>
          </div>
        </nav>

        <div className="px-4 py-4 border-t border-sidebar-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-full bg-sidebar-accent flex items-center justify-center text-[11px] font-medium text-sidebar-foreground/70">
                {session.username?.charAt(0).toUpperCase()}
              </div>
              <span className="text-[13px] text-sidebar-foreground/70">
                {session.username}
              </span>
            </div>
            <LogoutButton />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-background">
        {children}
      </main>
    </div>
  );
}
