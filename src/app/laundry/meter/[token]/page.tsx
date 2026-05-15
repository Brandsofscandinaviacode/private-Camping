import { notFound } from "next/navigation";
import { getMeteredLaundryStatus } from "@/lib/actions";
import { MeteredLaundryClient } from "@/components/guest/metered-laundry-client";

export const dynamic = "force-dynamic";

export default async function MeteredLaundryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const status = await getMeteredLaundryStatus(token);
  if (!status) notFound();

  return <MeteredLaundryClient accessToken={token} initial={status} />;
}
