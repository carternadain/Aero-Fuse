"use client";

import { useEffect, useState } from "react";
import { Flame, RefreshCw } from "lucide-react";
import type { Narrative } from "@/lib/types";
import { api } from "@/lib/api";

function mcap(n: number) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n}`;
}

export default function Narratives() {
  const [items, setItems] = useState<Narrative[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api
      .get<{ narratives: Narrative[] }>("/api/markets/narratives")
      .then((r) => setItems(r.narratives))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <section className="panel flex flex-col">
      <div className="panel-head">
        <span className="panel-title">
          <Flame size={14} /> Top Narratives
          <span className="text-[10px] text-faint font-medium ml-1">what&apos;s moving (24h)</span>
        </span>
        <button className="btn !py-1.5 !px-2" onClick={load} disabled={loading} title="Refresh">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <div className="overflow-y-auto max-h-[560px]">
        {items.length === 0 && (
          <p className="p-4 text-xs text-dim">{loading ? "Loading narratives…" : "No data — try refresh."}</p>
        )}
        {items.map((n, i) => (
          <div key={n.name} className="flex items-center gap-3 px-3 py-2.5 border-b border-edge hover:bg-panel2 transition-colors">
            <span className="text-[10px] text-faint font-bold tabular-nums w-4">{i + 1}</span>
            <div className="flex -space-x-1.5 shrink-0">
              {n.top_coins.slice(0, 3).map((src, j) =>
                src ? <img key={j} src={src} alt="" className="w-5 h-5 rounded-full border border-panel" /> : null
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-txt text-xs truncate">{n.name}</div>
              <div className="text-[10px] text-faint">{mcap(n.market_cap)} mcap</div>
            </div>
            <span
              className={`text-xs font-bold tabular-nums ${n.change_24h >= 0 ? "text-up" : "text-down"}`}
            >
              {n.change_24h >= 0 ? "+" : ""}
              {n.change_24h.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
      <p className="px-3 py-2 text-[10px] text-faint border-t border-edge">
        Real categories only (market cap &gt; $500M) sorted by 24h move — filters out scam micro-narratives.
        Source: CoinGecko.
      </p>
    </section>
  );
}
