"use client";

import { useMemo, useState } from "react";
import { PieChart as PieIcon } from "lucide-react";
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

/** Where the money sits. Tap a slice (or legend row) to filter the account list below to it. */
export default function AllocationDonut({ filter, onFilter }: { filter: Section | null; onFilter: (s: Section | null) => void }) {
  const { holdings, accounts, loaded } = useLive();
  const [hover, setHover] = useState<Section | null>(null);

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

  const focus = hover ?? filter;
  const focused = slices.rows.find((r) => r.s === focus);
  const pick = (s: Section) => { haptic(); onFilter(filter === s ? null : s); };

  return (
    <section className="panel h-full">
      <div className="panel-head">
        <span className="panel-title"><PieIcon size={14} />Allocation</span>
        {filter ? (
          <button className="text-[10px] font-bold text-up" onClick={() => onFilter(null)}>Showing {SECTION_LABEL[filter]} · clear</button>
        ) : <span className="text-[10px] text-faint">tap a slice to filter</span>}
      </div>
      {!loaded ? (
        <div className="p-4 flex items-center gap-4"><Skeleton className="w-36 h-36 !rounded-full" /><div className="flex-1 space-y-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-6" />)}</div></div>
      ) : (
        <div className="p-3 flex items-center gap-3">
          <div className="relative w-[148px] h-[148px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices.rows} dataKey="v" nameKey="s" innerRadius="64%" outerRadius="100%" paddingAngle={2}
                     stroke="none" isAnimationActive={false} startAngle={90} endAngle={-270}
                     onClick={(d) => pick((d as unknown as { s: Section }).s)}
                     onMouseEnter={(d) => setHover((d as unknown as { s: Section }).s)} onMouseLeave={() => setHover(null)}>
                  {slices.rows.map((r) => (
                    <Cell key={r.s} fill={SECTION_COLOR[r.s]} cursor="pointer"
                          opacity={filter && filter !== r.s ? 0.28 : 1} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
              <div className="text-[10px] text-faint">{focused ? SECTION_LABEL[focused.s] : "Total"}</div>
              <div className="text-[15px] font-extrabold text-txt tabular-nums leading-tight">
                {focused ? `${focused.pct.toFixed(0)}%` : isHidden() ? "•••" : fmtCents(slices.total).replace(/\.\d\d$/, "")}
              </div>
            </div>
          </div>
          <div className="flex-1 min-w-0 space-y-0.5">
            {slices.rows.map((r) => (
              <button key={r.s} onClick={() => pick(r.s)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 max-sm:py-2.5 rounded-lg text-left transition-colors ${filter === r.s ? "bg-panel2" : "hover:bg-panel2/60"}`}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SECTION_COLOR[r.s] }} />
                <span className="text-[12.5px] font-semibold text-txt flex-1 truncate">{SECTION_LABEL[r.s]}</span>
                <span className="text-[12px] tabular-nums text-dim">{r.pct.toFixed(1)}%</span>
                <span className="text-[11px] tabular-nums text-faint hidden sm:inline w-[76px] text-right">{fmtCents(r.v).replace(/\.\d\d$/, "")}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
