import { Zap } from "lucide-react";
import { SpotPriceChart } from "@/components/admin/spot-price-chart";
import { PageShell, PageHeader, Section } from "@/components/admin/admin-ui";

export const dynamic = "force-dynamic";

export default function ElpriserPage() {
  return (
    <PageShell width="5xl">
      <PageHeader
        title="Elpriser"
        icon={Zap}
        iconTint="bg-amber-500/10 text-amber-600"
        subtitle="Time-for-time spotpriser fra elprisenligenu.dk og dit samlede elforbrug"
      />
      <Section title="Spotpriser & forbrug">
        <SpotPriceChart />
      </Section>
    </PageShell>
  );
}
