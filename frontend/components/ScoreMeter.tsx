"use client";

import type { ScoreBlock } from "@/lib/types";

// Score band → color. High score = good long-term buy (green), low = overbought (red).
function bandColor(score: number): string {
  if (score >= 75) return "var(--color-up)";
  if (score >= 60) return "var(--color-cyan)";
  if (score >= 40) return "var(--color-amber)";
  if (score >= 25) return "var(--color-warn)";
  return "var(--color-down)";
}

export default function ScoreMeter({
  score,
  compact = false,
}: {
  score: ScoreBlock | null;
  compact?: boolean;
}) {
  if (!score) {
    return <span className="text-[10px] text-faint">no data</span>;
  }
  const color = bandColor(score.score);
  return (
    <div className={compact ? "w-full" : "w-full space-y-1"}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold tabular-nums" style={{ color }}>
          {score.score}
        </span>
        <span className="text-[10px] font-semibold" style={{ color }}>
          {score.label}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-edge overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.max(2, score.score)}%`, background: color }}
        />
      </div>
      {!compact && (
        <div className="flex items-center gap-2.5 text-[9px] text-faint tabular-nums pt-0.5">
          {score.rsi != null && <span>RSI {score.rsi}</span>}
          {score.vs_200dma_pct != null && (
            <span>
              200MA {score.vs_200dma_pct > 0 ? "+" : ""}
              {score.vs_200dma_pct}%
            </span>
          )}
          <span className={score.trend === "uptrend" ? "text-up" : score.trend === "downtrend" ? "text-down" : ""}>
            {score.trend}
          </span>
        </div>
      )}
    </div>
  );
}
