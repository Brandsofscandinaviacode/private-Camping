import { notFound } from "next/navigation";
import { getPublicShower } from "@/lib/actions";
import { ShowerBuyClient } from "@/components/guest/shower-buy-client";

export const dynamic = "force-dynamic";

export default async function ShowerBuyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const showerId = parseInt(id, 10);
  if (isNaN(showerId)) notFound();

  const shower = await getPublicShower(showerId);
  if (!shower) notFound();

  return <ShowerBuyClient shower={shower} />;
}
