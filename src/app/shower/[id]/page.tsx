import { notFound } from "next/navigation";
import { getPublicShower } from "@/lib/actions";
import { ShowerBuyClient } from "@/components/guest/shower-buy-client";

export const dynamic = "force-dynamic";

export default async function ShowerBuyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  // From the guest portal: the stay's portal token, so the shower can be paid
  // from credit / balance / the bill instead of by card.
  const { token } = await searchParams;
  const showerId = parseInt(id, 10);
  if (isNaN(showerId)) notFound();

  const shower = await getPublicShower(showerId);
  if (!shower) notFound();

  return <ShowerBuyClient shower={shower} guestToken={token ?? null} />;
}
