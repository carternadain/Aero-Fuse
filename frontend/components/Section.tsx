"use client";

import { Layers } from "lucide-react";
import { haptic } from "@/lib/bus";
import { isShown, setMode, usePrefs } from "@/lib/prefs";

/**
 * A plain titled block. It no longer folds: folding a block that already holds a pane switcher
 * and cards with their own expanders made things three taps deep.
 * `pro` sections only show in Pro mode (or when switched on in Settings), unless search or a link jumped to them.
 */
export default function Section({ id, title, accent, hint, pro = false, children }: {
  id: string; title: string; accent?: string; hint?: string; pro?: boolean; children: React.ReactNode;
}) {
  const p = usePrefs();
  if (!isShown(id, pro, p)) return null;
  return (
    <section id={id} className="scroll-mt-28 space-y-3" aria-labelledby={`${id}-h`}>
      <div className="flex items-baseline gap-3 pt-3">
        <h2 id={`${id}-h`} className="font-display text-[22px] leading-none text-txt">{accent ? `${title} ${accent}` : title}</h2>
        {pro && <span className="text-[9px] font-bold tracking-widest text-faint border border-edge2 rounded px-1 py-px self-center">PRO</span>}
        {hint && <span className="hidden sm:inline ml-auto text-[11px] text-faint font-medium">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** A scroll anchor with no title (the card inside has its own) that still honours Settings and Simple/Pro. */
export function Gated({ id, pro = false, children }: { id: string; pro?: boolean; children: React.ReactNode }) {
  const p = usePrefs();
  if (!isShown(id, pro, p)) return null;
  return <div id={id} className="scroll-mt-28">{children}</div>;
}

/**
 * Footer note in Simple mode: some tools are tucked away, here's how to get them.
 * With `ids`, it only shows while at least one of those Pro panels is actually hidden.
 */
export function ProHint({ what, ids }: { what: string; ids?: string[] }) {
  const p = usePrefs();
  if (p.mode !== "simple") return null;
  if (ids && ids.every((id) => isShown(id, true, p))) return null;
  return (
    <button onClick={() => { haptic(); setMode("pro"); }}
            className="w-full panel px-4 py-3 flex items-center gap-3 text-left hover:border-edge2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-up">
      <Layers size={16} className="text-amber shrink-0" />
      <span className="flex-1 text-[12px] text-dim">
        Simple view is hiding {what}. <b className="text-txt">Switch to Pro</b>, turn it on in Settings, or find it with search.
      </span>
    </button>
  );
}
