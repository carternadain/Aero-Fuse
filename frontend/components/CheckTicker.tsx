"use client";

import InfoTip from "./InfoTip";
import Skeleton from "./Skeleton";
import StarButton from "./StarButton";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, RefreshCw, Search } from "lucide-react";
import { Area, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { Zone, ZoneChartRange, ZoneChartResponse, ZoneHolding, ZoneHorizon, ZonesResponse } from "@/lib/types";
import { api, fmtPrice } from "@/lib/api";
import { haptic, openAlerts, openTicker } from "@/lib/bus";
import type { Why } from "./TickerSheet";

export type Kind = "stock" | "crypto";
export interface Sel { kind: Kind; symbol: string }

export const SEL_KEY = "buyzones:sel";
export const ZONE_COLOR: Record<Zone, string> = { buy: "var(--color-up)", hold: "var(--color-dim)", sell: "var(--color-down)" };
const ZONE_BG: Record<Zone, string> = { buy: "bg-up", hold: "bg-dim", sell: "bg-down" };
export const ZONE_NAME: Record<Zone, string> = { buy: "Buy zone", hold: "Hold", sell: "Sell zone" };
// Hold is quiet grey everywhere: hero, track, line and legend.
const LINE_COLOR: Record<Zone, string> = { buy: "var(--color-up)", hold: "var(--color-dim)", sell: "var(--color-down)" };
const LINE_BG: Record<Zone, string> = { buy: "bg-up", hold: "bg-dim", sell: "bg-down" };
export const fmtRisk = (r: number) => String(Math.round(r));

// One shared definition of the risk zones: under 30 buy, 30 to 70 hold, 70 and up sell.
export const RISK_BUY = 30;
export const RISK_SELL = 70;

export const HORIZON_KEY = "buyzones:horizon";
export const HORIZONS: { key: ZoneHorizon; label: string }[] = [
  { key: "long", label: "Long term" },
  { key: "mid", label: "Mid" },
  { key: "short", label: "Short" },
];
export const isHorizon = (v: unknown): v is ZoneHorizon => HORIZONS.some((h) => h.key === v);

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

type ChartPoint = ZoneChartResponse["points"][number];
const CHART_TOP = 8;   // px, chart top margin
const AXIS_H = 22;     // px, x-axis band; the overlay plot box sits between these two

export function zoneOf(risk: number | null | undefined): Zone | null {
  if (risk == null) return null;
  return risk < RISK_BUY ? "buy" : risk < RISK_SELL ? "hold" : "sell";
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

/** Apple Stocks-style risk line (0 to 100), coloured along its length by zone, with a scrub readout. */
function ZoneChart({ chart, range, dim }: { chart: ZoneChartResponse; range: ZoneChartRange; dim: boolean }) {
  const points = chart.points;
  const n = points.length;
  const gid = `zc${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const plotRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState<number | null>(null);
  useEffect(() => setIdx(null), [chart]);

  const zoneAt = useCallback((p: ChartPoint): Zone | "none" => zoneOf(p.risk) ?? "none", []);
  const colorOf = (z: Zone | "none") => (z === "none" ? "var(--color-dim)" : LINE_COLOR[z]);

  // Hard colour stops: two stops at the same offset wherever the zone changes.
  const stops = useMemo(() => {
    const out: { o: number; z: Zone | "none" }[] = [];
    let prev: Zone | "none" | null = null;
    // Offsets span the first..last non-null point: that is the extent of the drawn line's bounding box.
    let first = -1, last = -1;
    points.forEach((p, i) => { if (p.risk != null) { if (first < 0) first = i; last = i; } });
    if (first < 0) return out;
    const span = last - first;
    points.forEach((p, i) => {
      if (i < first || i > last || p.risk == null) return;
      const z = zoneAt(p);
      const o = span > 0 ? (i - first) / span : 0;
      if (prev == null) out.push({ o: 0, z });
      else if (z !== prev) out.push({ o, z: prev }, { o, z });
      prev = z;
    });
    if (prev) out.push({ o: 1, z: prev });
    return out;
  }, [points, zoneAt]);

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

  // Peak / trough positions: the API's dates, falling back to the extremes of the plotted line.
  const { peakIdx } = useMemo(() => {
    let hi = -1;
    points.forEach((p, i) => {
      if (p.risk == null) return;
      if (hi < 0 || p.risk > (points[hi].risk as number)) hi = i;
    });
    const find = (d: string | undefined, fb: number) => { const k = d ? points.findIndex((p) => p.date === d) : -1; return k >= 0 ? k : fb; };
    return { peakIdx: find(chart.peak?.date, hi) };
  }, [points, chart.peak]);

  const xPct = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 0);
  const yPct = (v: number) => 100 - Math.min(100, Math.max(0, v));
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
  const peak = chart.peak ?? (peakIdx >= 0 ? { date: points[peakIdx].date, risk: points[peakIdx].risk as number, price: points[peakIdx].price } : null);
  const horizonName = chart.horizon === "long" ? "long-term" : chart.horizon === "mid" ? "mid-term" : "short-term";

  return (
    <>
      <div
        data-noswipe
        tabIndex={0}
        role="img"
        aria-label={`${chart.symbol} ${horizonName} risk from 0 to 100 over the ${pastLabel}, coloured by buy, hold and sell zone. Use the arrow keys to move through dates.`}
        onKeyDown={onKey}
        onBlur={() => setIdx(null)}
        className={`relative h-[220px] sm:h-[300px] select-none rounded-md outline-none focus-visible:outline-2 focus-visible:outline-cyan motion-safe:transition-opacity motion-safe:duration-200 ${dim ? "opacity-60" : ""}`}
      >
        {/* Zone bands behind the line */}
        <div className="absolute inset-x-0 pointer-events-none" style={{ top: CHART_TOP, bottom: AXIS_H }} aria-hidden>
          <div className="absolute inset-x-0 top-0 flex items-end justify-start bg-down/[0.06]" style={{ height: `${100 - RISK_SELL}%` }}>
            <span className="hidden sm:block relative z-10 ml-1 mb-1 rounded bg-panel/85 px-1.5 py-0.5 text-[10px] leading-none text-faint tabular-nums">Sell {RISK_SELL}</span>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-start justify-start bg-up/[0.06]" style={{ height: `${RISK_BUY}%` }}>
            <span className="hidden sm:block relative z-10 ml-1 mt-1 rounded bg-panel/85 px-1.5 py-0.5 text-[10px] leading-none text-faint tabular-nums">Buy {RISK_BUY}</span>
          </div>
        </div>

        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: CHART_TOP, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`${gid}-line`} x1="0" y1="0" x2="1" y2="0">
                {stops.map((s, i) => <stop key={i} offset={s.o} style={{ stopColor: colorOf(s.z) }} />)}
              </linearGradient>
            </defs>
            <XAxis dataKey="date" ticks={ticks} interval={0} height={AXIS_H} tickLine={false} axisLine={false} tickMargin={6}
                   tick={{ fontSize: 11, fill: "var(--color-faint)" }}
                   tickFormatter={(d: string) => (range === "1Y" ? MONTHS[Number(d.slice(5, 7)) - 1] : `’${d.slice(2, 4)}`)} />
            <YAxis hide domain={[0, 100]} />
            <Line type="monotone" dataKey="risk" stroke={`url(#${gid}-line)`} strokeWidth={2} dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>

        {/* Plot-area overlay: markers positioned in % of the exact plot box */}
        <div ref={plotRef} className="absolute inset-x-0 pointer-events-none" style={{ top: CHART_TOP, bottom: AXIS_H }}>
          <div className={`absolute inset-0 motion-safe:transition-opacity ${sp ? "opacity-0" : ""}`}>
            {peak && peakIdx >= 0 && (
              <>
                <span className="absolute w-1.5 h-1.5 -ml-[3px] -mt-[3px] rounded-full bg-dim ring-2 ring-panel" style={{ left: `${xPct(peakIdx)}%`, top: `${yPct(peak.risk)}%` }} />
                <span
                  className={`absolute whitespace-nowrap rounded bg-panel/85 px-1.5 py-0.5 text-[10px] leading-none text-dim tabular-nums ${yPct(peak.risk) < 14 ? "mt-2" : "-translate-y-[calc(100%+6px)]"}`}
                  style={{ ...labelPos(peakIdx), top: `${yPct(peak.risk)}%` }}
                >
                  Peak {fmtRisk(peak.risk)} · {fmtMonYr(peak.date)}
                </span>
              </>
            )}
          </div>
          {sp && sz && idx != null && (
            <>
              <div className="absolute top-0 bottom-0 w-px bg-faint" style={{ left: `${xPct(idx)}%` }} />
              {sp.risk != null && (
                <span className="absolute w-2 h-2 -ml-1 -mt-1 rounded-full ring-2 ring-panel" style={{ left: `${xPct(idx)}%`, top: `${yPct(sp.risk)}%`, background: colorOf(sz) }} />
              )}
            </>
          )}
        </div>

        {/* Scrub readout: floats over the plot on the side away from the cursor, so nothing reflows */}
        {sp && sz && idx != null && (
          <div className={`absolute top-1.5 z-10 pointer-events-none rounded-lg bg-panel/90 px-2 py-1 text-[12px] leading-tight tabular-nums ${xPct(idx) < 50 ? "right-1.5 text-right" : "left-1.5"}`} aria-hidden>
            <div className="text-dim"><span className="font-bold text-txt">{fmtDate(sp.date)}</span> · {chart.symbol} ${fmtPrice(sp.price)}</div>
            <div className={`mt-0.5 flex items-center gap-1.5 ${xPct(idx) < 50 ? "justify-end" : ""}`}>
              <span className="w-2 h-2 rounded-full" style={{ background: colorOf(sz) }} />
              <span className="text-txt">{sz === "none" ? "No reading" : ZONE_NAME[sz]}</span>
              <span className="font-bold text-txt">{sp.risk != null ? fmtRisk(sp.risk) : "—"}</span>
            </div>
          </div>
        )}

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

    </>
  );
}

interface IndexTicker { symbol: string; kind: Kind; name: string | null; sector?: string; owned: boolean }

function verdictOf(r: number): { label: string; line: string } {
  if (r < RISK_BUY) return { label: "Buy", line: "Cheaper than usual compared with its own history." };
  if (r < 50) return { label: "Fair price", line: "Priced about normal for it. No rush either way." };
  if (r < RISK_SELL) return { label: "Wait for a dip", line: "Running warm. Buying in small pieces or waiting for a pullback is safer." };
  return { label: "Overheated", line: "Near its most stretched levels. Past readings this high often came before pullbacks." };
}

const usd = (v: number) => `$${fmtPrice(v)}`;
const TONE_BG: Record<"up" | "down" | "flat", string> = { up: "bg-up", down: "bg-down", flat: "bg-dim" };

function Tile({ k, children, note }: { k: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-panel2/60 px-3 py-2.5 min-w-0">
      <div className="text-[11px] text-faint truncate">{k}</div>
      <div className="mt-0.5 font-bold tabular-nums text-txt text-[14px] truncate">{children}</div>
      {note != null && <div className="mt-0.5 text-[11px] text-dim leading-snug tabular-nums">{note}</div>}
    </div>
  );
}

/** One horizontal range: quiet wide band (~9 in 10), stronger likely band (~2 in 3), today tick, optional analyst target. */
function RangeBar({ price, likely, wide, target }: { price: number; likely: [number, number]; wide: [number, number]; target: number | null }) {
  const lo = Math.min(wide[0], target ?? Infinity);
  const hi = Math.max(wide[1], target ?? -Infinity);
  const span = hi - lo || 1;
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / span) * 100))}%`;
  return (
    <div>
      <div
        role="img"
        aria-label={`Today ${usd(price)}. Likely ${usd(likely[0])} to ${usd(likely[1])}. Wider range ${usd(wide[0])} to ${usd(wide[1])}.${target != null ? ` Analyst target ${usd(target)}.` : ""}`}
        className="relative h-8 mx-1"
      >
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-edge" />
        <div className="absolute top-1/2 -translate-y-1/2 h-3 rounded-full bg-cyan/20" style={{ left: pos(wide[0]), width: `calc(${pos(wide[1])} - ${pos(wide[0])})` }} />
        <div className="absolute top-1/2 -translate-y-1/2 h-3 rounded-full bg-cyan/70" style={{ left: pos(likely[0]), width: `calc(${pos(likely[1])} - ${pos(likely[0])})` }} />
        {target != null && (
          <span className="absolute top-1/2 w-2.5 h-2.5 -ml-[5px] -mt-[5px] rotate-45 bg-amber ring-2 ring-panel" style={{ left: pos(target) }} />
        )}
        <span className="absolute top-1 bottom-1 w-0.5 -ml-px rounded-full bg-txt ring-2 ring-panel" style={{ left: pos(price) }} />
      </div>
      <div className="mt-1 mx-1 flex justify-between text-[12px] text-dim tabular-nums">
        <span>{usd(wide[0])}</span>
        <span>{usd(wide[1])}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-dim">
        <span className="inline-flex items-center gap-1.5"><span className="w-0.5 h-3 bg-txt" aria-hidden />Today <span className="tabular-nums">{usd(price)}</span></span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-full bg-cyan/70" aria-hidden />Likely</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-full bg-cyan/20" aria-hidden />Wider</span>
        {target != null && <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rotate-45 bg-amber" aria-hidden />Analyst target <span className="tabular-nums">{usd(target)}</span></span>}
      </div>
    </div>
  );
}

/** Compact dollars for tight tiles: $52K, $1.2M. */
const usdShort = (n: number) => (Math.abs(n) >= 1e6 ? `$${Number((n / 1e6).toFixed(1))}M` : Math.abs(n) >= 1e4 ? `$${Number((n / 1e3).toFixed(n >= 1e5 ? 0 : 1))}K` : `$${fmtPrice(n)}`);

export default function CheckTicker() {
  const [data, setData] = useState<ZonesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [sel, setSel] = useState<Sel | null>(null);
  const [chart, setChart] = useState<ZoneChartResponse | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [why, setWhy] = useState<Why | null>(null);
  const [range, setRange] = useState<ZoneChartRange>(() => {
    try { const r = localStorage.getItem(RANGE_KEY); if (isRange(r)) return r; } catch { /* unavailable */ }
    return "1Y";
  });
  const [horizon, setHorizon] = useState<ZoneHorizon>(() => {
    try { const h = localStorage.getItem(HORIZON_KEY); if (isHorizon(h)) return h; } catch { /* unavailable */ }
    return "long";
  });
  const [whyOpen, setWhyOpen] = useState(false);
  const [band, setBand] = useState<"3m" | "1y">("3m");
  const [index, setIndex] = useState<IndexTicker[]>([]);
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState(false);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    let live = true;
    api.get<{ tickers: IndexTicker[]; accounts: string[] }>("/api/search/index")
      .then((r) => live && setIndex(r.tickers ?? []))
      .catch(() => { /* search still works by typing a symbol */ });
    return () => { live = false; };
  }, []);

  // Default / remembered selection. Anything searchable is valid, so a saved symbol is kept as is.
  useEffect(() => {
    if (!data || sel) return;
    let saved: Sel | null = null;
    try { saved = JSON.parse(localStorage.getItem(SEL_KEY) || "null"); } catch { /* unavailable */ }
    if (saved && saved.symbol && (saved.kind === "stock" || saved.kind === "crypto")) { setSel(saved); return; }
    const first = data.holdings[0] ?? data.watch[0];
    if (first) setSel({ kind: first.kind, symbol: first.symbol });
  }, [data, sel]);

  const choose = (s: Sel) => {
    setSel(s);
    try { localStorage.setItem(SEL_KEY, JSON.stringify(s)); } catch { /* unavailable */ }
  };

  const chooseRange = (r: ZoneChartRange) => {
    haptic();
    setRange(r);
    try { localStorage.setItem(RANGE_KEY, r); } catch { /* unavailable */ }
  };

  const chooseHorizon = (h: ZoneHorizon) => {
    haptic();
    setHorizon(h);
    try { localStorage.setItem(HORIZON_KEY, h); } catch { /* unavailable */ }
  };

  // Chart data. The previous chart stays on screen (dimmed) while the next one loads.
  useEffect(() => {
    if (!sel) return;
    let live = true;
    setChartLoading(true);
    api
      .get<ZoneChartResponse>(`/api/zones/chart/${sel.kind}/${encodeURIComponent(sel.symbol)}?range=${range}&horizon=${horizon}`)
      .then((r) => live && setChart(r))
      .catch(() => live && setChart(null))
      .finally(() => live && setChartLoading(false));
    return () => { live = false; };
  }, [sel, range, horizon]);

  // Stats and name. Stale responses are ignored when the selection changes.
  useEffect(() => {
    if (!sel) return;
    let live = true;
    setWhy(null);
    api
      .get<Why>(`/api/ticker/${encodeURIComponent(sel.symbol)}/why?kind=${sel.kind}`)
      .then((w) => live && setWhy(w))
      .catch(() => { /* hero falls back to chart price */ });
    return () => { live = false; };
  }, [sel]);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    const pre: IndexTicker[] = [], inName: IndexTicker[] = [];
    for (const x of index) {
      if (x.symbol.toLowerCase().startsWith(t)) pre.push(x);
      else if (x.name && x.name.toLowerCase().includes(t)) inName.push(x);
    }
    const owned = (a: IndexTicker, b: IndexTicker) => Number(b.owned) - Number(a.owned);
    return [...pre.sort(owned), ...inName.sort(owned)].slice(0, 8);
  }, [q, index]);
  useEffect(() => setActive(0), [q]);

  const finishPick = (s: Sel) => {
    haptic();
    choose(s);
    setQ("");
    setSearchErr(false);
    setFocused(false);
    inputRef.current?.blur();
  };

  const submitTyped = async () => {
    const sym = q.trim().toUpperCase();
    if (!sym) return;
    setSearching(true);
    setSearchErr(false);
    try {
      const w = await api.get<Why>(`/api/ticker/${encodeURIComponent(sym)}/why`);
      finishPick({ kind: w.kind, symbol: (w.symbol || sym).toUpperCase() });
    } catch {
      setSearchErr(true);
    } finally {
      setSearching(false);
    }
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(matches.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Escape") { setQ(""); setFocused(false); inputRef.current?.blur(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const m = matches[active];
      if (m) finishPick({ kind: m.kind, symbol: m.symbol });
      else void submitTyped();
    }
  };

  const holding = data?.holdings.find((h) => sel && h.symbol === sel.symbol && h.kind === sel.kind) ?? null;
  const points = chart?.points ?? [];
  const chartFresh = !!chart && !!sel && chart.symbol === sel.symbol && chart.kind === sel.kind && chart.horizon === horizon;
  const whyFresh = why && sel && why.symbol.toUpperCase() === sel.symbol.toUpperCase() ? why : null;

  const riskOf = (h: ZoneHolding) => h.risk?.[horizon] ?? null;
  const risk = chartFresh ? chart.now.risk : holding ? riskOf(holding) : null;
  const price = whyFresh?.price ?? holding?.price ?? (chartFresh ? chart.now.price : null);
  const zone = zoneOf(risk);
  const verdict = risk != null ? verdictOf(risk) : null;
  const signals = chartFresh ? chart.signals : [];
  const holdings = data?.holdings ?? [];
  const showList = focused && q.trim().length > 0;

  // Where it could be: lognormal band from daily volatility.
  const volPct = whyFresh?.daily_vol_pct ?? null;
  const bands = useMemo(() => {
    if (!sel || price == null || volPct == null || volPct <= 0) return null;
    const days = sel.kind === "crypto" ? (band === "3m" ? 91 : 365) : band === "3m" ? 63 : 252;
    const s = (volPct / 100) * Math.sqrt(days);
    const f = (m: number): [number, number] => [price * Math.exp(-m * s), price * Math.exp(m * s)];
    return { likely: f(1), wide: f(1.645) };
  }, [sel, price, volPct, band]);
  const target = sel?.kind === "stock" && whyFresh?.target_mean ? whyFresh.target_mean : null;

  // Key stats
  const w = whyFresh;
  const hasRange = w?.low_52w != null && w.high_52w != null && w.high_52w > w.low_52w;
  const rangePos = hasRange && price != null ? Math.min(100, Math.max(0, ((price - w!.low_52w!) / (w!.high_52w! - w!.low_52w!)) * 100)) : null;
  const vs200 = w?.sma200 && price != null ? (price / w.sma200 - 1) * 100 : null;
  const earnings = sel?.kind === "stock" && w?.next_earnings ? w.next_earnings : null;
  const earnDate = earnings && /^\d{4}-\d{2}-\d{2}/.test(earnings) ? fmtDate(earnings.slice(0, 10)) : earnings;
  const rsiNote = w?.rsi == null ? "" : w.rsi >= 70 ? "Stretched" : w.rsi <= 30 ? "Beaten down" : "Neutral";
  const hasTiles = hasRange || w?.rsi != null || vs200 != null || earnings != null;
  const sym = sel?.symbol ?? "";

  return (
    <section className="panel">
      {/* Search */}
      <div className="px-3 pt-3 pb-2 flex items-start gap-2">
        <div className="relative flex-1 min-w-0">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => { setQ(e.target.value); setSearchErr(false); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 120)}
            onKeyDown={onSearchKey}
            placeholder="Search a stock or crypto"
            aria-label="Search a stock or crypto"
            role="combobox"
            aria-expanded={showList && matches.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && matches[active] ? `${listId}-${active}` : undefined}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="search"
            className="w-full h-11 rounded-xl bg-panel2 border border-edge2 pl-10 pr-3 text-[16px] text-txt placeholder:text-faint focus-visible:outline-2 focus-visible:outline-cyan"
          />
          {showList && matches.length > 0 && (
            <ul id={listId} role="listbox" aria-label="Matches" className="absolute z-30 left-0 right-0 top-full mt-1 overflow-hidden rounded-xl border border-edge2 bg-panel shadow-lg divide-y divide-edge">
              {matches.map((m, i) => (
                <li
                  key={`${m.kind}-${m.symbol}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => finishPick({ kind: m.kind, symbol: m.symbol })}
                  onMouseEnter={() => setActive(i)}
                  className={`min-h-11 flex items-center gap-2 px-3 py-1.5 cursor-pointer ${i === active ? "bg-panel2" : ""}`}
                >
                  <span className="font-bold text-txt text-sm shrink-0">{m.symbol}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-dim">{m.name ?? (m.kind === "crypto" ? "Crypto" : "")}</span>
                  {m.owned && <span className="shrink-0 rounded-full bg-up/15 px-2 py-0.5 text-[10px] font-bold text-up">Owned</span>}
                </li>
              ))}
            </ul>
          )}
          {showList && matches.length === 0 && (
            <div className="absolute z-30 left-0 right-0 top-full mt-1 rounded-xl border border-edge2 bg-panel px-3 min-h-11 flex items-center text-[12px] text-dim">
              {searching ? "Looking…" : <>Press Enter to look up <span className="mx-1 font-bold text-txt">{q.trim().toUpperCase()}</span></>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 h-11 shrink-0">
          <InfoTip topic="the risk score">
            <p>Risk runs from 0 to 100, and 100 is the most stretched price gets. {horizon === "long"
              ? "Long term: each asset is measured against its own history: how far price sits above its 200-day and 200-week averages, ranked against every other day on record. 100 is the most stretched it has ever been; past crypto bull-market tops mostly read 80–90."
              : "Mid and short term read RSI, distance from the 20- and 50-day averages in units of the asset's own volatility, Bollinger position and recent moves."}</p>
            <p>Long term reads months to years, Mid weeks to months, Short days to two weeks.</p>
            <p>Under 30 is the buy zone, 30 to 70 is hold, and 70 and up is the sell zone. It describes how stretched price is, not where it goes next. Not financial advice.</p>
          </InfoTip>
          <button className="btn !min-h-10 !min-w-10 !px-2" onClick={load} disabled={loading} title="Refresh" aria-label="Refresh">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      {searchErr && <p role="alert" className="px-4 pb-2 text-[12px] text-down">Couldn&apos;t find &ldquo;{q.trim().toUpperCase()}&rdquo;. Check the symbol and try again.</p>}

      {loading && !data && (
        <div className="p-3 space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-[220px] w-full" /></div>
      )}
      {failed && !data && <p className="px-3 py-6 text-center text-dim text-xs">Couldn&apos;t load your holdings. Try refresh, or search for a ticker.</p>}

      {(data || failed) && (
        <>
          {/* Holdings quick-pick */}
          {holdings.length > 0 && (
            <div className="px-3 pb-2 border-b border-edge">
              <div className="flex gap-1.5 overflow-x-auto pr-6 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]" data-noswipe>
                {holdings.map((h) => {
                  const on = sel?.symbol === h.symbol && sel.kind === h.kind;
                  const z = zoneOf(riskOf(h));
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
              </div>
            </div>
          )}

          {!sel ? (
            <p className="px-3 py-8 text-center text-dim text-xs">Search a stock or crypto to see if it&apos;s a good time to buy.</p>
          ) : (
            <>
              {/* Hero */}
              <div className="px-4 pt-3 pb-2 space-y-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-extrabold text-txt text-lg shrink-0">{sel.symbol}</span>
                  {whyFresh?.name && <span className="min-w-0 truncate text-[13px] text-dim">{whyFresh.name}</span>}
                  <span className="ml-auto tabular-nums text-sm font-semibold text-txt shrink-0">{price != null ? usd(price) : "—"}</span>
                  <StarButton symbol={sel.symbol} kind={sel.kind} size={14} />
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-display text-[48px] leading-none font-bold tabular-nums" style={{ color: zone ? ZONE_COLOR[zone] : "var(--color-dim)" }}>
                    {risk != null ? fmtRisk(risk) : "—"}
                  </span>
                  {verdict && zone ? (
                    <span className="inline-flex items-center rounded-full border px-3 py-1 text-[13px] font-bold text-txt" style={{ borderColor: ZONE_COLOR[zone], background: `color-mix(in srgb, ${ZONE_COLOR[zone]} 14%, transparent)` }}>
                      {verdict.label}
                    </span>
                  ) : (
                    <span className="text-[12px] text-faint">{chartLoading ? "Reading…" : "No reading yet"}</span>
                  )}
                </div>
                {verdict && <p className="text-[13px] text-txt leading-snug">{verdict.line}</p>}
                {chartFresh && chart.odds && (
                  <p className="text-[12px] text-dim leading-snug">
                    Price was higher 3 months later <span className="tabular-nums font-bold text-txt">{Math.round(chart.odds.m3)}%</span> of the time at this level, a year later <span className="tabular-nums font-bold text-txt">{Math.round(chart.odds.y1)}%</span>.
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button className="btn min-h-10" onClick={() => { haptic(); openAlerts({ symbol: sel.symbol, kind: sel.kind, price: price ?? undefined }); }}>Price alert</button>
                  <button className="btn min-h-10" onClick={() => { haptic(); openTicker({ symbol: sel.symbol, kind: sel.kind }); }}>Full chart</button>
                </div>
              </div>

              {/* Risk chart */}
              <div className="px-3 pb-2">
                <div role="group" aria-label="Time horizon" className="seg flex rounded-lg border border-edge2 text-[12px] [&>button]:flex-1 sm:inline-flex sm:[&>button]:flex-none sm:[&>button]:px-5">
                  {HORIZONS.map((hz) => (
                    <button key={hz.key} onClick={() => chooseHorizon(hz.key)} aria-pressed={horizon === hz.key}
                            className={`h-10 px-3 font-bold focus-visible:outline-2 focus-visible:outline-cyan ${horizon === hz.key ? "bg-panel2 text-txt" : "text-dim hover:text-txt"}`}>
                      {hz.label}
                    </button>
                  ))}
                </div>
                <div className="mt-2">
                  {!chart && chartLoading ? (
                    <Skeleton className="h-[220px] sm:h-[300px] w-full" />
                  ) : !chart || points.length < 2 ? (
                    <p className="py-10 text-center text-dim text-xs">Not enough price history for this one yet.</p>
                  ) : (
                    <ZoneChart chart={chart} range={chart.range ?? range} dim={chartLoading} />
                  )}
                </div>
                <div role="group" aria-label="Chart range" className="mt-0.5 flex justify-center gap-1 text-[12px]">
                  {RANGES.map((r) => (
                    <button key={r.key} onClick={() => chooseRange(r.key)} aria-pressed={range === r.key}
                            className={`h-7 px-3.5 rounded-full font-semibold focus-visible:outline-2 focus-visible:outline-cyan ${range === r.key ? "bg-panel2 text-txt" : "text-dim hover:text-txt"}`}>
                      {r.label}
                    </button>
                  ))}
                </div>
                {chartFresh && (
                  <div className="mt-1.5 px-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-dim">
                    {(["buy", "hold", "sell"] as const).map((z) => (
                      <span key={z} className="inline-flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${LINE_BG[z]}`} aria-hidden />{ZONE_NAME[z]}
                      </span>
                    ))}
                    {chart.zone_share && (
                      <span className="text-faint tabular-nums">In buy zone {Math.round(chart.zone_share.buy)}% of days, sell zone {Math.round(chart.zone_share.sell)}%</span>
                    )}
                  </div>
                )}
              </div>

              {/* Where it could be */}
              {bands && price != null && (
                <div className="px-4 py-3 border-t border-edge">
                  <div className="flex items-center justify-between gap-3">
                    <Label>Where it could be</Label>
                    <div role="group" aria-label="Time frame" className="seg inline-flex rounded-lg border border-edge2 text-[12px]">
                      {([["3m", "3 months"], ["1y", "1 year"]] as const).map(([k, l]) => (
                        <button key={k} onClick={() => { haptic(); setBand(k); }} aria-pressed={band === k}
                                className={`h-10 px-3 font-bold focus-visible:outline-2 focus-visible:outline-cyan ${band === k ? "bg-panel2 text-txt" : "text-dim hover:text-txt"}`}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2">
                    <RangeBar price={price} likely={bands.likely} wide={bands.wide} target={target} />
                  </div>
                  <p className="mt-2 text-[13px] text-txt tabular-nums leading-snug">
                    Likely {usd(bands.likely[0])} – {usd(bands.likely[1])}
                  </p>
                  <p className="mt-1 text-[11px] text-faint">Based on how much {sym} usually moves. Not a forecast.</p>
                </div>
              )}

              {/* Key stats */}
              {hasTiles && (
                <div className="px-3 py-3 border-t border-edge">
                  <div className="px-1 pb-2"><Label>Key stats</Label></div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {hasRange && (
                      <Tile k="52-week range" note={rangePos != null ? (
                        <span className="block relative h-1.5 mt-1.5 rounded-full bg-edge" aria-hidden>
                          <span className="absolute top-1/2 w-2 h-2 -ml-1 -mt-1 rounded-full bg-txt ring-2 ring-panel2" style={{ left: `${rangePos}%` }} />
                        </span>
                      ) : undefined}>
                        {usdShort(w!.low_52w!)} – {usdShort(w!.high_52w!)}
                      </Tile>
                    )}
                    {w?.rsi != null && <Tile k="RSI" note={rsiNote}>{Math.round(w.rsi)}</Tile>}
                    {vs200 != null && <Tile k="vs 200-day average" note={vs200 >= 0 ? "Above the average" : "Below the average"}>{vs200 > 0 ? "+" : ""}{vs200.toFixed(1)}%</Tile>}
                    {earnings && <Tile k="Next earnings" note={w?.days_to_earnings != null ? (w.days_to_earnings === 0 ? "Today" : `in ${w.days_to_earnings} day${w.days_to_earnings === 1 ? "" : "s"}`) : undefined}>{earnDate}</Tile>}
                  </div>
                </div>
              )}

              {/* Why */}
              {((w?.reasons?.length ?? 0) > 0 || signals.length > 0) && (
                <div className="px-3 pb-3">
                  <button onClick={() => setWhyOpen((o) => !o)} aria-expanded={whyOpen}
                          className="min-h-10 inline-flex items-center gap-1.5 rounded-md px-1 text-[12px] font-semibold text-dim hover:text-txt focus-visible:outline-2 focus-visible:outline-cyan">
                    <ChevronDown size={14} className={`motion-safe:transition-transform ${whyOpen ? "rotate-180" : ""}`} aria-hidden />
                    Why
                  </button>
                  {whyOpen && (
                    <div className="mt-1.5 space-y-3">
                      {(w?.reasons?.length ?? 0) > 0 && (
                        <ul className="space-y-1.5">
                          {w!.reasons.map((r, i) => (
                            <li key={i} className="flex items-start gap-2 text-[13px] text-txt leading-snug">
                              <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${TONE_BG[r.tone]}`} aria-hidden />
                              <span className="min-w-0">{r.text}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {signals.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {signals.map((sg) => <Cell key={sg.name} k={sg.name} v={sg.value} note={sg.note} />)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <p className="px-3 py-3 text-[10.5px] text-faint border-t border-edge">
            Not financial advice. Risk describes how stretched price is, not where it goes next.
          </p>
        </>
      )}
    </section>
  );
}
