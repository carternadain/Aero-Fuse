"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Lightbulb, RefreshCw } from "lucide-react";
import type { SwingIdea } from "@/lib/types";
import { api } from "@/lib/api";
import { haptic, openTicker } from "@/lib/bus";
import { useStars } from "@/lib/stars";
import StarButton from "./StarButton";
import Skeleton from "./Skeleton";

type SortKey = "score" | "chg_1m" | "off_high";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "score", label: "Score" },
  { key: "chg_1m", label: "1M" },
  { key: "off_high", label: "Off high" },
];

const TOP = 5;

function bandColor(score: number): string {
  if (score >= 75) return "var(--color-up)";
  if (score >= 60) return "var(--color-cyan)";
  if (score >= 40) return "var(--color-amber)";
  if (score >= 25) return "var(--color-warn)";
  return "var(--color-down)";
}

function Pct({ v }: { v: number | null }) {
  if (v == null) return <span className="text-faint">—</span>;
  return <span className={v >= 0 ? "text-up" : "text-down"}>{v > 0 ? "+" : ""}{v.toFixed(1)}%</span>;
}

/** One idea per line: ticker and name, 1-month move, score. Tap for the chart and why it's listed. */
function Row({ s, col }: { s: SwingIdea; col: SortKey }) {
  const score = s.score ?? 0;
  const color = bandColor(score);
  const open = () => openTicker({ symbol: s.symbol, kind: "stock" });
  return (
    <div role="button" tabIndex={0} onClick={open}
         onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
         className="flex items-center gap-3 pl-4 pr-3 min-h-[56px] py-2 hover:bg-panel2/60 active:bg-panel2 cursor-pointer
                    focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan">
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-bold text-txt leading-tight">{s.symbol}</div>
        <div className="text-[12px] text-dim truncate leading-tight mt-0.5">{s.name}</div>
      </div>
      <span className="text-[13px] tabular-nums w-16 text-right">
        {col === "off_high" ? <Pct v={s.off_high} /> : <Pct v={s.chg_1m} />}
      </span>
      <div className="w-[72px] text-right">
        <div className="text-[15px] font-bold tabular-nums leading-tight" style={{ color }}>{s.score ?? "—"}</div>
        <div className="text-[11px] font-semibold truncate leading-tight" style={{ color }}>{s.label}</div>
      </div>
      <StarButton symbol={s.symbol} kind="stock" size={15} />
    </div>
  );
}

/**
 * Buy ideas from ~115 optionable names. Shows the top few you haven't starred yet;
 * "See all" opens the full list with sector filters and sorting.
 */
export default function SwingIdeas() {
  const [stocks, setStocks] = useState<SwingIdea[] | null>(null);
  const [sectors, setSectors] = useState<string[]>([]);
  const [sector, setSector] = useState("All");
  const [sort, setSort] = useState<SortKey>("score");
  const [all, setAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const { items: stars, loaded: starsLoaded } = useStars();
  // Starred names already sit in the Starred list below. Snapshot them once so starring a top
  // idea doesn't make it jump out from under your finger.
  const [skip, setSkip] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (starsLoaded && !skip) setSkip(new Set(stars.filter((x) => x.kind === "stock").map((x) => x.symbol)));
  }, [starsLoaded, stars, skip]);

  const load = () => {
    setLoading(true);
    api.get<{ sectors: string[]; stocks: SwingIdea[] }>("/api/markets/discover")
      .then((r) => { setStocks(r.stocks); setSectors(r.sectors); })
      .catch(() => setStocks((s) => s ?? []))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const top = useMemo(() => (stocks ?? [])
    .filter((s) => s.score != null && !skip?.has(s.symbol))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, TOP), [stocks, skip]);

  const shown = useMemo(() => {
    const rows = (stocks ?? []).filter((s) => sector === "All" || s.sector === sector);
    // Off high: most beaten-down first; everything else: highest first.
    const val = (s: SwingIdea) => s[sort] ?? (sort === "off_high" ? 0 : -Infinity);
    return [...rows].sort((a, b) => (sort === "off_high" ? val(a) - val(b) : val(b) - val(a)));
  }, [stocks, sector, sort]);

  const list = all ? shown : top;
  const n = stocks?.length ?? 0;

  return (
    <section className="panel overflow-hidden">
      <div className="panel-head">
        <span className="panel-title"><Lightbulb size={14} />{all ? "All ideas" : "Top ideas"}</span>
        {!all && <span className="text-[11px] text-faint">1-month move · score</span>}
        {all && (
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Sort by" className="flex rounded-lg border border-edge2 text-[11px]">
              {SORTS.map((s) => (
                <button key={s.key} onClick={() => setSort(s.key)} aria-pressed={sort === s.key}
                        className={`px-2.5 min-h-10 font-bold transition-colors ${sort === s.key ? "bg-panel2 text-up" : "text-dim hover:text-txt"}`}>
                  {s.label}
                </button>
              ))}
            </div>
            <button className="icon-btn" onClick={load} disabled={loading} title="Refresh" aria-label="Refresh ideas">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        )}
      </div>

      {all && (
        <div data-noswipe className="flex gap-1.5 px-3 py-2 border-b border-edge overflow-x-auto">
          {["All", ...sectors].map((s) => (
            <button key={s} onClick={() => setSector(s)} aria-pressed={sector === s}
                    className={`shrink-0 px-3.5 min-h-10 rounded-full border text-[12px] font-semibold transition-colors ${
                      sector === s ? "border-up/50 bg-up/10 text-up" : "border-edge2 text-dim hover:text-txt"
                    }`}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="divide-y divide-edge/60">
        {!stocks ? (
          <div className="p-3 space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11" />)}</div>
        ) : list.length === 0 ? (
          <p className="px-4 py-6 text-center text-dim text-[13px]">
            {loading ? "Scoring ideas…" : n ? "Nothing new right now. You've starred the best ones." : "No ideas yet. Pull down to refresh."}
          </p>
        ) : (
          list.map((s) => <Row key={s.symbol} s={s} col={all ? sort : "chg_1m"} />)
        )}
      </div>

      {n > TOP && (
        <button onClick={() => { haptic(); setAll(!all); }} aria-expanded={all}
                className="w-full min-h-11 flex items-center justify-center gap-1 border-t border-edge text-[13px] font-semibold text-up
                           hover:bg-panel2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan">
          {all ? "Show top ideas" : `See all ${n}`}
          <ChevronDown size={15} className={`transition-transform ${all ? "rotate-180" : ""}`} />
        </button>
      )}
    </section>
  );
}
