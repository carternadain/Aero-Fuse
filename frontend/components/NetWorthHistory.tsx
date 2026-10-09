"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fmtCents, isHidden } from "@/lib/privacy";
import { fmtUsd } from "./NetWorth";
import AnimatedNumber from "./AnimatedNumber";
import Skeleton from "./Skeleton";
import PriceChart, { POLL_MS, RANGE_LABEL, fmtTime, type ChartData, type Range } from "./PriceChart";

interface Row {
  date: string;
  assets: number;
  liabilities: number;
  net_worth: number;
  investments: number | null;
  cash: number | null;
  property: number | null;
  source: "live" | "backup" | "rebuilt" | null;
}

interface NwChart extends ChartData { backfilled?: boolean; history_since?: string | null }

type HRange = "LIVE" | "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL";
const LIVE_KEYS: HRange[] = ["LIVE", "1D", "1W"];
const isLiveRange = (r: HRange) => LIVE_KEYS.includes(r);
const RANGES: { key: HRange; label: string; days: number | null }[] = [
  { key: "LIVE", label: "Live", days: null },
  { key: "1D", label: "1D", days: null },
  { key: "1W", label: "1W", days: null },
  { key: "1M", label: "1M", days: 30 },
  { key: "3M", label: "3M", days: 91 },
  { key: "1Y", label: "1Y", days: 365 },
  { key: "ALL", label: "All", days: null },
];
const KEY = "nwh-range";
const DAY = 86_400_000;

