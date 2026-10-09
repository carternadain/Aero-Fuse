"use client";

import { useEffect, useState } from "react";
import { CalendarClock, RefreshCw, TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { EarningsRow } from "@/lib/types";
import { api, fmtPrice } from "@/lib/api";

const BIAS_STYLE: Record<string, string> = {
  bullish: "bg-up/15 text-up border-up/40",
  bearish: "bg-down/15 text-down border-down/40",
  neutral: "bg-edge text-dim border-edge2",
};

function fmtDate(d: string | null) {
  if (!d) return "TBD";
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysUntil(d: string | null): string {
  if (!d) return "";
  const diff = Math.round((new Date(d + "T00:00:00").getTime() - Date.now()) / 86400000);
  if (diff < 0) return "reported";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return `in ${diff}d`;
}

export default function EarningsCalendar() {
  const [rows, setRows] = useState<EarningsRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api
      .get<{ earnings: EarningsRow[] }>("/api/markets/earnings")
      .then((r) => setRows(r.earnings))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">
          <CalendarClock size={14} /> Earnings &amp; Projections
          <span className="panel-sub text-[10px] text-faint font-medium ml-1">next calls · analyst bias</span>
        </span>
        <button className="btn !py-1.5 !px-2" onClick={load} disabled={loading} title="Refresh">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="overflow-y-auto max-h-[640px]">
        {rows.length === 0 && (
          <p className="p-4 text-xs text-dim">{loading ? "Loading earnings…" : "No data — try refresh."}</p>
        )}
        {rows.map((r) => {
          const Icon =
            r.bias === "bullish" ? TrendingUp : r.bias === "bearish" ? TrendingDown : Minus;
          return (
            <div key={r.symbol} className="px-3 py-2.5 border-b border-edge hover:bg-panel2 transition-colors">
              <div className="flex items-center gap-2">
                <span className="font-bold text-txt text-sm w-14">{r.symbol}</span>
                <span className="text-xs text-dim tabular-nums">{fmtDate(r.next_earnings)}</span>
                <span className="text-[10px] text-faint">{daysUntil(r.next_earnings)}</span>
                <span
                  className={`ml-auto shrink-0 inline-flex items-center gap-1 px-1.5 py-px rounded-md border text-[9px] font-bold uppercase ${
                    BIAS_STYLE[r.bias] ?? BIAS_STYLE.neutral
                  }`}
                >
                  <Icon size={9} strokeWidth={2.5} />
                  {r.bias}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-dim leading-snug">{r.projection}</p>
              {r.price != null && r.target_mean != null && (
                <p className="mt-0.5 text-[10px] text-faint tabular-nums">
                  ${fmtPrice(r.price)} now → ${fmtPrice(r.target_mean)} target
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="px-3 py-2 text-[10px] text-faint border-t border-edge">
        Bias is derived from analyst consensus targets vs current price (Yahoo Finance). Informational only.
      </p>
    </section>
  );
}
