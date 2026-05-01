import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const typeLabels: Record<string, string> = {
  CABIN: "Hytte",
  SEASONAL: "Fastligger",
  CARAVAN: "Campingvogn",
  PITCH: "Plads",
};

export function unitDisplayName(type: string, name: string): string {
  const label = typeLabels[type] || "";
  if (!label) return name;
  if (name.toLowerCase().startsWith(label.toLowerCase())) return name;
  return `${label} ${name}`;
}
