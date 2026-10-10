"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/api";
import { fmtCents, setHidden, usePrivacy } from "@/lib/privacy";
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
  source: "live" | "backup" | "rebuilt" | "estimate" | null;
}

interface NwChart extends ChartData { backfilled?: boolean; history_since?: string | null }

type HRange = "LIVE" | "1D" | "1W" | "1M" | "3M" | "1Y" | "5Y" | "ALL";
const LIVE_KEYS: HRange[] = ["LIVE", "1D", "1W"];
const isLiveRange = (r: HRange) => LIVE_KEYS.includes(r);
// `days`: window length. A history range is offered only when the data reaches past the
// previous one, so every chip shows something new.
const RANGES: { key: HRange; label: string; days: number | null }[] = [
  { key: "LIVE", label: "Live", days: null },
  { key: "1D", label: "1D", days: null },
  { key: "1W", label: "1W", days: null },
  { key: "1M", label: "1M", days: 30 },
  { key: "3M", label: "3M", days: 91 },
  { key: "1Y", label: "1Y", days: 365 },
  { key: "5Y", label: "5Y", days: 1826 },
  { key: "ALL", label: "Max", days: null },
];
const HIST = RANGES.filter((r) => !isLiveRange(r.key));
const KEY = "nwh-range";
const DAY = 86_400_000;
const MAX_POINTS = 420; // long ranges are thinned to about weekly so the line stays light

const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const unix = (d: string) => ms(d) / 1000;
const hasSplit = (r: Row) => r.investments != null && r.cash != null && r.property != null;
const isEst = (r: Row | null | undefined) => r?.source === "estimate";
const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Keep about one row per `step` days (always the last), so long ranges space evenly in time. */
function thin(rows: Row[], stepDays: number): Row[] {
  if (stepDays <= 1) return rows;
  const out: Row[] = [];
  let next = -Infinity;
  rows.forEach((r, i) => {
    const t = ms(r.date);
    if (t >= next || i === rows.length - 1) { out.push(r); next = t + stepDays * DAY - DAY / 2; }
  });
  return out;
}

