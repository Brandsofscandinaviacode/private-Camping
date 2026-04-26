import { notFound } from "next/navigation";
import { getShowerSessionState } from "@/lib/actions";
import { ShowerTimerClient } from "@/components/guest/shower-timer-client";

export const dynamic = "force-dynamic";

export default async function ShowerActivePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const id = parseInt(sessionId, 10);
  if (isNaN(id)) notFound();

  // Authorization is enforced inside getShowerSessionState via the
  // per-session httpOnly cookie set when the session was created.
  // Without the cookie this returns null (indistinguishable from a
  // missing session, so the URL alone leaks no information).
  const state = await getShowerSessionState(id);
  if (!state) notFound();

  return <ShowerTimerClient initial={state} />;
}
