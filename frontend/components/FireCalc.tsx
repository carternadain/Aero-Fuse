"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Flame } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";

interface FireInputs {
  currentNW: number;
  age: number;
  monthlyInvest: number;
  annualSpend: number;
  returnPct: number;     // nominal expected return %
  inflationPct: number;
  swrPct: number;        // safe withdrawal rate %
}

const DEFAULTS: FireInputs = {
  currentNW: 25000, age: 25, monthlyInvest: 1500, annualSpend: 50000,
  returnPct: 8, inflationPct: 3, swrPct: 4,
};

const STORAGE_KEY = "fire-inputs-v1";

function Slider({
  label, value, min, max, step, fmt, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  fmt: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-dim uppercase tracking-wider">{label}</span>
        <span className="text-amber font-bold tabular-nums">{fmt(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 accent-up cursor-pointer"
      />
    </div>
  );
}

export default function FireCalc() {
  const [inp, setInp] = useState<FireInputs>(DEFAULTS);
  const [loadedNW, setLoadedNW] = useState(false);

  // Restore saved inputs, then offer live net worth as the starting point
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setInp({ ...DEFAULTS, ...JSON.parse(saved) });
    } catch { /* fresh defaults */ }
    api.get<{ totals: { net_worth: number } }>("/api/accounts")
      .then((r) => {
        if (r.totals.net_worth !== 0) {
          setInp((p) => ({ ...p, currentNW: Math.round(r.totals.net_worth) }));
          setLoadedNW(true);
        }
      })
      .catch(() => {});
    api.get<{ monthly_you: number; monthly_match: number }>("/api/contributions")
      .then((r) => {
        const m = Math.round(r.monthly_you + r.monthly_match);
        if (m > 0) setInp((p) => ({ ...p, monthlyInvest: m }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(inp)); } catch { /* private mode */ }
    window.dispatchEvent(new Event("fire-inputs")); // Money Lab shares these assumptions
  }, [inp]);

  const set = (k: keyof FireInputs) => (v: number) => setInp((p) => ({ ...p, [k]: v }));

  const calc = useMemo(() => {
    const realReturn = (1 + inp.returnPct / 100) / (1 + inp.inflationPct / 100) - 1;
    const fireNumber = inp.annualSpend / (inp.swrPct / 100);
    const leanFire = (inp.annualSpend * 0.7) / (inp.swrPct / 100);
    const fatFire = (inp.annualSpend * 2) / (inp.swrPct / 100);

    // Coast FIRE: the amount that grows to fireNumber by age 65 with zero new contributions
    const yearsTo65 = Math.max(0, 65 - inp.age);
    const coastNumber = fireNumber / Math.pow(1 + realReturn, yearsTo65);

    const data: { age: number; nw: number; contributions: number }[] = [];
    let nw = inp.currentNW;
    let contributed = inp.currentNW;
    let fireAge: number | null = null;
    let leanAge: number | null = null;
    // Monthly compounding with monthly deposits (matches Money Lab and how accounts actually grow).
    const rm = Math.pow(1 + realReturn, 1 / 12) - 1;
    for (let m = 0; m <= 45 * 12; m++) {
      if (m % 12 === 0) data.push({ age: inp.age + m / 12, nw: Math.round(nw), contributions: Math.round(contributed) });
      if (fireAge === null && nw >= fireNumber) fireAge = Math.round(inp.age + m / 12);
      if (leanAge === null && nw >= leanFire) leanAge = Math.round(inp.age + m / 12);
      nw = nw * (1 + rm) + inp.monthlyInvest;
      contributed += inp.monthlyInvest;
    }
    const coastReached = inp.currentNW >= coastNumber;
    return { realReturn, fireNumber, leanFire, fatFire, coastNumber, coastReached, fireAge, leanAge, data };
  }, [inp]);

  const yearsAway = calc.fireAge !== null ? calc.fireAge - inp.age : null;
  const progress = Math.min(100, (inp.currentNW / calc.fireNumber) * 100);

  return (
    <section className="panel flex flex-col">
      <div className="panel-head">
        <span className="panel-title"><Flame size={14} />FIRE Calculator</span>
        <span className="text-[10px] text-dim">
          {loadedNW ? "NW synced from tracker" : "real (inflation-adj.) returns"}
        </span>
      </div>

      {/* Verdict strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-edge border-b border-edge text-center">
        <div className="py-2">
          <div className="text-[9px] text-dim uppercase tracking-widest">FIRE Number</div>
          <div className="text-sm font-bold text-amber tabular-nums">{fmtUsd(calc.fireNumber)}</div>
        </div>
        <div className="py-2">
          <div className="text-[9px] text-dim uppercase tracking-widest">FIRE Age</div>
          <div className="text-sm font-bold text-up tabular-nums">
            {calc.fireAge !== null ? `${calc.fireAge} (${yearsAway}y)` : "45y+"}
          </div>
        </div>
        <div className="py-2">
          <div className="text-[9px] text-dim uppercase tracking-widest">Coast FIRE</div>
          <div className={`text-sm font-bold tabular-nums ${calc.coastReached ? "text-up" : "text-txt"}`}>
            {calc.coastReached ? "Reached" : fmtUsd(calc.coastNumber)}
          </div>
        </div>
        <div className="py-2">
          <div className="text-[9px] text-dim uppercase tracking-widest">Progress</div>
          <div className="text-sm font-bold text-cyan tabular-nums">{progress.toFixed(1)}%</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-3 pt-2">
        <div className="h-1.5 rounded bg-edge overflow-hidden">
          <div className="h-full rounded bg-gradient-to-r from-amber to-up transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex justify-between text-[9px] text-faint pt-0.5">
          <span>{fmtUsd(inp.currentNW)}</span>
          <span>lean {fmtUsd(calc.leanFire)}</span>
          <span>fat {fmtUsd(calc.fatFire)}</span>
        </div>
      </div>

      {/* Projection chart */}
      <div className="h-52 px-1 pt-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={calc.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="fireFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e3a83c" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#e3a83c" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="contribFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#56b8a4" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#56b8a4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#2b2723" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="age" stroke="#645e53" fontSize={9} tickLine={false}
                   tickFormatter={(a: number) => `${a}`} />
            <YAxis stroke="#645e53" fontSize={9} tickLine={false} width={52}
                   tickFormatter={(v: number) => fmtUsd(v)} />
            <Tooltip
              contentStyle={{ background: "#221f1c", border: "1px solid #3b3631", borderRadius: 10, fontSize: 11 }}
              labelFormatter={(a) => `Age ${a}`}
              formatter={(v, name) => [fmtUsd(Number(v)), name === "nw" ? "Net worth (real $)" : "Contributions"]}
            />
            <ReferenceLine y={calc.fireNumber} stroke="var(--color-up)" strokeDasharray="6 4"
                           label={{ value: "FIRE", fill: "var(--color-up)", fontSize: 10, position: "insideTopRight" }} />
            {calc.fireAge !== null && (
              <ReferenceLine x={calc.fireAge} stroke="var(--color-up)" strokeDasharray="2 4"
                             label={{ value: `${calc.fireAge}`, fill: "var(--color-up)", fontSize: 10, position: "top" }} />
            )}
            <Area type="monotone" dataKey="contributions" stroke="#56b8a4" strokeWidth={1} fill="url(#contribFill)" />
            <Area type="monotone" dataKey="nw" stroke="#e3a83c" strokeWidth={2} fill="url(#fireFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="px-3 pb-1 text-[9px] text-faint">
        amber = compounding · blue = what you put in · gap = the money your money made
      </p>

      {/* Inputs */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 p-3 border-t border-edge">
        <Slider label="Current NW" value={inp.currentNW} min={0} max={1_000_000} step={1000}
                fmt={fmtUsd} onChange={set("currentNW")} />
        <Slider label="Age" value={inp.age} min={16} max={60} step={1}
                fmt={(v) => `${v}`} onChange={set("age")} />
        <Slider label="Invested / mo" value={inp.monthlyInvest} min={0} max={15000} step={100}
                fmt={fmtUsd} onChange={set("monthlyInvest")} />
        <Slider label="Spend / yr" value={inp.annualSpend} min={15000} max={250000} step={1000}
                fmt={fmtUsd} onChange={set("annualSpend")} />
        <Slider label="Return %" value={inp.returnPct} min={3} max={15} step={0.5}
                fmt={(v) => `${v}%`} onChange={set("returnPct")} />
        <Slider label="Inflation %" value={inp.inflationPct} min={0} max={8} step={0.5}
                fmt={(v) => `${v}%`} onChange={set("inflationPct")} />
        <div className="col-span-2">
          <Slider label="Withdrawal rate (SWR)" value={inp.swrPct} min={2.5} max={6} step={0.25}
                  fmt={(v) => `${v}%`} onChange={set("swrPct")} />
        </div>
      </div>
    </section>
  );
}
