"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import Skeleton from "./Skeleton";

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

type Pt = { t: number; p: number };

/**
 * Robinhood-style line: no axes, colored by direction over the range, dashed
 * baseline (previous close) on 1D.
 *
 * Scrubbing is handled by our own pointer layer instead of recharts' tooltip:
 * the chart SVG renders once (memoized) and only the cursor line / dot / dimmed
 * "future" overlay move, mapped straight from pointer x → point index. That
 * removes the flicker (no "no point" gaps between samples), keeps 60fps on long
 * ranges, and keeps tracking a finger for the whole drag on phones.
 */
export default function PriceChart({
  data, range, height = 200, onScrub,
}: {
  data: ChartData | null;
  range: Range;
  height?: number;
  onScrub?: (pt: Pt | null) => void;
}) {
  const pts = useMemo(() => data?.points ?? [], [data]);
  const n = pts.length;
  const wrap = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState<number | null>(null);
  const frame = useRef<number | null>(null);
  const lastX = useRef(0);
  const shown = useRef<number | null>(null); // index currently reported to the parent

  const up = n > 1 ? (data?.change ?? pts[n - 1].p - pts[0].p) >= 0 : true;
  const color = up ? "var(--color-up)" : "var(--color-down)";

  // Explicit y-domain (with padding) so the overlay can place the dot exactly on the line.
  const [lo, hi] = useMemo(() => {
    if (n < 2) return [0, 1];
    let a = Infinity, b = -Infinity;
    for (const q of pts) { if (q.p < a) a = q.p; if (q.p > b) b = q.p; }
    if (range === "1D" && data?.baseline != null) { a = Math.min(a, data.baseline); b = Math.max(b, data.baseline); }
    const pad = (b - a || Math.abs(b) || 1) * 0.06;
    return [a - pad, b + pad];
  }, [pts, n, range, data?.baseline]);

  // Reset the cursor whenever the data or range changes.
  useEffect(() => { shown.current = null; setIdx(null); }, [data, range]);

  const chart = useMemo(() => {
    if (n < 2) return null;
    const gid = `pc-${up ? "u" : "d"}`;
    const rows = pts.map((q, i) => ({ i, p: q.p }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: TOP, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis hide dataKey="i" type="number" domain={[0, n - 1]} />
          <YAxis hide domain={[lo, hi]} allowDataOverflow />
          {range === "1D" && data?.baseline != null && (
            <ReferenceLine y={data.baseline} stroke="var(--color-faint)" strokeDasharray="2 4" strokeOpacity={0.7} />
          )}
          <Area type="linear" dataKey="p" stroke={color} strokeWidth={1.8} fill={`url(#${gid})`}
                isAnimationActive={false} dot={false} activeDot={false} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }, [pts, n, up, color, lo, hi, range, data?.baseline]);

  if (n < 2) {
    return (
      data ? (
        <div className="flex items-center justify-center text-[11px] text-faint" style={{ height }}>No chart data for this range</div>
      ) : (
        <Skeleton className="mx-1" style={{ height }} />
      )
    );
  }

  const update = () => {
    frame.current = null;
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (lastX.current - r.left) / r.width));
    const i = Math.round(f * (n - 1));
    if (shown.current === i) return;  // same point: nothing to redraw
    shown.current = i;
    setIdx(i);
    onScrub?.(pts[i]);
  };
  const move = (clientX: number) => {
    lastX.current = clientX;
    if (frame.current == null) frame.current = requestAnimationFrame(update); // ≤1 update per frame
  };
  const clear = () => {
    if (frame.current != null) { cancelAnimationFrame(frame.current); frame.current = null; }
    shown.current = null;
    setIdx(null);
    onScrub?.(null);
  };

  const xPct = idx != null ? (idx / (n - 1)) * 100 : 0;
  const yPx = idx != null ? TOP + ((hi - pts[idx].p) / (hi - lo)) * (height - TOP) : 0;

  return (
    <div ref={wrap} data-noswipe style={{ height }} className="relative select-none">
      {chart}
      {idx != null && (
        <>
          {/* dim everything to the right of the cursor, like Robinhood */}
          <div className="absolute top-0 bottom-0 right-0 bg-bg/55 pointer-events-none" style={{ left: `${xPct}%` }} />
          <div className="absolute top-0 bottom-0 w-px bg-dim/70 pointer-events-none" style={{ left: `${xPct}%` }} />
          <div className="absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full pointer-events-none ring-2 ring-bg"
               style={{ left: `${xPct}%`, top: yPx, background: color }} />
          <div className="absolute -top-1 -translate-x-1/2 px-1.5 rounded text-[10px] text-dim tabular-nums whitespace-nowrap pointer-events-none bg-bg/80"
               style={{ left: `clamp(32px, ${xPct}%, calc(100% - 32px))` }}>
            {fmtTime(pts[idx].t, range)}
          </div>
        </>
      )}
      {/* interaction layer: mouse hover + finger drag (vertical swipes still scroll the page) */}
      <div
        className="absolute inset-0 cursor-crosshair"
        style={{ touchAction: "pan-y" }}
        onPointerDown={(e) => { if (e.pointerType !== "mouse") (e.target as HTMLElement).setPointerCapture(e.pointerId); move(e.clientX); }}
        onPointerMove={(e) => move(e.clientX)}
        onPointerUp={(e) => { if (e.pointerType !== "mouse") clear(); }}
        onPointerCancel={clear}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") clear(); }}
      />
    </div>
  );
}

const TOP = 6; // chart top margin (px), shared by the SVG and the overlay math

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
