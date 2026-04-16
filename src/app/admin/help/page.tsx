import { requireAuth } from "@/lib/auth";
import { HelpContent } from "@/components/admin/help-content";

export const dynamic = "force-dynamic";

export default async function HelpPage() {
  await requireAuth();

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Hjælp & Guide</h1>
        <p className="text-muted-foreground mt-1">
          Oversigt over CampSense-funktioner og hvordan du bruger systemet.
        </p>
      </div>
      <HelpContent />
    </div>
  );
}
