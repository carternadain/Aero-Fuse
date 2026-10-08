"use client";

import { useEffect, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChevronLeft, ChevronRight, PiggyBank, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";

interface Tx {
  id: number;
  date: string;
  category: string;
  amount: number;
  kind: "income" | "expense";
  note: string;
}

interface BudgetSummary {
  month: string;
  income: number;
  expenses: number;
  net: number;
  savings_rate: number;
  categories: { category: string; spent: number; limit: number | null }[];
  transactions: Tx[];
}

const EXPENSE_CATS = ["rent", "food", "transport", "subscriptions", "fun", "trading_fees", "health", "shopping", "other"];
const PIE_COLORS = ["#e3a83c", "#56b8a4", "#6cb4ff", "#e98cb4", "#b08bd9", "#e8895a", "#7fb069", "#d97ba8", "#9b9285"];

function monthShift(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function BudgetTracker() {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [sum, setSum] = useState<BudgetSummary | null>(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ kind: "expense", category: "food", amount: "", note: "" });

  const refresh = () =>
    api.get<BudgetSummary>(`/api/budget/summary?month=${month}`).then(setSum).catch(() => {});

  useEffect(() => { refresh(); }, [month]);

  const add = async () => {
    const amount = parseFloat(f.amount);
    if (isNaN(amount) || amount <= 0) return;
    await api.post("/api/transactions", { ...f, amount, category: f.kind === "income" ? "income" : f.category });
    setF({ ...f, amount: "", note: "" });
    setAdding(false);
    refresh();
  };

  const setLimit = async (category: string, current: number | null) => {
    const v = prompt(`Monthly budget for ${category}:`, String(current ?? ""));
    if (v == null) return;
    const limit = parseFloat(v.replace(/[$,]/g, ""));
    if (isNaN(limit)) return;
    await api.put("/api/budgets", { category, monthly_limit: limit });
    refresh();
  };

  const pieData = (sum?.categories ?? []).filter((c) => c.spent > 0)
    .map((c) => ({ name: c.category, value: c.spent }));

  return (
    <section className="panel flex flex-col">
      <div className="panel-head">
        <span className="panel-title"><PiggyBank size={14} />Budget</span>
        <div className="flex items-center gap-1.5">
          <button className="btn !py-1 !px-1.5" onClick={() => setMonth(monthShift(month, -1))}>
            <ChevronLeft size={12} />
          </button>
          <span className="text-[11px] text-txt tabular-nums">{month}</span>
          <button className="btn !py-1 !px-1.5" onClick={() => setMonth(monthShift(month, 1))}>
            <ChevronRight size={12} />
          </button>
          <button className="btn btn-primary !py-1 ml-1" onClick={() => setAdding(!adding)}>
            <Plus size={12} strokeWidth={3} />Tx
          </button>
        </div>
      </div>

      {adding && (
        <div className="p-3 border-b border-edge space-y-2 bg-panel2">
          <div className="grid grid-cols-3 gap-2">
            <select className="field" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="expense">EXPENSE</option>
              <option value="income">INCOME</option>
            </select>
            {f.kind === "expense" ? (
              <select className="field" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {EXPENSE_CATS.map((c) => <option key={c} value={c}>{c.replace("_", " ").toUpperCase()}</option>)}
              </select>
            ) : (
              <input className="field" value="income" disabled />
            )}
            <input className="field" placeholder="$ amount" value={f.amount}
                   onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <input className="field" placeholder="Note (optional)" value={f.note}
                   onChange={(e) => setF({ ...f, note: e.target.value })} />
            <button className="btn btn-primary whitespace-nowrap" onClick={add}>Log</button>
          </div>
        </div>
      )}

      {/* Month verdict */}
      <div className="grid grid-cols-4 divide-x divide-edge border-b border-edge text-center">
        <div className="py-2">
          <div className="text-[9px] text-dim uppercase tracking-widest">In</div>
          <div className="text-sm font-bold text-up tabular-nums">{fmtUsd(sum?.income ?? 0)}</div>
        </div>
        <div className="py-2">
          <div className="text-[9px] text-dim uppercase tracking-widest">Out</div>
          <div className="text-sm font-bold text-down tabular-nums">{fmtUsd(sum?.expenses ?? 0)}</div>
        </div>
        <div className="py-2">
          <div className="text-[9px] text-dim uppercase tracking-widest">Net</div>
          <div className={`text-sm font-bold tabular-nums ${(sum?.net ?? 0) >= 0 ? "text-up" : "text-down"}`}>
            {fmtUsd(sum?.net ?? 0)}
          </div>
        </div>
        <div className="py-2">
          <div className="text-[9px] text-dim uppercase tracking-widest">Saved</div>
          <div className={`text-sm font-bold tabular-nums ${
            (sum?.savings_rate ?? 0) >= 50 ? "text-up" : (sum?.savings_rate ?? 0) >= 20 ? "text-amber" : "text-down"
          }`}>
            {sum?.savings_rate ?? 0}%
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
        {/* Donut */}
        <div className="h-44">
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%"
                     paddingAngle={3} stroke="none">
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "#221f1c", border: "1px solid #3b3631", borderRadius: 10, fontSize: 11 }}
                  formatter={(v, name) => [fmtUsd(Number(v)), String(name)]}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-[11px] text-dim text-center px-4">
              Log expenses to see where the money goes.
            </div>
          )}
        </div>

        {/* Category bars vs budget */}
        <div className="space-y-2 overflow-y-auto max-h-44 pr-1">
          {(sum?.categories ?? []).length === 0 && (
            <p className="text-[11px] text-dim pt-2">
              Click a category bar to set its monthly limit. Spending turns red when you blow past it.
            </p>
          )}
          {(sum?.categories ?? []).map((c, i) => {
            const pct = c.limit ? Math.min(100, (c.spent / c.limit) * 100) : 0;
            const over = c.limit !== null && c.spent > c.limit;
            return (
              <div key={c.category} className="cursor-pointer" onClick={() => setLimit(c.category, c.limit)}
                   title="Click to set monthly limit">
                <div className="flex justify-between text-[10px]">
                  <span className="text-txt">{c.category.replace("_", " ")}</span>
                  <span className={over ? "text-down font-bold" : "text-dim"}>
                    {fmtUsd(c.spent)}{c.limit !== null ? ` / ${fmtUsd(c.limit)}` : " · set limit"}
                  </span>
                </div>
                <div className="h-1.5 rounded bg-edge overflow-hidden mt-0.5">
                  <div
                    className="h-full rounded transition-all"
                    style={{
                      width: c.limit ? `${pct}%` : "100%",
                      background: over ? "var(--color-down)" : c.limit ? (pct > 80 ? "var(--color-amber)" : "var(--color-up)") : PIE_COLORS[i % PIE_COLORS.length] + "55",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent transactions */}
      <div className="border-t border-edge overflow-y-auto max-h-36">
        {(sum?.transactions ?? []).map((t) => (
          <div key={t.id} className="flex items-center gap-2 px-3 py-1 text-[11px] border-t border-edge hover:bg-panel2">
            <span className="text-faint tabular-nums">{t.date.slice(5)}</span>
            <span className={t.kind === "income" ? "text-up" : "text-txt"}>{t.category.replace("_", " ")}</span>
            <span className="text-faint truncate">{t.note}</span>
            <span className={`ml-auto font-bold tabular-nums ${t.kind === "income" ? "text-up" : "text-down"}`}>
              {t.kind === "income" ? "+" : "−"}{fmtUsd(t.amount)}
            </span>
            <button className="icon-btn"
                    onClick={() => api.del(`/api/transactions/${t.id}`).then(refresh)}>
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
