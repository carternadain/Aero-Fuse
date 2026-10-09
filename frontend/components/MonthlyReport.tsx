"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileBarChart, PiggyBank, TrendingDown, TrendingUp, X } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { api } from "@/lib/api";
import { on, openReport } from "@/lib/bus";
import { fmtCents, isHidden } from "@/lib/privacy";
import Skeleton from "./Skeleton";

interface Mover { symbol: string; pct: number; usd: number }
interface Report {
  month: string; label: string; complete: boolean;
  nw_start: number | null; nw_end: number | null; change: number | null; change_pct: number | null; estimated: boolean;
  best_day: { t: number; usd: number } | null; worst_day: { t: number; usd: number } | null;
  top: Mover[]; bottom: Mover[]; planned_in: number; match_in: number;
  spent: number | null; earned: number | null; series: { t: number; p: number }[];
}

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const signed = (n: number) => (isHidden() ? "•••" : `${n >= 0 ? "+" : "−"}${fmtCents(Math.abs(n))}`);
const day = (t: number) => new Date(t * 1000).toLocaleDateString([], { month: "short", day: "numeric" });

function lastMonths(n: number): string[] {
  const out = [], d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) { out.push(ym(d)); d.setMonth(d.getMonth() - 1); }
  return out; // newest first
}

