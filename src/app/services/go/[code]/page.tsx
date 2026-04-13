import { redirect, notFound } from "next/navigation";
import { resolveServiceCode } from "@/lib/actions";

export const dynamic = "force-dynamic";

// Convenience redirect: /services/go/1001 → /shower/1, /services/go/2001 → /laundry/<group-token>
export default async function ServiceCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const resolved = await resolveServiceCode(code);
  if (!resolved) notFound();

  if (resolved.type === "shower") redirect(`/shower/${resolved.id}`);
  // Washer/dryer share the laundry group token flow
  if (resolved.groupToken) redirect(`/laundry/${resolved.groupToken}`);
  notFound();
}
