"use client";

import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Hourglass, Rocket, Sprout, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";
import { isHidden } from "@/lib/privacy";

// Shares assumptions with the FIRE calculator (same localStorage key) so the
// two panels never disagree. Everything is in today's dollars (real returns).
interface FireInputs { age: number; returnPct: number; inflationPct: number; annualSpend: number; swrPct: number }
const FIRE_DEFAULTS: FireInputs = { age: 25, returnPct: 8, inflationPct: 3, annualSpend: 50000, swrPct: 4 };
const FIRE_KEY = "fire-inputs-v1";

function readFire(): FireInputs {
  try {
    const s = localStorage.getItem(FIRE_KEY);
    return s ? { ...FIRE_DEFAULTS, ...JSON.parse(s) } : FIRE_DEFAULTS;
  } catch {
    return FIRE_DEFAULTS;
  }
}

/** Month-by-month balance path; stops at `months`. */
function path(start: number, monthly: number, annualReal: number, months: number): number[] {
  const r = Math.pow(1 + annualReal, 1 / 12) - 1;
  const out = [start];
  let b = start;
  for (let m = 1; m <= months; m++) {
    b = b * (1 + r) + monthly;
    out.push(b);
  }
  return out;
}

function monthsUntil(series: number[], target: number): number | null {
  const i = series.findIndex((v) => v >= target);
  return i === -1 ? null : i;
}

function fmtWhen(months: number | null, age: number): string {
  if (months == null) return "40+ yrs";
  if (months === 0) return "done";
  const yrs = months / 12;
  const when = yrs < 1 ? `${months} mo` : `${yrs.toFixed(yrs < 10 ? 1 : 0)} yrs`;
  return `${when} · age ${Math.round(age + yrs)}`;
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs font-bold text-txt">
        <span className="text-amber">{icon}</span>{title}
      </div>
      {children}
    </div>
  );
}

/** Like fmtUsd, but keeps cents for small amounts ($2.84, not $3). */
function money(n: number): string {
  return Math.abs(n) < 100 && !isHidden()
    ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : fmtUsd(n);
}

const MILESTONES = [25_000, 50_000, 75_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000];

