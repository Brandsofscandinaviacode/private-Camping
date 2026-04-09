import { notFound } from "next/navigation";
import { getPublicLaundryGroup } from "@/lib/actions";
import { PublicLaundryClient } from "@/components/guest/public-laundry-client";

export const dynamic = "force-dynamic";

export default async function PublicLaundryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const group = await getPublicLaundryGroup(token);
  if (!group) notFound();

  return <PublicLaundryClient token={token} groupName={group.name} machines={group.machines} />;
}
