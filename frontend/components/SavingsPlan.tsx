"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Pencil, Plus, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";

interface Contribution {
  id: number;
  account: string;
  bucket: "retirement" | "brokerage" | "cash" | "crypto";
  amount: number;
  employer_match: number;
  frequency: "weekly" | "biweekly" | "semimonthly" | "monthly";
  plan_type: "401k" | "ira" | "other";
  match_max: number | null;
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

type FormState = {
  account: string; bucket: string; amount: string; employer_match: string; frequency: string;
  plan_type: string; match_max: string;
};

const EMPTY: FormState = {
  account: "", bucket: "retirement", amount: "", employer_match: "", frequency: "monthly", plan_type: "other", match_max: "",
};

const num = (v: string) => parseFloat(v.replace(/[$,]/g, ""));

function toPayload(f: FormState) {
  const max = num(f.match_max);
  return {
    account: f.account.trim(), bucket: f.bucket, frequency: f.frequency, plan_type: f.plan_type,
    amount: num(f.amount), employer_match: num(f.employer_match) || 0,
    match_max: f.plan_type === "401k" && !isNaN(max) ? max : 0,
  };
}

function ContributionForm({
  value, onChange, onSave, onCancel, onDelete, saveLabel,
}: {
  value: FormState;
  onChange: (f: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  saveLabel: string;
}) {
  const f = value;
  return (
    <form className="p-3 space-y-2 bg-panel2" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
      <label className="block">
        <span className="text-[10px] text-faint">Account</span>
        <input className="field" placeholder="e.g. Roth IRA" value={f.account} autoFocus
               onChange={(e) => onChange({ ...f, account: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] text-faint">You put in ($)</span>
          <input className="field" inputMode="decimal" placeholder="0" value={f.amount}
                 onChange={(e) => onChange({ ...f, amount: e.target.value })} />
        </label>
        <label className="block">
          <span className="text-[10px] text-faint">Employer match ($)</span>
          <input className="field" inputMode="decimal" placeholder="0" value={f.employer_match}
                 onChange={(e) => onChange({ ...f, employer_match: e.target.value })} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] text-faint">How often</span>
          <select className="field" value={f.frequency} onChange={(e) => onChange({ ...f, frequency: e.target.value })}>
            <option value="weekly">Every week</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="semimonthly">Twice a month</option>
            <option value="monthly">Every month</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] text-faint">Type</span>
          <select className="field" value={f.bucket} onChange={(e) => onChange({ ...f, bucket: e.target.value })}>
            <option value="retirement">Retirement</option>
            <option value="brokerage">Brokerage</option>
            <option value="cash">Cash savings</option>
            <option value="crypto">Crypto</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] text-faint">Account kind (for IRS limits)</span>
          <select className="field" value={f.plan_type} onChange={(e) => onChange({ ...f, plan_type: e.target.value })}>
            <option value="401k">401(k) / 403(b)</option>
            <option value="ira">IRA (Roth or traditional)</option>
            <option value="other">Other / taxable</option>
          </select>
        </label>
        {f.plan_type === "401k" && (
          <label className="block">
            <span className="text-[10px] text-faint">Max match available ($ per period)</span>
            <input className="field" inputMode="decimal" placeholder="if you know it" value={f.match_max}
                   onChange={(e) => onChange({ ...f, match_max: e.target.value })} />
          </label>
        )}
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" className="btn btn-primary flex-1">{saveLabel}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        {onDelete && (
          <button type="button" className="btn !text-down hover:!border-down" onClick={onDelete} title="Remove">
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </form>
  );
}

export default function SavingsPlan() {
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [nw, setNw] = useState(0);
  const [ret, setRet] = useState(7);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<FormState>(EMPTY);
  const [editing, setEditing] = useState<number | null>(null);
  const [ef, setEf] = useState<FormState>(EMPTY);

  const refresh = () => {
    api.get<PlanResponse>("/api/contributions").then(setPlan).catch(() => {});
    api.get<{ totals: { net_worth: number } }>("/api/accounts").then((r) => setNw(r.totals.net_worth)).catch(() => {});
  };
  useEffect(refresh, []);

  const add = async () => {
    const body = toPayload(f);
    if (!body.account || isNaN(body.amount)) return;
    await api.post("/api/contributions", { ...body, match_max: body.match_max || null });
    setF({ ...f, account: "", amount: "", employer_match: "" });
    setAdding(false);
    refresh();
  };

  const startEdit = (c: Contribution) => {
    setAdding(false);
    setEditing(c.id);
    setEf({
      account: c.account, bucket: c.bucket, frequency: c.frequency,
      amount: String(c.amount), employer_match: c.employer_match ? String(c.employer_match) : "",
      plan_type: c.plan_type, match_max: c.match_max ? String(c.match_max) : "",
    });
  };

  const saveEdit = async () => {
    if (editing == null) return;
    const body = toPayload(ef);
    if (!body.account || isNaN(body.amount)) return;
    await api.patch(`/api/contributions/${editing}`, body); // match_max 0 clears it
    setEditing(null);
    refresh();
  };

  const remove = async (id: number) => {
    await api.del(`/api/contributions/${id}`);
    setEditing(null);
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
        <button className="btn btn-primary !py-1 !px-2" onClick={() => { setEditing(null); setAdding(!adding); }} title="Add a recurring contribution">
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
        <div className="mt-3 border-t border-edge">
          <ContributionForm value={f} onChange={setF} onSave={add} saveLabel="Add contribution"
                            onCancel={() => setAdding(false)} />
        </div>
      )}

      <div className="mt-3 border-t border-edge">
        {plan?.contributions.length === 0 && (
          <p className="p-4 text-xs text-dim">Add what you put away each paycheck or month: 401(k), Roth, brokerage, savings.</p>
        )}
        {plan?.contributions.map((c) =>
          editing === c.id ? (
            <div key={c.id} className="border-t border-edge first:border-t-0">
              <ContributionForm value={ef} onChange={setEf} onSave={saveEdit} saveLabel="Save changes"
                                onCancel={() => setEditing(null)} onDelete={() => remove(c.id)} />
            </div>
          ) : (
            <button key={c.id} onClick={() => startEdit(c)}
                    className="w-full text-left flex items-center gap-2 px-3 py-2.5 border-t border-edge first:border-t-0 text-xs hover:bg-panel2 group">
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
              <Pencil size={12} className="text-faint group-hover:text-txt shrink-0" />
            </button>
          ),
        )}
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
