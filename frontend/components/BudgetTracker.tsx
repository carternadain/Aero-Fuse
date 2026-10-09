"use client";

import { useEffect, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChevronLeft, ChevronRight, FileUp, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";
import { budgetChanged, fmtShortDate, onBudgetChanged, toast } from "@/lib/bus";
import { ALL_CATS, EXPENSE_CATS, catLabel, errorText } from "@/lib/categories";
import ImportStatement from "./ImportStatement";
import SwipeRow, { deferDelete } from "./SwipeRow";

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
  const [hidden, setHidden] = useState<number[]>([]); // deleted, waiting out the Undo window
  const [f, setF] = useState({ kind: "expense", category: "food", amount: "", note: "" });

  const refresh = () =>
    api.get<BudgetSummary>(`/api/budget/summary?month=${month}`).then(setSum).catch(() => {});
  // Anything that changes transactions also tells the bills panel next to us.
  const changed = () => { refresh(); budgetChanged(); };

  useEffect(() => { refresh(); }, [month]);
  // Target edits in the Monthly budget panel show up here (refresh doesn't emit, so no loop).
  useEffect(() => onBudgetChanged(() => { refresh(); }), [month]);

  const add = async () => {
    const amount = parseFloat(f.amount);
    if (isNaN(amount) || amount <= 0) return;
    await api.post("/api/transactions", { ...f, amount, category: f.kind === "income" ? "income" : f.category });
    setF({ ...f, amount: "", note: "" });
    setAdding(false);
    changed();
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
      changed();
    } catch (e) {
      toast(errorText(e, "Couldn't change that category."));
    }
  };

  const remove = (t: Tx) =>
    deferDelete({
      message: "Transaction deleted",
      hide: () => setHidden((h) => [...h, t.id]),
      restore: () => setHidden((h) => h.filter((i) => i !== t.id)),
      commit: () => api.del(`/api/transactions/${t.id}`).then(() => { changed(); setHidden((h) => h.filter((i) => i !== t.id)); }),
    });

  const pieData = (sum?.categories ?? []).filter((c) => c.spent > 0)
    .map((c) => ({ name: c.category, value: c.spent }));

  return (
    <section className="panel flex flex-col">
      <div className="panel-head !justify-end">
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
          <div className="grid grid-cols-3 max-sm:grid-cols-2 gap-2">
            <label className="field-wrap"><span className="field-label">Type</span>
              <select className="field" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                <option value="expense">EXPENSE</option>
                <option value="income">INCOME</option>
              </select></label>
            <label className="field-wrap"><span className="field-label">Category</span>
              {f.kind === "expense" ? (
                <select className="field" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                  {EXPENSE_CATS.map((c) => <option key={c} value={c}>{c.replace("_", " ").toUpperCase()}</option>)}
                </select>
              ) : (
                <input className="field" value="income" disabled />
              )}</label>
            <label className="field-wrap max-sm:col-span-2"><span className="field-label">Amount $</span>
              <input className="field" inputMode="decimal" placeholder="0" autoComplete="off" enterKeyHint="next" value={f.amount}
                     onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
          </div>
          <div className="flex gap-2 items-end">
            <label className="field-wrap flex-1"><span className="field-label">Note (optional)</span>
              <input className="field" autoComplete="off" enterKeyHint="done" value={f.note}
                     onChange={(e) => setF({ ...f, note: e.target.value })}
                     onKeyDown={(e) => { if (e.key === "Enter") add(); }} /></label>
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

        {/* Spent per category, colored like the donut */}
        <div className="space-y-1 overflow-y-auto max-h-44 pr-1 min-w-0">
          {pieData.length === 0 && (
            <p className="text-[11px] text-dim pt-2">Targets live in the Monthly budget panel below.</p>
          )}
          {(sum?.categories ?? []).filter((c) => c.spent > 0).map((c, i) => {
            const over = c.limit !== null && c.spent > c.limit;
            return (
              <div key={c.category} className="flex items-center gap-2 text-[11px] min-w-0">
                <span className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                <span className="min-w-0 flex-1 truncate text-txt">{catLabel(c.category)}</span>
                {over && <span className="shrink-0 text-[9px] uppercase tracking-widest text-down font-bold">over</span>}
                <span className={`shrink-0 tabular-nums ${over ? "text-down font-bold" : "text-dim"}`}>{fmtUsd(c.spent)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent transactions */}
      <div className="border-t border-edge overflow-y-auto max-h-80">
        {(sum?.transactions ?? []).filter((t) => !hidden.includes(t.id)).map((t) => (
          <div key={t.id} className="border-t border-edge first:border-t-0">
            <SwipeRow label="Delete transaction" onDelete={() => remove(t)}
                      className="flex items-center gap-2 pl-3 pr-3 [@media(hover:hover)]:pr-1 min-h-10 text-[11px] hover:bg-panel2">
              <span className="text-dim shrink-0 w-12">{fmtShortDate(t.date)}</span>
              <span className="min-w-0 flex-1 truncate text-txt" title={t.note}>{t.merchant || t.note || "—"}</span>
              <button className={`shrink-0 min-h-10 px-1.5 rounded focus-visible:outline-2 focus-visible:outline-up ${t.kind === "income" ? "text-up" : "text-dim"} hover:text-txt`}
                      aria-label={`Change category (${catLabel(t.category)})`} aria-expanded={editId === t.id}
                      onClick={() => openEdit(t)}>
                {catLabel(t.category)}
              </button>
              <span className={`shrink-0 font-bold tabular-nums ${t.kind === "income" || t.amount < 0 ? "text-up" : "text-down"}`}>
                {t.kind === "income" || t.amount < 0 ? "+" : "−"}{fmtUsd(Math.abs(t.amount))}
              </span>
            </SwipeRow>
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

      {importing && <ImportStatement onClose={() => setImporting(false)} onDone={changed} />}
    </section>
  );
}
