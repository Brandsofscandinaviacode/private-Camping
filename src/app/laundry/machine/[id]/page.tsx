import { notFound } from "next/navigation";
import { getPublicLaundryMachine } from "@/lib/actions";
import { PublicLaundryMachineClient } from "@/components/guest/public-laundry-machine-client";

export const dynamic = "force-dynamic";

export default async function PublicLaundryMachinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const machineId = parseInt(id, 10);
  if (isNaN(machineId)) notFound();

  const machine = await getPublicLaundryMachine(machineId);
  if (!machine) notFound();

  return <PublicLaundryMachineClient machine={machine} />;
}
