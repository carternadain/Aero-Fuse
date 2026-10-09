"use client";

import { ChevronDown, Layers } from "lucide-react";
import { haptic } from "@/lib/bus";
import { setMode, toggleCollapsed, usePrefs } from "@/lib/prefs";

/**
 * A titled block that folds when you tap its header (remembered per device).
 * `pro` sections only show in Pro mode, unless search or a link jumped to them.
 */
export default function Section({ id, title, accent, hint, pro = false, children }: {
  id: string; title: string; accent: string; hint?: string; pro?: boolean; children: React.ReactNode;
}) {
  const p = usePrefs();
  if (pro && p.mode === "simple" && !p.revealed.has(id)) return null;
  const open = !p.collapsed.includes(id);
  return (
    <section id={id} className="scroll-mt-28 space-y-3">
      <button className="section-divider w-full flex items-baseline gap-3 pt-3 text-left group"
              onClick={() => { haptic(); toggleCollapsed(id); }} aria-expanded={open}>
        <h2 className="font-display text-[22px] leading-none text-txt">{title} {accent}</h2>
        {pro && <span className="text-[9px] font-bold tracking-widest text-faint border border-edge2 rounded px-1 py-px self-center">PRO</span>}
        <div className="flex-1 h-px bg-edge self-center" />
        {hint && open && <span className="hidden sm:inline text-[10px] text-faint font-medium">{hint}</span>}
        {!open && <span className="text-[10px] text-faint font-medium">tap to open</span>}
        <ChevronDown size={16} className={`self-center text-faint transition-transform group-hover:text-txt ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && children}
    </section>
  );
}

/** Footer note in Simple mode: some tools are tucked away, here's how to get them. */
export function ProHint({ what }: { what: string }) {
  const p = usePrefs();
  if (p.mode !== "simple") return null;
  return (
    <button onClick={() => { haptic(); setMode("pro"); }}
            className="w-full panel px-4 py-3 flex items-center gap-3 text-left hover:border-edge2 transition-colors">
      <Layers size={16} className="text-amber shrink-0" />
      <span className="flex-1 text-[12px] text-dim">
        Simple mode is hiding {what}. <b className="text-txt">Switch to Pro</b> to see everything, or find any of it with search.
      </span>
    </button>
  );
}
