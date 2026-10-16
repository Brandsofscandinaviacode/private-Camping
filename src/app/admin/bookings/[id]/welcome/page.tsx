import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import DOMPurify from "isomorphic-dompurify";
import { Button } from "@/components/ui/button";
import { getGlobalSettings, getSessionById } from "@/lib/actions";
import { getBaseUrl, isPlaceholderBaseUrl } from "@/lib/base-url";
import { formatBookingRef } from "@/lib/check-in";
import { fmtDate } from "@/lib/format";
import { unitDisplayName } from "@/lib/utils";
import { PrintButton } from "@/components/admin/print-button";
import { WelcomeSlipQr } from "@/components/admin/guest-portal-handover";

export const dynamic = "force-dynamic";

// Only the slip is printed — the admin sidebar and toolbar are hidden.
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #welcome-slip, #welcome-slip * { visibility: visible !important; }
  #welcome-slip { position: absolute; left: 0; top: 0; width: 100%; }
}`;

export default async function WelcomeSlipPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const { id } = await params;
  const { print } = await searchParams;
  const sessionId = parseInt(id, 10);
  if (isNaN(sessionId)) notFound();

  const [session, settings] = await Promise.all([getSessionById(sessionId), getGlobalSettings()]);
  if (!session) notFound();

  const siteBase = getBaseUrl(settings);
  const siteUrl = isPlaceholderBaseUrl(siteBase) ? "" : siteBase;
  // Same practical info as the guest portal shows for this unit type.
  const typeKey = session.unit.type.toLowerCase();
  const info = settings[`practical_info_${typeKey}_da`] || settings[`practical_info_${typeKey}`] || "";
  const infoHtml = info
    ? DOMPurify.sanitize(info, {
        ALLOWED_TAGS: ["p", "br", "strong", "em", "b", "i", "a", "ul", "ol", "li", "h3", "h4", "span"],
        ALLOWED_ATTR: ["href"],
      })
    : "";
  const bookingRef = formatBookingRef(session.bookingRef);

  return (
    <div className="p-4 sm:p-6 lg:p-10">
      <style>{PRINT_CSS}</style>
      <div className="max-w-xl mx-auto mb-6 flex items-center justify-between print:hidden">
        <Link href={`/admin/bookings/${session.id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Tilbage til booking
          </Button>
        </Link>
        <PrintButton />
      </div>

      <div
        id="welcome-slip"
        className="max-w-xl mx-auto bg-white text-black rounded-xl border border-border/60 shadow-sm p-8 space-y-6 print:shadow-none print:border-0 print:p-0"
      >
        <div className="text-center">
          <p className="text-xs uppercase tracking-wide text-gray-500">Velkommen · Welcome · Willkommen</p>
          <h1 className="text-3xl font-bold mt-1">{session.guestName}</h1>
          <p className="text-xl mt-2">{unitDisplayName(session.unit.type, session.unit.name)}</p>
          <p className="text-sm text-gray-600 mt-1">
            {fmtDate(session.checkInTime)} – {session.expectedCheckOut ? fmtDate(session.expectedCheckOut) : "åbent ophold"}
          </p>
        </div>

        <div className="space-y-3">
          <WelcomeSlipQr
            portalPath={`/guest/${session.guestPortalToken}`}
            siteUrl={siteUrl}
            autoPrint={print === "1"}
          />
          <p className="text-sm text-center">
            Scan koden for at åbne din gæsteportal: forbrug, vask og bad og praktisk information.
          </p>
          <p className="text-xs text-center text-gray-500">
            Scan the code for your guest portal · Scannen Sie den Code für Ihr Gästeportal
          </p>
        </div>

        {infoHtml && (
          <div className="border-t border-gray-300 pt-4">
            <h2 className="font-semibold mb-1">Praktisk information</h2>
            <div
              className="text-sm leading-relaxed [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h3]:font-semibold [&_h4]:font-medium [&_p]:my-1"
              dangerouslySetInnerHTML={{ __html: infoHtml }}
            />
          </div>
        )}

        {bookingRef && <p className="text-xs text-center text-gray-500">Booking {bookingRef}</p>}
      </div>
    </div>
  );
}
