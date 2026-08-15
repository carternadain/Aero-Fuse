"use client";

import { useEffect, useState } from "react";
import { LineChart, RefreshCw } from "lucide-react";
import type { StockScore } from "@/lib/types";
import { api, fmtPrice } from "@/lib/api";
import ScoreMeter from "./ScoreMeter";
import TickerEditor from "./TickerEditor";
import ScoreHistoryChart from "./ScoreHistoryChart";

export default function StockScreener() {
  const [stocks, setStocks] = useState<StockScore[]>([]);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [chart, setChart] = useState<string | null>(null);

  const loadScores = () => {
    setLoading(true);
    api
      .get<{ stocks: StockScore[] }>("/api/markets/stocks")
      .then((r) => setStocks(r.stocks))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const loadList = () =>
    api.get<{ symbols: string[] }>("/api/watchlist/stocks").then((r) => setSymbols(r.symbols)).catch(() => {});

  useEffect(() => {
    loadList();
    loadScores();
  }, []);

  const saveList = async (next: string[]) => {
    setSymbols(next);
    await api.put("/api/watchlist/stocks", { symbols: next });
    loadScores();
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">
          <LineChart size={14} /> Tech Stock Screener
          <span className="text-[10px] text-faint font-medium ml-1">long-term buy / overbought</span>
        </span>
        <button className="btn !py-1.5 !px-2" onClick={loadScores} disabled={loading} title="Refresh">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-edge">
        <TickerEditor symbols={symbols} onSave={saveList} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-3">
        {stocks.length === 0 && (
          <p className="col-span-full px-1 py-6 text-center text-dim text-xs">
            {loading ? "Loading stock data…" : "No data — Yahoo may be throttling, try refresh."}
          </p>
        )}
        {stocks.map((s) => (
          <button
            key={s.symbol}
            onClick={() => setChart(s.symbol)}
            className="text-left rounded-xl border border-edge bg-panel2 p-3 space-y-2 hover:border-edge2 transition-colors cursor-pointer"
            title="View score history"
          >
            <div className="flex items-baseline justify-between">
              <span className="font-bold text-txt text-sm">{s.symbol}</span>
              <span className="tabular-nums text-xs text-dim">
                {s.price != null ? `$${fmtPrice(s.price)}` : "—"}
              </span>
            </div>
            <ScoreMeter score={s.score} />
          </button>
        ))}
      </div>
      {chart && (
        <ScoreHistoryChart kind="stock" id={chart} symbol={chart} onClose={() => setChart(null)} />
      )}
    </section>
  );
}