export default function NetWorthHistory() {
  const hidden = usePrivacy();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [range, setRange] = useState<HRange>("3M");
  const [scrub, setScrub] = useState<{ t: number; p: number } | null>(null);
  const [live, setLive] = useState<NwChart | null>(null);
  const [hasLive, setHasLive] = useState(false); // intraday data actually varies (live-priced holdings)
  const picked = useRef(false);

  useEffect(() => {
    try {
      const r = localStorage.getItem(KEY) as HRange | null;
      if (r && RANGES.some((x) => x.key === r)) { picked.current = true; setRange(r); }
    } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    let alive = true;
    // Recorded days first (instant), then the same list with estimated earlier days prepended.
    api.get<Row[]>("/api/networth/history")
      .then((d) => { if (alive) setRows((cur) => cur ?? (Array.isArray(d) ? d : [])); })
      .catch(() => { if (alive) setRows((cur) => cur ?? []); });
    api.get<Row[]>("/api/networth/history?estimate=true")
      .then((d) => { if (alive && Array.isArray(d) && d.length) setRows((cur) => (!cur || d.length >= cur.length ? d : cur)); })
      .catch(() => { /* recorded days are enough */ });
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

  // History ranges the data actually reaches; a remembered pick beyond them shows the longest one.
  const spanDays = rows && rows.length > 1 ? (ms(rows[rows.length - 1].date) - ms(rows[0].date)) / DAY : 0;
  const histRanges = useMemo(() => {
    const out = [HIST[0]];
    for (let i = 1; i < HIST.length; i++) {
      const prev = HIST[i - 1].days ?? Infinity;
      if (spanDays > prev + 1) out.push(HIST[i]);
    }
    return out;
  }, [spanDays]);
  const visibleRanges = [...RANGES.filter((r) => hasLive && isLiveRange(r.key)), ...histRanges];
  const eff: HRange = visibleRanges.some((r) => r.key === range) ? range : histRanges[histRanges.length - 1].key;
  const liveMode = isLiveRange(eff);

  useEffect(() => {
    if (!liveMode) { setLive(null); return; }
    let alive = true;
    const load = () =>
      api.get<NwChart>(`/api/networth/chart?range=${eff}`)
        .then((d) => { if (alive) setLive(d); })
        .catch(() => {});
    setLive(null);
    load();
    const t = POLL_MS[eff as Range] ? setInterval(load, POLL_MS[eff as Range]) : undefined;
    return () => { alive = false; if (t) clearInterval(t); };
  }, [eff, liveMode]);

  const pick = (r: HRange) => {
    picked.current = true;
    setRange(r);
    setScrub(null);
    try { localStorage.setItem(KEY, r); } catch { /* private mode */ }
  };

  // The breakdown/history window; live ranges borrow the 1M window for the breakdown.
  const histKey: HRange = liveMode ? "1M" : eff;
  const inRange = useMemo(() => {
    if (!rows?.length) return [];
    const days = RANGES.find((x) => x.key === histKey)?.days;
    const last = ms(rows[rows.length - 1].date);
    const win = days ? rows.filter((r) => ms(r.date) >= last - days * DAY) : rows;
    const span = win.length > 1 ? (last - ms(win[0].date)) / DAY : 0;
    return thin(win, span > MAX_POINTS ? Math.max(7, Math.ceil(span / MAX_POINTS)) : 1);
  }, [rows, histKey]);

  const chart = useMemo<ChartData | null>(() => {
    if (inRange.length < 2) return null;
    const points = inRange.map((r) => ({ t: unix(r.date), p: r.net_worth }));
    const base = points[0].p;
    const change = points[points.length - 1].p - base;
    return { points, baseline: base, change, change_pct: base ? (change / Math.abs(base)) * 100 : null };
  }, [inRange]);

  // Where estimated days end, as a fraction of the chart width (the chart spaces points evenly).
  const estEnd = useMemo(() => {
    const k = inRange.findIndex((r) => !isEst(r));
    if (k <= 0 || inRange.length < 2) return null;
    return k / (inRange.length - 1);
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
  const pct = chg != null && chgBase ? (chg / Math.abs(chgBase)) * 100 : null;
  const scrubEst = !liveMode && scrub != null && isEst(shownRow);
  // first recorded day, when the visible history starts with estimated days
  const estFrom = !liveMode && chart && estEnd != null ? rows?.find((r) => !isEst(r))?.date ?? null : null;

  // Bucket change uses the first row in range with a full split.
  const splitBase = inRange.find(hasSplit) ?? null;
  const split = shownRow && hasSplit(shownRow) ? shownRow : null;

  const buckets = split ? [
    { key: "inv", label: "Investments", color: "var(--color-cyan)", val: split.investments!, base: splitBase?.investments ?? null },
    { key: "cash", label: "Cash", color: "var(--color-amber)", val: split.cash!, base: splitBase?.cash ?? null },
    { key: "prop", label: "Property & other", color: "var(--color-dim)", val: split.property!, base: splitBase?.property ?? null },
    { key: "debt", label: "Debts", color: "var(--color-down)", val: -split.liabilities, base: splitBase ? -splitBase.liabilities : null },
  ].filter((b) => b.val !== 0 || (b.base ?? 0) !== 0) : []; // an always-empty bucket is just noise
  const segs = buckets.filter((b) => b.key !== "debt" && b.val > 0);
  const segTotal = segs.reduce((s, b) => s + b.val, 0);

  const money = (n: number) => (hidden ? fmtCents(n) : fmtUsd(n));
  const signed = (n: number) => (hidden ? "" : `${n >= 0 ? "+" : "−"}${fmtUsd(Math.abs(n))}`);

  const eye = (
    <button type="button" onClick={() => setHidden(!hidden)} aria-pressed={hidden} aria-label="Hide balances"
            title={hidden ? "Show balances" : "Hide balances"}
            className="-mr-2 -mt-1 w-10 h-10 shrink-0 grid place-items-center rounded-full text-dim hover:text-txt hover:bg-panel2 transition-colors focus-visible:outline-2 focus-visible:outline-up">
      {hidden ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
    </button>
  );

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
          <div className="flex items-start gap-2">
            <p className="flex-1 text-[12px] text-dim py-6 text-center">Net worth is recorded once a day. The line starts tomorrow.</p>
            {eye}
          </div>
        ) : (
          <>
            <div className="px-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] text-dim">Net worth</div>
                  <div className="font-display text-[42px] sm:text-[48px] leading-none text-txt [font-variant-numeric:tabular-nums]">
                    {heroVal != null ? <AnimatedNumber value={heroVal} format={fmtCents} instant={scrub != null} />
                      : <Skeleton className="h-[42px] w-56 mt-1" />}
                  </div>
                </div>
                {eye}
              </div>
              <div className="text-[12px] mt-1.5 min-h-4 tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
                {chg != null && (
                  <span className={chg >= 0 ? "text-up" : "text-down"}>
                    {chg >= 0 ? "▲" : "▼"} {hidden ? "" : `${fmtCents(Math.abs(chg))} `}({Math.abs(pct ?? 0).toFixed(2)}%)
                  </span>
                )}
                {liveMode
                  ? <span className="text-faint ml-1.5">{scrub ? fmtTime(scrub.t, eff as Range) : RANGE_LABEL[eff as Range]}</span>
                  : shownRow && <span className="text-faint ml-1.5">{fmtDate(shownRow.date)}</span>}
              </div>
            </div>

            <div className="mt-3 -mx-1 relative">
              <PriceChart data={liveMode ? live : chart} range={liveMode ? (eff as Range) : "1Y"} height={190} onScrub={setScrub} />
              {estFrom && (
                // estimated days sit left of this line
                <div aria-hidden className="absolute top-2 bottom-0 border-l border-dashed border-faint/50 pointer-events-none"
                     style={{ left: `${estEnd! * 100}%` }} />
              )}
            </div>
            {estFrom && (
              <p className="px-1 mt-1 text-[10px] leading-[14px] text-faint truncate">
                {scrubEst ? "Estimated from today’s holdings" : `Estimated before ${fmtDate(estFrom)}`}
              </p>
            )}

            <div role="group" aria-label="Range" className="mt-2 border-t border-edge/60 pt-2 flex justify-between sm:justify-start sm:gap-1">
              {visibleRanges.map((r) => (
                <button key={r.key} onClick={() => pick(r.key)} aria-pressed={eff === r.key}
                        className={`min-h-10 min-w-10 px-1.5 sm:min-w-12 sm:px-3 rounded-full text-[11px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-up ${
                          eff === r.key ? "bg-up/15 text-up" : "text-dim hover:text-txt"
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
                              d == null || Math.abs(d) < 0.5 ? "text-faint" : d > 0 ? "text-up" : "text-down"
                            }`}>
                              {d == null || Math.abs(d) < 0.5 ? "—" : signed(d) || (d > 0 ? "▲" : "▼")}
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
