import { requireAuth } from "@/lib/auth";
import { getMapUnits, getGlobalSettings } from "@/lib/actions";
import { SiteMapEditor } from "@/components/admin/site-map-editor";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  await requireAuth();
  const [units, settings] = await Promise.all([
    getMapUnits(),
    getGlobalSettings(),
  ]);

  const siteMapUrl = settings.site_map_url || null;

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pladskort</h1>
        <p className="text-muted-foreground mt-1">
          Overblik over alle enheder med live status.
        </p>
      </div>
      <SiteMapEditor units={units} siteMapUrl={siteMapUrl} />
    </div>
  );
}
