"use client";

import InfoTip from "./InfoTip";
import Skeleton from "./Skeleton";
import StarButton from "./StarButton";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Layers, RefreshCw } from "lucide-react";
import { Area, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { Zone, ZoneChartRange, ZoneChartResponse, ZoneHolding, ZonesResponse } from "@/lib/types";
import { api, fmtPnl, fmtPrice } from "@/lib/api";
import { haptic, navigate } from "@/lib/bus";
import { fmtCents, isHidden } from "@/lib/privacy";

type Kind = "stock" | "crypto";
interface Sel { kind: Kind; symbol: string }

const LS_KEY = "buyzones:sel";
const ZONE_COLOR: Record<Zone, string> = { buy: "var(--color-up)", hold: "var(--color-dim)", sell: "var(--color-down)" };
const ZONE_BG: Record<Zone, string> = { buy: "bg-up", hold: "bg-dim", sell: "bg-down" };
const ZONE_NAME: Record<Zone, string> = { buy: "Buy zone", hold: "Hold", sell: "Sell zone" };
// Hold is quiet grey everywhere: hero, track, line and legend.
const LINE_COLOR: Record<Zone, string> = { buy: "var(--color-up)", hold: "var(--color-dim)", sell: "var(--color-down)" };
const LINE_BG: Record<Zone, string> = { buy: "bg-up", hold: "bg-dim", sell: "bg-down" };

const RANGE_KEY = "buyzones:range";
const RANGES: { key: ZoneChartRange; label: string; past: string }[] = [
  { key: "1Y", label: "1Y", past: "past year" },
  { key: "3Y", label: "3Y", past: "past 3 years" },
  { key: "5Y", label: "5Y", past: "past 5 years" },
  { key: "MAX", label: "Max", past: "all time" },
];
const isRange = (v: unknown): v is ZoneChartRange => RANGES.some((r) => r.key === v);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d: string) => { const [y, m, day] = d.split("-").map(Number); return `${MONTHS[m - 1]} ${day}, ${y}`; };
const fmtMonYr = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ’${d.slice(2, 4)}`;
const fmtChange = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;

type ChartPoint = ZoneChartResponse["points"][number];
const CHART_TOP = 8;   // px, chart top margin
const AXIS_H = 22;     // px, x-axis band; the overlay plot box sits between these two

export function zoneOf(score: number | null | undefined): Zone | null {
  if (score == null) return null;
  return score >= 60 ? "buy" : score >= 40 ? "hold" : "sell";
}

function labelOf(score: number): string {
  if (score >= 75) return "Accumulate";
  if (score >= 60) return "Buy zone";
  if (score >= 40) return "Neutral";
  if (score >= 25) return "Overbought";
  return "Extremely overbought";
}

function Cell({ k, v, note }: { k: string; v: React.ReactNode; note: string }) {
  return (
    <div className="rounded-lg bg-panel2/60 px-2.5 py-2 min-w-0">
      <div className="text-[10px] text-faint truncate">{k}</div>
      <div className="font-bold tabular-nums text-txt text-[13px] truncate">{v}</div>
      <div className="text-[10px] text-faint leading-snug mt-0.5">{note}</div>
    </div>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[10px] font-bold tracking-widest text-faint uppercase">{children}</div>
);

function Row({ h, onPick }: { h: ZoneHolding; onPick: (h: ZoneHolding) => void }) {
  const z = h.zone ?? zoneOf(h.score?.score);
  const c = z ? ZONE_COLOR[z] : "var(--color-dim)";
  return (
    <button
      onClick={() => onPick(h)}
      className="w-full min-h-[44px] flex items-center gap-2 px-3 py-2 text-left hover:bg-panel2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan"
    >
      <span className="font-bold text-txt text-sm w-14 shrink-0 truncate">{h.symbol}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold truncate" style={{ color: c }}>
          {h.score?.label ?? "—"} <span className="tabular-nums text-dim font-normal">· {h.score ? Math.round(h.score.score) : "—"}</span>
        </span>
        <span className="block text-[10px] text-faint tabular-nums truncate">
          {h.weight_pct.toFixed(1)}% of holdings{isHidden() ? "" : ` · ${fmtCents(h.value)}`}
        </span>
      </span>
      {h.gain_pct != null && (
        <span className={`tabular-nums text-[12px] font-bold shrink-0 ${h.gain_pct >= 0 ? "text-up" : "text-down"}`}>{fmtPnl(h.gain_pct)}</span>
      )}
    </button>
  );
}

function Group({ title, rows, empty, onPick }: { title: string; rows: ZoneHolding[]; empty: string; onPick: (h: ZoneHolding) => void }) {
  return (
    <div>
      <div className="px-3 pt-3 pb-1"><Label>{title}</Label></div>
      {rows.length === 0 ? (
        <p className="px-3 pb-2 text-xs text-dim">{empty}</p>
      ) : (
        <div className="divide-y divide-edge">{rows.map((h) => <Row key={`${h.kind}-${h.symbol}`} h={h} onPick={onPick} />)}</div>
      )}
    </div>
  );
}

/** Apple Stocks-style price line, coloured along its length by zone, with a scrub readout. */
function ZoneChart({ chart, range, dim }: { chart: ZoneChartResponse; range: ZoneChartRange; dim: boolean }) {
  const points = chart.points;
  const n = points.length;
  const gid = `zc${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const plotRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState<number | null>(null);
  useEffect(() => setIdx(null), [chart]);

  const zoneAt = useCallback((p: ChartPoint): Zone => zoneOf(p.score) ?? "hold", []);

  // Hard colour stops: two stops at the same offset wherever the zone changes.
  const stops = useMemo(() => {
    const out: { o: number; z: Zone }[] = [];
    let prev: Zone | null = null;
    points.forEach((p, i) => {
      const z = zoneAt(p);
      const o = n > 1 ? i / (n - 1) : 0;
      if (prev == null) out.push({ o: 0, z });
      else if (z !== prev) out.push({ o, z: prev }, { o, z });
      prev = z;
    });
    if (prev) out.push({ o: 1, z: prev });
    return out;
  }, [points, n, zoneAt]);

  const ticks = useMemo(() => {
    const keyLen = range === "1Y" ? 7 : 4;
    const cand: number[] = [];
    for (let i = 1; i < n; i++) {
      const f = i / (n - 1);
      if (f > 0.05 && f < 0.95 && points[i].date.slice(0, keyLen) !== points[i - 1].date.slice(0, keyLen)) cand.push(i);
    }
    const step = Math.max(1, Math.ceil(cand.length / 5));
    return cand.filter((_, k) => k % step === 0).map((i) => points[i].date);
  }, [points, n, range]);

  // Fixed y-domain with headroom so the high / low labels fit inside the plot.
  const { dLo, dHi, hiIdx, loIdx } = useMemo(() => {
    let hi = 0, lo = 0;
    points.forEach((p, i) => { if (p.price > points[hi].price) hi = i; if (p.price < points[lo].price) lo = i; });
    const find = (d: string | undefined, fb: number) => { const k = d ? points.findIndex((p) => p.date === d) : -1; return k >= 0 ? k : fb; };
    const max = points[hi].price, min = points[lo].price;
    const span = max - min || Math.abs(max) * 0.1 || 1;
    return { dLo: min - span * 0.14, dHi: max + span * 0.16, hiIdx: find(chart.high?.date, hi), loIdx: find(chart.low?.date, lo) };
  }, [points, chart.high, chart.low]);

  const xPct = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 0);
  const yPct = (v: number) => ((dHi - v) / (dHi - dLo)) * 100;
  const labelPos = (i: number): React.CSSProperties => {
    const f = xPct(i);
    return f < 28 ? { left: `${f}%` } : f > 72 ? { left: `${f}%`, transform: "translateX(-100%)" } : { left: `${f}%`, transform: "translateX(-50%)" };
  };

  const at = (clientX: number) => {
    const r = plotRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setIdx(Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (n - 1)));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const cur = idx ?? n - 1;
    const next = e.key === "ArrowLeft" ? cur - 1 : e.key === "ArrowRight" ? cur + 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (next == null) return;
    e.preventDefault();
    setIdx(Math.min(n - 1, Math.max(0, next)));
  };

  const sp = idx != null ? points[idx] : null;
  const sz = sp ? zoneAt(sp) : null;
  const pastLabel = RANGES.find((r) => r.key === range)?.past ?? "";
  const hiPrice = chart.high?.price ?? points[hiIdx].price;
  const loPrice = chart.low?.price ?? points[loIdx].price;
  const share = chart.zone_share;

  return (
    <div>
      {/* Readout: range change at rest, the scrubbed point while touching */}
      <div className="min-h-[76px] px-1 flex flex-col justify-end" aria-live="off">
        {sp && sz ? (
          <>
            <div className="text-[28px] leading-none font-bold tabular-nums text-txt">${fmtPrice(sp.price)}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-dim tabular-nums">
              <span>{fmtDate(sp.date)}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-edge2 px-2 py-0.5 text-[11px] text-txt">
                <span className={`w-2 h-2 rounded-full ${LINE_BG[sz]}`} aria-hidden />
                {sp.score == null ? "No score" : ZONE_NAME[sz]}
              </span>
            </div>
          </>
        ) : (
          <div className="flex items-baseline gap-2 tabular-nums">
            {chart.change_pct != null && (
              <span className={`text-[28px] leading-none font-bold ${chart.change_pct >= 0 ? "text-up" : "text-down"}`}>{fmtChange(chart.change_pct)}</span>
            )}
            <span className="text-[12px] text-dim">{chart.change_pct != null ? `· ${pastLabel}` : pastLabel}</span>
          </div>
        )}
      </div>

      <div
        data-noswipe
        tabIndex={0}
        role="img"
        aria-label={`${chart.symbol} price over the ${pastLabel}, coloured by buy, hold and sell zone. Use the arrow keys to move through dates.`}
        onKeyDown={onKey}
        onBlur={() => setIdx(null)}
        className={`relative mt-2 h-[240px] sm:h-[300px] select-none rounded-md outline-none focus-visible:outline-2 focus-visible:outline-cyan motion-safe:transition-opacity motion-safe:duration-200 ${dim ? "opacity-60" : ""}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: CHART_TOP, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`${gid}-line`} x1="0" y1="0" x2="1" y2="0">
                {stops.map((s, i) => <stop key={i} offset={s.o} style={{ stopColor: LINE_COLOR[s.z] }} />)}
              </linearGradient>
              <linearGradient id={`${gid}-fade`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: "var(--color-txt)", stopOpacity: 0.06 }} />
                <stop offset="1" style={{ stopColor: "var(--color-txt)", stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" ticks={ticks} interval={0} height={AXIS_H} tickLine={false} axisLine={false} tickMargin={6}
                   tick={{ fontSize: 11, fill: "var(--color-faint)" }}
                   tickFormatter={(d: string) => (range === "1Y" ? MONTHS[Number(d.slice(5, 7)) - 1] : `’${d.slice(2, 4)}`)} />
            <YAxis hide domain={[dLo, dHi]} />
            <Area type="monotone" dataKey="price" stroke="none" fill={`url(#${gid}-fade)`} isAnimationActive={false} />
            <Line type="monotone" dataKey="price" stroke={`url(#${gid}-line)`} strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>

        {/* Plot-area overlay: markers positioned in % of the exact plot box */}
        <div ref={plotRef} className="absolute inset-x-0 pointer-events-none" style={{ top: CHART_TOP, bottom: AXIS_H }}>
          <div className={`absolute inset-0 motion-safe:transition-opacity ${sp ? "opacity-0" : ""}`}>
            <span className="absolute w-1.5 h-1.5 -ml-[3px] -mt-[3px] rounded-full bg-dim ring-2 ring-panel" style={{ left: `${xPct(hiIdx)}%`, top: `${yPct(hiPrice)}%` }} />
            <span className="absolute -translate-y-[calc(100%+6px)] whitespace-nowrap text-[10px] text-dim tabular-nums" style={{ ...labelPos(hiIdx), top: `${yPct(hiPrice)}%` }}>
              High ${fmtPrice(hiPrice)} · {fmtMonYr(chart.high?.date ?? points[hiIdx].date)}
            </span>
            {loIdx !== hiIdx && (
              <>
                <span className="absolute w-1.5 h-1.5 -ml-[3px] -mt-[3px] rounded-full bg-faint ring-2 ring-panel" style={{ left: `${xPct(loIdx)}%`, top: `${yPct(loPrice)}%` }} />
                <span className="absolute mt-2 whitespace-nowrap text-[10px] text-faint tabular-nums" style={{ ...labelPos(loIdx), top: `${yPct(loPrice)}%` }}>
                  Low ${fmtPrice(loPrice)} · {fmtMonYr(chart.low?.date ?? points[loIdx].date)}
                </span>
              </>
            )}
          </div>
          {sp && sz && idx != null && (
            <>
              <div className="absolute top-0 bottom-0 w-px bg-faint" style={{ left: `${xPct(idx)}%` }} />
              <span className={`absolute w-2 h-2 -ml-1 -mt-1 rounded-full ring-2 ring-panel ${LINE_BG[sz]}`} style={{ left: `${xPct(idx)}%`, top: `${yPct(sp.price)}%` }} />
            </>
          )}
        </div>

        {/* Interaction layer: mouse hover + finger drag (vertical swipes still scroll the page) */}
        <div
          className="absolute inset-0 cursor-crosshair"
          style={{ touchAction: "pan-y" }}
          onPointerDown={(e) => { if (e.pointerType !== "mouse") (e.target as HTMLElement).setPointerCapture(e.pointerId); at(e.clientX); }}
          onPointerMove={(e) => at(e.clientX)}
          onPointerUp={(e) => { if (e.pointerType !== "mouse") setIdx(null); }}
          onPointerCancel={() => setIdx(null)}
          onPointerLeave={(e) => { if (e.pointerType === "mouse") setIdx(null); }}
        />
      </div>

      <div className="mt-2 px-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-dim">
        {(["buy", "hold", "sell"] as const).map((z) => (
          <span key={z} className="inline-flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${LINE_BG[z]}`} aria-hidden />{z === "hold" ? "Hold" : ZONE_NAME[z]}
          </span>
        ))}
        {share && (
          <span className="text-faint tabular-nums">In buy zone {Math.round(share.buy)}% of days, sell zone {Math.round(share.sell)}%</span>
        )}
      </div>
    </div>
  );
}

export default function BuyZones() {
  const [data, setData] = useState<ZonesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [sel, setSel] = useState<Sel | null>(null);
  const [chart, setChart] = useState<ZoneChartResponse | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [range, setRange] = useState<ZoneChartRange>(() => {
    try { const r = localStorage.getItem(RANGE_KEY); if (isRange(r)) return r; } catch { /* unavailable */ }
    return "1Y";
  });
  const heroRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    api
      .get<ZonesResponse>("/api/zones")
      .then(setData)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  // Default / remembered selection
  useEffect(() => {
    if (!data || sel) return;
    let saved: Sel | null = null;
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { /* unavailable */ }
    const exists = (s: Sel) =>
      data.holdings.some((h) => h.symbol === s.symbol && h.kind === s.kind) ||
      data.watch.some((w) => w.symbol === s.symbol && w.kind === s.kind);
    if (saved && saved.symbol && exists(saved)) { setSel(saved); return; }
    const first = data.holdings[0] ?? data.watch[0];
    if (first) setSel({ kind: first.kind, symbol: first.symbol });
  }, [data, sel]);

  const choose = (s: Sel) => {
    setSel(s);
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* unavailable */ }
  };

  const chooseRange = (r: ZoneChartRange) => {
    haptic();
    setRange(r);
    try { localStorage.setItem(RANGE_KEY, r); } catch { /* unavailable */ }
  };

  // Chart data. The previous chart stays on screen (dimmed) while the next one loads.
  useEffect(() => {
    if (!sel) return;
    let live = true;
    setChartLoading(true);
    api
      .get<ZoneChartResponse>(`/api/zones/chart/${sel.kind}/${encodeURIComponent(sel.symbol)}?range=${range}`)
      .then((r) => live && setChart(r))
      .catch(() => live && setChart(null))
      .finally(() => live && setChartLoading(false));
    return () => { live = false; };
  }, [sel, range]);

  const holding = data?.holdings.find((h) => sel && h.symbol === sel.symbol && h.kind === sel.kind) ?? null;
  const watchItem = data?.watch.find((w) => sel && w.symbol === sel.symbol && w.kind === sel.kind) ?? null;
  const points = chart?.points ?? [];
  const lastPoint = chart && sel && chart.symbol === sel.symbol ? points[points.length - 1] : undefined;

  const score = holding?.score?.score ?? watchItem?.score ?? lastPoint?.score ?? null;
  const price = holding?.price ?? watchItem?.price ?? lastPoint?.price ?? null;
  const zone = zoneOf(score);
  const label = holding?.score?.label ?? watchItem?.label ?? (score != null ? labelOf(score) : null);

  const pickFromList = (h: ZoneHolding) => {
    haptic();
    choose({ kind: h.kind, symbol: h.symbol });
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    heroRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const holdings = data?.holdings ?? [];
  const bySym = (s: string) => holdings.find((h) => h.symbol === s);
  const accumulate = (data?.accumulate ?? []).map(bySym).filter((h): h is ZoneHolding => !!h);
  const sell = (data?.sell ?? []).map(bySym).filter((h): h is ZoneHolding => !!h);
  const listed = new Set([...accumulate, ...sell].map((h) => h.symbol));
  const holdCount = holdings.filter((h) => h.zone === "hold" && !listed.has(h.symbol)).length;
  const heldKeys = new Set(holdings.map((h) => `${h.kind}:${h.symbol}`));
  const more = (data?.watch ?? []).filter((w) => !heldKeys.has(`${w.kind}:${w.symbol}`));
  const reduceTip = holding?.score;

  const moreValue = sel && !heldKeys.has(`${sel.kind}:${sel.symbol}`) ? `${sel.kind}:${sel.symbol}` : "";

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><Layers size={14} /> Buy &amp; Sell Zones</span>
        <div className="flex items-center gap-2">
          <InfoTip topic="the zones">
            <p>Each asset gets a long-term score from 0 to 100. It blends the 14-day RSI (35%), how far price sits from its 200-day average (35%) and where it sits in its 52-week range (30%).</p>
            <p>60 and up is the buy zone, 40 to 60 is hold, and under 40 is the sell zone. It measures how stretched price is, not where it goes next. Not financial advice.</p>
          </InfoTip>
          <button className="btn !py-1.5 !px-2" onClick={load} disabled={loading} title="Refresh" aria-label="Refresh zones">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {loading && !data && (
        <div className="p-3 space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-[220px] w-full" /></div>
      )}
      {failed && !data && <p className="px-3 py-6 text-center text-dim text-xs">Couldn&apos;t load zones. Try refresh.</p>}

      {data && (
        <>
          {/* Picker */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-edge">
            <div className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto [scrollbar-width:none]" data-noswipe>
              {holdings.map((h) => {
                const on = sel?.symbol === h.symbol && sel.kind === h.kind;
                const z = h.zone ?? zoneOf(h.score?.score);
                return (
                  <button
                    key={`${h.kind}-${h.symbol}`}
                    onClick={() => { haptic(); choose({ kind: h.kind, symbol: h.symbol }); }}
                    aria-pressed={on}
                    className={`shrink-0 h-10 px-3 inline-flex items-center gap-1.5 rounded-md border text-[12px] font-semibold focus-visible:outline-2 focus-visible:outline-cyan ${on ? "border-up/50 bg-up/10 text-up" : "border-edge2 text-dim"}`}
                  >
                    {h.symbol}
                    <span className={`w-2 h-2 rounded-full ${z ? ZONE_BG[z] : "bg-faint"}`} aria-hidden />
                  </button>
                );
              })}
              {holdings.length === 0 && <span className="text-xs text-dim self-center">No holdings yet</span>}
            </div>
            {more.length > 0 && (
              <select
                aria-label="More assets"
                value={moreValue}
                onChange={(e) => { if (!e.target.value) return; const [k, s] = e.target.value.split(":"); haptic(); choose({ kind: k as Kind, symbol: s }); }}
                className="shrink-0 h-10 max-w-[7.5rem] rounded-md border border-edge2 bg-panel2 text-[12px] text-dim px-2 focus-visible:outline-2 focus-visible:outline-cyan"
              >
                <option value="">More…</option>
                {(["crypto", "stock"] as const).map((k) => {
                  const items = more.filter((w) => w.kind === k);
                  return items.length ? (
                    <optgroup key={k} label={k === "crypto" ? "Crypto" : "Stocks"}>
                      {items.map((w) => <option key={`${k}:${w.symbol}`} value={`${k}:${w.symbol}`}>{w.symbol}</option>)}
                    </optgroup>
                  ) : null;
                })}
              </select>
            )}
          </div>

          {!sel ? (
            <p className="px-3 py-6 text-center text-dim text-xs">Nothing to chart yet. Star a ticker or add holdings.</p>
          ) : (
            <>
              {/* Hero */}
              <div ref={heroRef} className="scroll-mt-28 p-4 space-y-3">
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-extrabold text-txt text-lg">{sel.symbol}</span>
                      <span className="tabular-nums text-sm text-dim">{price != null ? `$${fmtPrice(price)}` : "—"}</span>
                      <StarButton symbol={sel.symbol} kind={sel.kind} size={14} className="self-center" />
                    </div>
                    <div className="font-display text-[28px] leading-tight" style={{ color: zone ? ZONE_COLOR[zone] : "var(--color-dim)" }}>
                      {label ?? "No score yet"}
                    </div>
                  </div>
                  <div className="text-[10px] text-faint shrink-0 pb-1">
                    score <span className="tabular-nums text-dim font-bold">{score != null ? Math.round(score) : "—"}</span>/100
                  </div>
                </div>
                <div>
                  <div className="relative h-2.5 rounded-full flex overflow-hidden">
                    <div className="h-full bg-down opacity-30" style={{ width: "40%" }} />
                    <div className="h-full bg-dim opacity-30" style={{ width: "20%" }} />
                    <div className="h-full bg-up opacity-30" style={{ width: "40%" }} />
                  </div>
                  {score != null && (
                    <div className="relative h-0">
                      <span
                        className="absolute -top-[13px] -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-bg bg-txt"
                        style={{ left: `${Math.min(100, Math.max(0, score))}%` }}
                      />
                    </div>
                  )}
                  <div className="flex text-[10px] text-faint mt-1">
                    <span style={{ width: "40%" }}>Sell · 0–40</span>
                    <span style={{ width: "20%" }} className="text-center">Hold</span>
                    <span style={{ width: "40%" }} className="text-right">Buy · 60–100</span>
                  </div>
                </div>
              </div>

              {/* Chart */}
              <div className="px-3 pb-3">
                <div role="group" aria-label="Chart range" className="seg flex rounded-lg border border-edge2 text-[12px] [&>button]:flex-1 sm:inline-flex sm:[&>button]:flex-none sm:[&>button]:px-5">
                  {RANGES.map((r) => (
                    <button key={r.key} onClick={() => chooseRange(r.key)} aria-pressed={range === r.key}
                            className={`h-10 px-3 font-bold focus-visible:outline-2 focus-visible:outline-cyan ${range === r.key ? "bg-panel2 text-txt" : "text-dim hover:text-txt"}`}>
                      {r.label}
                    </button>
                  ))}
                </div>
                <div className="mt-3">
                  {!chart && chartLoading ? (
                    <Skeleton className="h-[300px] w-full" />
                  ) : !chart || points.length < 2 ? (
                    <p className="py-10 text-center text-dim text-xs">Not enough price history for this one yet.</p>
                  ) : (
                    <ZoneChart chart={chart} range={chart.range ?? range} dim={chartLoading} />
                  )}
                </div>
              </div>

              {/* Why */}
              {reduceTip && (
                <div className="px-3 pb-3 space-y-1.5">
                  <Label>Why</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <Cell k="RSI (14d)" v={reduceTip.rsi != null ? reduceTip.rsi.toFixed(0) : "—"} note="Under 30 is oversold" />
                    <Cell k="vs 200-day avg" v={reduceTip.vs_200dma_pct != null ? `${reduceTip.vs_200dma_pct >= 0 ? "+" : ""}${reduceTip.vs_200dma_pct.toFixed(1)}%` : "—"} note="Far above runs hot" />
                    <Cell k="52-week range" v={reduceTip.range_pos != null ? `${reduceTip.range_pos.toFixed(0)}%` : "—"} note="0% low, 100% high" />
                  </div>
                </div>
              )}
            </>
          )}

          {/* From your holdings */}
          <div className="border-t border-edge">
            <div className="px-3 pt-3"><Label>From your holdings</Label></div>
            {holdings.length === 0 ? (
              <div className="px-3 py-3 flex flex-wrap items-center gap-3">
                <p className="text-xs text-dim">Add holdings in Wealth to get personal picks.</p>
                <button className="btn min-h-10" onClick={() => navigate({ tab: "wealth", anchor: "sec-wealth" })}>Go to Wealth</button>
              </div>
            ) : (
              <>
                <Group title="Add more" rows={accumulate} onPick={pickFromList} empty="None of your holdings are in the buy zone right now." />
                <Group title="Time to take profits" rows={sell} onPick={pickFromList} empty="Nothing you own is stretched into the sell zone." />
                {holdCount > 0 && (
                  <p className="px-3 py-2 text-[11px] text-faint">{holdCount} other{holdCount === 1 ? " is" : "s are"} in the hold zone</p>
                )}
              </>
            )}
          </div>
          <p className="px-3 py-3 text-[10.5px] text-faint border-t border-edge">
            Not financial advice. Zones describe how stretched price is, not where it goes next.
          </p>
        </>
      )}
    </section>
  );
}
