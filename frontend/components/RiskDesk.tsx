"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, ShieldAlert, ShieldCheck } from "lucide-react";
import type { Trade } from "@/lib/types";

type Settings = { account: number; riskPct: number; dailyLossPct: number };
const DEFAULTS: Settings = { account: 10000, riskPct: 1, dailyLossPct: 3 };
const KEY = "risk-settings";

function load(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

function num(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export default function RiskDesk({ trades }: { trades: Trade[] }) {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");

  useEffect(() => setS(load()), []);
  const save = (next: Settings) => {
    setS(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };

  // ── Position sizing ──
  const calc = useMemo(() => {
    const e = num(entry), sl = num(stop), tp = num(target);
    const riskDollars = s.account * (s.riskPct / 100);
    const perUnit = Math.abs(e - sl);
    if (!e || !sl || !perUnit) return { riskDollars, size: 0, value: 0, rr: 0 };
    const size = riskDollars / perUnit;
    const value = size * e;
    const dir = e > sl ? 1 : -1; // long if entry above stop
    const rr = tp ? Math.abs(tp - e) / perUnit * (dir * (tp - e) > 0 ? 1 : -1) : 0;
    return { riskDollars, size, value, rr };
  }, [entry, stop, target, s]);

  // ── Risk monitor ──
  const monitor = useMemo(() => {
    const open = trades.filter((t) => t.status === "open" || t.status === "partial");
    const openRisk = open.reduce((a, t) => a + (t.risk_pct || 0), 0);
    const today = new Date().toISOString().slice(0, 10);
    const closedToday = trades.filter((t) => t.status === "closed" && (t.closed_at || "").slice(0, 10) === today);
    const realizedToday = closedToday.reduce((a, t) => a + (t.pnl_pct || 0), 0);

    const closed = trades
      .filter((t) => t.status === "closed" && t.closed_at)
      .sort((a, b) => (b.closed_at || "").localeCompare(a.closed_at || ""));
    let streak = 0;
    for (const t of closed) {
      if (t.outcome === "loss") streak++;
      else break;
    }
    const limitHit = realizedToday <= -s.dailyLossPct;
    return { openCount: open.length, openRisk, realizedToday, streak, limitHit };
  }, [trades, s.dailyLossPct]);

  const rrColor = calc.rr >= 2 ? "text-up" : calc.rr > 0 ? "text-amber" : "text-faint";

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><Calculator size={14} /> Risk Desk</span>
        <div className="flex items-center gap-2 text-[10px] text-faint">
          <label className="flex items-center gap-1">acct $
            <input className="field !w-20 max-sm:!w-24 !py-0.5 !px-1.5 tabular-nums" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={s.account}
              onChange={(e) => save({ ...s, account: num(e.target.value) })} />
          </label>
          <label className="flex items-center gap-1">risk %
            <input className="field !w-12 max-sm:!w-20 !py-0.5 !px-1.5 tabular-nums" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={s.riskPct}
              onChange={(e) => save({ ...s, riskPct: num(e.target.value) })} />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-edge">
        {/* Position sizer */}
        <div className="p-3 space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-faint font-semibold">Position size</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <label className="field-wrap"><span className="field-label">Entry</span>
              <input className="field !py-1 tabular-nums" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="0" />
            </label>
            <label className="field-wrap"><span className="field-label">Stop</span>
              <input className="field !py-1 tabular-nums" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={stop} onChange={(e) => setStop(e.target.value)} placeholder="0" />
            </label>
            <label className="field-wrap max-sm:col-span-2"><span className="field-label">Target</span>
              <input className="field !py-1 tabular-nums" inputMode="decimal" autoComplete="off" enterKeyHint="done" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="optional" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-y-1 text-xs pt-1">
            <span className="text-dim">Risk</span>
            <span className="text-right tabular-nums text-txt">${calc.riskDollars.toFixed(0)} <span className="text-faint">({s.riskPct}%)</span></span>
            <span className="text-dim">Position size</span>
            <span className="text-right tabular-nums font-bold text-up">{calc.size ? calc.size.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"}</span>
            <span className="text-dim">Position value</span>
            <span className="text-right tabular-nums text-txt">{calc.value ? `$${calc.value.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}</span>
            <span className="text-dim">R:R to target</span>
            <span className={`text-right tabular-nums font-bold ${rrColor}`}>{calc.rr ? `${calc.rr.toFixed(2)}R` : "—"}</span>
          </div>
          {calc.rr > 0 && calc.rr < 2 && (
            <p className="text-[10px] text-amber">⚠ Below your 2:1 minimum — skip or move the target.</p>
          )}
        </div>

        {/* Risk monitor */}
        <div className="p-3 space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-faint font-semibold">Today&apos;s risk</p>
          <div className="grid grid-cols-2 gap-y-1.5 text-xs">
            <span className="text-dim">Open trades</span>
            <span className="text-right tabular-nums text-txt">{monitor.openCount}</span>
            <span className="text-dim">Open risk</span>
            <span className={`text-right tabular-nums ${monitor.openRisk > s.riskPct * 3 ? "text-down" : "text-txt"}`}>{monitor.openRisk.toFixed(1)}%</span>
            <span className="text-dim">Realized today</span>
            <span className={`text-right tabular-nums font-bold ${monitor.realizedToday > 0 ? "text-up" : monitor.realizedToday < 0 ? "text-down" : "text-txt"}`}>
              {monitor.realizedToday > 0 ? "+" : ""}{monitor.realizedToday.toFixed(2)}%
            </span>
            <span className="text-dim">Loss streak</span>
            <span className={`text-right tabular-nums ${monitor.streak >= 3 ? "text-down" : "text-txt"}`}>{monitor.streak}</span>
          </div>
          {monitor.limitHit ? (
            <div className="flex items-center gap-2 rounded-lg border border-down/50 bg-down/10 px-2.5 py-2 text-down text-[11px] font-bold">
              <ShieldAlert size={14} /> Daily loss limit hit ({s.dailyLossPct}%) — STOP TRADING TODAY.
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-up/30 bg-up/5 px-2.5 py-2 text-up text-[11px] font-semibold">
              <ShieldCheck size={14} /> Within limits ({Math.abs(s.dailyLossPct + monitor.realizedToday).toFixed(1)}% buffer left)
            </div>
          )}
          <label className="flex items-center justify-between text-[10px] text-faint">
            Daily loss limit
            <span className="flex items-center gap-1">
              <input className="field !w-14 max-sm:!w-20 !py-0.5 !px-1.5 tabular-nums" inputMode="decimal" autoComplete="off" enterKeyHint="done" value={s.dailyLossPct}
                onChange={(e) => save({ ...s, dailyLossPct: num(e.target.value) })} />%
            </span>
          </label>
        </div>
      </div>
    </section>
  );
}
