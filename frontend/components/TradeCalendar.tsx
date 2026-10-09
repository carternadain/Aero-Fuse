"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Flame } from "lucide-react";
import type { Trade } from "@/lib/types";

const WEEKS = 18;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function cellColor(pnl: number | undefined) {
  if (pnl == null) return "var(--color-panel2)";
  const k = Math.min(1, Math.abs(pnl) / 6);
  const c = pnl >= 0 ? "var(--color-up)" : "var(--color-down)";
  return `color-mix(in srgb, ${c} ${Math.round(25 + k * 65)}%, var(--color-panel))`;
}

/** P&L calendar (closed trades by day), streaks, and when you trade best. */
export default function TradeCalendar({ trades }: { trades: Trade[] }) {
  const [hover, setHover] = useState<{ d: string; pnl: number; n: number } | null>(null);

  const s = useMemo(() => {
    const closed = trades
      .filter((t) => t.status === "closed" && t.closed_at && t.pnl_pct != null)
      .sort((a, b) => a.closed_at!.localeCompare(b.closed_at!));
    const byDay: Record<string, { pnl: number; n: number }> = {};
    for (const t of closed) {
      const k = key(new Date(t.closed_at!));
      byDay[k] = { pnl: (byDay[k]?.pnl ?? 0) + (t.pnl_pct ?? 0), n: (byDay[k]?.n ?? 0) + 1 };
    }
    // streaks over decided trades
    let cur = 0, curKind: "win" | "loss" | null = null, bestWin = 0, run = 0;
    for (const t of closed) {
      const o = t.outcome === "win" ? "win" : t.outcome === "loss" ? "loss" : null;
      if (!o) continue;
      if (o === curKind) cur++; else { curKind = o; cur = 1; }
      run = o === "win" ? run + 1 : 0;
      bestWin = Math.max(bestWin, run);
    }
    const dow: { n: number; w: number; pnl: number }[] = DOW.map(() => ({ n: 0, w: 0, pnl: 0 }));
    let holdH = 0, holdN = 0;
    for (const t of closed) {
      const d = new Date(t.opened_at).getDay();
      dow[d].n++; dow[d].pnl += t.pnl_pct ?? 0; if (t.outcome === "win") dow[d].w++;
      const h = (new Date(t.closed_at!).getTime() - new Date(t.opened_at).getTime()) / 3600_000;
      if (h >= 0) { holdH += h; holdN++; }
    }
    const bestDow = dow.map((v, i) => ({ ...v, i })).filter((v) => v.n >= 2).sort((a, b) => b.pnl / b.n - a.pnl / a.n)[0];
    const last20 = closed.slice(-20).filter((t) => t.outcome === "win" || t.outcome === "loss");
    const now = new Date();
    const monthTrades = closed.filter((t) => new Date(t.closed_at!).getMonth() === now.getMonth() && new Date(t.closed_at!).getFullYear() === now.getFullYear());
    return {
      byDay, cur, curKind, bestWin, bestDow, avgHold: holdN ? holdH / holdN : null,
      wr20: last20.length ? (last20.filter((t) => t.outcome === "win").length / last20.length) * 100 : null, n20: last20.length,
      monthN: monthTrades.length, monthPnl: monthTrades.reduce((t, x) => t + (x.pnl_pct ?? 0), 0), total: closed.length,
    };
  }, [trades]);

  // grid: WEEKS columns ending this week, rows Sun..Sat
  const cols = useMemo(() => {
    const end = new Date(); end.setHours(0, 0, 0, 0);
    const start = new Date(end); start.setDate(end.getDate() - end.getDay() - (WEEKS - 1) * 7);
    return Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => {
      const x = new Date(start); x.setDate(start.getDate() + w * 7 + d);
      return x > end ? null : x;
    }));
  }, []);

  const hold = s.avgHold == null ? "—" : s.avgHold < 24 ? `${s.avgHold.toFixed(1)}h` : `${(s.avgHold / 24).toFixed(1)}d`;
  const Stat = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) => (
    <div className="rounded-lg bg-panel2/50 px-3 py-2 min-w-0">
      <div className="text-[10px] text-faint truncate">{k}</div>
      <div className={`text-[14px] font-extrabold tabular-nums ${tone ?? "text-txt"}`}>{v}</div>
    </div>
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><CalendarDays size={14} />Trading Calendar</span>
        <span className="text-[10px] text-faint tabular-nums">
          {hover ? `${new Date(hover.d + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" })} · ${hover.n} trade${hover.n > 1 ? "s" : ""} · ${hover.pnl >= 0 ? "+" : ""}${hover.pnl.toFixed(2)}%`
            : `last ${WEEKS} weeks · closed P&L by day`}
        </span>
      </div>
      <div className="p-3">
        <div className="flex gap-[3px] overflow-x-auto pb-1" data-noswipe>
          <div className="flex flex-col gap-[3px] pr-1 text-[8px] text-faint">
            {DOW.map((d, i) => <span key={d} className="h-[13px] leading-[13px]">{i % 2 ? d[0] : ""}</span>)}
          </div>
          {cols.map((col, w) => (
            <div key={w} className="flex flex-col gap-[3px]">
              {col.map((d, i) => {
                if (!d) return <span key={i} className="w-[13px] h-[13px]" />;
                const v = s.byDay[key(d)];
                return (
                  <span key={i} className="w-[13px] h-[13px] rounded-[3px] cursor-default"
                        style={{ background: cellColor(v?.pnl) }}
                        onMouseEnter={() => v && setHover({ d: key(d), ...v })} onMouseLeave={() => setHover(null)}
                        onClick={() => v && setHover({ d: key(d), ...v })} />
                );
              })}
            </div>
          ))}
        </div>
        {s.total === 0 ? (
          <p className="text-[12px] text-dim mt-3">Close a few trades in the log and your days, streaks and best weekday show up here.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
            <Stat k="Current streak" tone={s.curKind === "win" ? "text-up" : s.curKind === "loss" ? "text-down" : undefined}
                  v={s.curKind ? <span className="flex items-center gap-1">{s.curKind === "win" && s.cur >= 3 && <Flame size={13} />}{s.cur} {s.curKind === "win" ? "W" : "L"}</span> : "—"} />
            <Stat k="Best win streak" v={s.bestWin || "—"} />
            <Stat k={`Win rate, last ${s.n20}`} v={s.wr20 != null ? `${s.wr20.toFixed(0)}%` : "—"}
                  tone={s.wr20 != null ? (s.wr20 >= 50 ? "text-up" : "text-down") : undefined} />
            <Stat k="This month" v={`${s.monthN} · ${s.monthPnl >= 0 ? "+" : ""}${s.monthPnl.toFixed(1)}%`} tone={s.monthPnl >= 0 ? "text-up" : "text-down"} />
            <Stat k="Avg hold" v={hold} />
            <Stat k="Best day to open" v={s.bestDow ? `${DOW[s.bestDow.i]} · ${(s.bestDow.pnl / s.bestDow.n).toFixed(1)}%` : "need more trades"} />
          </div>
        )}
      </div>
    </section>
  );
}
