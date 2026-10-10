"use client";

import { useEffect, useState } from "react";
import { Bitcoin, RefreshCw } from "lucide-react";
import type { CryptoCoin } from "@/lib/types";
import { api, fmtPrice } from "@/lib/api";
import ScoreMeter from "./ScoreMeter";
import Sparkline from "./Sparkline";
import { openTicker } from "@/lib/bus";
import StarButton from "./StarButton";

function pct(n: number | null | undefined) {
  if (n == null) return <span className="text-faint">—</span>;
  return (
    <span className={n >= 0 ? "text-up" : "text-down"}>
      {n >= 0 ? "+" : ""}
      {n.toFixed(1)}%
    </span>
  );
}

function mcap(n: number | null) {
  if (n == null) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n}`;
}

export default function CryptoScreener() {
  const [coins, setCoins] = useState<CryptoCoin[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api
      .get<{ coins: CryptoCoin[] }>("/api/markets/crypto")
      .then((r) => setCoins(r.coins))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">
          <Bitcoin size={14} /> Crypto Screener
          <span className="panel-sub hidden sm:inline text-[10px] text-faint font-medium ml-1">top 15 · 1-year score</span>
        </span>
        <button className="btn !min-h-10 !min-w-10 !px-2" onClick={load} disabled={loading} title="Refresh" aria-label="Refresh coins">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-faint uppercase tracking-wide">
              <th className="text-left font-semibold px-3 py-2">Coin</th>
              <th className="text-right font-semibold px-2">Price</th>
              <th className="text-right font-semibold px-2 hidden sm:table-cell">24h</th>
              <th className="text-right font-semibold px-2 hidden md:table-cell">7d</th>
              <th className="text-right font-semibold px-2 hidden lg:table-cell">1y</th>
              <th className="text-center font-semibold px-2 hidden sm:table-cell">7d trend</th>
              <th className="text-left font-semibold px-3 w-[160px]">1-year score</th>
            </tr>
          </thead>
          <tbody>
            {coins.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-dim">
                  {loading ? "Loading market data…" : "No data — CoinGecko may be rate-limited, try refresh."}
                </td>
              </tr>
            )}
            {coins.map((c) => (
              <tr
                key={c.id}
                onClick={() => openTicker({ symbol: c.symbol.toUpperCase(), kind: "crypto", cgId: c.id })}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openTicker({ symbol: c.symbol.toUpperCase(), kind: "crypto", cgId: c.id }); } }}
                tabIndex={0}
                className="border-t border-edge hover:bg-panel2 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan"
                title="View score history"
              >
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    {c.image && <img src={c.image} alt="" className="w-5 h-5 rounded-full" />}
                    <div className="leading-tight">
                      <div className="font-bold text-txt flex items-center gap-1">{c.symbol}
                        <StarButton symbol={c.symbol.toUpperCase()} kind="crypto" size={12} className="!p-1 !min-h-0 !min-w-0" /></div>
                      <div className="text-[10px] text-faint">{mcap(c.market_cap)}</div>
                    </div>
                  </div>
                </td>
                <td className="px-2 text-right tabular-nums text-txt">${fmtPrice(c.price ?? undefined)}</td>
                <td className="px-2 text-right tabular-nums hidden sm:table-cell">{pct(c.change_24h)}</td>
                <td className="px-2 text-right tabular-nums hidden md:table-cell">{pct(c.change_7d)}</td>
                <td className="px-2 text-right tabular-nums hidden lg:table-cell">{pct(c.change_1y)}</td>
                <td className="px-2 hidden sm:table-cell">
                  <div className="flex justify-center">
                    <Sparkline data={c.sparkline} />
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <ScoreMeter score={c.score} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-[10px] text-faint border-t border-edge">
        Tap a row for its chart and score history. The 1-year score blends RSI(14), distance from the 200-day average and 52-week range:
        higher is cheaper, lower is more stretched. For where a coin sits in the 4-year cycle, search it in Check. Not financial advice.
      </p>
    </section>
  );
}
