"use client";

import { useEffect, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChevronLeft, ChevronRight, FileUp, PiggyBank, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";
import { askText } from "./DialogHost";
import { toast } from "@/lib/bus";
import { ALL_CATS, EXPENSE_CATS, catLabel, errorText } from "@/lib/categories";
import ImportStatement from "./ImportStatement";

interface Tx {
  id: number;
  date: string;
  category: string;
  amount: number;
  kind: "income" | "expense";
  note: string;
  merchant?: string;
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
  const [importing, setImporting] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState({ category: "other", remember: true, existing: false });
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
    const v = await askText(`Monthly budget for ${category}:`, String(current ?? ""));
    if (v == null) return;
    const limit = parseFloat(v.replace(/[$,]/g, ""));
    if (isNaN(limit)) return;
    await api.put("/api/budgets", { category, monthly_limit: limit });
    refresh();
  };

  const openEdit = (t: Tx) => {
    if (editId === t.id) { setEditId(null); return; }
    setEditId(t.id);
    setEdit({ category: t.category, remember: !!t.merchant, existing: false });
  };

  const saveEdit = async (t: Tx) => {
    try {
      const res = await api.patch<{ updated: number }>(`/api/transactions/${t.id}`, {
        category: edit.category,
        remember: edit.remember && !!t.merchant,
        apply_to_existing: edit.remember && edit.existing && !!t.merchant,
      });
      toast(res.updated ? `Updated ${res.updated + 1} transactions` : "Category updated");
      setEditId(null);
      refresh();
    } catch (e) {
      toast(errorText(e, "Couldn't change that category."));
    }
  };

  const pieData = (sum?.categories ?? []).filter((c) => c.spent > 0)
    .map((c) => ({ name: c.category, value: c.spent }));

  return (
    <section className="panel flex flex-col">
      <div className="panel-head">
        <span className="panel-title"><PiggyBank size={14} />Budget</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button className="btn !min-h-10 !min-w-10 !px-2" aria-label="Previous month"
                  onClick={() => setMonth(monthShift(month, -1))}>
            <ChevronLeft size={14} />
          </button>
          <span className="text-[11px] text-txt tabular-nums">{month}</span>
          <button className="btn !min-h-10 !min-w-10 !px-2" aria-label="Next month"
                  onClick={() => setMonth(monthShift(month, 1))}>
            <ChevronRight size={14} />
          </button>
          <button className="btn !min-h-10" onClick={() => setImporting(true)}>
            <FileUp size={13} />Import
          </button>
          <button className="btn btn-primary !min-h-10" onClick={() => setAdding(!adding)}>
            <Plus size={13} strokeWidth={3} />Tx
          </button>
        </div>
      </div>

      {adding && (
        <div className="p-3 border-b border-edge space-y-2 bg-panel2">
          <div className="grid grid-cols-3 gap-2">
            <select className="field !h-10" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="expense">EXPENSE</option>
              <option value="income">INCOME</option>
            </select>
            {f.kind === "expense" ? (
              <select className="field !h-10" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {EXPENSE_CATS.map((c) => <option key={c} value={c}>{c.replace("_", " ").toUpperCase()}</option>)}
              </select>
            ) : (
              <input className="field !h-10" value="income" disabled />
            )}
            <input className="field !h-10" placeholder="$ amount" inputMode="decimal" value={f.amount}
                   onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <input className="field !h-10" placeholder="Note (optional)" value={f.note}
                   onChange={(e) => setF({ ...f, note: e.target.value })} />
            <button className="btn btn-primary !min-h-10 whitespace-nowrap" onClick={add}>Log</button>
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
                  contentStyle={{ background: "var(--color-panel2)", border: "1px solid var(--color-edge)", borderRadius: 10, fontSize: 11, color: "var(--color-txt)" }}
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
      <div className="border-t border-edge overflow-y-auto max-h-80">
        {(sum?.transactions ?? []).map((t) => (
          <div key={t.id} className="border-t border-edge first:border-t-0">
            <div className="flex items-center gap-2 pl-3 pr-1 min-h-10 text-[11px] hover:bg-panel2">
              <span className="text-faint tabular-nums shrink-0">{t.date.slice(5)}</span>
              <span className="min-w-0 flex-1 truncate text-txt" title={t.note}>{t.merchant || t.note || "—"}</span>
              <button className={`shrink-0 min-h-10 px-1.5 rounded focus-visible:outline-2 focus-visible:outline-up ${t.kind === "income" ? "text-up" : "text-dim"} hover:text-txt`}
                      aria-label={`Change category (${catLabel(t.category)})`} aria-expanded={editId === t.id}
                      onClick={() => openEdit(t)}>
                {catLabel(t.category)}
              </button>
              <span className={`shrink-0 font-bold tabular-nums ${t.kind === "income" ? "text-up" : "text-down"}`}>
                {t.kind === "income" ? "+" : "−"}{fmtUsd(t.amount)}
              </span>
              <button className="icon-btn h-10 w-10 justify-center focus-visible:outline-2 focus-visible:outline-up"
                      aria-label="Delete transaction"
                      onClick={() => api.del(`/api/transactions/${t.id}`).then(refresh)}>
                <X size={14} />
              </button>
            </div>
            {editId === t.id && (
              <div className="px-3 pb-3 space-y-1 bg-panel2">
                <select className="field !h-10" value={edit.category} aria-label="Category"
                        onChange={(e) => setEdit({ ...edit, category: e.target.value })}>
                  {ALL_CATS.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
                </select>
                {t.merchant && (
                  <>
                    <label className="flex items-center gap-3 min-h-10 text-[12px] text-txt cursor-pointer">
                      <input type="checkbox" className="h-5 w-5 accent-up shrink-0" checked={edit.remember}
                             onChange={(e) => setEdit({ ...edit, remember: e.target.checked })} />
                      Remember for {t.merchant}
                    </label>
                    {edit.remember && (
                      <label className="flex items-center gap-3 min-h-10 text-[12px] text-txt cursor-pointer">
                        <input type="checkbox" className="h-5 w-5 accent-up shrink-0" checked={edit.existing}
                               onChange={(e) => setEdit({ ...edit, existing: e.target.checked })} />
                        Also change past ones
                      </label>
                    )}
                  </>
                )}
                <div className="flex gap-2">
                  <button className="btn btn-primary !min-h-10 flex-1" onClick={() => saveEdit(t)}>Save</button>
                  <button className="btn !min-h-10 flex-1" onClick={() => setEditId(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {importing && <ImportStatement onClose={() => setImporting(false)} onDone={refresh} />}
    </section>
  );
}
