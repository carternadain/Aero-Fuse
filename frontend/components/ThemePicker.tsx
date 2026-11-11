"use client";

import { useEffect, useState } from "react";
import { Check, Moon, Smartphone, Sun, type LucideIcon } from "lucide-react";
import { getThemePref, setThemePref, type ThemePref } from "@/lib/theme";
import { haptic } from "@/lib/bus";

const THEMES: { key: ThemePref; name: string; hint: string; icon: LucideIcon }[] = [
  { key: "dark", name: "Dark", hint: "Warm charcoal", icon: Moon },
  { key: "light", name: "Light", hint: "Warm paper, easier to read in daylight", icon: Sun },
  { key: "auto", name: "Match device", hint: "Follows your phone or computer", icon: Smartphone },
];

/** Appearance choice, as rows for a grouped Settings list (a radio group). */
export default function ThemePicker() {
  const [cur, setCur] = useState<ThemePref>("dark");
  useEffect(() => setCur(getThemePref()), []);

  const pick = (k: ThemePref) => {
    if (k === cur) return;
    haptic();
    setCur(k);
    setThemePref(k);
  };

  return (
    <div role="radiogroup" aria-label="Appearance" className="divide-y divide-edge">
      {THEMES.map((t) => {
        const on = cur === t.key;
        return (
          <button key={t.key} role="radio" aria-checked={on} onClick={() => pick(t.key)}
                  className="w-full flex items-center gap-3 px-4 min-h-12 text-left hover:bg-panel2/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan">
            <t.icon size={17} className="text-dim shrink-0" aria-hidden />
            <span className="flex-1 min-w-0 py-2">
              <span className="block text-[14px] text-txt">{t.name}</span>
              <span className="block text-[11.5px] text-dim">{t.hint}</span>
            </span>
            {on && <Check size={17} className="text-up shrink-0" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
