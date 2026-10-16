import { CalendarCheck, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell, PageHeader } from "@/components/admin/admin-ui";
import { BookingSyncStatus } from "@/components/admin/booking-sync-status";
import { CheckInReceiptHost } from "@/components/admin/check-in-receipt";
import { TodayBoard } from "@/components/admin/today-board";
import { getGlobalSettings } from "@/lib/actions";
import { getTodayOverview } from "@/lib/today-actions";
import { getBaseUrl, isPlaceholderBaseUrl } from "@/lib/base-url";
import { fmtDateWith } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const [overview, settings] = await Promise.all([getTodayOverview(), getGlobalSettings()]);
  const notify = {
    email: settings.notifications_email_enabled === "true",
    sms: settings.notifications_sms_enabled === "true",
  };
  const siteBase = getBaseUrl(settings);
  const siteUrl = isPlaceholderBaseUrl(siteBase) ? "" : siteBase;
  const date = fmtDateWith(overview.generatedAt, { weekday: "long", day: "numeric", month: "long" });

  return (
    <PageShell width="5xl">
      {/* Receipt of a check-in started from a row (the row itself moves on) */}
      <CheckInReceiptHost siteUrl={siteUrl} />
      <PageHeader
        title="I dag"
        icon={CalendarCheck}
        subtitle={
          <>
            {date.charAt(0).toUpperCase() + date.slice(1)} · <b className="text-foreground font-semibold">{overview.arrivals.length}</b> ankomster ·{" "}
            <b className="text-foreground font-semibold">{overview.departures.length}</b> afrejser
          </>
        }
      >
        <a href="/admin/today/print?print=1" target="_blank" rel="noopener">
          <Button variant="outline" size="sm">
            <Printer className="h-4 w-4 mr-2" />
            Udskriv dagsliste
          </Button>
        </a>
      </PageHeader>
      <BookingSyncStatus className="-mt-3" />

      <TodayBoard overview={overview} notify={notify} />
    </PageShell>
  );
}
