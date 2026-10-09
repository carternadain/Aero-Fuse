"use client";

import { useEffect, useState } from "react";
import { CalendarClock, ChevronDown, Eye, EyeOff, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";
import { onBudgetChanged, toast } from "@/lib/bus";
import { catLabel, errorText } from "@/lib/categories";

type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

interface Item {
  merchant: string;
  category: string;
  kind: "income" | "expense";
  cadence: Cadence;
  amount: number;
  previous_amount: number | null;
  last_date: string;
  next_date: string;
  occurrences: number;
  monthly_cost: number;
  annual_cost: number;
  price_change: { from: number; to: number; delta: number } | null;
  status: "active" | "maybe_cancelled";
  override: "ignored" | "confirmed" | null;
}

interface Recurring {
  items: Item[];
  totals: { monthly: number; annual: number; count: number; income_monthly: number; upcoming_count: number; upcoming_total: number };
  upcoming: { date: string; merchant: string; amount: number; kind: "income" | "expense"; cadence: Cadence }[];
  price_hikes: { merchant: string; from: number; to: number; delta: number }[];
}

const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: "weekly", biweekly: "every 2 weeks", monthly: "monthly", quarterly: "every 3 months", yearly: "yearly",
};

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const dayDiff = (iso: string, today: Date) => Math.round((parse(iso).getTime() - parse(isoDay(today)).getTime()) / 86_400_000);
const fmtDay = (iso: string) => parse(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtLong = (iso: string) => parse(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/** Bills care about the cents ($17.49, not $17); fmtUsd still decides when to mask. */
function usd(n: number): string {
  const s = fmtUsd(n);
  if (!/\d/.test(s) || Math.abs(n) >= 10_000) return s;
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dayHint(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  return `in ${n} days`;
}

export default function RecurringBills() {
  const [data, setData] = useState<Recurring | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const refresh = () =>
    api.get<Recurring>("/api/recurring").then((d) => { setData(d); setFailed(false); }).catch(() => setFailed(true));

  useEffect(() => { refresh(); return onBudgetChanged(refresh); }, []);

  const choose = async (it: Item, status: "ignored" | "confirmed" | null, msg: string) => {
    try {
      await api.put(`/api/recurring/${encodeURIComponent(it.merchant)}`, { status });
      toast(msg);
      setOpen(null);
      refresh();
    } catch (e) {
      toast(errorText(e, "Couldn't save that. Please try again."));
    }
  };

  const today = new Date();
  const visible = (data?.items ?? []).filter((i) => i.override !== "ignored");
  const hidden = (data?.items ?? []).filter((i) => i.override === "ignored");
  const bills = visible.filter((i) => i.kind === "expense");
  const paydays = visible.filter((i) => i.kind === "income");
  const soon = (data?.upcoming ?? []).filter((u) => dayDiff(u.date, today) <= 30);
  const byDate = soon.reduce<Record<string, typeof soon>>((acc, u) => { (acc[u.date] ||= []).push(u); return acc; }, {});
  const t = data?.totals;

  const row = (it: Item) => {
    const dim = it.status === "maybe_cancelled";
    const expanded = open === it.merchant;
    return (
      <div key={it.merchant + it.kind} className="border-t border-edge first:border-t-0">
        <button
          className={`w-full flex items-center gap-2 px-3 min-h-12 text-left hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-up ${dim ? "opacity-60" : ""}`}
          aria-expanded={expanded} onClick={() => setOpen(expanded ? null : it.merchant)}>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] text-txt">{it.merchant}</span>
            <span className="block truncate text-[10px] text-dim">
              {dim ? `no charge since ${fmtDay(it.last_date)}` : `${CADENCE_LABEL[it.cadence]} · ${it.next_date < new Date().toLocaleDateString("en-CA") ? "was due" : "next"} ${fmtDay(it.next_date)}`}
              {it.override === "confirmed" ? " · kept" : ""}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className={`block text-[12px] font-bold tabular-nums ${it.kind === "income" ? "text-up" : "text-txt"}`}>
              {usd(it.amount)}
            </span>
            <span className="block text-[10px] text-dim tabular-nums">
              {it.cadence === "monthly" ? "per month" : `${usd(it.monthly_cost)}/mo`}
            </span>
          </span>
          <ChevronDown size={14} className={`shrink-0 text-faint transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
        {expanded && (
          <div className="px-3 pb-3 pt-1 bg-panel2 space-y-2">
            <p className="text-[11px] text-dim tabular-nums">
              {catLabel(it.category)} · seen {it.occurrences} times · about {usd(it.annual_cost)} a year
            </p>
            <div className="flex gap-2">
              <button className="btn !min-h-10 flex-1" onClick={() => choose(it, "ignored", `${it.merchant} hidden`)}>
                Not a {it.kind === "income" ? "paycheck" : "bill"}
              </button>
              {it.override === "confirmed" ? (
                <button className="btn !min-h-10 flex-1" onClick={() => choose(it, null, "Back to automatic")}>Stop keeping</button>
              ) : (
                <button className="btn btn-primary !min-h-10 flex-1" onClick={() => choose(it, "confirmed", `Keeping ${it.merchant}`)}>Keep</button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="panel flex flex-col">
      <div className="panel-head">
        <span className="panel-title"><CalendarClock size={14} />Bills &amp; subscriptions</span>
      </div>

      {failed && !data && <p className="p-3 text-[11px] text-dim">Couldn&apos;t load your bills. Try again in a moment.</p>}

      {data && visible.length === 0 && hidden.length === 0 && (
        <p className="p-4 text-[12px] text-dim text-center">
          Import a few months of statements and your bills and subscriptions show up here.
        </p>
      )}

      {data && (visible.length > 0 || hidden.length > 0) && (
        <>
          <div className="grid grid-cols-3 divide-x divide-edge border-b border-edge text-center">
            <div className="py-2">
              <div className="text-[9px] text-dim uppercase tracking-widest">Monthly</div>
              <div className="text-sm font-bold text-txt tabular-nums">{fmtUsd(t?.monthly ?? 0)}</div>
            </div>
            <div className="py-2">
              <div className="text-[9px] text-dim uppercase tracking-widest">Yearly</div>
              <div className="text-sm font-bold text-txt tabular-nums">{fmtUsd(t?.annual ?? 0)}</div>
            </div>
            <div className="py-2">
              <div className="text-[9px] text-dim uppercase tracking-widest">Bills</div>
              <div className="text-sm font-bold text-txt tabular-nums">{t?.count ?? 0}</div>
            </div>
          </div>

          {(data.price_hikes ?? []).length > 0 && (
            <div className="px-3 py-2 border-b border-edge space-y-1" role="status">
              {data.price_hikes.map((h) => (
                <p key={h.merchant} className="flex items-start gap-2 text-[12px] text-amber">
                  <TrendingUp size={14} className="shrink-0 mt-0.5" />
                  <span className="min-w-0">
                    {h.merchant} went {h.delta > 0 ? "up" : "down"} {usd(Math.abs(h.delta))} to{" "}
                    <span className="tabular-nums">{usd(h.to)}</span>
                  </span>
                </p>
              ))}
            </div>
          )}

          <div className="border-b border-edge">
            <div className="flex items-baseline justify-between px-3 pt-3 pb-1">
              <h3 className="text-[10px] text-dim uppercase tracking-widest">Next 30 days</h3>
              {(t?.upcoming_count ?? 0) > 0 && (
                <span className="text-[10px] text-dim tabular-nums">{t?.upcoming_count} bills · {fmtUsd(t?.upcoming_total ?? 0)}</span>
              )}
            </div>
            {soon.length === 0 ? (
              <p className="px-3 pb-3 text-[11px] text-dim">Nothing due in the next 30 days.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto pb-1">
                {Object.entries(byDate).map(([date, list]) => (
                  <div key={date} className="flex gap-3 px-3 py-1.5 border-t border-edge first:border-t-0">
                    <div className="w-14 shrink-0 text-center rounded bg-panel2 border border-edge py-1 self-start">
                      <div className="text-[9px] text-dim uppercase">{parse(date).toLocaleDateString(undefined, { month: "short" })}</div>
                      <div className="text-sm font-bold text-txt tabular-nums leading-none">{parse(date).getDate()}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-faint mb-0.5">{fmtLong(date)} · {dayHint(dayDiff(date, today))}</div>
                      {list.map((u) => (
                        <div key={u.merchant + u.kind} className="flex items-center gap-2 min-h-7 text-[12px]">
                          <span className="min-w-0 flex-1 truncate text-txt">{u.merchant}</span>
                          <span className="shrink-0 text-[10px] text-dim">{CADENCE_LABEL[u.cadence]}</span>
                          <span className={`shrink-0 font-bold tabular-nums ${u.kind === "income" ? "text-up" : "text-down"}`}>
                            {u.kind === "income" ? "+" : "−"}{usd(u.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {bills.length > 0 && <h3 className="px-3 pt-3 pb-1 text-[10px] text-dim uppercase tracking-widest">All bills</h3>}
            {bills.map(row)}
            {paydays.length > 0 && (
              <h3 className="px-3 pt-3 pb-1 text-[10px] text-dim uppercase tracking-widest border-t border-edge">
                Regular income{t && t.income_monthly > 0 ? ` · about ${fmtUsd(t.income_monthly)}/mo` : ""}
              </h3>
            )}
            {paydays.map(row)}
          </div>

          {hidden.length > 0 && (
            <div className="border-t border-edge">
              <button className="w-full flex items-center gap-2 px-3 min-h-10 text-[11px] text-dim hover:text-txt focus-visible:outline-2 focus-visible:outline-up"
                      aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>
                {showHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                {showHidden ? "Hide" : "Show"} {hidden.length} hidden
              </button>
              {showHidden && hidden.map((it) => (
                <div key={it.merchant + it.kind} className="flex items-center gap-2 pl-3 pr-1 min-h-12 border-t border-edge opacity-80">
                  <span className="min-w-0 flex-1 truncate text-[12px] text-dim">{it.merchant}</span>
                  <span className="shrink-0 text-[11px] text-dim tabular-nums">{usd(it.amount)}</span>
                  <button className="btn !min-h-10 shrink-0" onClick={() => choose(it, null, `${it.merchant} is back`)}>Show again</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