export default function MoneyLab() {
  const [nw, setNw] = useState(0);
  const [monthly, setMonthly] = useState(0);
  const [fire, setFire] = useState<FireInputs>(FIRE_DEFAULTS);
  const [amount, setAmount] = useState("1");
  const [extra, setExtra] = useState(200);

  useEffect(() => {
    setFire(readFire());
    const onFire = () => setFire(readFire());
    window.addEventListener("fire-inputs", onFire);
    api.get<{ totals: { net_worth: number } }>("/api/accounts").then((r) => setNw(r.totals.net_worth)).catch(() => {});
    api.get<{ monthly_you: number; monthly_match: number }>("/api/contributions")
      .then((r) => setMonthly(r.monthly_you + r.monthly_match)).catch(() => {});
    return () => window.removeEventListener("fire-inputs", onFire);
  }, []);

  const real = (1 + fire.returnPct / 100) / (1 + fire.inflationPct / 100) - 1;
  const fireNumber = fire.annualSpend / (fire.swrPct / 100);
  const HORIZON = 40 * 12;

  const calc = useMemo(() => {
    const base = path(nw, monthly, real, HORIZON);
    const boosted = path(nw, monthly + extra, real, HORIZON);
    const at = (s: number[], yrs: number) => s[Math.min(s.length - 1, yrs * 12)];
    const fireBase = monthsUntil(base, fireNumber);
    const fireBoost = monthsUntil(boosted, fireNumber);

    // Crossover: first month the portfolio's growth beats what you add.
    const r = Math.pow(1 + real, 1 / 12) - 1;
    const crossover = base.findIndex((b) => b * r >= monthly);

    return { base, boosted, at, fireBase, fireBoost, r, crossover };
  }, [nw, monthly, extra, real, fireNumber, HORIZON]);

  const dollars = parseFloat(amount.replace(/[$,]/g, "")) || 0;
  const ages = [40, 50, 65].filter((a) => a > fire.age);
  const grow = (yrs: number) => dollars * Math.pow(1 + real, yrs);
  const growthNow = nw * calc.r;
  const nextMilestones = MILESTONES.filter((m) => m > nw).slice(0, 4);
  const prevMilestone = [0, ...MILESTONES].filter((m) => m <= nw).pop() ?? 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* 1 — Dollar time machine */}
      <Card icon={<Hourglass size={14} />} title="Dollar time machine">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs text-dim">If you invest</span>
          <span className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-faint text-sm">$</span>
            <input className="field !w-28 !pl-5 !py-1 !text-sm font-bold tabular-nums" inputMode="decimal"
                   value={amount} onChange={(e) => setAmount(e.target.value)} />
          </span>
          <span className="text-xs text-dim">
            today, at age <span className="text-txt font-bold">{fire.age}</span>…
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {ages.map((a) => (
            <div key={a} className="rounded-lg bg-panel2/60 p-2.5 text-center">
              <div className="text-[10px] text-faint">at {a}</div>
              <div className="font-display text-[26px] leading-tight text-txt">{money(grow(a - fire.age))}</div>
              <div className="text-[10px] text-cyan tabular-nums">{(grow(a - fire.age) / (dollars || 1)).toFixed(1)}×</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[["Coffee", 6], ["Dinner out", 60], ["Sneakers", 180], ["New phone", 1100]].map(([label, v]) => (
            <button key={label} onClick={() => setAmount(String(v))}
                    className="px-2 py-0.5 rounded-md border border-edge2 text-[10px] text-dim hover:text-txt hover:border-amber/60">
              {label} ${v}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-dim leading-snug">
          A {money(dollars)} purchase today really costs future-you about{" "}
          <span className="text-txt font-bold">{money(grow(65 - fire.age))}</span> at 65.
        </p>
      </Card>

      {/* 2 — The +$X effect */}
      <Card icon={<Rocket size={14} />} title={`What an extra ${fmtUsd(extra)}/month does`}>
        <input type="range" min={25} max={1500} step={25} value={extra}
               onChange={(e) => setExtra(parseFloat(e.target.value))} className="w-full h-1 accent-up cursor-pointer" />
        <div className="space-y-2">
          {[10, 20, 30].map((y) => {
            const b = calc.at(calc.base, y), x = calc.at(calc.boosted, y);
            const max = calc.at(calc.boosted, 30) || 1;
            return (
              <div key={y}>
                <div className="flex justify-between text-[10px] mb-0.5">
                  <span className="text-faint">in {y} yrs (age {fire.age + y})</span>
                  <span className="tabular-nums text-up font-bold">+{fmtUsd(x - b)}</span>
                </div>
                <div className="relative h-2.5 rounded-full bg-edge overflow-hidden">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-up/35" style={{ width: `${(x / max) * 100}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-full bg-up" style={{ width: `${(b / max) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-dim leading-snug">
          You&apos;d only put in <span className="text-txt">{fmtUsd(extra * 12 * 30)}</span> more over 30 years. Compounding adds the other{" "}
          <span className="text-txt">{fmtUsd(calc.at(calc.boosted, 30) - calc.at(calc.base, 30) - extra * 12 * 30)}</span>.
          {calc.fireBase != null && calc.fireBoost != null && calc.fireBase > calc.fireBoost && (
            <> FIRE arrives <span className="text-up font-bold">{((calc.fireBase - calc.fireBoost) / 12).toFixed(1)} years sooner</span>.</>
          )}
        </p>
      </Card>

      {/* 3 — Milestones */}
      <Card icon={<Trophy size={14} />} title="Next milestones at your current pace">
        {nextMilestones.length > 0 && (
          <div>
            <div className="flex justify-between text-[10px] text-faint mb-1">
              <span>{fmtUsd(prevMilestone)}</span><span>{fmtUsd(nextMilestones[0])}</span>
            </div>
            <div className="h-2 rounded-full bg-edge overflow-hidden">
              <div className="h-full rounded-full bg-amber"
                   style={{ width: `${Math.min(100, ((nw - prevMilestone) / (nextMilestones[0] - prevMilestone)) * 100)}%` }} />
            </div>
            <div className="text-[10px] text-dim mt-1">
              {fmtUsd(nextMilestones[0] - nw)} to go until {fmtUsd(nextMilestones[0])}
            </div>
          </div>
        )}
        <ul className="divide-y divide-edge">
          {nextMilestones.map((m) => (
            <li key={m} className="flex items-center justify-between py-1.5 text-xs">
              <span className="font-bold text-txt tabular-nums">{fmtUsd(m)}</span>
              <span className="text-dim tabular-nums">{fmtWhen(monthsUntil(calc.base, m), fire.age)}</span>
            </li>
          ))}
          <li className="flex items-center justify-between py-1.5 text-xs">
            <span className="font-bold text-amber">FIRE · {fmtUsd(fireNumber)}</span>
            <span className="text-dim tabular-nums">{fmtWhen(calc.fireBase, fire.age)}</span>
          </li>
        </ul>
      </Card>

      {/* 4 — Crossover */}
      <Card icon={<Sprout size={14} />} title="When your money out-earns you">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-panel2/60 p-2.5">
            <div className="text-[10px] text-faint">Your money earns (avg)</div>
            <div className="font-display text-[26px] leading-tight text-txt">{fmtUsd(growthNow)}<span className="text-xs text-faint">/mo</span></div>
          </div>
          <div className="rounded-lg bg-panel2/60 p-2.5">
            <div className="text-[10px] text-faint">You put in</div>
            <div className="font-display text-[26px] leading-tight text-txt">{fmtUsd(monthly)}<span className="text-xs text-faint">/mo</span></div>
          </div>
        </div>
        <div className="h-2 rounded-full bg-edge overflow-hidden">
          <div className="h-full rounded-full bg-cyan" style={{ width: `${Math.min(100, monthly ? (growthNow / monthly) * 100 : 0)}%` }} />
        </div>
        <p className="text-[11px] text-dim leading-snug">
          {monthly === 0
            ? "Add your contributions in the Savings Plan to see this."
            : calc.crossover === 0
            ? <>Your investments already earn more each month than you add. Compounding is doing the heavy lifting now.</>
            : calc.crossover > 0
            ? <>Your investments earn {Math.round((growthNow / monthly) * 100)}% of what you add each month. Around{" "}
                <span className="text-txt font-bold">age {Math.round(fire.age + calc.crossover / 12)}</span>
                {" "}({(calc.crossover / 12).toFixed(1)} yrs) they start earning more than you put in, and growth snowballs from there.</>
            : "Not within 40 years at this pace."}
        </p>
      </Card>

      <p className="lg:col-span-2 text-[10px] text-faint flex items-center gap-1.5">
        <FlaskConical size={11} />
        Today&apos;s dollars: {(real * 100).toFixed(1)}%/yr after inflation ({fire.returnPct}% return − {fire.inflationPct}% inflation), age {fire.age}.
        Change these in the FIRE calculator below. These are averages, and real markets swing year to year.
      </p>
    </div>
  );
}
