"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, Target } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";
import { budgetChanged, onBudgetChanged, toast } from "@/lib/bus";
import { catLabel, errorText } from "@/lib/categories";

interface PlanCat {
  category: string;
  target: number | null;
  spent: number;
  left: number | null;
  pct: number | null;
  pace: number | null;
  projected: number | null;
  avg_3m: number | null;
  last_month: number;
  suggested: number | null;
  status: "none" | "ok" | "watch" | "over";
}

interface Plan {
  month: string;
  is_current: boolean;
  is_future: boolean;
  days_in_month: number;
  days_elapsed: number;
  days_left: number;
  history_months: number;
  totals: {
    target: number;
    spent: number;
    spent_targeted: number;
    left: number;
    projected: number | null;
    daily_allowance: number | null;
  };
  categories: PlanCat[];
}

const curMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function monthShift(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const barColor = (s: PlanCat["status"]) =>
  s === "over" ? "var(--color-down)" : s === "watch" ? "var(--color-amber)" : "var(--color-up)";

export default function MonthlyBudget() {
  const [month, setMonth] = useState(curMonth);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    api.get<Plan>(`/api/budget/plan?month=${month}`).then(setPlan).catch(() => {});

  useEffect(() => { setOpen(null); refresh(); }, [month]);
  useEffect(() => onBudgetChanged(() => { refresh(); }), [month]);

  const cats = plan?.categories ?? [];
  const hasTargets = cats.some((c) => c.target !== null);
  const isQuiet = (c: PlanCat) => c.target === null && c.spent <= 0 && c.suggested === null;
  const quiet = cats.filter(isQuiet);
  const shown = showAll ? cats : cats.filter((c) => !isQuiet(c) || c.category === open);
  const hiddenCount = quiet.filter((c) => c.category !== open).length;

  const toggle = (c: PlanCat) => {
    if (open === c.category) { setOpen(null); return; }
    setOpen(c.category);
    const start = c.target ?? c.suggested;
    setVal(start !== null ? String(Math.round(start)) : "");
  };

  const done = (msg: string) => { toast(msg); setOpen(null); refresh(); budgetChanged(); };

  const save = async (c: PlanCat, raw: string) => {
    const n = parseFloat(raw.replace(/[$,\s]/g, ""));
    if (isNaN(n) || n < 0) { toast("Enter an amount, or 0 to spend nothing."); return; }
    setBusy(true);
    try {
      await api.put("/api/budgets", { category: c.category, monthly_limit: n });
      done(`${catLabel(c.category)} target set to ${fmtUsd(n)}`);
    } catch (e) {
      toast(errorText(e, "Couldn't save that target."));
    } finally { setBusy(false); }
  };

  const remove = async (c: PlanCat) => {
    setBusy(true);
    try {
      await api.del(`/api/budgets/${encodeURIComponent(c.category)}`);
      done(`${catLabel(c.category)} target removed`);
    } catch (e) {
      toast(errorText(e, "Couldn't remove that target."));
    } finally { setBusy(false); }
  };

  const startFromHistory = async () => {
    const targets = cats.filter((c) => c.suggested !== null)
      .map((c) => ({ category: c.category, monthly_limit: c.suggested as number }));
    if (!targets.length) { toast("Nothing to suggest yet."); return; }
    setBusy(true);
    try {
      const r = await api.put<{ saved: number; removed: number }>("/api/budgets/bulk", { targets });
      toast(`Set ${r.saved} targets from your history`);
      refresh();
      budgetChanged();
    } catch (e) {
      toast(errorText(e, "Couldn't set those targets."));
    } finally { setBusy(false); }
  };

  const t = plan?.totals;
  const left = t?.left ?? 0;

  return (
    <section className="panel flex flex-col">
      <div className="panel-head">
        <span className="panel-title"><Target size={14} />Monthly budget</span>
        <div className="flex items-center gap-1.5">
          <button className="btn !min-h-10 !min-w-10 !px-2" aria-label="Previous month"
                  onClick={() => setMonth(monthShift(month, -1))}>
            <ChevronLeft size={14} />
          </button>
          <span className="text-[11px] text-txt tabular-nums">{month}</span>
          <button className="btn !min-h-10 !min-w-10 !px-2" aria-label="Next month"
                  onClick={() => setMonth(monthShift(month, 1))}>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 divide-x divide-edge border-b border-edge text-center">
        <div className="py-2">
          <div className="text-[9px] text-dim uppercase tracking-widest">Budgeted</div>
          <div className="text-sm font-bold text-txt tabular-nums">{fmtUsd(t?.target ?? 0)}</div>
        </div>
        <div className="py-2">
          <div className="text-[9px] text-dim uppercase tracking-widest">Spent</div>
          <div className="text-sm font-bold text-txt tabular-nums">{fmtUsd(t?.spent_targeted ?? 0)}</div>
        </div>
        <div className="py-2">
          <div className="text-[9px] text-dim uppercase tracking-widest">{left < 0 ? "Over" : "Left"}</div>
          <div className={`text-sm font-bold tabular-nums ${left < 0 ? "text-down" : "text-up"}`}>
            {fmtUsd(Math.abs(left))}
          </div>
        </div>
      </div>

      {plan && hasTargets && plan.is_current && (
        <div className="px-3 py-2 border-b border-edge text-[11px] text-dim space-y-0.5">
          {left < 0 ? (
            <div className="text-down font-bold">Over by {fmtUsd(-left)}</div>
          ) : t?.daily_allowance != null && plan.days_left > 0 ? (
            <div className="text-txt">
              <span className="font-bold text-up tabular-nums">{fmtUsd(t.daily_allowance)}</span> a day for the next {plan.days_left} {plan.days_left === 1 ? "day" : "days"}
            </div>
          ) : null}
          {t && t.spent - t.spent_targeted > 0 && (
            <div>Plus <span className="tabular-nums text-txt">{fmtUsd(t.spent - t.spent_targeted)}</span> in categories without a target</div>
          )}
          {t?.projected != null && (
            <div>All spending on track for <span className="tabular-nums text-txt">{fmtUsd(t.projected)}</span> this month</div>
          )}
        </div>
      )}

      {plan && !hasTargets && (
        <div className="p-3 border-b border-edge bg-panel2 space-y-2">
          {plan.history_months > 0 ? (
            <>
              <div className="text-[12px] text-txt font-bold">
                Start from your last {plan.history_months} {plan.history_months === 1 ? "month" : "months"}
              </div>
              <p className="text-[11px] text-dim">
                Sets a target for every category from what you actually spent. Tweak any of them after.
              </p>
              <button className="btn btn-primary !min-h-10 w-full" disabled={busy} onClick={startFromHistory}>
                Set targets from history
              </button>
            </>
          ) : (
            <p className="text-[11px] text-dim">
              Import a statement in the panel above, or tap a category below to set a target.
            </p>
          )}
        </div>
      )}

      {/* Categories */}
      <div>
        {shown.map((c) => {
          const isOpen = open === c.category;
          const hasT = c.target !== null;
          const fill = !hasT ? 0 : c.pct ?? (c.spent > 0 ? 100 : 0);
          const pace = plan?.is_current && c.target && c.pace != null
            ? Math.min(Math.max((c.pace / (c.target as number)) * 100, 0), 100) : null;
          return (
            <div key={c.category} className="border-t border-edge first:border-t-0">
              <button className="w-full min-h-10 px-3 py-2 text-left hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-up"
                      aria-expanded={isOpen} onClick={() => toggle(c)}>
                <div className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="text-txt truncate capitalize">{catLabel(c.category)}</span>
                  <span className={`shrink-0 tabular-nums ${c.status === "over" ? "text-down font-bold" : "text-dim"}`}>
                    {fmtUsd(c.spent)}{hasT ? ` / ${fmtUsd(c.target as number)}` : " · set target"}
                  </span>
                </div>
                {hasT && (
                  <>
                    <div className="relative h-1.5 rounded bg-edge mt-1">
                      <div className="h-full rounded transition-all"
                           style={{ width: `${Math.min(fill, 100)}%`, background: barColor(c.status) }} />
                      {pace !== null && (
                        <div className="absolute -top-0.5 -bottom-0.5 w-px bg-txt opacity-70"
                             style={{ left: `${pace}%` }} aria-hidden />
                      )}
                    </div>
                    <div className="flex justify-between gap-2 mt-0.5 text-[10px] text-faint">
                      <span className={c.status === "over" ? "text-down" : ""}>
                        {c.left !== null && c.left < 0
                          ? `${fmtUsd(-c.left)} over`
                          : `${fmtUsd(c.left ?? 0)} left`}
                      </span>
                      {!!c.avg_3m && <span className="tabular-nums">avg {fmtUsd(c.avg_3m)}</span>}
                    </div>
                  </>
                )}
                {!hasT && !!c.avg_3m && (
                  <div className="mt-0.5 text-[10px] text-faint tabular-nums">avg {fmtUsd(c.avg_3m)}</div>
                )}
              </button>
              {isOpen && (
                <div className="px-3 pb-3 space-y-2 bg-panel2">
                  <input className="field !h-10" inputMode="decimal" placeholder="$ per month"
                         aria-label={`Monthly target for ${catLabel(c.category)}`} autoFocus
                         value={val} onChange={(e) => setVal(e.target.value)}
                         onKeyDown={(e) => { if (e.key === "Enter") save(c, val); }} />
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-primary !min-h-10" disabled={busy} onClick={() => save(c, val)}>Save</button>
                    {c.suggested !== null && (
                      <button className="btn !min-h-10" disabled={busy} onClick={() => save(c, String(c.suggested))}>
                        Use avg {fmtUsd(c.suggested)}
                      </button>
                    )}
                    {c.target !== null && (
                      <button className="btn !min-h-10 text-down" disabled={busy} onClick={() => remove(c)}>Remove</button>
                    )}
                    <button className="btn !min-h-10" onClick={() => setOpen(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {hiddenCount > 0 && !showAll && (
          <button className="w-full min-h-10 border-t border-edge text-[11px] text-dim hover:text-txt flex items-center justify-center gap-1"
                  onClick={() => setShowAll(true)}>
            <ChevronDown size={13} />Show {hiddenCount} more
          </button>
        )}
        {showAll && quiet.length > 0 && (
          <button className="w-full min-h-10 border-t border-edge text-[11px] text-dim hover:text-txt"
                  onClick={() => setShowAll(false)}>
            Show less
          </button>
        )}
        {plan && cats.length === 0 && (
          <p className="p-3 text-[11px] text-dim">No categories yet.</p>
        )}
      </div>
    </section>
  );
}
