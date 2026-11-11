"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { CandlestickChart, LineChart } from "lucide-react";
import { fmtPrice } from "@/lib/api";
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

export interface Candle { t: number; o: number; h: number; l: number; c: number }
export interface Buy { t: number; price: number; qty: number; amount?: number | null }
export type ChartMode = "line" | "candles";

export interface ChartData {
  points: { t: number; p: number }[];
  baseline: number | null;
  change: number | null;
  change_pct: number | null;
  /** open/high/low/close bars, when asked for with ?candles=1 */
  candles?: Candle[];
  /** your average cost per unit, when you hold this and entered a cost */
  avg_cost?: number | null;
  /** your recorded buys inside the range */
  buys?: Buy[];
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
  data, range, height = 200, onScrub, mode = "line", ghost, label,
}: {
  data: ChartData | null;
  range: Range;
  height?: number;
  onScrub?: (pt: Pt | null) => void;
  /** "candles" draws data.candles (falls back to the line until they arrive) */
  mode?: ChartMode;
  /** a second, quieter series on the same scale, one value per point (a benchmark) */
  ghost?: (number | null)[] | null;
  /** what the chart shows, for screen readers */
  label?: string;
}) {
  const bars = mode === "candles" && (data?.candles?.length ?? 0) > 1 ? data!.candles! : null;
  // In candle mode the scrub points are the bars' closes, so the cursor and the hero number follow the bars.
  const pts = useMemo(() => (bars ? bars.map((b) => ({ t: b.t, p: b.c })) : data?.points ?? []), [bars, data]);
  const n = pts.length;
  const avg = data?.avg_cost ?? null;
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
    if (bars) for (const k of bars) { if (k.l < a) a = k.l; if (k.h > b) b = k.h; }
    if (ghost) for (const g of ghost) { if (g != null) { if (g < a) a = g; if (g > b) b = g; } }
    if (range === "1D" && data?.baseline != null) { a = Math.min(a, data.baseline); b = Math.max(b, data.baseline); }
    // Average cost joins the scale only when it sits near the prices; a far-away cost would flatten the line.
    const span = b - a || Math.abs(b) || 1;
    if (avg != null && avg > a - span * 0.5 && avg < b + span * 0.5) { a = Math.min(a, avg); b = Math.max(b, avg); }
    const pad = (b - a || Math.abs(b) || 1) * 0.06;
    return [a - pad, b + pad];
  }, [pts, n, bars, ghost, avg, range, data?.baseline]);

  // Reset the cursor whenever the data or range changes.
  useEffect(() => { shown.current = null; setIdx(null); }, [data, range]);

  const chart = useMemo(() => {
    if (n < 2 || bars) return null;
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
  }, [pts, n, bars, up, color, lo, hi, range, data?.baseline]);

  // One mapping for everything drawn over the plot: x as a 0..1 fraction, y in px.
  const xOf = (i: number) => (bars ? (i + 0.5) / n : n > 1 ? i / (n - 1) : 0);
  const yOf = (p: number) => TOP + ((hi - p) / (hi - lo || 1)) * (height - TOP);
  const inScale = (p: number) => p >= lo && p <= hi;

  const candleSvg = useMemo(() => {
    if (!bars) return null;
    const y = (p: number) => TOP + ((hi - p) / (hi - lo || 1)) * (height - TOP);
    return (
      <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${n} ${height}`} preserveAspectRatio="none" aria-hidden>
        {bars.map((k, i) => {
          const c = k.c >= k.o ? "var(--color-up)" : "var(--color-down)";
          const top = y(Math.max(k.o, k.c)), bot = y(Math.min(k.o, k.c));
          return (
            <g key={k.t}>
              <line x1={i + 0.5} x2={i + 0.5} y1={y(k.h)} y2={y(k.l)} stroke={c} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <rect x={i + 0.18} width={0.64} y={top} height={Math.max(1, bot - top)} fill={c} />
            </g>
          );
        })}
      </svg>
    );
  }, [bars, n, lo, hi, height]);

  // Buys land on the nearest point in time.
  const marks = useMemo(() => {
    const out: { i: number; b: Buy }[] = [];
    if (n < 2) return out;
    for (const b of data?.buys ?? []) {
      if (b.t < pts[0].t - 86_400) continue;
      let best = 0;
      for (let i = 1; i < n; i++) if (Math.abs(pts[i].t - b.t) < Math.abs(pts[best].t - b.t)) best = i;
      out.push({ i: best, b });
    }
    return out;
  }, [data?.buys, pts, n]);

  const ghostPath = useMemo(() => {
    if (!ghost || n < 2 || bars) return null;
    const y = (p: number) => TOP + ((hi - p) / (hi - lo || 1)) * (height - TOP);
    let d = "", pen = false;
    ghost.forEach((g, i) => {
      if (g == null || i >= n) { pen = false; return; }
      d += `${pen ? "L" : "M"}${((i / (n - 1)) * 1000).toFixed(1)} ${y(g).toFixed(1)}`;
      pen = true;
    });
    return d || null;
  }, [ghost, n, bars, lo, hi, height]);

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
    const i = bars ? Math.min(n - 1, Math.floor(f * n)) : Math.round(f * (n - 1));
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

  const xPct = idx != null ? xOf(idx) * 100 : 0;
  const yPx = idx != null ? yOf(pts[idx].p) : 0;
  const bar = bars && idx != null ? bars[idx] : null;
  const hit = idx != null ? marks.filter((m) => m.i === idx) : [];
  const dotColor = bar ? (bar.c >= bar.o ? "var(--color-up)" : "var(--color-down)") : color;

  return (
    <div ref={wrap} data-noswipe style={{ height }} className="relative select-none" role="img"
         aria-label={label ?? `${bars ? "Candlestick" : "Line"} chart, ${RANGE_LABEL[range].toLowerCase()}`}>
      {chart}
      {candleSvg}
      {ghostPath && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" aria-hidden>
          <path d={ghostPath} fill="none" stroke="var(--color-dim)" strokeWidth={1.5} strokeDasharray="1 5" strokeLinecap="round"
                vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {avg != null && inScale(avg) && (
        <div className="absolute left-0 right-0 border-t border-dashed border-dim/70 pointer-events-none" style={{ top: yOf(avg) }}>
          <span className="absolute left-1 -top-[15px] px-1 rounded bg-bg/80 text-[10px] leading-[14px] text-dim tabular-nums">
            avg cost ${fmtPrice(avg)}
          </span>
        </div>
      )}
      {marks.map((m, k) => (
        // 9px dot in text ink with a 2px surface ring: reads on the line, on a candle and in either theme
        <div key={k} className="absolute w-[9px] h-[9px] -ml-[4.5px] -mt-[4.5px] rounded-full bg-txt ring-2 ring-bg pointer-events-none"
             style={{ left: `${xOf(m.i) * 100}%`, top: yOf(Math.min(hi, Math.max(lo, m.b.price))) }} />
      ))}
      {idx != null && (
        <>
          {/* dim everything to the right of the cursor, like Robinhood */}
          <div className="absolute top-0 bottom-0 right-0 bg-bg/55 pointer-events-none" style={{ left: `${xPct}%` }} />
          <div className="absolute top-0 bottom-0 w-px bg-dim/70 pointer-events-none" style={{ left: `${xPct}%` }} />
          <div className="absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full pointer-events-none ring-2 ring-bg"
               style={{ left: `${xPct}%`, top: yPx, background: dotColor }} />
          <div className="absolute -top-1 -translate-x-1/2 px-1.5 rounded text-[10px] text-dim tabular-nums whitespace-nowrap pointer-events-none bg-bg/80 text-center"
               style={{ left: `clamp(${bar || hit.length ? 84 : 32}px, ${xPct}%, calc(100% - ${bar || hit.length ? 84 : 32}px))` }}>
            {fmtTime(pts[idx].t, range)}
            {bar && <div>O {fmtPrice(bar.o)} · H {fmtPrice(bar.h)} · L {fmtPrice(bar.l)} · C {fmtPrice(bar.c)}</div>}
            {hit.map((m, k) => <div key={k} className="text-txt">You bought {+m.b.qty.toFixed(4)} at ${fmtPrice(m.b.price)}</div>)}
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

const MODE_KEY = "chart-mode";

/** Line or candles, remembered on this device. */
export function useChartMode(): [ChartMode, (m: ChartMode) => void] {
  const [mode, setMode] = useState<ChartMode>("line");
  useEffect(() => {
    try { if (localStorage.getItem(MODE_KEY) === "candles") setMode("candles"); } catch { /* private mode */ }
  }, []);
  return [mode, (m) => {
    setMode(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* private mode */ }
  }];
}

export function ChartModeToggle({ mode, onChange }: { mode: ChartMode; onChange: (m: ChartMode) => void }) {
  const candles = mode === "candles";
  return (
    <button type="button" aria-pressed={candles} onClick={() => onChange(candles ? "line" : "candles")}
            aria-label="Candlestick view" title={candles ? "Switch to line" : "Switch to candles"}
            className={`shrink-0 w-10 h-10 grid place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-up ${
              candles ? "bg-up/15 text-up" : "text-dim hover:text-txt hover:bg-panel2"
            }`}>
      {candles ? <CandlestickChart size={17} aria-hidden /> : <LineChart size={17} aria-hidden />}
    </button>
  );
}

/** One line under an asset chart: your average cost and where the price stands against it. */
export function PositionNote({ data, price }: { data: ChartData | null; price: number | null }) {
  const avg = data?.avg_cost;
  const buys = data?.buys?.length ?? 0;
  if (avg == null && !buys) return null;
  const pct = avg && price != null ? (price / avg - 1) * 100 : null;
  return (
    <p className="px-4 mt-2 text-[11.5px] text-dim tabular-nums">
      {avg != null && <>Your average cost is <span className="text-txt font-semibold">${fmtPrice(avg)}</span></>}
      {pct != null && <>, so you&apos;re {pct >= 0 ? "up" : "down"} <span className="text-txt font-semibold">{Math.abs(pct).toFixed(1)}%</span></>}
      {avg != null && "."}
      {buys > 0 && <> {avg != null ? "Dots" : "The dots"} mark {buys === 1 ? "a buy" : `${buys} buys`} in this range.</>}
    </p>
  );
}
