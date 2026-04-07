"use client";

import { useState } from "react";
import { Settings, Wifi, Bell, MapPin, Activity, CreditCard, Users } from "lucide-react";

const tabs = [
  { id: "general", label: "Generelt", icon: Settings },
  { id: "ha", label: "Home Assistant", icon: Wifi },
  { id: "notifications", label: "Notifikationer", icon: Bell },
  { id: "payment", label: "Betaling", icon: CreditCard },
  { id: "guest", label: "Gæsteportal", icon: Users },
  { id: "hardware", label: "Pladser", icon: MapPin },
  { id: "system", label: "System", icon: Activity },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function SettingsTabs({ children }: { children: Record<string, React.ReactNode> }) {
  const [activeTab, setActiveTab] = useState<TabId>("general");

  return (
    <div>
      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>{children[activeTab]}</div>
    </div>
  );
}
