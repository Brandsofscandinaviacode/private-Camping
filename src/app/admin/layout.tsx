import Link from "next/link";
import { LayoutDashboard, Settings, Tent } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { LogoutButton } from "@/components/auth/logout-button";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAuth();

  return (
    <div className="flex h-full min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card flex flex-col shrink-0">
        <div className="p-6 border-b">
          <Link href="/admin" className="flex items-center gap-2">
            <Tent className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold">CampFlow</span>
          </Link>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          <Link
            href="/admin"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium hover:bg-accent transition-colors"
          >
            <LayoutDashboard className="h-4 w-4" />
            Oversigt
          </Link>
          <Link
            href="/admin/settings"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium hover:bg-accent transition-colors"
          >
            <Settings className="h-4 w-4" />
            Indstillinger
          </Link>
        </nav>
        <div className="p-4 border-t space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {session.username}
            </span>
            <LogoutButton />
          </div>
          <p className="text-xs text-muted-foreground">
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
