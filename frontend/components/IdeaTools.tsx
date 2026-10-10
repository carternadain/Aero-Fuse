"use client";

// Invest › Ideas: the less-used research tools behind one list. Each row opens its tool in
// place (one at a time) and only then loads it. Search and links can open a tool directly.

import { useEffect, useRef, useState } from "react";
import { ChevronRight, GitCompareArrows, LayoutGrid, LineChart, Radio, type LucideIcon } from "lucide-react";
import { haptic } from "@/lib/bus";
import { getLastRevealed, usePrefs } from "@/lib/prefs";
import SectorMap from "./SectorMap";
import CompareChart from "./CompareChart";
import OptionsWatch from "./OptionsWatch";
import StockScreener from "./StockScreener";

const TOOLS: { id: string; title: string; sub: string; icon: LucideIcon; node: () => React.ReactNode }[] = [
  { id: "sec-sectors", title: "Sectors", sub: "Which groups are moving", icon: LayoutGrid, node: () => <SectorMap /> },
  { id: "sec-compare", title: "Compare", sub: "Up to 4 tickers on one chart", icon: GitCompareArrows, node: () => <CompareChart /> },
  { id: "sec-options", title: "Options watch", sub: "Signals on your options list", icon: Radio, node: () => <OptionsWatch /> },
  { id: "sec-screener", title: "Tech screener", sub: "Big tech scored for a buy", icon: LineChart, node: () => <StockScreener /> },
];

export default function IdeaTools() {
  usePrefs(); // re-render on reveal() so a search jump opens its tool
  const [open, setOpen] = useState<string | null>(() => {
    const l = getLastRevealed();
    return TOOLS.some((t) => t.id === l) ? l : null;
  });
  const handled = useRef<string | null>(getLastRevealed());

  useEffect(() => {
    const l = getLastRevealed();
    if (l && l !== handled.current && TOOLS.some((t) => t.id === l)) { handled.current = l; setOpen(l); }
  });

  return (
    <section id="sec-research" aria-label="More tools" className="scroll-mt-28 space-y-2">
      <h2 className="px-1 text-[13px] font-semibold text-dim">More tools</h2>
      <div className="rounded-2xl border border-edge bg-panel overflow-hidden divide-y divide-edge">
        {TOOLS.map(({ id, title, sub, icon: Icon, node }) => {
          const on = open === id;
          return (
            <div key={id} id={id} className="scroll-mt-28">
              <button onClick={() => { haptic(); setOpen(on ? null : id); }} aria-expanded={on}
                      className="w-full min-h-[56px] flex items-center gap-3 pl-3.5 pr-3 py-2 text-left transition-colors
                                 hover:bg-panel2/60 active:bg-panel2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan">
                <span className="shrink-0 w-8 h-8 rounded-[9px] flex items-center justify-center bg-cyan/15 text-cyan">
                  <Icon size={17} strokeWidth={2.2} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-semibold text-txt leading-tight truncate">{title}</span>
                  <span className="block text-[12px] text-dim leading-tight mt-1 truncate">{sub}</span>
                </span>
                <ChevronRight size={16} className={`shrink-0 text-faint transition-transform ${on ? "rotate-90" : ""}`} />
              </button>
              {on && <div className="p-2 sm:p-3 bg-bg/40 border-t border-edge">{node()}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
