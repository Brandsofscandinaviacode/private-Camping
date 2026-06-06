import { requireAuth } from "@/lib/auth";
import { getMapUnits, getGlobalSettings } from "@/lib/actions";
import { SiteMapEditor } from "@/components/admin/site-map-editor";
import { PageShell, PageHeader } from "@/components/admin/admin-ui";
import { Map } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  await requireAuth();
  const [units, settings] = await Promise.all([getMapUnits(), getGlobalSettings()]);
  const siteMapUrl = settings.site_map_url || null;

  return (
    <PageShell width="7xl">
      <PageHeader
        title="Pladskort"
        icon={Map}
        iconTint="bg-blue-500/10 text-blue-600"
        subtitle="Overblik over alle enheder med live status."
      />
      <SiteMapEditor units={units} siteMapUrl={siteMapUrl} />
    </PageShell>
  );
}
