"use client";

import { type Locale, ALL_LOCALES, localeLabels, persistLocale } from "@/lib/guest-translations";

export function LanguagePicker({ locale, onChange }: { locale: Locale; onChange: (l: Locale) => void }) {
  return (
    <div className="flex items-center justify-center gap-1 py-2">
      {ALL_LOCALES.map((l) => (
        <button
          key={l}
          onClick={() => { persistLocale(l); onChange(l); }}
          className={`px-2.5 py-1 rounded-full transition-all text-xs font-medium ${
            locale === l ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {localeLabels[l]}
        </button>
      ))}
    </div>
  );
}
