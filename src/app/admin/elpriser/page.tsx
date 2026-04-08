import { Zap } from "lucide-react";
import { SpotPriceChart } from "@/components/admin/spot-price-chart";

export const dynamic = "force-dynamic";

export default function ElpriserPage() {
  return (
    <div className="p-4 sm:p-6 lg:p-10 space-y-6 max-w-5xl">
      <div>
        <div className="flex items-center gap-2.5">
          <Zap className="h-6 w-6 text-yellow-500" />
          <h1 className="text-2xl font-bold tracking-tight">Elpriser</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Time-for-time spotpriser fra Energi Data Service og dit samlede elforbrug
        </p>
      </div>

      <div className="rounded-xl border border-border/60 bg-card shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Spotpriser & forbrug</h2>
        </div>
        <div className="p-5">
          <SpotPriceChart />
        </div>
      </div>
    </div>
  );
}
