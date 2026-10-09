"use client";

import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from "recharts";

export type Range = "LIVE" | "1D" | "1W" | "1M" | "3M" | "1Y" | "5Y" | "ALL";
export const ASSET_RANGES: Range[] = ["LIVE", "1D", "1W", "1M", "3M", "1Y", "5Y"];
export const NW_RANGES: Range[] = ["LIVE", "1D", "1W", "1M", "1Y", "ALL"];
export const RANGE_LABEL: Record<Range, string> = {
  LIVE: "Past hour", "1D": "Today", "1W": "Past week", "1M": "Past month", "3M": "Past 3 months",
  "1Y": "Past year", "5Y": "Past 5 years", ALL: "All time",
};
/** How often the client re-polls a range so "live" actually moves. */
export const POLL_MS: Partial<Record<Range, number>> = { LIVE: 30_000, "1D": 60_000, "1W": 300_000 };

export interface ChartData {
  points: { t: number; p: number }[];
  baseline: number | null;
  change: number | null;
  change_pct: number | null;
}

export function fmtTime(t: number, range: Range): string {
  const d = new Date(t * 1000);
  if (range === "LIVE" || range === "1D") return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (range === "1W" || range === "1M")
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function pointAt(pts: { t: number; p: number }[], idx: unknown): { t: number; p: number } | null {
  const i = typeof idx === "string" ? parseInt(idx, 10) : typeof idx === "number" ? idx : NaN;
  return Number.isInteger(i) && pts[i] ? pts[i] : null;
}

/**
 * Robinhood-style line: no axes, colored by direction over the range, dashed
 * baseline (previous close) on 1D, and scrubbing reports the hovered point.
 */
export default function PriceChart({
  data, range, height = 200, onScrub,
}: {
  data: ChartData | null;
  range: Range;
  height?: number;
  onScrub?: (pt: { t: number; p: number } | null) => void;
}) {
  const pts = data?.points ?? [];
  if (pts.length < 2) {
    return (
      <div className="flex items-center justify-center text-[11px] text-faint" style={{ height }}>
        {data ? "No chart data for this range" : "Loading chart…"}
      </div>
    );
  }
  const up = (data?.change ?? pts[pts.length - 1].p - pts[0].p) >= 0;
  const color = up ? "var(--color-up)" : "var(--color-down)";
  const gid = `pc-${up ? "u" : "d"}`;

  return (
    <div style={{ height }} className="select-none touch-pan-y">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={pts}
          margin={{ top: 6, right: 0, bottom: 0, left: 0 }}
          // recharts 3 reports the hovered index as a string ("123"), so normalize it
          onMouseMove={(s) => onScrub?.(pointAt(pts, s?.activeTooltipIndex))}
          onTouchMove={(s) => onScrub?.(pointAt(pts, s?.activeTooltipIndex))}
          onMouseLeave={() => onScrub?.(null)}
          onTouchEnd={() => onScrub?.(null)}
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["auto", "auto"]} />
          {range === "1D" && data?.baseline != null && (
            <ReferenceLine y={data.baseline} stroke="var(--color-faint)" strokeDasharray="2 4" strokeOpacity={0.7} />
          )}
          <Tooltip
            cursor={{ stroke: "var(--color-dim)", strokeWidth: 1 }}
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <div className="text-[10px] text-faint tabular-nums px-1">
                  {fmtTime((payload[0].payload as { t: number }).t, range)}
                </div>
              ) : null
            }
          />
          <Area type="monotone" dataKey="p" stroke={color} strokeWidth={1.8} fill={`url(#${gid})`}
                isAnimationActive={false} dot={false} activeDot={{ r: 3.5, fill: color, stroke: "var(--color-bg)" }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RangeTabs({ value, onChange, ranges = ASSET_RANGES }: {
  value: Range; onChange: (r: Range) => void; ranges?: Range[];
}) {
  return (
    <div className="flex justify-between sm:justify-start sm:gap-1">
      {ranges.map((r) => (
        <button key={r} onClick={() => onChange(r)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors flex items-center gap-1 ${
                  value === r ? "bg-up/15 text-up" : "text-dim hover:text-txt"
                }`}>
          {r === "LIVE" && <span className={`w-1.5 h-1.5 rounded-full bg-down ${value === r ? "live-dot" : ""}`} />}
          {r}
        </button>
      ))}
    </div>
  );
}
