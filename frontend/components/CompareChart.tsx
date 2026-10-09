"use client";

import { useEffect, useMemo, useState } from "react";
import { GitCompareArrows, Plus, X } from "lucide-react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { api } from "@/lib/api";
import { openTicker } from "@/lib/bus";
import { useStars } from "@/lib/stars";
import Skeleton from "./Skeleton";

interface Cmp { range: string; symbols: { symbol: string; kind: "crypto" | "stock"; change_pct: number }[]; points: Record<string, number>[] }

const RANGES = ["1W", "1M", "3M", "1Y"] as const;
const COLORS = ["var(--color-up)", "var(--color-amber)", "var(--color-cyan)", "var(--color-down)"];
const PRESETS: [string, string[]][] = [
  ["Space", ["RDW", "LUNR", "RKLB"]],
  ["Oil majors", ["XOM", "CVX", "OXY"]],
  ["Nuclear", ["CCJ", "OKLO", "SMR"]],
  ["Crypto", ["BTC", "ETH", "SOL"]],
  ["AI chips", ["NVDA", "AMD", "AVGO"]],
];
const KEY = "compare-v1";

/** Up to 4 tickers on one chart as % change, so a move in one is easy to compare with peers. */
export default function CompareChart() {
  const { items: stars } = useStars();
  const [syms, setSyms] = useState<string[]>(["RDW", "LUNR", "RKLB"]);
  const [range, setRange] = useState<(typeof RANGES)[number]>("1M");
  const [data, setData] = useState<Cmp | null>(null);
  const [add, setAdd] = useState("");
  const [hover, setHover] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(KEY) ?? "null"); if (Array.isArray(s) && s.length) setSyms(s); } catch { /* */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(syms)); } catch { /* */ }
    if (!syms.length) { setData(null); return; }
    let alive = true;
    setData(null);
    api.get<Cmp>(`/api/compare?symbols=${syms.join(",")}&range=${range}`).then((d) => alive && setData(d)).catch(() => {});
    return () => { alive = false; };
  }, [syms, range]);

  const push = (s: string) => {
    const v = s.trim().toUpperCase();
    if (v && !syms.includes(v) && syms.length < 4) setSyms([...syms, v]);
    setAdd("");
  };

  const shown = hover ?? data?.points[data.points.length - 1] ?? null;
  const order = data?.symbols.map((s) => s.symbol) ?? [];
  const winner = useMemo(() => [...(data?.symbols ?? [])].sort((a, b) => b.change_pct - a.change_pct)[0], [data]);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><GitCompareArrows size={14} />Compare</span>
        <div className="seg flex rounded-lg border border-edge2 text-[10px]">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setRange(r)}
                    className={`px-2.5 py-1 font-bold ${range === r ? "bg-panel2 text-up" : "text-dim hover:text-txt"}`}>{r}</button>
          ))}
        </div>
      </div>
      <div className="px-3 pt-3 flex flex-wrap gap-1.5 items-center">
        {syms.map((s) => {
          const i = order.indexOf(s);
          return (
            <span key={s} className="flex items-center gap-1 max-sm:gap-3 pl-2 pr-1 py-1 max-sm:py-2.5 rounded-lg border border-edge2 text-[12px] font-bold text-txt">
              <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i >= 0 ? i : syms.indexOf(s)] }} />
              <button className="max-sm:min-w-10" onClick={() => openTicker({ symbol: s })}>{s}</button>
              <span className="tabular-nums text-dim font-semibold ml-0.5">
                {shown?.[s] != null ? `${shown[s] >= 0 ? "+" : ""}${shown[s].toFixed(1)}%` : ""}
              </span>
              <button className="p-0.5 text-faint hover:text-txt" onClick={() => setSyms(syms.filter((x) => x !== s))}><X size={11} /></button>
            </span>
          );
        })}
        {syms.length < 4 && (
          <form onSubmit={(e) => { e.preventDefault(); push(add); }} className="flex items-center">
            <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Add ticker" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="go"
                   className="field !py-1 sm:!text-[12px] w-[96px] max-sm:w-32 uppercase" />
            <button className="icon-btn" type="submit"><Plus size={13} /></button>
          </form>
        )}
      </div>
      <div className="px-3 pt-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none]" data-noswipe>
        {PRESETS.map(([name, list]) => (
          <button key={name} onClick={() => setSyms(list)} className="chip-tap shrink-0 px-2 py-0.5 rounded-md border border-edge2 text-[10px] font-semibold text-dim hover:text-txt">
            {name}
          </button>
        ))}
        {stars.length >= 2 && (
          <button onClick={() => setSyms(stars.slice(0, 4).map((s) => s.symbol))}
                  className="chip-tap shrink-0 px-2 py-0.5 rounded-md border border-amber/40 text-[10px] font-semibold text-amber">★ My stars</button>
        )}
      </div>
      <div className="h-[230px] mt-2" data-noswipe onMouseLeave={() => setHover(null)} onTouchEnd={() => setHover(null)}>
        {!data ? (
          syms.length ? <Skeleton className="mx-3 h-full" /> : <p className="text-center text-xs text-dim pt-20">Add a ticker to compare.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.points} margin={{ top: 8, bottom: 8, left: 8, right: 8 }}
                       onMouseMove={(e) => { const i = Number((e as { activeTooltipIndex?: number | string }).activeTooltipIndex);
                                             if (!Number.isNaN(i) && data.points[i]) setHover(data.points[i]); }}>
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <ReferenceLine y={0} stroke="var(--color-edge2)" strokeDasharray="3 4" />
              <Tooltip content={() => null} cursor={{ stroke: "var(--color-faint)", strokeDasharray: "3 3" }} />
              {order.map((s, i) => (
                <Line key={s} type="linear" dataKey={s} stroke={COLORS[i]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="px-3 pb-3 text-[11px] text-dim">
        {hover?.t ? new Date(hover.t * 1000).toLocaleString([], { month: "short", day: "numeric", hour: range === "1W" ? "numeric" : undefined })
          : winner ? <>Leader over {range}: <b className="text-txt">{winner.symbol}</b> {winner.change_pct >= 0 ? "+" : ""}{winner.change_pct.toFixed(1)}%</> : " "}
      </div>
    </section>
  );
}
