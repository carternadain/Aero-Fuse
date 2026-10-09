"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtCents, isHidden } from "@/lib/privacy";
import AnimatedNumber from "./AnimatedNumber";
import Skeleton from "./Skeleton";
import PriceChart, { NW_RANGES, POLL_MS, RANGE_LABEL, RangeTabs, fmtTime, type ChartData, type Range } from "./PriceChart";

interface NwChart extends ChartData {
  backfilled: boolean;
  history_since: string | null;
}

const KEY = "nw-range";

/** Robinhood-style headline + scrubbable net worth chart (Live · 1D · 1W · 1M · 1Y · All). */
export default function NetWorthChart({ label = "Net worth", height = 210 }: { label?: string; height?: number }) {
  const [range, setRange] = useState<Range>("1D");
  const [data, setData] = useState<NwChart | null>(null);
  const [scrub, setScrub] = useState<{ t: number; p: number } | null>(null);

  useEffect(() => {
    try {
      const r = localStorage.getItem(KEY) as Range | null;
      if (r && NW_RANGES.includes(r)) setRange(r);
    } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.get<NwChart>(`/api/networth/chart?range=${range}`)
        .then((d) => { if (alive) setData(d); })
        .catch(() => {});
    setData(null);
    load();
    const ms = POLL_MS[range];
    const t = ms ? setInterval(load, ms) : undefined;
    return () => { alive = false; if (t) clearInterval(t); };
  }, [range]);

  const pick = (r: Range) => {
    setRange(r);
    try { localStorage.setItem(KEY, r); } catch { /* private mode */ }
  };

  const pts = data?.points ?? [];
  const last = pts.length ? pts[pts.length - 1].p : null;
  const shown = scrub?.p ?? last;
  const base = data?.baseline ?? null;
  const chg = shown != null && base != null ? shown - base : null;
  const pct = chg != null && base ? (chg / base) * 100 : null;

  return (
    <div>
      <div className="px-1">
        <div className="text-[11px] text-dim">{label}</div>
        <div className="font-display text-[42px] sm:text-[48px] leading-none text-txt [font-variant-numeric:tabular-nums]">
          {shown != null ? <AnimatedNumber value={shown} format={fmtCents} instant={scrub != null} />
            : <Skeleton className="h-[42px] w-64 mt-1" />}
        </div>
        <div className="text-[12px] mt-1.5 h-4 tabular-nums">
          {chg != null && (
            <span className={chg >= 0 ? "text-up" : "text-down"}>
              {chg >= 0 ? "▲" : "▼"} {isHidden() ? "" : `${fmtCents(Math.abs(chg))} `}({Math.abs(pct ?? 0).toFixed(2)}%)
            </span>
          )}
          <span className="text-faint ml-1.5">
            {scrub ? fmtTime(scrub.t, range) : RANGE_LABEL[range]}
          </span>
        </div>
      </div>
      <div className="mt-3 -mx-1">
        <PriceChart data={data} range={range} height={height} onScrub={setScrub} />
      </div>
      <div className="mt-2 border-t border-edge/60 pt-2">
        <RangeTabs value={range} onChange={pick} ranges={NW_RANGES} />
      </div>
      {data?.backfilled && (
        <p className="text-[10px] text-faint mt-1.5 px-1">
          Back-calculated from what you hold today. Recorded history starts {data.history_since ?? "now"}.
        </p>
      )}
    </div>
  );
}
