"use client";

// Grouped panels: one visible at a time behind a small switcher (all stay mounted).
// With `grid`, desktop shows every pane side by side and the switcher is phone/tablet only.

import { useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/bus";
import { getLastRevealed, isShown, usePrefs } from "@/lib/prefs";

export interface Pane { id: string; label: string; pro?: boolean; span?: string; node: React.ReactNode }

export default function Panes({ items, grid, label }: { items: Pane[]; grid?: boolean; label?: string }) {
  const p = usePrefs();
  const vis = items.filter((i) => isShown(i.id, !!i.pro, p));
  const ids = vis.map((i) => i.id);
  const [active, setActive] = useState<string>(() => {
    const l = getLastRevealed();
    return l && ids.includes(l) ? l : ids[0];
  });
  const handled = useRef<string | null>(getLastRevealed());

  // a link/search reveal jumps to that pane once; manual tab clicks aren't overridden
  useEffect(() => {
    const l = getLastRevealed();
    if (l && l !== handled.current && ids.includes(l)) { handled.current = l; setActive(l); }
    else if (!ids.includes(active) && ids.length) setActive(ids[0]);
  });

  if (!vis.length) return null;
  const cur = ids.includes(active) ? active : ids[0];

  if (vis.length === 1) return <div id={vis[0].id} className="scroll-mt-28">{vis[0].node}</div>;

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label={label} data-noswipe
           className={`flex p-1 rounded-xl border border-edge bg-panel overflow-x-auto max-w-full w-fit sm:max-w-xl ${grid ? "lg:hidden" : ""}`}>
        {vis.map((i) => (
          <button key={i.id} role="tab" aria-selected={cur === i.id}
                  onClick={() => { if (cur !== i.id) haptic(); setActive(i.id); }}
                  className={`flex-1 whitespace-nowrap min-h-10 px-3 py-2 rounded-lg text-[12px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-cyan ${
                    cur === i.id ? "bg-panel2 text-up shadow-sm" : "text-dim hover:text-txt"
                  }`}>
            {i.label}
          </button>
        ))}
      </div>
      <div className={grid ? "grid grid-cols-1 lg:grid-cols-12 gap-3 items-start" : ""}>
        {vis.map((i) => (
          <div key={i.id} id={i.id}
               className={`scroll-mt-28 ${cur === i.id ? "" : "hidden"}${grid ? ` lg:block ${i.span ?? "lg:col-span-12"}` : ""}`}>
            {i.node}
          </div>
        ))}
      </div>
    </div>
  );
}
