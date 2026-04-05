import Link from "next/link";
import { LayoutDashboard, Settings, Tent, BookOpen, Zap } from "lucide-react";
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
      {/* Dark Sidebar */}
      <aside className="w-60 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col shrink-0">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <Link href="/admin" className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <Tent className="h-4 w-4 text-sidebar-primary-foreground" />
            </div>
            <span className="text-base font-semibold tracking-tight text-sidebar-accent-foreground">CampSense</span>
          </Link>
        </div>

        <nav className="flex-1 px-3 pt-5">
          <p className="px-3 mb-2 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
            Oversigt
          </p>
          <div className="space-y-0.5">
            <Link
              href="/admin"
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <LayoutDashboard className="h-[18px] w-[18px]" />
              Dashboard
            </Link>
            <Link
              href="/admin/bookings"
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <BookOpen className="h-[18px] w-[18px]" />
              Bookinger
              {unpaidCount > 0 && (
                <span className="ml-auto inline-flex items-center justify-center h-5 min-w-5 px-1.5 text-[10px] font-semibold rounded-full bg-red-500 text-white">
                  {unpaidCount}
                </span>
              )}
            </Link>
            <Link
              href="/admin/elpriser"
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <Zap className="h-[18px] w-[18px]" />
              Elpriser
            </Link>
          </div>

          <p className="px-3 mt-6 mb-2 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
            System
          </p>
          <div className="space-y-0.5">
            <Link
              href="/admin/settings"
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <Settings className="h-[18px] w-[18px]" />
              Indstillinger
            </Link>
          </div>
        </nav>

        <div className="px-4 py-4 border-t border-sidebar-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-medium text-sidebar-foreground">
                {session.username?.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm text-sidebar-foreground">
                {session.username}
              </span>
            </div>
            <LogoutButton />
          </div>
        </div>
      </aside>

      {/* Light Main Content */}
      <main className="flex-1 overflow-auto bg-background">
        {children}
      </main>
    </div>
  );
}
