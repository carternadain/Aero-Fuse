"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Target } from "lucide-react";
import type { OptionsStock } from "@/lib/types";
import { api, fmtPrice, timeAgo } from "@/lib/api";
import ScoreMeter from "./ScoreMeter";
import TickerEditor from "./TickerEditor";

export default function OptionsWatch() {
  const [stocks, setStocks] = useState<OptionsStock[]>([]);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = () => {
    setLoading(true);
    api
      .get<{ stocks: OptionsStock[] }>("/api/markets/options-watch")
      .then((r) => setStocks(r.stocks))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const loadList = () =>
    api.get<{ symbols: string[] }>("/api/watchlist/options").then((r) => setSymbols(r.symbols)).catch(() => {});

  useEffect(() => {
    loadList();
    loadData();
  }, []);

  const saveList = async (next: string[]) => {
    setSymbols(next);
    await api.put("/api/watchlist/options", { symbols: next });
    loadData();
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">
          <Target size={14} /> Options Watch
          <span className="text-[10px] text-faint font-medium ml-1">signals + confluence</span>
        </span>
        <button className="btn !py-1.5 !px-2" onClick={loadData} disabled={loading} title="Refresh">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-edge">
        <TickerEditor symbols={symbols} onSave={saveList} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
        {stocks.length === 0 && (
          <p className="col-span-full px-1 py-6 text-center text-dim text-xs">
            {loading ? "Loading…" : "No tickers — add some above."}
          </p>
        )}
        {stocks.map((s) => (
          <div key={s.symbol} className="rounded-xl border border-edge bg-panel2 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-bold text-txt text-sm">{s.symbol}</span>
                {s.has_confluence && (
                  <span className="text-[9px] font-bold text-amber border border-amber/40 bg-amber/10 rounded px-1.5 py-px">
                    🔥 CONFLUENCE
                  </span>
                )}
              </div>
              <span className="tabular-nums text-xs text-dim">
                {s.price != null ? `$${fmtPrice(s.price)}` : "—"}
              </span>
            </div>
            <ScoreMeter score={s.score} compact />
            <div className="space-y-1 pt-1">
              {s.signals.length === 0 && <p className="text-[10px] text-faint">No recent signals</p>}
              {s.signals.slice(0, 4).map((sig) => (
                <div key={sig.id} className="flex items-center gap-2 text-[10px]">
                  <span className={sig.direction === "buy" ? "text-up" : "text-down"}>
                    {sig.direction === "buy" ? "▲" : "▼"}
                  </span>
                  <span className="text-dim font-medium">{sig.indicator}</span>
                  {sig.ai_take != null && (
                    <span className={sig.ai_take ? "text-up" : "text-faint"}>
                      {sig.ai_take ? "✅" : "⏭"} {sig.ai_score}/10
                    </span>
                  )}
                  <span className="text-faint ml-auto">{timeAgo(sig.ts)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
