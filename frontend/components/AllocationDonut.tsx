"use client";

import { useMemo, useState } from "react";
import { ChevronDown, PieChart as PieIcon } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { haptic } from "@/lib/bus";
import { sectionForAccount, sectionForLabel, useLive, type Section } from "@/lib/live";
import { fmtCents, isHidden } from "@/lib/privacy";
import Skeleton from "./Skeleton";

export const SECTION_COLOR: Record<Section, string> = {
  investing: "var(--color-up)",
  retirement: "var(--color-cyan)",
  crypto: "var(--color-amber)",
  cash: "var(--color-dim)",
  debt: "var(--color-down)",
};
export const SECTION_LABEL: Record<Section, string> = {
  investing: "Investing", retirement: "Retirement", crypto: "Crypto", cash: "Cash", debt: "Owed",
};

interface Slice { key: string; label: string; v: number; pct: number; color: string }
const TOP = 7;         // slices before the rest fold into "Other": eight colors is the most that stay tellable apart
const OTHER = "__other";
// Order checked with the dataviz palette validator in both themes: no two neighbours are a pair
// that reads alike with a color vision deficiency (teal/pink and green/orange are kept apart).
const CAT_ORDER = [3, 4, 1, 2, 6, 5, 7];

/** Where the money sits. Tap a slice (or legend row) to filter the account list below to it. */
export default function AllocationDonut({ filter, onFilter }: { filter: Section | null; onFilter: (s: Section | null) => void }) {
  const { holdings, accounts, loaded } = useLive();
  const [hover, setHover] = useState<string | null>(null);
  const [mode, setMode] = useState<"groups" | "holdings">("holdings");
  const [all, setAll] = useState(false);

  const slices = useMemo(() => {
    const by: Partial<Record<Section, number>> = {};
    for (const h of holdings) {
      if (!h.value || h.value <= 0) continue;
      const s = sectionForLabel(h.label || ""); // same grouping as the account list it filters
      by[s] = (by[s] ?? 0) + h.value;
    }
    for (const a of accounts) {
      const s = sectionForAccount(a);
      if (s !== "debt") by[s] = (by[s] ?? 0) + a.balance;
    }
    const total = Object.values(by).reduce((t, v) => t + (v ?? 0), 0);
    return {
      total,
      rows: (Object.entries(by) as [Section, number][])
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([s, v]) => ({ s, v, pct: total ? (v / total) * 100 : 0 })),
    };
  }, [holdings, accounts]);

  // Every position by value, the same symbol in two accounts counted once. The pie shows the
  // biggest seven and folds the rest into "Other"; the full list is one tap away.
  const held = useMemo(() => {
    const by = new Map<string, number>();
    for (const h of holdings) if (h.value && h.value > 0) by.set(h.display, (by.get(h.display) ?? 0) + h.value);
    const total = [...by.values()].reduce((t, v) => t + v, 0);
    const list = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([name, v]) => ({ name, v, pct: total ? (v / total) * 100 : 0 }));
    const top = list.length > TOP + 1 ? list.slice(0, TOP) : list;
    const rest = list.slice(top.length);
    const restV = rest.reduce((t, r) => t + r.v, 0);
    return { total, list, rest: rest.length, slices: [
      ...top.map((r, i) => ({ key: r.name, label: r.name, v: r.v, pct: r.pct, color: `var(--color-cat-${CAT_ORDER[i]})` })),
      ...(rest.length ? [{ key: OTHER, label: `Other (${rest.length})`, v: restV, pct: total ? (restV / total) * 100 : 0, color: "var(--color-faint)" }] : []),
    ] };
  }, [holdings]);

  const byHolding = mode === "holdings";
  const rows: Slice[] = byHolding ? held.slices
    : slices.rows.map((r) => ({ key: r.s, label: SECTION_LABEL[r.s], v: r.v, pct: r.pct, color: SECTION_COLOR[r.s] }));
  const total = byHolding ? held.total : slices.total;
  const focus = hover ?? (byHolding ? null : filter);
  const focused = rows.find((r) => r.key === focus);
  const pick = (key: string) => {
    haptic();
    if (!byHolding) onFilter(filter === key ? null : (key as Section));
    else if (key === OTHER) setAll(true);
    else setHover(hover === key ? null : key);
  };
  const dim = (key: string) => (byHolding ? hover != null && hover !== key : !!filter && filter !== key);

  return (
    <section className="panel h-full">
      <div className="panel-head">
        <span className="panel-title"><PieIcon size={14} />Allocation</span>
        <div role="group" aria-label="Split by" className="flex p-0.5 rounded-lg border border-edge bg-bg/50">
          {([["groups", "By type"], ["holdings", "By holding"]] as const).map(([id, name]) => (
            <button key={id} type="button" aria-pressed={mode === id} onClick={() => { if (mode !== id) haptic(); setMode(id); setHover(null); }}
                    className={`min-h-10 sm:min-h-8 px-3 rounded-md text-[12px] font-bold focus-visible:outline-2 focus-visible:outline-cyan ${mode === id ? "bg-panel2 text-up" : "text-dim hover:text-txt"}`}>
              {name}
            </button>
          ))}
        </div>
      </div>
      {!loaded ? (
        <div className="p-4 flex items-center gap-4"><Skeleton className="w-36 h-36 !rounded-full" /><div className="flex-1 space-y-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-6" />)}</div></div>
      ) : byHolding && held.list.length === 0 ? (
        <p className="p-6 text-center text-[13px] text-dim">No priced holdings to chart right now.</p>
      ) : (
        <>
        <div className="p-3 flex items-center gap-3">
          <div className="relative w-[148px] h-[148px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={rows} dataKey="v" nameKey="key" innerRadius="64%" outerRadius="100%" paddingAngle={2}
                     stroke="none" isAnimationActive={false} startAngle={90} endAngle={-270}
                     onClick={(d) => pick((d as unknown as Slice).key)}
                     onMouseEnter={(d) => setHover((d as unknown as Slice).key)} onMouseLeave={() => setHover(null)}>
                  {rows.map((r) => (
                    <Cell key={r.key} fill={r.color} cursor="pointer" opacity={dim(r.key) ? 0.28 : 1} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
              <div className="text-[10px] text-faint max-w-[84px] truncate">{focused ? focused.label : byHolding ? "Holdings" : "Assets"}</div>
              <div className="text-[15px] font-extrabold text-txt tabular-nums leading-tight">
                {focused ? `${focused.pct.toFixed(0)}%` : isHidden() ? "•••" : fmtCents(total).replace(/\.\d\d$/, "")}
              </div>
            </div>
          </div>
          <div className="flex-1 min-w-0 space-y-0.5">
            {rows.map((r) => (
              <button key={r.key} onClick={() => pick(r.key)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 max-sm:min-h-10 rounded-lg focus-visible:outline-2 focus-visible:outline-up text-left transition-colors ${focus === r.key ? "bg-panel2" : "hover:bg-panel2/60"}`}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                <span className="text-[12.5px] font-semibold text-txt flex-1 truncate">{r.label}</span>
                <span className="text-[12px] tabular-nums text-dim">{r.pct.toFixed(1)}%</span>
                <span className="text-[11px] tabular-nums text-faint hidden sm:inline w-[76px] text-right">{fmtCents(r.v).replace(/\.\d\d$/, "")}</span>
              </button>
            ))}
          </div>
        </div>
        {!byHolding && (
          <p className="px-4 pb-3 -mt-1 text-[11px] text-faint">
            {filter ? <button className="min-h-10 -my-3 font-bold text-up rounded focus-visible:outline-2 focus-visible:outline-up" onClick={() => onFilter(null)}>Showing {SECTION_LABEL[filter]} only · clear</button>
              : "Tap a slice to filter your accounts below."}
          </p>
        )}
        {byHolding && held.list.length > rows.length - (held.rest ? 1 : 0) && (
          <div className="border-t border-edge">
            <button type="button" aria-expanded={all} onClick={() => setAll(!all)}
                    className="w-full min-h-11 px-4 flex items-center justify-between text-[12.5px] font-semibold text-dim hover:text-txt focus-visible:outline-2 focus-visible:outline-cyan">
              {all ? "Hide the full list" : `See all ${held.list.length} holdings`}
              <ChevronDown size={15} aria-hidden className={`transition-transform ${all ? "rotate-180" : ""}`} />
            </button>
            {all && (
              <ol className="px-4 pb-3 space-y-1.5">
                {held.list.map((r, i) => (
                  <li key={r.name} className="flex items-center gap-2 text-[12.5px]">
                    <span className="w-5 shrink-0 tabular-nums text-faint">{i + 1}</span>
                    <span className="font-semibold text-txt w-[38%] truncate">{r.name}</span>
                    <span className="flex-1 h-1.5 rounded-full bg-panel2 overflow-hidden" aria-hidden>
                      <span className="block h-full rounded-full bg-dim" style={{ width: `${(r.pct / held.list[0].pct) * 100}%` }} />
                    </span>
                    <span className="w-12 text-right tabular-nums text-dim">{r.pct.toFixed(1)}%</span>
                    <span className="w-[78px] text-right tabular-nums text-txt">{fmtCents(r.v).replace(/\.\d\d$/, "")}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        </>
      )}
    </section>
  );
}
