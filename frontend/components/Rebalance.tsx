"use client";

// Rebalance helper: set a target mix across your four groups and see the dollars that get you back to it.

import { useEffect, useMemo, useState } from "react";
import { Loader2, Scale } from "lucide-react";
import { api } from "@/lib/api";
import { haptic, toast } from "@/lib/bus";
import { sectionForAccount, sectionForLabel, useLive } from "@/lib/live";
import { GROUPS, currentMix, plan, sum, type Group, type Mix } from "@/lib/rebalance";
import { SECTION_COLOR, SECTION_LABEL } from "./AllocationDonut";
import { fmtUsd } from "./NetWorth";
import Skeleton from "./Skeleton";

const ON_TARGET = 1; // within one point of target counts as on target
const whole = (n: number) => fmtUsd(Math.round(n)).replace(/\.00$/, "");
const toNum = (s: string) => { const n = parseFloat(s.replace(/[$,%\s]/g, "")); return isFinite(n) ? n : NaN; };

export default function Rebalance() {
  const { holdings, accounts, loaded } = useLive();
  const [targets, setTargets] = useState<Mix | null | undefined>(undefined); // undefined = still loading
  const [edit, setEdit] = useState<Record<Group, string> | null>(null);
  const [money, setMoney] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ rebalance_targets: Mix | null }>("/api/settings").then((r) => setTargets(r.rebalance_targets ?? null)).catch(() => setTargets(null));
  }, []);

  const values = useMemo(() => {
    const v: Mix = { investing: 0, retirement: 0, crypto: 0, cash: 0 };
    for (const h of holdings) if (h.value && h.value > 0) v[sectionForLabel(h.label || "") as Group] += h.value;
    for (const a of accounts) { const s = sectionForAccount(a); if (s !== "debt") v[s] += a.balance; }
    return v;
  }, [holdings, accounts]);
  const total = sum(values);

  const startEdit = () => {
    const from = targets ?? currentMix(values);
    setEdit({ investing: String(from.investing), retirement: String(from.retirement), crypto: String(from.crypto), cash: String(from.cash) });
    setErr(null); haptic();
  };
  const editSum = edit ? GROUPS.reduce((t, g) => t + (toNum(edit[g]) || 0), 0) : 0;
  const editBad = edit ? GROUPS.some((g) => { const n = toNum(edit[g]); return isNaN(n) || n < 0 || n > 100; }) : false;
  const editOk = !!edit && !editBad && Math.abs(editSum - 100) < 0.01;

  const save = async () => {
    if (!edit || !editOk) return;
    const next = Object.fromEntries(GROUPS.map((g) => [g, toNum(edit[g])])) as Mix;
    setSaving(true); setErr(null);
    try {
      await api.put("/api/settings", { rebalance_targets: next });
      setTargets(next); setEdit(null); toast("Target mix saved.");
    } catch { setErr("Couldn't save your targets. Try again."); }
    setSaving(false);
  };

  const add = Math.max(0, toNum(money) || 0);
  const rows = targets ? plan(values, targets, add) : [];
  const scale = Math.max(1, ...rows.flatMap((r) => [r.pct, r.target]));
  const settled = rows.length > 0 && rows.every((r) => Math.abs(r.pct - r.target) < ON_TARGET);

  return (
    <section className="panel" aria-labelledby="rebalance-h">
      <div className="panel-head">
        <span id="rebalance-h" className="panel-title"><Scale size={14} aria-hidden />Rebalance</span>
        {targets && !edit && <button type="button" className="btn !min-h-10" onClick={startEdit}>Change targets</button>}
      </div>

      {!loaded || targets === undefined ? (
        <div className="p-4 space-y-3" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : total <= 0 ? (
        <p className="p-6 text-center text-[13.5px] text-dim">Add an account or a holding first, then set the mix you want to keep.</p>
      ) : edit ? (
        <form className="p-4 space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <p className="text-[13px] text-dim leading-relaxed">Set the share of your money you want in each group. They need to add up to 100%.</p>
          <div className="grid grid-cols-2 gap-3">
            {GROUPS.map((g) => (
              <label key={g} className="block min-w-0">
                <span className="flex items-center gap-1.5 mb-1 text-[12px] text-dim">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SECTION_COLOR[g] }} aria-hidden />{SECTION_LABEL[g]} %
                </span>
                <input className="field tabular-nums" inputMode="decimal" value={edit[g]}
                       aria-invalid={isNaN(toNum(edit[g])) || toNum(edit[g]) < 0 || toNum(edit[g]) > 100}
                       onChange={(e) => setEdit({ ...edit, [g]: e.target.value })} />
              </label>
            ))}
          </div>
          <p className={`text-[13px] tabular-nums ${editOk ? "text-dim" : "text-warn"}`} aria-live="polite">
            {editBad ? "Each one needs to be a number from 0 to 100."
              : editOk ? "Adds up to 100%."
              : editSum < 100 ? `Adds up to ${+editSum.toFixed(2)}%. ${+(100 - editSum).toFixed(2)}% left to assign.`
              : `Adds up to ${+editSum.toFixed(2)}%. Take ${+(editSum - 100).toFixed(2)}% off.`}
          </p>
          {err && <p role="alert" className="text-[13px] text-down">{err}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn !min-h-10" onClick={() => setEdit(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary !min-h-10 disabled:opacity-40" disabled={!editOk || saving}>
              {saving && <Loader2 size={14} className="animate-spin" aria-hidden />}Save targets
            </button>
          </div>
        </form>
      ) : !targets ? (
        <div className="p-6 text-center space-y-3">
          <p className="text-[13.5px] text-dim leading-relaxed max-w-sm mx-auto">Pick the mix you want to keep, like 60% investing and 10% crypto. This shows how many dollars to move whenever you drift from it.</p>
          <button type="button" className="btn btn-primary !min-h-11 !px-5" onClick={startEdit}>Set a target mix</button>
        </div>
      ) : (
        <div className="p-4 space-y-4">
          <label className="flex items-center gap-3">
            <span className="text-[13px] text-dim shrink-0">Adding new money?</span>
            <input className="field tabular-nums max-w-40" inputMode="decimal" placeholder="$0" value={money} onChange={(e) => setMoney(e.target.value)} />
          </label>
          <ul className="space-y-3.5">
            {rows.map((r) => {
              const off = Math.abs(r.pct - r.target) >= ON_TARGET, amt = Math.round(Math.abs(r.move));
              const action = add ? (amt >= 1 ? `Add ${whole(amt)}` : "Nothing to add")
                : off && amt >= 1 ? `${r.group === "cash" ? (r.move > 0 ? "Add" : "Move out") : r.move > 0 ? "Buy" : "Sell"} ${whole(amt)}` : "On target";
              return (
                <li key={r.group}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 self-center" style={{ background: SECTION_COLOR[r.group] }} aria-hidden />
                    <span className="text-[14px] font-bold text-txt">{SECTION_LABEL[r.group]}</span>
                    <span className="max-sm:order-last max-sm:basis-full max-sm:pl-[18px] text-[12.5px] tabular-nums text-dim">{r.pct.toFixed(1)}% now, target {+r.target.toFixed(1)}%</span>
                    <span className={`ml-auto text-[13.5px] tabular-nums font-semibold ${action.includes("$") ? "text-txt" : "text-dim"}`} data-private>{action}</span>
                  </div>
                  <div className="relative mt-1.5 h-2.5 rounded-full bg-panel2" aria-hidden>
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(r.pct / scale) * 100}%`, background: SECTION_COLOR[r.group] }} />
                    <div className="absolute -inset-y-1 w-0.5 rounded bg-txt" style={{ left: `calc(${(r.target / scale) * 100}% - 1px)` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-[12.5px] text-dim leading-relaxed">
            The bar is where you are and the line is your target.{" "}
            {add ? "New money goes to whatever is furthest under target, so nothing is sold."
              : settled ? "You are within a point of every target."
              : "Selling can be taxed. Type an amount above to get there with new money instead."}
          </p>
        </div>
      )}
    </section>
  );
}
