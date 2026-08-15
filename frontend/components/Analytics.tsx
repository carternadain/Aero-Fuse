"use client";

import { useEffect, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import type { Analytics as AnalyticsT, AnalyticsBucket } from "@/lib/types";
import { api } from "@/lib/api";

function Metric({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-txt";
  return (
    <div className="flex flex-col px-3 py-2">
      <span className="text-[9px] uppercase tracking-wide text-faint">{label}</span>
      <span className={`text-base font-bold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

function BucketTable({ title, rows }: { title: string; rows: AnalyticsBucket[] }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-faint font-semibold">{title}</p>
      {rows.length === 0 && <p className="text-[11px] text-faint">—</p>}
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2 text-[11px]">
          <span className="w-20 truncate text-dim font-medium">{r.key}</span>
          <span className="w-8 tabular-nums text-faint">{r.trades}t</span>
          <span className={`w-12 tabular-nums ${r.win_rate >= 50 ? "text-up" : "text-down"}`}>{r.win_rate}%</span>
          <div className="flex-1 h-1.5 rounded-full bg-edge overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.abs(r.expectancy_r) * 30)}%`,
                background: r.expectancy_r >= 0 ? "var(--color-up)" : "var(--color-down)",
              }}
            />
          </div>
          <span className={`w-12 text-right tabular-nums font-bold ${r.expectancy_r >= 0 ? "text-up" : "text-down"}`}>
            {r.expectancy_r > 0 ? "+" : ""}{r.expectancy_r}R
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Analytics() {
  const [a, setA] = useState<AnalyticsT | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get<AnalyticsT>("/api/analytics").then(setA).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">
          <BarChart3 size={14} /> Performance
          <span className="text-[10px] text-faint font-medium ml-1">in R (risk units){a ? ` · ${a.sample} trades` : ""}</span>
        </span>
        <button className="btn !py-1.5 !px-2" onClick={load} disabled={loading} title="Refresh">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {!a || a.sample === 0 ? (
        <p className="p-4 text-xs text-dim">
          {loading ? "Crunching trades…" : "No closed trades yet — analytics appear once you close some."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-edge border-b border-edge">
            <Metric label="Expectancy" value={`${a.expectancy_r > 0 ? "+" : ""}${a.expectancy_r}R`} tone={a.expectancy_r >= 0 ? "up" : "down"} />
            <Metric label="Profit factor" value={a.profit_factor != null ? `${a.profit_factor}` : "—"} tone={(a.profit_factor ?? 0) >= 1 ? "up" : "down"} />
            <Metric label="Avg win" value={`+${a.avg_win_r}R`} tone="up" />
            <Metric label="Avg loss" value={`${a.avg_loss_r}R`} tone="down" />
            <Metric label="Total" value={`${a.total_r > 0 ? "+" : ""}${a.total_r}R`} tone={a.total_r >= 0 ? "up" : "down"} />
            <Metric label="Best / worst" value={`+${a.best_r} / ${a.worst_r}`} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-3">
            <BucketTable title="By signal source" rows={a.by_source} />
            <BucketTable title="By asset" rows={a.by_asset} />
            <BucketTable title="By entry hour (UTC)" rows={a.by_hour} />
          </div>
          <p className="px-3 pb-2 text-[10px] text-faint">
            Expectancy = average R earned per trade. Positive expectancy + profit factor &gt; 1 = a real edge. Each
            bar shows which setups, assets, and times actually make you money.
          </p>
        </>
      )}
    </section>
  );
}
