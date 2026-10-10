"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";
import { budgetChanged, onBudgetChanged, toast } from "@/lib/bus";
import { catLabel, errorText } from "@/lib/categories";
import { alertColor, ordinal, useSpendingAlerts } from "./SpendingAlerts";
import { enablePush, pushState, pushSupport } from "@/lib/push";

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

const cap = (n: string) => n.charAt(0).toUpperCase() + n.slice(1);

const curMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

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

  const [pushOff, setPushOff] = useState(false);
  useEffect(() => {
    if (pushSupport() !== "ok") return;
    pushState().then((st) => setPushOff(st === "off")).catch(() => {});
  }, []);

  const alertData = useSpendingAlerts(month === curMonth());
  const alertFor = (cat: string) =>
    alertData?.month === month ? alertData.alerts.find((a) => a.category === cat) : undefined;
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

  const alerts = plan?.is_current && alertData?.month === month ? alertData.alerts : [];
  const anyHigh = alerts.some((a) => a.level === "high");
  const hue = anyHigh ? "var(--color-down)" : "var(--color-amber)";
  const goTo = (cat: string) => {
    const c = cats.find((x) => x.category === cat);
    if (!c) return;
    if (open !== cat) toggle(c);
    setTimeout(() => {
      document.getElementById(`bud-cat-${cat}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  };
  const enableNotify = async () => {
    const r = await enablePush();
    if (r === "on") { setPushOff(false); toast("Done. I'll let you know when spending runs high."); }
    else if (r === "denied") { setPushOff(false); toast("Notifications are blocked for this site. You can allow them in your browser settings."); }
    else toast("Couldn't turn notifications on. Try again in a bit.");
  };
  const names = alerts.map((a, i) => { const n = catLabel(a.category).toLowerCase(); return i ? n : cap(n); });
  const nameList = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];

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
        <div className="flex items-center gap-0.5">
          <button className="btn !min-h-10 !min-w-10 !px-2" aria-label="Previous month"
                  onClick={() => setMonth(monthShift(month, -1))}>
            <ChevronLeft size={14} />
          </button>
          <span className="min-w-[4.5rem] text-center text-[13px] font-semibold text-txt tabular-nums">{monthLabel(month)}</span>
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

      {alerts.length > 0 && alertData && (
        <div className="m-3 rounded-xl p-3" role="region" aria-label="Spending above normal"
             style={{ background: `color-mix(in srgb, ${hue} 10%, transparent)` }}>
          <div className="flex items-start gap-3">
            <span className="shrink-0 size-8 rounded-full grid place-items-center"
                  style={{ background: `color-mix(in srgb, ${hue} 16%, transparent)`, color: hue }} aria-hidden>
              <TrendingUp size={16} />
            </span>
            {alerts.length === 1 ? (
              <button className="flex-1 min-w-0 min-h-10 text-left rounded focus-visible:outline-2 focus-visible:outline-up"
                      onClick={() => goTo(alerts[0].category)}>
                <div className="text-[13px] font-semibold text-txt">{nameList} is up this month</div>
                <div className="text-[12px] text-dim tabular-nums">
                  {alerts[0].level === "high"
                    ? `${fmtUsd(alerts[0].spent)} so far, more than a usual month.`
                    : `${fmtUsd(alerts[0].spent)} so far. Usually about ${fmtUsd(alerts[0].typical_to_date)} by the ${ordinal(alertData.day)}.`}
                </div>
              </button>
            ) : (
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-txt">Spending is up in {alerts.length} categories</div>
                <div className="text-[12px] text-dim">Ahead of your usual pace this month.</div>
              </div>
            )}
          </div>
          {alerts.length > 1 && (
            <ul className="mt-2 ml-11 divide-y" style={{ borderColor: "color-mix(in srgb, var(--color-txt) 8%, transparent)" }}>
              {alerts.map((a) => (
                <li key={a.category} style={{ borderColor: "color-mix(in srgb, var(--color-txt) 8%, transparent)" }}>
                  <button className="w-full min-h-10 flex items-center justify-between gap-2 text-left text-[12px] rounded focus-visible:outline-2 focus-visible:outline-up"
                          onClick={() => goTo(a.category)}>
                    <span className="text-txt truncate capitalize">{catLabel(a.category)}</span>
                    <span className="shrink-0 flex items-center gap-1 tabular-nums" style={{ color: alertColor(a.level) }}>
                      +{fmtUsd(a.over_amount)}
                      <ChevronRight size={14} className="text-faint" aria-hidden />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pushOff && (
            <div className="ml-11">
              <button className="min-h-10 text-[12px] text-up rounded focus-visible:outline-2 focus-visible:outline-up" onClick={enableNotify}>
                Notify me
              </button>
            </div>
          )}
        </div>
      )}

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
        <div className="m-3 rounded-xl bg-panel2 p-3">
          {plan.history_months > 0 ? (
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-txt">
                  Start from your last {plan.history_months} {plan.history_months === 1 ? "month" : "months"}
                </div>
                <p className="text-[12px] text-dim">Targets based on what you actually spent.</p>
              </div>
              <button className="shrink-0 min-h-10 px-4 rounded-full text-[13px] font-semibold text-up transition-colors hover:brightness-110 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-up"
                      style={{ background: "color-mix(in srgb, var(--color-up) 16%, transparent)" }}
                      disabled={busy} onClick={startFromHistory}>
                Set targets
              </button>
            </div>
          ) : (
            <p className="text-[12px] text-dim">
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
          const al = alertFor(c.category);
          return (
            <div key={c.category} id={`bud-cat-${c.category}`} className="scroll-mt-28 border-t border-edge first:border-t-0">
              <button className="w-full min-h-10 px-3 py-2 text-left hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-up"
                      aria-expanded={isOpen} onClick={() => toggle(c)}>
                <div className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="text-txt truncate capitalize min-w-0 inline-flex items-center gap-2">
                    {al && (
                      <span className="shrink-0 size-1.5 rounded-full" style={{ background: alertColor(al.level) }}>
                        <span className="sr-only">Running higher than usual</span>
                      </span>
                    )}
                    <span className="truncate">{catLabel(c.category)}</span>
                  </span>
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
                      {!!c.avg_3m && !al && <span className="tabular-nums">avg {fmtUsd(c.avg_3m)}</span>}
                    </div>
                  </>
                )}
                {al && (
                  <div className="mt-0.5 text-[11px] tabular-nums" style={{ color: alertColor(al.level) }}>
                    {al.level === "high" ? "More than a usual month" : `${fmtUsd(al.over_amount)} more than usual by now`}
                  </div>
                )}
                {!hasT && !al && !!c.avg_3m && (
                  <div className="mt-0.5 text-[10px] text-faint tabular-nums">avg {fmtUsd(c.avg_3m)}</div>
                )}
              </button>
              {isOpen && (
                <div className="px-3 pb-3 space-y-2 bg-panel2">
                  {al && alertData && (
                    <p className="pt-2 text-[11px] text-dim tabular-nums">
                      Usually about {fmtUsd(al.typical_to_date)} by the {ordinal(alertData.day)}. {fmtUsd(al.normal_month)} in a normal month.
                    </p>
                  )}
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
