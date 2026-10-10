"use client";

import type { EdgeReport, Stats } from "@/lib/types";
import { fmtPnl } from "@/lib/api";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" | "amber" }) {
  const color =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : tone === "amber" ? "text-amber" : "text-txt";
  return (
    <div className="flex flex-col items-center justify-center min-w-0 px-3 py-2.5 bg-panel sm:bg-transparent sm:px-4 sm:py-2 sm:min-w-[90px]">
      <span className="text-[9px] tracking-[0.15em] text-dim uppercase">{label}</span>
      <span className={`max-w-full truncate text-base font-bold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

export default function StatsBar({ stats, edge }: { stats: Stats | null; edge?: EdgeReport | null }) {
  if (!stats) return null;
  const wr = stats.win_rate;
  const aiTake = edge?.ai_take;
  const aiSkip = edge?.ai_skip;
  return (
    <div className="panel overflow-hidden">
     {/* Phones: even 2-column grid with hairline gaps. Desktop: the original centered row. */}
     <div className="grid grid-cols-2 gap-px bg-edge [&>:last-child:nth-child(odd)]:col-span-2
                     sm:flex sm:flex-wrap sm:justify-around sm:gap-0 sm:bg-transparent sm:divide-x sm:divide-edge">
      <Stat
        label="Win Rate"
        value={stats.closed ? `${wr}%` : "—"}
        tone={wr >= 70 ? "up" : wr >= 50 ? "amber" : stats.closed ? "down" : undefined}
      />
      {aiTake && aiTake.total > 0 && (
        <Stat
          label="AI-Take WR"
          value={`${aiTake.win_rate}% (${aiTake.total})`}
          tone={(aiTake.win_rate ?? 0) >= 60 ? "up" : "amber"}
        />
      )}
      {aiSkip && aiSkip.total > 0 && (
        <Stat
          label="AI-Skip WR"
          value={`${aiSkip.win_rate}% (${aiSkip.total})`}
          tone="down"
        />
      )}
      <Stat label="Record" value={`${stats.wins}W/${stats.losses}L`} />
      <Stat
        label="Total P&L"
        value={fmtPnl(stats.total_pnl_pct)}
        tone={stats.total_pnl_pct > 0 ? "up" : stats.total_pnl_pct < 0 ? "down" : undefined}
      />
      <Stat label="Avg RR" value={stats.avg_rr ? `${stats.avg_rr}R` : "—"} tone="amber" />
      <Stat label="Open" value={String(stats.open_trades)} />
      <Stat
        label="Best"
        value={stats.best_trade ? `${stats.best_trade.asset} ${fmtPnl(stats.best_trade.pnl_pct)}` : "—"}
        tone="up"
      />
      <Stat
        label="Worst"
        value={stats.worst_trade ? `${stats.worst_trade.asset} ${fmtPnl(stats.worst_trade.pnl_pct)}` : "—"}
        tone="down"
      />
     </div>
    </div>
  );
}