const unix = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
const hasSplit = (r: Row) => r.investments != null && r.cash != null && r.property != null;
const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default function NetWorthHistory() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [range, setRange] = useState<HRange>("3M");
  const [scrub, setScrub] = useState<{ t: number; p: number } | null>(null);
  const [live, setLive] = useState<NwChart | null>(null);
  const [hasLive, setHasLive] = useState(false); // intraday data actually varies (live-priced holdings)
  const picked = useRef(false);
  const liveMode = isLiveRange(range);

  useEffect(() => {
    try {
      const r = localStorage.getItem(KEY) as HRange | null;
      if (r && RANGES.some((x) => x.key === r)) { picked.current = true; setRange(r); }
    } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    let alive = true;
    api.get<Row[]>("/api/networth/history")
      .then((d) => { if (alive) setRows(Array.isArray(d) ? d : []); })
      .catch(() => { if (alive) setRows([]); });
    // Probe intraday data: only offer Live/1D/1W (and default to 1D) when the line actually moves.
    api.get<NwChart>("/api/networth/chart?range=1D")
      .then((d) => {
        if (!alive) return;
        const ps = (d?.points ?? []).map((x) => x.p);
        const varies = ps.length > 2 && Math.max(...ps) - Math.min(...ps) > 0.005;
        setHasLive(varies);
        if (varies && !picked.current) setRange("1D");
        // A remembered Live/1D/1W pick with no live data would show an empty hero: fall back to history.
        if (!varies) setRange((r) => (isLiveRange(r) ? "3M" : r));
      })
      .catch(() => { if (alive) setRange((r) => (isLiveRange(r) ? "3M" : r)); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!liveMode) { setLive(null); return; }
    let alive = true;
    const load = () =>
      api.get<NwChart>(`/api/networth/chart?range=${range}`)
        .then((d) => { if (alive) setLive(d); })
        .catch(() => {});
    setLive(null);
    load();
    const ms = POLL_MS[range as Range];
    const t = ms ? setInterval(load, ms) : undefined;
    return () => { alive = false; if (t) clearInterval(t); };
  }, [range, liveMode]);

  const pick = (r: HRange) => {
    picked.current = true;
    setRange(r);
    setScrub(null);
    try { localStorage.setItem(KEY, r); } catch { /* private mode */ }
  };

  // The breakdown/history window; live ranges borrow the 1M window for the breakdown.
  const histKey: HRange = liveMode ? "1M" : range;
  const inRange = useMemo(() => {
    if (!rows?.length) return [];
    const days = RANGES.find((x) => x.key === histKey)?.days;
    if (!days) return rows;
    const last = Date.parse(`${rows[rows.length - 1].date}T00:00:00Z`);
    const cutoff = last - days * DAY;
    return rows.filter((r) => Date.parse(`${r.date}T00:00:00Z`) >= cutoff);
  }, [rows, histKey]);

  const chart = useMemo<ChartData | null>(() => {
    if (inRange.length < 2) return null;
    const points = inRange.map((r) => ({ t: unix(r.date), p: r.net_worth }));
    const base = points[0].p;
    const change = points[points.length - 1].p - base;
    return { points, baseline: base, change, change_pct: base ? (change / base) * 100 : null };
  }, [inRange]);

  const firstSplit = useMemo(() => (rows ?? []).find(hasSplit) ?? null, [rows]);
  const rebuiltTo = useMemo(() => {
    let k = -1;
    inRange.forEach((r, i) => { if (r.source === "rebuilt") k = i; });
    if (k < 0) return null;
    return (inRange[k + 1] ?? inRange[k]).date; // first recorded day after the rebuilt stretch
  }, [inRange]);

  const loading = rows == null;
  const latest = inRange.length ? inRange[inRange.length - 1] : null;
  const shownRow = (!liveMode && scrub && inRange.find((r) => unix(r.date) === scrub.t)) || latest;
  const first = inRange[0] ?? null;
  const livePts = live?.points ?? [];
  const liveShown = scrub?.p ?? (livePts.length ? livePts[livePts.length - 1].p : null);
  const heroVal = liveMode ? liveShown : shownRow?.net_worth ?? null;
  const chg = liveMode
    ? (liveShown != null && live?.baseline != null ? liveShown - live.baseline : null)
    : shownRow && first ? shownRow.net_worth - first.net_worth : null;
  const chgBase = liveMode ? live?.baseline ?? null : first?.net_worth ?? null;
  const pct = chg != null && chgBase ? (chg / chgBase) * 100 : null;
  const visibleRanges = RANGES.filter((r) => hasLive || !isLiveRange(r.key));

  // Bucket change uses the first row in range with a full split.
  const splitBase = inRange.find(hasSplit) ?? null;
  const split = shownRow && hasSplit(shownRow) ? shownRow : null;

  const buckets = split ? [
    { key: "inv", label: "Investments", color: "var(--color-cyan)", val: split.investments!, base: splitBase?.investments ?? null, good: 1 },
    { key: "cash", label: "Cash", color: "var(--color-amber)", val: split.cash!, base: splitBase?.cash ?? null, good: 1 },
    { key: "prop", label: "Property & other", color: "var(--color-dim)", val: split.property!, base: splitBase?.property ?? null, good: 1 },
    { key: "debt", label: "Debts", color: "var(--color-down)", val: -split.liabilities, base: splitBase ? -splitBase.liabilities : null, good: 1 },
  ] : [];
  const segs = buckets.slice(0, 3).filter((b) => b.val > 0);
  const segTotal = segs.reduce((s, b) => s + b.val, 0);

  const money = (n: number) => (isHidden() ? fmtCents(n) : fmtUsd(n));
  const signed = (n: number) => (isHidden() ? "" : `${n >= 0 ? "+" : "−"}${fmtUsd(Math.abs(n))}`);

  return (
    <section className="panel">
      <div className="p-4">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-[42px] w-56" />
            <Skeleton className="h-[180px]" />
            <Skeleton className="h-24" />
          </div>
        ) : inRange.length < 2 && (rows?.length ?? 0) < 2 && !hasLive && !liveMode ? (
          <p className="text-[12px] text-dim py-6 text-center">Net worth is recorded once a day. The line starts tomorrow.</p>
        ) : (
          <>
            <div className="px-1">
              <div className="text-[11px] text-dim">Net worth</div>
              <div className="font-display text-[42px] sm:text-[48px] leading-none text-txt [font-variant-numeric:tabular-nums]">
                {heroVal != null ? <AnimatedNumber value={heroVal} format={fmtCents} instant={scrub != null} />
                  : <Skeleton className="h-[42px] w-64 mt-1" />}
              </div>
              <div className="text-[12px] mt-1.5 min-h-4 tabular-nums">
                {chg != null && (
                  <span className={chg >= 0 ? "text-up" : "text-down"}>
                    {chg >= 0 ? "▲" : "▼"} {isHidden() ? "" : `${fmtCents(Math.abs(chg))} `}({Math.abs(pct ?? 0).toFixed(2)}%)
                  </span>
                )}
                {liveMode
                  ? <span className="text-faint ml-1.5">{scrub ? fmtTime(scrub.t, range as Range) : RANGE_LABEL[range as Range]}</span>
                  : shownRow && <span className="text-faint ml-1.5">{fmtDate(shownRow.date)}</span>}
              </div>
            </div>

            <div className="mt-3 -mx-1">
              <PriceChart data={liveMode ? live : chart} range={liveMode ? (range as Range) : "1Y"} height={190} onScrub={setScrub} />
            </div>

            <div role="group" aria-label="Range" className="mt-2 border-t border-edge/60 pt-2 flex justify-between sm:justify-start sm:gap-1">
              {visibleRanges.map((r) => (
                <button key={r.key} onClick={() => pick(r.key)} aria-pressed={range === r.key}
                        className={`min-h-10 min-w-12 px-3 rounded-full text-[11px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-up ${
                          range === r.key ? "bg-up/15 text-up" : "text-dim hover:text-txt"
                        }`}>
                  {r.label}
                </button>
              ))}
            </div>

            {inRange.length >= 2 && shownRow && (
              <div className="mt-4 border-t border-edge/60 pt-3">
                <div className="text-[11px] font-bold text-dim mb-2 px-1">What it&apos;s made of</div>
                {split ? (
                  <>
                    <div className="flex gap-0.5 h-2 px-1" aria-hidden>
                      {segs.map((b) => (
                        <div key={b.key} className="rounded-full min-w-[3px]"
                             style={{ flexGrow: b.val / segTotal, flexBasis: 0, background: b.color }} />
                      ))}
                    </div>
                    <ul className="mt-3 space-y-1">
                      {buckets.map((b) => {
                        const d = b.base != null ? b.val - b.base : null;
                        return (
                          <li key={b.key} className="flex items-center gap-2 px-1 py-1.5 text-[12px]">
                            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: b.color }} aria-hidden />
                            <span className="text-dim truncate">{b.label}</span>
                            <span className="ml-auto text-txt font-bold tabular-nums whitespace-nowrap">{money(b.val)}</span>
                            <span className={`w-20 sm:w-24 text-right tabular-nums text-[11px] whitespace-nowrap ${
                              d == null || d === 0 ? "text-faint" : d > 0 ? "text-up" : "text-down"
                            }`}>
                              {d == null ? "—" : d === 0 ? "—" : signed(d) || (d > 0 ? "▲" : "▼")}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : (
                  <div className="px-1 text-[12px] tabular-nums">
                    <div className="flex justify-between"><span className="text-dim">Assets</span><span className="text-txt font-bold">{money(shownRow.assets)}</span></div>
                    <div className="flex justify-between mt-1"><span className="text-dim">Debts</span><span className="text-txt font-bold">{money(-shownRow.liabilities)}</span></div>
                    {firstSplit && <p className="text-[10px] text-faint mt-2">Split starts {fmtDate(firstSplit.date)}</p>}
                  </div>
                )}
              </div>
            )}

            {rebuiltTo && (
              <p className="text-[10px] text-faint mt-3 px-1">
                Days before {fmtDate(rebuiltTo)} were rebuilt from backups at that day&apos;s prices.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
