"use client";

import InfoTip from "./InfoTip";
import { useEffect, useState } from "react";
import { RefreshCw, Target } from "lucide-react";
import type { ScoredAsset } from "@/lib/types";
import { api, fmtPrice } from "@/lib/api";
import { openTicker } from "@/lib/bus";
import StarButton from "./StarButton";

function bandColor(score: number): string {
  if (score >= 75) return "var(--color-up)";
  if (score >= 60) return "var(--color-cyan)";
  if (score >= 40) return "var(--color-amber)";
  if (score >= 25) return "var(--color-warn)";
  return "var(--color-down)";
}

export default function TopBuys() {
  const [assets, setAssets] = useState<ScoredAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "crypto" | "stock">("all");

  const load = () => {
    setLoading(true);
    api
      .get<{ assets: ScoredAsset[] }>("/api/markets/top-buys")
      .then((r) => setAssets(r.assets))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const shown = assets.filter((a) => filter === "all" || a.kind === filter);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">
          <Target size={14} /> Top Buys
          <span className="panel-sub text-[10px] text-faint font-medium ml-1">crypto + stocks, best long-term score first</span>
        </span>
        <div className="flex items-center gap-2">
          <InfoTip topic="Telegram alerts">
            <p>Telegram alerts fire when any watched asset crosses into Accumulate (≥75) or Extremely overbought (≤25).</p>
          </InfoTip>
          <div className="seg flex rounded-lg border border-edge2 text-[10px]">
            {(["all", "crypto", "stock"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2 py-1 font-bold capitalize transition-colors ${
                  filter === f ? "bg-panel2 text-up" : "text-dim hover:text-txt"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <button className="btn !py-1.5 !px-2" onClick={load} disabled={loading} title="Refresh">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="divide-y divide-edge">
        {shown.length === 0 && (
          <p className="px-3 py-6 text-center text-dim text-xs">
            {loading ? "Scoring markets…" : "No data yet — try refresh."}
          </p>
        )}
        {shown.map((a, i) => {
          const score = a.score ?? 0;
          const color = bandColor(score);
          return (
            <div
              key={`${a.kind}-${a.id}`}
              role="button"
              tabIndex={0}
              onClick={() => openTicker({ symbol: a.symbol, kind: a.kind, cgId: a.kind === "crypto" ? a.id : undefined })}
              className="w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-panel2 transition-colors cursor-pointer"
              title="Chart, why it scores this way, score history"
            >
              <span className="text-xs text-faint font-bold tabular-nums w-5">{i + 1}</span>
              <span
                className={`shrink-0 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${
                  a.kind === "crypto" ? "bg-amber/15 text-amber" : "bg-cyan/15 text-cyan"
                }`}
              >
                {a.kind === "crypto" ? "Crypto" : "Stock"}
              </span>
              <span className="font-bold text-txt text-sm w-16">{a.symbol}</span>
              <span className="tabular-nums text-xs text-dim w-20 text-right">
                {a.price != null ? `$${fmtPrice(a.price)}` : "—"}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-edge overflow-hidden ml-2">
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, score)}%`, background: color }} />
              </div>
              <span className="tabular-nums text-sm font-bold w-9 text-right" style={{ color }}>
                {a.score}
              </span>
              <span className="text-[10px] font-semibold w-32 text-right hidden sm:block" style={{ color }}>
                {a.label}
              </span>
              <StarButton symbol={a.symbol} kind={a.kind} size={13} />
            </div>
          );
        })}
      </div>

    </section>
  );
}
