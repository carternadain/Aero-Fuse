"use client";

import { useState } from "react";
import { Pencil, Search, Star, X } from "lucide-react";
import { fmtPrice } from "@/lib/api";
import { openSearch, openTicker } from "@/lib/bus";
import { toggleStar, useStars } from "@/lib/stars";
import Sparkline from "./Sparkline";
import Skeleton from "./Skeleton";

/** Starred tickers with live price, today's move and how they've done since you starred them. */
export default function StarredList({ compact = false }: { compact?: boolean }) {
  const { items, loaded } = useStars();
  const [edit, setEdit] = useState(false);
  const rows = compact ? items.slice(0, 6) : items;

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><Star size={14} />Starred</span>
        <div className="flex items-center gap-1">
          {items.length > 0 && !compact && (
            <button className={`icon-btn ${edit ? "!text-up" : ""}`} onClick={() => setEdit(!edit)} title={edit ? "Done" : "Edit"} aria-label={edit ? "Done editing" : "Edit starred"} aria-pressed={edit}><Pencil size={13} /></button>
          )}
          <button className="icon-btn" onClick={openSearch} title="Find a ticker to star" aria-label="Find a ticker to star"><Search size={13} /></button>
        </div>
      </div>
      {!loaded ? (
        <div className="p-3 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : !items.length ? (
        <p className="px-4 py-5 text-[13px] text-dim">
          Tap <Star size={12} className="inline align-[-1px] text-amber" aria-label="star" /> on any ticker to keep it here.
        </p>
      ) : (
        <div>
          {rows.map((s) => {
            const up = (s.change_1d ?? 0) >= 0;
            return (
              <div key={`${s.kind}:${s.symbol}`} role="button" tabIndex={0}
                   onClick={() => !edit && openTicker({ symbol: s.symbol, kind: s.kind })}
                   onKeyDown={(e) => { if (!edit && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openTicker({ symbol: s.symbol, kind: s.kind }); } }}
                   className="flex items-center gap-3 px-4 min-h-[56px] py-2 border-t border-edge/50 first:border-t-0 hover:bg-panel2/60 cursor-pointer
                              focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan">
                <div className="min-w-0 w-[30%]">
                  <div className="text-[14px] font-bold text-txt truncate">{s.symbol}</div>
                  <div className="text-[10.5px] text-faint truncate">
                    {s.since_pct != null ? <>since ★ <span className={s.since_pct >= 0 ? "text-up" : "text-down"}>{s.since_pct >= 0 ? "+" : ""}{s.since_pct.toFixed(1)}%</span></>
                      : s.name ?? (s.kind === "crypto" ? "crypto" : "")}
                  </div>
                </div>
                <div className="flex-1 flex justify-center min-w-0">
                  {s.spark.length > 1 ? <Sparkline data={s.spark} width={88} height={28} /> : <span className="w-[88px]" />}
                </div>
                <div className="text-right shrink-0 min-w-[72px]">
                  <div className="text-[13px] font-bold tabular-nums text-txt">{s.price != null ? `$${fmtPrice(s.price)}` : "—"}</div>
                  <div className={`text-[11px] tabular-nums ${up ? "text-up" : "text-down"}`}>
                    {s.change_1d != null ? `${up ? "+" : ""}${s.change_1d.toFixed(2)}%` : ""}
                  </div>
                </div>
                {edit && (
                  <button className="icon-btn" onClick={(e) => { e.stopPropagation(); toggleStar(s.symbol, s.kind); }} title="Unstar" aria-label={`Unstar ${s.symbol}`}>
                    <X size={14} />
                  </button>
                )}
              </div>
            );
          })}
          {compact && items.length > rows.length && (
            <div className="px-4 py-2 text-[11px] text-faint border-t border-edge/50">+{items.length - rows.length} more in Invest › Ideas</div>
          )}
        </div>
      )}
    </section>
  );
}
