import { requireAuth } from "@/lib/auth";
import { HelpContent } from "@/components/admin/help-content";
import { PageShell, PageHeader } from "@/components/admin/admin-ui";
import { HelpCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function HelpPage() {
  await requireAuth();
  return (
    <PageShell width="3xl">
      <PageHeader
        title="Hjælp & Guide"
        icon={HelpCircle}
        subtitle="Oversigt over CampSense-funktioner og hvordan du bruger systemet."
      />
      <HelpContent />
    </PageShell>
  );
}
