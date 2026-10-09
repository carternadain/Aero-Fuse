"use client";

import { useEffect, useState } from "react";
import { Bot, RefreshCw } from "lucide-react";
import type { SimStats, SimTrade } from "@/lib/types";
import { api, fmtPrice, timeAgo } from "@/lib/api";

function Metric({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-txt";
  return (
    <div className="flex flex-col px-3 py-2">
      <span className="text-[9px] uppercase tracking-wide text-faint">{label}</span>
      <span className={`text-base font-bold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

export default function SimBot() {
  const [stats, setStats] = useState<SimStats | null>(null);
  const [trades, setTrades] = useState<SimTrade[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<SimStats>("/api/sim/stats"),
      api.get<SimTrade[]>("/api/sim/trades"),
    ])
      .then(([s, t]) => { setStats(s); setTrades(t); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">
          <Bot size={14} /> Sim Bot
          <span className="panel-sub text-[10px] text-faint font-medium ml-1">auto-trades every AI-approved signal (paper)</span>
        </span>
        <button className="btn !py-1.5 !px-2" onClick={load} disabled={loading} title="Refresh">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-edge border-b border-edge">
          <Metric label="Net R" value={`${stats.total_r > 0 ? "+" : ""}${stats.total_r}R`} tone={stats.total_r >= 0 ? "up" : "down"} />
          <Metric label="Expectancy" value={`${stats.expectancy_r > 0 ? "+" : ""}${stats.expectancy_r}R`} tone={stats.expectancy_r >= 0 ? "up" : "down"} />
          <Metric label="Win rate" value={stats.closed ? `${stats.win_rate}%` : "—"} tone={stats.win_rate >= 50 ? "up" : "down"} />
          <Metric label="Record" value={`${stats.wins}W/${stats.losses}L`} />
          <Metric label="P&L" value={`${stats.total_pnl_pct > 0 ? "+" : ""}${stats.total_pnl_pct}%`} tone={stats.total_pnl_pct >= 0 ? "up" : "down"} />
          <Metric label="Open" value={String(stats.open)} />
        </div>
      )}

      <div className="overflow-auto max-h-[320px]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-panel2 text-[9px] uppercase tracking-widest text-dim">
            <tr>
              <th className="px-2 py-2 text-left">When</th>
              <th className="px-2 py-2 text-left">Asset</th>
              <th className="px-2 py-2 text-left">Dir</th>
              <th className="px-2 py-2 text-right">Entry</th>
              <th className="px-2 py-2 text-right hidden sm:table-cell">SL / TP</th>
              <th className="px-2 py-2 text-left">Status</th>
              <th className="px-2 py-2 text-right">R</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-dim">
                {loading ? "Loading…" : "No sim trades yet — they open automatically when Claude approves a signal (needs ANTHROPIC_API_KEY)."}
              </td></tr>
            )}
            {trades.map((t) => (
              <tr key={t.id} className="border-t border-edge">
                <td className="px-2 py-2 text-faint whitespace-nowrap">{timeAgo(t.opened_at)}</td>
                <td className="px-2 py-2 font-bold text-cyan">{t.asset}</td>
                <td className={`px-2 py-2 font-bold ${t.direction === "long" ? "text-up" : "text-down"}`}>
                  {t.direction === "long" ? "LONG" : "SHORT"}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtPrice(t.entry)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-faint hidden sm:table-cell">
                  {fmtPrice(t.sl)} / {fmtPrice(t.tp1)}
                </td>
                <td className="px-2 py-2">
                  {t.status === "open" ? (
                    <span className="text-amber">OPEN</span>
                  ) : (
                    <span className={t.outcome === "win" ? "text-up" : "text-down"}>
                      {t.outcome?.toUpperCase()} @ {fmtPrice(t.exit_price)}
                    </span>
                  )}
                </td>
                <td className={`px-2 py-2 text-right tabular-nums font-bold ${
                  t.r_multiple == null ? "text-faint" : t.r_multiple >= 0 ? "text-up" : "text-down"
                }`}>
                  {t.r_multiple == null ? "—" : `${t.r_multiple > 0 ? "+" : ""}${t.r_multiple}R`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-[10px] text-faint border-t border-edge">
        The emotionless bot, on paper: it opens a virtual trade at the signal price with Claude&apos;s suggested
        SL/TP and closes when price hits one. If this runs profitably over time, it&apos;s your green light to go live on Toobit.
      </p>
    </section>
  );
}
