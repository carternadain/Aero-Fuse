"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

const PALETTES = [
  { key: "calm", name: "Calm", hint: "Blue up, soft orange down" },
  { key: "classic", name: "Classic", hint: "Green up, red down" },
  { key: "mono", name: "Mono", hint: "No color, just ▲▼ and +/−" },
] as const;

type Key = (typeof PALETTES)[number]["key"];

/** Gain/loss color choice, as rows for a grouped Settings list (a radio group). */
export default function PalettePicker() {
  const [cur, setCur] = useState<Key>("calm");
  useEffect(() => setCur((document.documentElement.dataset.palette as Key) || "calm"), []);

  const pick = (k: Key) => {
    setCur(k);
    if (k === "calm") delete document.documentElement.dataset.palette;
    else document.documentElement.dataset.palette = k;
    try { localStorage.setItem("palette", k); } catch { /* private mode */ }
  };

  return (
    <div role="radiogroup" aria-label="Gain and loss colors" className="divide-y divide-edge">
      {PALETTES.map((p) => {
        const on = cur === p.key;
        return (
          <button key={p.key} role="radio" aria-checked={on} onClick={() => pick(p.key)}
                  className="w-full flex items-center gap-3 px-4 min-h-12 text-left hover:bg-panel2/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan">
            <span className="flex shrink-0" aria-hidden>
              <span className={`w-3.5 h-3.5 rounded-full swatch-${p.key}-up`} />
              <span className={`w-3.5 h-3.5 rounded-full -ml-1 ring-2 ring-panel swatch-${p.key}-down`} />
            </span>
            <span className="flex-1 min-w-0 py-2">
              <span className="block text-[14px] text-txt">{p.name}</span>
              <span className="block text-[11.5px] text-dim">{p.hint}</span>
            </span>
            {on && <Check size={17} className="text-up shrink-0" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
