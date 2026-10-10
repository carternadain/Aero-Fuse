"use client";

import InfoTip from "./InfoTip";
import Skeleton from "./Skeleton";
import StarButton from "./StarButton";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Layers, RefreshCw } from "lucide-react";
import { Area, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { Zone, ZoneChartRange, ZoneChartResponse, ZoneHolding, ZoneHorizon, ZonesResponse } from "@/lib/types";
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
const verdictOf = (r: number) => (r < 15 ? "Strong buy" : r < RISK_BUY ? "Buy" : r < RISK_SELL ? "Hold" : r < 85 ? "Take profits" : "Sell");
const fmtRisk = (r: number) => String(Math.round(r));

// One shared definition of the risk zones: under 30 buy, 30 to 70 hold, 70 and up sell.
const RISK_BUY = 30;
const RISK_SELL = 70;

const HORIZON_KEY = "buyzones:horizon";
const HORIZONS: { key: ZoneHorizon; label: string }[] = [
  { key: "long", label: "Long term" },
  { key: "mid", label: "Mid" },
  { key: "short", label: "Short" },
];
const isHorizon = (v: unknown): v is ZoneHorizon => HORIZONS.some((h) => h.key === v);

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

function Row({ h, risk, onPick }: { h: ZoneHolding; risk: number | null; onPick: (h: ZoneHolding) => void }) {
  const z = zoneOf(risk);
  const c = z ? ZONE_COLOR[z] : "var(--color-dim)";
  return (
    <button
      onClick={() => onPick(h)}
      className="w-full min-h-[44px] flex items-center gap-2 px-3 py-2 text-left hover:bg-panel2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan"
    >
      <span className="font-bold text-txt text-sm w-14 shrink-0 truncate">{h.symbol}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold truncate" style={{ color: c }}>
          <span className="tabular-nums">Risk {risk != null ? fmtRisk(risk) : "—"}</span>{z && <> · {ZONE_NAME[z]}</>}
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

function Group({ title, rows, risk, empty, onPick }: { title: string; rows: ZoneHolding[]; risk: (h: ZoneHolding) => number | null; empty: string; onPick: (h: ZoneHolding) => void }) {
  return (
    <div>
      <div className="px-3 pt-3 pb-1"><Label>{title}</Label></div>
      {rows.length === 0 ? (
        <p className="px-3 pb-2 text-xs text-dim">{empty}</p>
      ) : (
        <div className="divide-y divide-edge">{rows.map((h) => <Row key={`${h.kind}-${h.symbol}`} h={h} risk={risk(h)} onPick={onPick} />)}</div>
      )}
    </div>
  );
}

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
  const [horizon, setHorizon] = useState<ZoneHorizon>(() => {
    try { const h = localStorage.getItem(HORIZON_KEY); if (isHorizon(h)) return h; } catch { /* unavailable */ }
    return "long";
  });
  const [whyOpen, setWhyOpen] = useState(false);
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

  const holding = data?.holdings.find((h) => sel && h.symbol === sel.symbol && h.kind === sel.kind) ?? null;
  const points = chart?.points ?? [];
  const chartFresh = !!chart && !!sel && chart.symbol === sel.symbol && chart.kind === sel.kind && chart.horizon === horizon;

  // The hero follows the chart's reading when it matches the selection, so number and label agree.
  const riskOf = (h: ZoneHolding) => h.risk?.[horizon] ?? null;
  const risk = chartFresh ? chart.now.risk : holding ? riskOf(holding) : null;
  const price = holding?.price ?? (chartFresh ? chart.now.price : null);
  const zone = zoneOf(risk);
  const signals = chartFresh ? chart.signals : [];

  const pickFromList = (h: ZoneHolding) => {
    haptic();
    choose({ kind: h.kind, symbol: h.symbol });
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    heroRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const holdings = data?.holdings ?? [];
  const withRisk = holdings.map((h) => ({ h, r: riskOf(h) }));
  const addMore = withRisk.filter((x) => x.r != null && x.r < RISK_BUY).sort((a, b) => (a.r as number) - (b.r as number)).slice(0, 3).map((x) => x.h);
  const takeProfits = withRisk.filter((x) => x.r != null && x.r >= RISK_SELL).sort((a, b) => (b.r as number) - (a.r as number)).slice(0, 2).map((x) => x.h);
  const holdCount = withRisk.filter((x) => zoneOf(x.r) === "hold").length;
  const heldKeys = new Set(holdings.map((h) => `${h.kind}:${h.symbol}`));
  const more = (data?.watch ?? []).filter((w) => !heldKeys.has(`${w.kind}:${w.symbol}`));

  const moreValue = sel && !heldKeys.has(`${sel.kind}:${sel.symbol}`) ? `${sel.kind}:${sel.symbol}` : "";

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><Layers size={14} /> Risk Score</span>
        <div className="flex items-center gap-2">
          <InfoTip topic="the risk score">
            <p>Risk runs from 0 to 100, and 100 is the most stretched price gets. {horizon === "long"
              ? "Long term: each asset is measured against its own history: how far price sits above its 200-day and 200-week averages, ranked against every other day on record. 100 is the most stretched it has ever been; past crypto bull-market tops mostly read 80–90."
              : "Mid and short term read RSI, distance from the 20- and 50-day averages in units of the asset's own volatility, Bollinger position and recent moves."}</p>
            <p>Long term reads months to years, Mid weeks to months, Short days to two weeks.</p>
            <p>Under 30 is the buy zone, 30 to 70 is hold, and 70 and up is the sell zone. It describes how stretched price is, not where it goes next. Not financial advice.</p>
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
            <div className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto pr-6 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]" data-noswipe>
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
              <div ref={heroRef} className="scroll-mt-28 px-4 pt-3 pb-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-txt text-lg">{sel.symbol}</span>
                  <span className="tabular-nums text-sm text-dim">{price != null ? `$${fmtPrice(price)}` : "—"}</span>
                  <StarButton symbol={sel.symbol} kind={sel.kind} size={14} />
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-display text-[48px] leading-none font-bold tabular-nums" style={{ color: zone ? ZONE_COLOR[zone] : "var(--color-dim)" }}>
                    {risk != null ? fmtRisk(risk) : "—"}
                  </span>
                  {risk != null && zone ? (
                    <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-[12px] font-bold text-txt" style={{ borderColor: ZONE_COLOR[zone], background: `color-mix(in srgb, ${ZONE_COLOR[zone]} 14%, transparent)` }}>
                      {verdictOf(risk)}
                    </span>
                  ) : (
                    <span className="text-[12px] text-faint">No reading yet</span>
                  )}
                </div>
                {chartFresh && chart.odds && (
                  <p className="text-[12px] text-dim leading-snug">
                    Price was higher 3 months later <span className="tabular-nums font-bold text-txt">{Math.round(chart.odds.m3)}%</span> of the time at this level, a year later <span className="tabular-nums font-bold text-txt">{Math.round(chart.odds.y1)}%</span>.
                  </p>
                )}
              </div>

              {/* Chart */}
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

              {/* Why */}
              {signals.length > 0 && (
                <div className="px-3 pb-3">
                  <button onClick={() => setWhyOpen((o) => !o)} aria-expanded={whyOpen}
                          className="min-h-10 inline-flex items-center gap-1.5 rounded-md px-1 text-[12px] font-semibold text-dim hover:text-txt focus-visible:outline-2 focus-visible:outline-cyan">
                    <ChevronDown size={14} className={`motion-safe:transition-transform ${whyOpen ? "rotate-180" : ""}`} aria-hidden />
                    What drives this
                  </button>
                  {whyOpen && <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {signals.map((sg) => <Cell key={sg.name} k={sg.name} v={sg.value} note={sg.note} />)}
                  </div>}
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
                <Group title="Add more" rows={addMore} risk={riskOf} onPick={pickFromList} empty="None of your holdings are in the buy zone right now." />
                <Group title="Time to take profits" rows={takeProfits} risk={riskOf} onPick={pickFromList} empty="Nothing you own is in the sell zone." />
                {holdCount > 0 && (
                  <p className="px-3 py-2 text-[11px] text-faint">{holdCount} other{holdCount === 1 ? " is" : "s are"} in the hold zone</p>
                )}
              </>
            )}
          </div>
          <p className="px-3 py-3 text-[10.5px] text-faint border-t border-edge">
            Not financial advice. Risk describes how stretched price is, not where it goes next.
          </p>
        </>
      )}
    </section>
  );
}
