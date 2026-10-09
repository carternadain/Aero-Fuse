"use client";

import { useEffect, useMemo, useState } from "react";
import { LayoutGrid } from "lucide-react";
import type { SwingIdea } from "@/lib/types";
import { api } from "@/lib/api";
import { openTicker } from "@/lib/bus";
import { tileColor } from "./PortfolioHeatmap";
import Skeleton from "./Skeleton";

type P = "chg_1d" | "chg_1w" | "chg_1m" | "chg_3m";
const PERIODS: [P, string][] = [["chg_1d", "1D"], ["chg_1w", "1W"], ["chg_1m", "1M"], ["chg_3m", "3M"]];
// 5% is a big day; a quarter needs a wider scale to show any contrast
const SCALE: Record<P, number> = { chg_1d: 5, chg_1w: 10, chg_1m: 20, chg_3m: 35 };

/** Every Swing Ideas name, grouped by sector and colored by its move, hottest sector first. */
export default function SectorMap() {
  const [rows, setRows] = useState<SwingIdea[] | null>(null);
  const [p, setP] = useState<P>("chg_1d");

  useEffect(() => {
    api.get<{ stocks: SwingIdea[] }>("/api/markets/discover").then((r) => setRows(r.stocks)).catch(() => setRows([]));
  }, []);

  const sectors = useMemo(() => {
    const by = new Map<string, SwingIdea[]>();
    for (const r of rows ?? []) by.set(r.sector, [...(by.get(r.sector) ?? []), r]);
    return [...by].map(([name, list]) => {
      const vals = list.map((x) => x[p]).filter((v): v is number => v != null);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      const sorted = [...list].sort((a, b) => (b[p] ?? -999) - (a[p] ?? -999));
      return { name, avg, list: sorted, up: vals.filter((v) => v > 0).length, n: vals.length };
    }).sort((a, b) => (b.avg ?? -999) - (a.avg ?? -999));
  }, [rows, p]);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><LayoutGrid size={14} />Sector Map</span>
        <div className="flex rounded-lg border border-edge2 overflow-hidden text-[10px]">
          {PERIODS.map(([k, l]) => (
            <button key={k} onClick={() => setP(k)} className={`px-2.5 py-1 font-bold ${p === k ? "bg-panel2 text-up" : "text-dim hover:text-txt"}`}>{l}</button>
          ))}
        </div>
      </div>
      {!rows ? (
        <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <div className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {sectors.map((s) => (
            <div key={s.name} className="rounded-xl border border-edge bg-panel2/30 p-2.5">
              <div className="flex items-baseline justify-between mb-2 px-0.5">
                <span className="text-[12px] font-extrabold text-txt">{s.name}</span>
                <span className="text-[11px] tabular-nums">
                  <span className="text-faint mr-1.5">{s.up}/{s.n} up</span>
                  <b className={(s.avg ?? 0) >= 0 ? "text-up" : "text-down"}>{s.avg != null ? `${s.avg >= 0 ? "+" : ""}${s.avg.toFixed(1)}%` : "—"}</b>
                </span>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-1">
                {s.list.map((x) => {
                  const v = x[p];
                  return (
                    <button key={x.symbol} onClick={() => openTicker({ symbol: x.symbol, kind: "stock" })}
                            title={x.name}
                            className="rounded-md px-1 py-1.5 text-center hover:brightness-125 active:brightness-150 transition-[filter]"
                            style={{ background: tileColor(v != null ? (v / SCALE[p]) * 5 : null) }}>
                      <div className="text-[11px] font-extrabold text-txt leading-tight truncate">{x.symbol}</div>
                      <div className="text-[9.5px] tabular-nums text-txt/80">{v != null ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : "—"}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
