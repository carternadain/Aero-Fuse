"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Compass, Plus, RefreshCw } from "lucide-react";
import type { SwingIdea } from "@/lib/types";
import { api } from "@/lib/api";
import ScoreHistoryChart from "./ScoreHistoryChart";

type SortKey = "score" | "chg_1m" | "chg_3m" | "off_high";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "score", label: "Score" },
  { key: "chg_1m", label: "1M %" },
  { key: "chg_3m", label: "3M %" },
  { key: "off_high", label: "Off high" },
];

function bandColor(score: number): string {
  if (score >= 75) return "var(--color-up)";
  if (score >= 60) return "var(--color-cyan)";
  if (score >= 40) return "var(--color-amber)";
  if (score >= 25) return "var(--color-warn)";
  return "var(--color-down)";
}

function Pct({ v }: { v: number | null }) {
  if (v == null) return <span className="text-faint">—</span>;
  return (
    <span className={v >= 0 ? "text-up" : "text-down"}>
      {v > 0 ? "+" : ""}
      {v.toFixed(1)}%
    </span>
  );
}

export default function SwingIdeas() {
  const [stocks, setStocks] = useState<SwingIdea[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [sector, setSector] = useState("All");
  const [sort, setSort] = useState<SortKey>("score");
  const [loading, setLoading] = useState(true);
  const [chart, setChart] = useState<SwingIdea | null>(null);

  const load = () => {
    setLoading(true);
    api
      .get<{ sectors: string[]; stocks: SwingIdea[] }>("/api/markets/discover")
      .then((r) => {
        setStocks(r.stocks);
        setSectors(r.sectors);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const addToWatch = async (sym: string) => {
    const cur = await api.get<{ symbols: string[] }>("/api/watchlist/options");
    if (!cur.symbols.includes(sym)) {
      await api.put("/api/watchlist/options", { symbols: [...cur.symbols, sym] });
    }
    setStocks((prev) => prev.map((s) => (s.symbol === sym ? { ...s, watched: true } : s)));
  };

  const shown = useMemo(() => {
    const rows = stocks.filter((s) => sector === "All" || s.sector === sector);
    // Off high: most beaten-down first; everything else: highest first.
    const val = (s: SwingIdea) => s[sort] ?? (sort === "off_high" ? 0 : -Infinity);
    return [...rows].sort((a, b) => (sort === "off_high" ? val(a) - val(b) : val(b) - val(a)));
  }, [stocks, sector, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of stocks) if ((s.score ?? 0) >= 60) c[s.sector] = (c[s.sector] ?? 0) + 1;
    return c;
  }, [stocks]);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">
          <Compass size={14} /> Swing Ideas
          <span className="text-[10px] text-faint font-medium ml-1">
            {stocks.length} optionable names by sector · click a row for history
          </span>
        </span>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-edge2 overflow-hidden text-[10px]">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={`px-2 py-1 font-bold transition-colors ${
                  sort === s.key ? "bg-panel2 text-up" : "text-dim hover:text-txt"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button className="btn !py-1.5 !px-2" onClick={load} disabled={loading} title="Refresh">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-edge bg-panel2/40">
        {["All", ...sectors].map((s) => (
          <button
            key={s}
            onClick={() => setSector(s)}
            className={`chip-tap px-2 py-0.5 rounded-md border text-[10px] font-semibold transition-colors ${
              sector === s ? "border-up/50 bg-up/10 text-up" : "border-edge2 text-dim hover:text-txt"
            }`}
          >
            {s}
            {s !== "All" && counts[s] ? <span className="ml-1 text-up">{counts[s]}</span> : null}
          </button>
        ))}
      </div>

      <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 border-b border-edge text-[9px] uppercase tracking-wide text-faint font-bold">
        <span className="w-5">#</span>
        <span className="flex-1">Ticker</span>
        <span className="w-20 text-right">Price</span>
        <span className="w-14 text-right">1D</span>
        <span className="w-14 text-right">1M</span>
        <span className="w-14 text-right hidden md:block">3M</span>
        <span className="w-16 text-right hidden md:block">Off high</span>
        <span className="w-28 text-right">Score</span>
        <span className="w-7" />
      </div>

      <div className="divide-y divide-edge">
        {shown.length === 0 && (
          <p className="px-3 py-6 text-center text-dim text-xs">
            {loading ? "Scoring ~115 names…" : "No data yet — try refresh."}
          </p>
        )}
        {shown.map((s, i) => {
          const score = s.score ?? 0;
          const color = bandColor(score);
          return (
            <div
              key={s.symbol}
              onClick={() => setChart(s)}
              className="flex items-center gap-3 px-3 py-2 hover:bg-panel2 transition-colors cursor-pointer text-xs"
              title="View score history"
            >
              <span className="text-faint font-bold tabular-nums w-5">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-txt text-sm">{s.symbol}</div>
                <div className="text-[10px] text-faint truncate">
                  {s.name} · {s.sector}
                </div>
              </div>
              <span className="tabular-nums text-dim w-20 text-right">
                {s.price != null ? `$${s.price.toFixed(2)}` : "—"}
              </span>
              <span className="tabular-nums w-14 text-right hidden sm:block"><Pct v={s.chg_1d} /></span>
              <span className="tabular-nums w-14 text-right"><Pct v={s.chg_1m} /></span>
              <span className="tabular-nums w-14 text-right hidden md:block"><Pct v={s.chg_3m} /></span>
              <span className="tabular-nums w-16 text-right hidden md:block"><Pct v={s.off_high} /></span>
              <div className="w-28 text-right">
                <div className="tabular-nums text-sm font-bold" style={{ color }}>
                  {s.score ?? "—"}
                </div>
                <div className="text-[9px] font-semibold truncate" style={{ color }}>
                  {s.label}
                </div>
              </div>
              <button
                className="icon-btn w-7 flex justify-center"
                disabled={s.watched}
                title={s.watched ? "In Options Watch" : "Add to Options Watch"}
                onClick={(e) => {
                  e.stopPropagation();
                  addToWatch(s.symbol);
                }}
              >
                {s.watched ? <Check size={13} className="text-up" /> : <Plus size={13} />}
              </button>
            </div>
          );
        })}
      </div>

      {chart && (
        <ScoreHistoryChart kind="stock" id={chart.id} symbol={chart.symbol} onClose={() => setChart(null)} />
      )}
    </section>
  );
}
