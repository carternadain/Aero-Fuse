"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";

interface Contribution {
  id: number;
  account: string;
  bucket: "retirement" | "brokerage" | "cash" | "crypto";
  amount: number;
  employer_match: number;
  frequency: "weekly" | "biweekly" | "semimonthly" | "monthly";
  monthly: number;
  monthly_match: number;
}

interface PlanResponse {
  contributions: Contribution[];
  monthly_you: number;
  monthly_match: number;
  by_bucket: Record<string, number>;
}

const FREQ_LABEL: Record<string, string> = {
  weekly: "/ week", biweekly: "/ 2 weeks", semimonthly: "twice a month", monthly: "/ month",
};
const BUCKETS = ["retirement", "brokerage", "cash", "crypto"] as const;

/** Future value of today's balance plus a monthly deposit, compounded monthly. */
function project(start: number, monthly: number, annualPct: number, years: number): number {
  const r = annualPct / 100 / 12;
  const n = years * 12;
  if (r === 0) return start + monthly * n;
  const g = Math.pow(1 + r, n);
  return start * g + monthly * ((g - 1) / r);
}

export default function SavingsPlan() {
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [nw, setNw] = useState(0);
  const [ret, setRet] = useState(7);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ account: "", bucket: "retirement", amount: "", employer_match: "", frequency: "monthly" });

  const refresh = () => {
    api.get<PlanResponse>("/api/contributions").then(setPlan).catch(() => {});
    api.get<{ totals: { net_worth: number } }>("/api/accounts").then((r) => setNw(r.totals.net_worth)).catch(() => {});
  };
  useEffect(refresh, []);

  const add = async () => {
    const amount = parseFloat(f.amount);
    if (!f.account.trim() || isNaN(amount)) return;
    await api.post("/api/contributions", {
      ...f, amount, employer_match: parseFloat(f.employer_match) || 0,
    });
    setF({ ...f, account: "", amount: "", employer_match: "" });
    setAdding(false);
    refresh();
  };

  const edit = async (c: Contribution) => {
    const v = prompt(`How much do you put into ${c.account} ${FREQ_LABEL[c.frequency]}?`, String(c.amount));
    if (v == null) return;
    const amount = parseFloat(v.replace(/[$,]/g, ""));
    if (isNaN(amount)) return;
    await api.patch(`/api/contributions/${c.id}`, { amount });
    refresh();
  };

  const monthlyTotal = (plan?.monthly_you ?? 0) + (plan?.monthly_match ?? 0);
  const proj = useMemo(
    () => [1, 5, 10, 20].map((y) => ({ y, v: project(nw, monthlyTotal, ret, y) })),
    [nw, monthlyTotal, ret],
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><CalendarClock size={14} />Savings Plan</span>
        <button className="btn btn-primary !py-1 !px-2" onClick={() => setAdding(!adding)} title="Add a recurring contribution">
          <Plus size={12} strokeWidth={3} />
        </button>
      </div>

      <div className="px-4 pt-3">
        <div className="font-display text-[34px] leading-none text-txt">
          {fmtUsd(monthlyTotal)}<span className="text-base text-faint"> / month</span>
        </div>
        <div className="text-[11px] text-dim mt-1">
          {fmtUsd(plan?.monthly_you ?? 0)} from you
          {(plan?.monthly_match ?? 0) > 0 && <> + <span className="text-cyan">{fmtUsd(plan!.monthly_match)} free employer match</span></>}
          {" · "}{fmtUsd(monthlyTotal * 12)} a year
        </div>
      </div>

      {adding && (
        <div className="m-3 p-3 rounded-lg space-y-2 bg-panel2">
          <input className="field" placeholder="Account (e.g. Roth IRA)" value={f.account}
                 onChange={(e) => setF({ ...f, account: e.target.value })} />
          <div className="grid grid-cols-3 gap-2">
            <input className="field" placeholder="Amount $" inputMode="decimal" value={f.amount}
                   onChange={(e) => setF({ ...f, amount: e.target.value })} />
            <input className="field" placeholder="Match $" inputMode="decimal" value={f.employer_match}
                   onChange={(e) => setF({ ...f, employer_match: e.target.value })} />
            <select className="field" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
              <option value="weekly">WEEKLY</option>
              <option value="biweekly">EVERY 2 WEEKS</option>
              <option value="semimonthly">TWICE A MONTH</option>
              <option value="monthly">MONTHLY</option>
            </select>
          </div>
          <select className="field" value={f.bucket} onChange={(e) => setF({ ...f, bucket: e.target.value })}>
            {BUCKETS.map((b) => <option key={b} value={b}>{b.toUpperCase()}</option>)}
          </select>
          <button className="btn btn-primary w-full" onClick={add}>Add Contribution</button>
        </div>
      )}

      <div className="mt-3 border-t border-edge">
        {plan?.contributions.length === 0 && (
          <p className="p-4 text-xs text-dim">Add what you put away each paycheck or month: 401(k), Roth, brokerage, savings.</p>
        )}
        {plan?.contributions.map((c) => (
          <div key={c.id} className="flex items-center gap-2 px-3 py-2 border-t border-edge first:border-t-0 text-xs hover:bg-panel2 cursor-pointer"
               onClick={() => edit(c)} title="Click to change the amount">
            <div className="min-w-0">
              <div className="text-txt font-bold">{c.account}</div>
              <div className="text-[10px] text-faint">
                {fmtUsd(c.amount)} {FREQ_LABEL[c.frequency]}
                {c.employer_match > 0 && <span className="text-cyan"> + {fmtUsd(c.employer_match)} match</span>}
                <span className="uppercase"> · {c.bucket}</span>
              </div>
            </div>
            <div className="ml-auto text-right tabular-nums">
              <div className="font-bold text-txt">{fmtUsd(c.monthly + c.monthly_match)}</div>
              <div className="text-[9px] text-faint">per month</div>
            </div>
            <button className="icon-btn"
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Remove ${c.account}?`)) api.del(`/api/contributions/${c.id}`).then(refresh); }}>
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Projection */}
      <div className="border-t border-edge p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold tracking-widest text-dim">IF YOU KEEP THIS UP</span>
          <div className="flex rounded-md border border-edge2 overflow-hidden text-[10px]">
            {[4, 7, 10].map((p) => (
              <button key={p} onClick={() => setRet(p)}
                      className={`px-2 py-0.5 font-bold ${ret === p ? "bg-panel2 text-up" : "text-dim hover:text-txt"}`}>
                {p}%/yr
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {proj.map(({ y, v }) => (
            <div key={y} className="rounded-lg bg-panel2/60 px-2 py-2 text-center">
              <div className="text-[9px] text-faint">{y} {y === 1 ? "year" : "years"}</div>
              <div className="text-sm font-bold tabular-nums text-txt">{fmtUsd(v)}</div>
            </div>
          ))}
        </div>
        <p className="text-[9px] text-faint mt-2">
          Starts from today&apos;s net worth and adds your monthly total at an average {ret}% a year. Real markets go up and down.
        </p>
      </div>
    </section>
  );
}
