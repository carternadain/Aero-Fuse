"use client";

import InfoTip from "./InfoTip";
import Skeleton from "./Skeleton";
import StarButton from "./StarButton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layers, RefreshCw } from "lucide-react";
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Zone, ZoneChartResponse, ZoneHolding, ZonesResponse } from "@/lib/types";
import { api, fmtPnl, fmtPrice } from "@/lib/api";
import { haptic, navigate } from "@/lib/bus";
import { fmtCents, isHidden } from "@/lib/privacy";

type Kind = "stock" | "crypto";
interface Sel { kind: Kind; symbol: string }

const LS_KEY = "buyzones:sel";
const ZONE_COLOR: Record<Zone, string> = { buy: "var(--color-up)", hold: "var(--color-amber)", sell: "var(--color-down)" };
const ZONE_BG: Record<Zone, string> = { buy: "bg-up", hold: "bg-amber", sell: "bg-down" };
const ZONE_NAME: Record<Zone, string> = { buy: "Buy zone", hold: "Hold zone", sell: "Sell zone" };

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

export default function BuyZones() {
  const [data, setData] = useState<ZonesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [sel, setSel] = useState<Sel | null>(null);
  const [chart, setChart] = useState<ZoneChartResponse | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
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

  // Chart data
  useEffect(() => {
    if (!sel) return;
    let live = true;
    setChartLoading(true);
    api
      .get<ZoneChartResponse>(`/api/zones/chart/${sel.kind}/${encodeURIComponent(sel.symbol)}`)
      .then((r) => live && setChart(r))
      .catch(() => live && setChart(null))
      .finally(() => live && setChartLoading(false));
    return () => { live = false; };
  }, [sel]);

  const holding = data?.holdings.find((h) => sel && h.symbol === sel.symbol && h.kind === sel.kind) ?? null;
  const watchItem = data?.watch.find((w) => sel && w.symbol === sel.symbol && w.kind === sel.kind) ?? null;
  const points = useMemo(() => (chart && sel && chart.symbol === sel.symbol ? chart.points : []), [chart, sel]);
  const lastPoint = points[points.length - 1];

  const score = holding?.score?.score ?? watchItem?.score ?? lastPoint?.score ?? null;
  const price = holding?.price ?? watchItem?.price ?? lastPoint?.price ?? null;
  const zone = zoneOf(score);
  const label = holding?.score?.label ?? watchItem?.label ?? (score != null ? labelOf(score) : null);

  // Contiguous runs of buy / sell days
  const bands = useMemo(() => {
    const out: { x1: string; x2: string; zone: Zone }[] = [];
    let start = -1;
    let cur: Zone | null = null;
    const close = (end: number) => {
      if (cur && cur !== "hold" && start >= 0) {
        out.push({ x1: points[start].date, x2: points[Math.min(end + 1, points.length - 1)].date, zone: cur });
      }
    };
    points.forEach((p, i) => {
      const z = zoneOf(p.score);
      if (z !== cur) { close(i - 1); cur = z; start = i; }
    });
    close(points.length - 1);
    return out;
  }, [points]);

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

  const Row = ({ h }: { h: ZoneHolding }) => {
    const z = h.zone ?? zoneOf(h.score?.score);
    const c = z ? ZONE_COLOR[z] : "var(--color-dim)";
    return (
      <button
        onClick={() => pickFromList(h)}
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
  };

  const Group = ({ title, rows, empty }: { title: string; rows: ZoneHolding[]; empty: string }) => (
    <div>
      <div className="px-3 pt-3 pb-1"><Label>{title}</Label></div>
      {rows.length === 0 ? (
        <p className="px-3 pb-2 text-xs text-dim">{empty}</p>
      ) : (
        <div className="divide-y divide-edge">{rows.map((h) => <Row key={`${h.kind}-${h.symbol}`} h={h} />)}</div>
      )}
    </div>
  );

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
                    <div className="h-full bg-amber opacity-30" style={{ width: "20%" }} />
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
                {chartLoading && points.length === 0 ? (
                  <Skeleton className="h-[220px] sm:h-[280px] w-full" />
                ) : points.length < 2 ? (
                  <p className="py-10 text-center text-dim text-xs">Not enough price history for this one yet.</p>
                ) : (
                  <>
                    <div className="h-[220px] sm:h-[280px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                          <CartesianGrid stroke="var(--color-edge)" strokeOpacity={0.5} vertical={false} />
                          {bands.map((b, i) => (
                            <ReferenceArea key={i} x1={b.x1} x2={b.x2} fill={ZONE_COLOR[b.zone]} fillOpacity={0.12} stroke="none" ifOverflow="visible" />
                          ))}
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--color-faint)" }} minTickGap={48} tickLine={false} axisLine={false}
                                 tickFormatter={(d: string) => d.slice(2, 7)} />
                          <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "var(--color-faint)" }} width={44} tickLine={false} axisLine={false}
                                 tickFormatter={(v: number) => fmtPrice(v)} />
                          <Tooltip
                            cursor={{ stroke: "var(--color-dim)", strokeWidth: 1 }}
                            content={({ active, payload }) => {
                              const p = active ? payload?.[0]?.payload as typeof points[number] | undefined : undefined;
                              if (!p) return null;
                              const z = zoneOf(p.score);
                              return (
                                <div className="rounded-[10px] border border-edge2 bg-panel2 px-2.5 py-1.5 text-[11px] tabular-nums">
                                  <div className="text-dim">{p.date}</div>
                                  <div className="text-txt font-bold">${fmtPrice(p.price)}</div>
                                  <div className="text-dim">{p.score != null ? `score ${Math.round(p.score)} · ${z ? ZONE_NAME[z] : ""}` : "no score"}</div>
                                </div>
                              );
                            }}
                          />
                          <Line type="monotone" dataKey="price" stroke="var(--color-txt)" strokeWidth={2} dot={false} isAnimationActive={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-dim mt-1">
                      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-up opacity-40" />Buy zone</span>
                      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-down opacity-40" />Sell zone</span>
                      <span className="text-faint">Unshaded = hold</span>
                    </div>
                  </>
                )}
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
                <Group title="Add more" rows={accumulate} empty="None of your holdings are in the buy zone right now." />
                <Group title="Time to take profits" rows={sell} empty="Nothing you own is stretched into the sell zone." />
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