function Sheet({ initial, onClose }: { initial: string; onClose: () => void }) {
  const months = useMemo(() => lastMonths(12), []);
  const [month, setMonth] = useState(initial);
  const [r, setR] = useState<Report | null>(null);
  const i = months.indexOf(month);

  useEffect(() => {
    setR(null);
    api.get<Report>(`/api/recap/month?month=${month}`).then(setR).catch(() => {});
  }, [month]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [onClose]);

  const up = (r?.change ?? 0) >= 0;
  const Row = ({ m, tone }: { m: Mover; tone: "up" | "down" }) => (
    <div className="flex items-center justify-between py-1.5 text-[13px]">
      <span className="font-bold text-txt">{m.symbol}</span>
      <span className="tabular-nums text-dim">{m.pct >= 0 ? "+" : ""}{m.pct.toFixed(1)}%</span>
      <span className={`tabular-nums font-bold w-24 text-right ${tone === "up" ? "text-up" : "text-down"}`}>{signed(m.usd)}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[86] bg-black/70 flex items-end sm:items-center justify-center"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full sm:max-w-md max-h-[94dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-edge2 tab-enter
                      bg-gradient-to-b from-panel2 via-panel to-bg pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-1 px-3 pt-3">
          <button className="icon-btn" disabled={i >= months.length - 1} onClick={() => setMonth(months[i + 1])}><ChevronLeft size={18} /></button>
          <div className="flex-1 text-center">
            <div className="text-[10px] font-bold tracking-[0.2em] text-faint">MONTHLY REPORT</div>
            <div className="font-display text-[26px] leading-tight text-txt">{r?.label ?? new Date(month + "-15").toLocaleDateString([], { month: "long", year: "numeric" })}</div>
          </div>
          <button className="icon-btn" disabled={i <= 0} onClick={() => setMonth(months[i - 1])}><ChevronRight size={18} /></button>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {!r ? (
          <div className="p-5 space-y-3"><Skeleton className="h-16" /><Skeleton className="h-28" /><Skeleton className="h-24" /></div>
        ) : (
          <div className="px-5 pt-2">
            <div className="text-center">
              <div className={`font-display text-[52px] leading-none ${up ? "text-up" : "text-down"}`}>
                {(r.change_pct ?? 0) >= 0 ? "+" : "−"}{Math.abs(r.change_pct ?? 0).toFixed(2)}%
              </div>
              <div className="text-[13px] text-dim mt-1 tabular-nums">
                {r.change != null && signed(r.change)} · {r.nw_start != null && fmtCents(r.nw_start).replace(/\.\d\d$/, "")} → {r.nw_end != null && fmtCents(r.nw_end).replace(/\.\d\d$/, "")}
              </div>
              {!r.complete && <div className="text-[10px] text-amber mt-1">Month in progress</div>}
            </div>

            {r.series.length > 1 && (
              <div className="h-[90px] mt-3 -mx-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={r.series} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
                    <defs>
                      <linearGradient id="rep-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={up ? "var(--color-up)" : "var(--color-down)"} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={up ? "var(--color-up)" : "var(--color-down)"} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <YAxis hide domain={["dataMin", "dataMax"]} />
                    <Area type="monotone" dataKey="p" stroke={up ? "var(--color-up)" : "var(--color-down)"} strokeWidth={2}
                          fill="url(#rep-fill)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mt-3">
              {r.best_day && (
                <div className="rounded-xl bg-panel2/60 p-3">
                  <div className="text-[10px] text-faint flex items-center gap-1"><TrendingUp size={11} /> Best day</div>
                  <div className="text-[15px] font-extrabold text-up tabular-nums">{signed(r.best_day.usd)}</div>
                  <div className="text-[10px] text-faint">{day(r.best_day.t)}</div>
                </div>
              )}
              {r.worst_day && (
                <div className="rounded-xl bg-panel2/60 p-3">
                  <div className="text-[10px] text-faint flex items-center gap-1"><TrendingDown size={11} /> Worst day</div>
                  <div className="text-[15px] font-extrabold text-down tabular-nums">{signed(r.worst_day.usd)}</div>
                  <div className="text-[10px] text-faint">{day(r.worst_day.t)}</div>
                </div>
              )}
            </div>

            {(r.top.length > 0 || r.bottom.length > 0) && (
              <div className="mt-4">
                <div className="text-[10px] font-bold tracking-widest text-faint">WHAT MOVED YOU</div>
                {r.top.filter((m) => m.usd > 0).map((m) => <Row key={m.symbol} m={m} tone="up" />)}
                {r.bottom.length > 0 && <div className="border-t border-edge/60 my-1" />}
                {r.bottom.map((m) => <Row key={m.symbol} m={m} tone="down" />)}
              </div>
            )}

            <div className="mt-4 rounded-xl border border-edge bg-panel/60 p-3 flex items-center gap-3">
              <PiggyBank size={18} className="text-cyan shrink-0" />
              <div className="flex-1 text-[12px] text-dim">
                Plan put away <b className="text-txt">{isHidden() ? "•••" : fmtCents(r.planned_in)}</b>
                {r.match_in > 0 && <> incl. <span className="text-cyan">{isHidden() ? "•••" : fmtCents(r.match_in)}</span> free match</>}
                {r.spent != null && <> · spent <b className="text-txt">{isHidden() ? "•••" : fmtCents(r.spent)}</b></>}
              </div>
            </div>

            <p className="text-[10px] text-faint text-center mt-3">
              {r.estimated ? "Start/end values estimated from what you hold now (no snapshot those days). " : ""}
              Aero-Fuse · {r.complete ? "final" : "so far"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Mount once: the report sheet opens on openReport(). */
export default function MonthlyReportHost() {
  const [month, setMonth] = useState<string | null>(null);
  useEffect(() => on<string | null>("app:report", (m) => {
    if (m) return setMonth(m);
    const d = new Date();
    if (d.getDate() <= 7) d.setMonth(d.getMonth() - 1); // early in the month, last month's report is the interesting one
    setMonth(ym(d));
  }), []);
  return month ? <Sheet initial={month} onClose={() => setMonth(null)} /> : null;
}

/** Home banner during the first week of a month: last month's report is ready. */
export function ReportBanner() {
  const [show, setShow] = useState(false);
  const d = new Date();
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const key = `report-seen-${ym(prev)}`;
  useEffect(() => {
    try { setShow(new Date().getDate() <= 7 && !localStorage.getItem(key)); } catch { /* */ }
  }, [key]);
  if (!show) return null;
  const dismiss = () => { try { localStorage.setItem(key, "1"); } catch { /* */ } setShow(false); };
  return (
    <div className="panel flex items-center gap-3 px-4 py-3 border-amber/40">
      <FileBarChart size={18} className="text-amber shrink-0" />
      <button className="flex-1 text-left text-[13px] text-txt font-semibold" onClick={() => { dismiss(); openReport(ym(prev)); }}>
        Your {prev.toLocaleDateString([], { month: "long" })} report is ready →
      </button>
      <button className="icon-btn" onClick={dismiss} aria-label="Dismiss"><X size={14} /></button>
    </div>
  );
}
