import { notFound } from "next/navigation";
import { getShowerSessionState } from "@/lib/actions";
import { ShowerTimerClient } from "@/components/guest/shower-timer-client";

export const dynamic = "force-dynamic";

export default async function ShowerActivePage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { sessionId } = await params;
  const { token } = await searchParams;
  const id = parseInt(sessionId, 10);
  if (isNaN(id)) notFound();
  if (!token) notFound();

  const state = await getShowerSessionState(id, token);
  if (!state) notFound();

  return <ShowerTimerClient initial={state} />;
}
