import { getPublicServices } from "@/lib/actions";
import { ServicesOverviewClient } from "@/components/guest/services-overview-client";

export const dynamic = "force-dynamic";

export default async function PublicServicesPage() {
  const services = await getPublicServices();
  return <ServicesOverviewClient services={services} />;
}
