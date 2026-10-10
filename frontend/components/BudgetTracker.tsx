"use client";

import { useEffect, useRef, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChevronLeft, ChevronRight, FileUp, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";
import { fmtCents } from "@/lib/privacy";
import { budgetChanged, onBudgetChanged, toast } from "@/lib/bus";
import {
  ALL_CATS, EXPENSE_CATS, catLabel, curMonth, dayLabel, defaultDayFor, errorText, monthLabel, monthShift,
} from "@/lib/categories";
import ImportStatement, { type ImportResult } from "./ImportStatement";
import SwipeRow, { deferDelete } from "./SwipeRow";
import { askConfirm } from "./DialogHost";

interface Tx {
  id: number;
  date: string;
  category: string;
  amount: number;
  kind: "income" | "expense";
  note: string;
  merchant: string;
  /** the month it counts in (budget_month when set, else the month of its date) */
  month: string;
  budget_month: string | null;
  import_batch: string | null;
  source: string;
}

interface BudgetSummary {
  month: string;
  income: number;
  expenses: number;
  net: number;
  savings_rate: number;
  categories: { category: string; spent: number; limit: number | null }[];
  transactions: Tx[];
  count: number;
  recent_income: { name: string; amount: number; date: string }[];
}

const PIE_COLORS = ["#e3a83c", "#56b8a4", "#6cb4ff", "#e98cb4", "#b08bd9", "#e8895a", "#7fb069", "#d97ba8", "#9b9285"];
const FIRST_ROWS = 25;

const isMoved = (t: Tx) => !!t.budget_month && t.budget_month !== t.date.slice(0, 7);
const isPlus = (t: Tx) => t.kind === "income" || t.amount < 0; // income, or a refund (negative spending)

// ── Add ───────────────────────────────────────────────────

type AddKind = "expense" | "income" | "refund";
const ADD_KINDS: { key: AddKind; label: string; hint: string; name: string; placeholder: string; button: string }[] = [
  { key: "expense", label: "Spent", hint: "", name: "Where", placeholder: "Trader Joe's", button: "Add expense" },
  { key: "income", label: "Income", hint: "Paychecks, interest, gifts. Counts as money in.",
    name: "From", placeholder: "Paycheck", button: "Add income" },
  { key: "refund", label: "Refund", hint: "Money back from a store. Lowers spending in that category instead of counting as income.",
    name: "Store", placeholder: "Target", button: "Add refund" },
];

function AddForm({ month, recent, onClose, onAdded }: {
  month: string;
  recent: BudgetSummary["recent_income"];
  onClose: () => void;
  onAdded: (t: Tx, kind: AddKind) => void;
}) {
  const [kind, setKind] = useState<AddKind>("expense");
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("food");
  const [date, setDate] = useState(() => defaultDayFor(month));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const k = ADD_KINDS.find((x) => x.key === kind)!;

  useEffect(() => { setDate(defaultDayFor(month)); }, [month]);
  useEffect(() => { amountRef.current?.focus(); }, [kind]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseFloat(amount.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n <= 0) { setError("Enter an amount above $0."); amountRef.current?.focus(); return; }
    if (!date) { setError("Pick a date."); return; }
    setSaving(true);
    setError(null);
    try {
      const t = await api.post<Tx>("/api/transactions", {
        kind: kind === "income" ? "income" : "expense",
        category: kind === "income" ? "income" : category,
        amount: Math.round(n * 100) / 100, merchant: name.trim(), note: "", date, refund: kind === "refund",
      });
      setAmount("");
      setName("");
      onAdded(t, kind);
    } catch (err) {
      setError(errorText(err, "Couldn't add that. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="p-3 border-b border-edge space-y-3 bg-panel2" aria-label="Add a transaction">
      <div role="group" aria-label="Type" className="seg flex rounded-lg border border-edge2 text-[13px] bg-panel">
        {ADD_KINDS.map((x) => (
          <button key={x.key} type="button" aria-pressed={kind === x.key} onClick={() => { setKind(x.key); setError(null); }}
                  className={`flex-1 h-10 font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-up
                              ${kind === x.key ? "bg-panel2 text-txt" : "text-dim hover:text-txt"}`}>
            {x.label}
          </button>
        ))}
      </div>
      {k.hint && <p className="text-[12px] text-dim -mt-1">{k.hint}</p>}

      {kind === "income" && recent.length > 0 && (
        <div className="flex gap-2 overflow-x-auto -mx-3 px-3 pb-0.5" aria-label="Same as before">
          {recent.map((r) => (
            <button key={r.name} type="button"
                    className="shrink-0 min-h-10 px-3 rounded-full border border-edge2 bg-panel text-[12px] text-txt hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-up"
                    onClick={() => { setName(r.name); setAmount(String(r.amount)); setError(null); }}>
              {r.name} <span className="tabular-nums text-up">{fmtCents(r.amount)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="field-wrap"><span className="field-label">Amount</span>
          <span className="relative">
            <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-dim">$</span>
            <input ref={amountRef} className="field !pl-6 tabular-nums" inputMode="decimal" placeholder="0.00" autoComplete="off"
                   enterKeyHint="next" value={amount} aria-invalid={!!error && !amount}
                   onChange={(e) => setAmount(e.target.value)} />
          </span>
        </label>
        <label className="field-wrap"><span className="field-label">Date</span>
          <input type="date" className="field tabular-nums" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className={`field-wrap ${kind === "income" ? "col-span-2" : ""}`}><span className="field-label">{k.name}</span>
          <input className="field" placeholder={k.placeholder} autoComplete="off" enterKeyHint="done"
                 value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {kind !== "income" && (
          <label className="field-wrap"><span className="field-label">Category</span>
            <select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
              {EXPENSE_CATS.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
            </select>
          </label>
        )}
      </div>

      {error && <p role="alert" className="text-[12px] text-down">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn !min-h-10 flex-1" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary !min-h-10 flex-[2] disabled:opacity-50" disabled={saving}>
          {saving ? "Adding…" : k.button}
        </button>
      </div>
    </form>
  );
}

// ── Edit one transaction ──────────────────────────────────

function TxEditor({ t, batchSize, onSaved, onCancel, onDelete, onDeleteBatch }: {
  t: Tx;
  batchSize: number;
  onSaved: (moved: string | null) => void;
  onCancel: () => void;
  onDelete: () => void;
  onDeleteBatch: () => void;
}) {
  const ownMonth = t.date.slice(0, 7);
  const [name, setName] = useState(t.merchant);
  const [amount, setAmount] = useState(Math.abs(t.amount).toFixed(2));
  const [date, setDate] = useState(t.date.slice(0, 10));
  const [category, setCategory] = useState(t.category);
  const [countIn, setCountIn] = useState(t.budget_month || "");
  const [remember, setRemember] = useState(!!t.merchant);
  const [existing, setExisting] = useState(false);
  const [wholeImport, setWholeImport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateMonth = (date || t.date).slice(0, 7);
  const monthOpts = [-1, 0, 1, 2].map((d) => monthShift(dateMonth, d));
  if (countIn && !monthOpts.includes(countIn)) monthOpts.push(countIn);
  const newBm = countIn && countIn !== dateMonth ? countIn : null;
  const oldBm = t.budget_month && t.budget_month !== ownMonth ? t.budget_month : null;
  const monthChanged = newBm !== oldBm;
  const catChanged = category !== t.category;

  const save = async () => {
    const n = parseFloat(amount.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n <= 0) { setError("Enter an amount above $0."); return; }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (name.trim() && name.trim() !== t.merchant) body.merchant = name.trim();
      if (Math.abs(n - Math.abs(t.amount)) > 0.001) body.amount = n;
      if (date && date !== t.date.slice(0, 10)) body.date = date;
      if (monthChanged && wholeImport && t.import_batch) {
        await api.post("/api/transactions/bulk", { action: "move", batch: t.import_batch, budget_month: newBm });
      } else if (monthChanged || body.date) {
        body.budget_month = newBm;
      }
      if (catChanged) {
        body.category = category;
        body.remember = remember && !!t.merchant;
        body.apply_to_existing = remember && existing && !!t.merchant;
      }
      const res = await api.patch<{ updated: number }>(`/api/transactions/${t.id}`, body);
      toast(res.updated ? `Updated ${res.updated + 1} transactions` : "Saved");
      onSaved(monthChanged ? (newBm ?? dateMonth) : null);
    } catch (e) {
      setError(errorText(e, "Couldn't save that. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-3 pt-2 pb-3 space-y-2 bg-panel2 border-t border-edge">
      <div className="grid grid-cols-2 gap-2">
        <label className="field-wrap col-span-2"><span className="field-label">Name</span>
          <input className="field" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} /></label>
        <label className="field-wrap"><span className="field-label">{isPlus(t) ? (t.kind === "income" ? "Amount in" : "Refund") : "Amount"}</span>
          <span className="relative">
            <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-dim">$</span>
            <input className="field !pl-6 tabular-nums" inputMode="decimal" value={amount}
                   onChange={(e) => setAmount(e.target.value)} />
          </span></label>
        <label className="field-wrap"><span className="field-label">Date</span>
          <input type="date" className="field tabular-nums" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field-wrap"><span className="field-label">Category</span>
          <select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
            {ALL_CATS.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
          </select></label>
        <label className="field-wrap"><span className="field-label">Counts in</span>
          <select className="field" value={countIn && countIn !== dateMonth ? countIn : ""}
                  onChange={(e) => setCountIn(e.target.value)}>
            {monthOpts.map((m) => (
              <option key={m} value={m === dateMonth ? "" : m}>{monthLabel(m)}</option>
            ))}
          </select></label>
      </div>
      {monthChanged && t.import_batch && batchSize > 1 && (
        <label className="flex items-center gap-3 min-h-10 text-[13px] text-txt cursor-pointer">
          <input type="checkbox" className="h-5 w-5 accent-up shrink-0" checked={wholeImport}
                 onChange={(e) => setWholeImport(e.target.checked)} />
          Move everything from this import
        </label>
      )}
      {catChanged && t.merchant && (
        <>
          <label className="flex items-center gap-3 min-h-10 text-[13px] text-txt cursor-pointer">
            <input type="checkbox" className="h-5 w-5 accent-up shrink-0" checked={remember}
                   onChange={(e) => setRemember(e.target.checked)} />
            <span className="min-w-0">Always file {t.merchant} as {catLabel(category)}</span>
          </label>
          {remember && (
            <label className="flex items-center gap-3 min-h-10 text-[13px] text-txt cursor-pointer">
              <input type="checkbox" className="h-5 w-5 accent-up shrink-0" checked={existing}
                     onChange={(e) => setExisting(e.target.checked)} />
              Change past ones too
            </label>
          )}
        </>
      )}
      {error && <p role="alert" className="text-[12px] text-down">{error}</p>}
      <div className="flex gap-2">
        <button className="btn !min-h-10 flex-1" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary !min-h-10 flex-[2] disabled:opacity-50" disabled={busy} onClick={save}>Save</button>
      </div>
      <div className="flex flex-wrap gap-x-4">
        <button className="min-h-10 inline-flex items-center gap-1.5 text-[13px] font-semibold text-down rounded focus-visible:outline-2 focus-visible:outline-up"
                onClick={onDelete}>
          <Trash2 size={14} aria-hidden />Delete
        </button>
        {t.import_batch && batchSize > 1 && (
          <button className="min-h-10 text-[13px] text-dim hover:text-txt rounded focus-visible:outline-2 focus-visible:outline-up"
                  onClick={onDeleteBatch}>
            Delete everything from this import
          </button>
        )}
      </div>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────

export default function BudgetTracker() {
  const [month, setMonth] = useState(curMonth);
  const [sum, setSum] = useState<BudgetSummary | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [hidden, setHidden] = useState<number[]>([]); // deleted, waiting out the Undo window
  const [manage, setManage] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const [showAll, setShowAll] = useState(false);
  const self = useRef(0); // budgetChanged events we sent ourselves (already refreshed)
  const monthRef = useRef(month);
  monthRef.current = month;

  const refresh = () =>
    api.get<BudgetSummary>(`/api/budget/summary?month=${monthRef.current}`)
      .then((s) => { if (s.month === monthRef.current) setSum(s); }).catch(() => {});
  // Anything that changes transactions also tells the other budget panels.
  const changed = () => { self.current++; budgetChanged(); return refresh(); };

  useEffect(() => { setEditId(null); setManage(false); setShowAll(false); refresh(); }, [month]);
  useEffect(() => onBudgetChanged(() => {
    if (self.current > 0) { self.current--; return; }
    refresh();
  }), []);

  const view = (m: string) => { if (m !== monthRef.current) setMonth(m); };

  const onAdded = (t: Tx, kind: AddKind) => {
    setAdding(false);
    const what = kind === "income" ? "Income" : kind === "refund" ? "Refund" : "Expense";
    if (t.month !== month) {
      toast(`${what} added to ${monthLabel(t.month)}`, { label: "View", run: () => view(t.month) });
    } else toast(`${what} added`);
    changed();
  };

  const onImported = (r: ImportResult) => {
    const dup = r.duplicates ? ` (${r.duplicates} already there)` : "";
    view(r.month);
    changed();
    if (!r.inserted) { toast(`Nothing new to add${dup}`); return; }
    const msg = `Added ${r.inserted} to ${monthLabel(r.month)}${dup}`;
    if (!r.batch) { toast(msg); return; }
    const batch = r.batch;
    toast(msg, {
      label: "Undo",
      run: () => api.post("/api/transactions/bulk", { action: "delete", batch })
        .then(() => { toast("Import undone"); changed(); })
        .catch(() => toast("Couldn't undo that import.")),
    });
  };

  const remove = (t: Tx) => {
    setEditId(null);
    deferDelete({
      message: `Deleted ${t.merchant}`,
      hide: () => setHidden((h) => [...h, t.id]),
      restore: () => setHidden((h) => h.filter((i) => i !== t.id)),
      // refresh first, so the row doesn't flash back before the new list arrives
      commit: () => api.del(`/api/transactions/${t.id}`).then(changed)
        .then(() => setHidden((h) => h.filter((i) => i !== t.id))),
    });
  };

  const bulk = async (body: Record<string, unknown>, done: (n: number) => void) => {
    try {
      const r = await api.post<{ deleted?: number; moved?: number }>("/api/transactions/bulk", body);
      done(r.deleted ?? r.moved ?? 0);
      setManage(false);
      setEditId(null);
      changed();
    } catch (e) {
      toast(errorText(e, "Couldn't do that. Please try again."));
    }
  };

  const deleteAll = async () => {
    const n = sum?.count ?? 0;
    if (!n || !(await askConfirm(`Delete all ${n} transactions counted in ${monthLabel(month, { long: true })}? This can't be undone.`))) return;
    bulk({ action: "delete", month }, (k) => toast(`Deleted ${k} transaction${k === 1 ? "" : "s"}`));
  };

  const deleteBatch = async (t: Tx) => {
    if (!t.import_batch || !(await askConfirm("Delete every transaction from this import? This can't be undone."))) return;
    bulk({ action: "delete", batch: t.import_batch }, (k) => toast(`Deleted ${k} transaction${k === 1 ? "" : "s"}`));
  };

  const moveAll = () => {
    const target = moveTo || monthShift(month, 1);
    const toDates = target === "dates";
    bulk({ action: "move", month, budget_month: toDates ? null : target }, (k) => {
      if (toDates) toast(`${k} transaction${k === 1 ? "" : "s"} back to their purchase months`);
      else toast(`Moved ${k} to ${monthLabel(target)}`, { label: "View", run: () => view(target) });
    });
  };

  const txs = (sum?.transactions ?? []).filter((t) => !hidden.includes(t.id));
  const shownTxs = showAll ? txs : txs.slice(0, FIRST_ROWS);
  const batchSizes = new Map<string, number>();
  for (const t of txs) if (t.import_batch) batchSizes.set(t.import_batch, (batchSizes.get(t.import_batch) ?? 0) + 1);
  const anyMoved = txs.some(isMoved);
  const pieData = (sum?.categories ?? []).filter((c) => c.spent > 0)
    .map((c) => ({ name: catLabel(c.category), value: c.spent }));
  const income = sum?.income ?? 0;

  return (
    <section className="panel flex flex-col">
      <div className="panel-head">
        <div className="flex items-center gap-0.5">
          <button className="btn !min-h-10 !min-w-10 !px-2" aria-label="Previous month"
                  onClick={() => setMonth(monthShift(month, -1))}>
            <ChevronLeft size={14} />
          </button>
          <span className="min-w-[4.5rem] text-center text-[13px] font-semibold text-txt tabular-nums" aria-live="polite">{monthLabel(month)}</span>
          <button className="btn !min-h-10 !min-w-10 !px-2" aria-label="Next month"
                  onClick={() => setMonth(monthShift(month, 1))}>
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button className="btn !min-h-10" onClick={() => setImporting(true)}>
            <FileUp size={13} />Import
          </button>
          <button className="btn btn-primary !min-h-10" aria-expanded={adding} onClick={() => setAdding(!adding)}>
            <Plus size={13} strokeWidth={3} />Add
          </button>
        </div>
      </div>

      {adding && (
        <AddForm month={month} recent={sum?.recent_income ?? []} onClose={() => setAdding(false)} onAdded={onAdded} />
      )}

      {/* Month verdict */}
      <div className="grid grid-cols-4 divide-x divide-edge border-b border-edge text-center">
        <div className="py-2">
          <div className="text-[9px] text-dim uppercase tracking-widest">In</div>
          <div className="text-sm font-bold text-up tabular-nums">{fmtUsd(income)}</div>
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
          {income > 0 ? (
            <div className={`text-sm font-bold tabular-nums ${
              (sum?.savings_rate ?? 0) >= 50 ? "text-up" : (sum?.savings_rate ?? 0) >= 20 ? "text-amber" : "text-down"
            }`}>
              {sum?.savings_rate ?? 0}%
            </div>
          ) : (
            <div className="text-sm font-bold text-faint" title="No income this month">—</div>
          )}
        </div>
      </div>

      {pieData.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%"
                     paddingAngle={3} stroke="none" isAnimationActive={false}>
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "var(--color-panel2)", border: "1px solid var(--color-edge)", borderRadius: 10, fontSize: 11, color: "var(--color-txt)" }}
                  itemStyle={{ color: "var(--color-txt)" }}
                  formatter={(v, name) => [fmtUsd(Number(v)), String(name)]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Spent per category, colored like the donut */}
          <ul className="space-y-1 min-w-0 self-center">
            {(sum?.categories ?? []).filter((c) => c.spent > 0).map((c, i) => {
              const over = c.limit !== null && c.spent > c.limit;
              return (
                <li key={c.category} className="flex items-center gap-2 text-[12px] min-w-0 min-h-6">
                  <span className="h-2 w-2 rounded-full shrink-0" aria-hidden
                        style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="min-w-0 flex-1 truncate text-txt">{catLabel(c.category)}</span>
                  {over && <span className="shrink-0 text-[10px] text-down font-bold">Over</span>}
                  <span className={`shrink-0 tabular-nums ${over ? "text-down font-bold" : "text-dim"}`}>{fmtUsd(c.spent)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Transactions */}
      <div className="flex items-center justify-between gap-2 pl-3 pr-1 min-h-11 border-t border-edge">
        <h3 className="text-[13px] font-semibold text-txt">
          Transactions {sum && <span className="text-faint font-normal tabular-nums">{txs.length}</span>}
        </h3>
        {txs.length > 0 && (
          <button className="min-h-10 px-3 text-[13px] font-semibold text-up rounded focus-visible:outline-2 focus-visible:outline-up"
                  aria-expanded={manage} onClick={() => { setManage(!manage); setEditId(null); }}>
            {manage ? "Done" : "Edit"}
          </button>
        )}
      </div>

      {manage && txs.length > 0 && (
        <div className="px-3 pb-3 pt-1 space-y-2 bg-panel2 border-t border-edge">
          <div className="flex items-end gap-2">
            <label className="field-wrap flex-1"><span className="field-label">Count all {txs.length} in</span>
              <select className="field" value={moveTo || monthShift(month, 1)} onChange={(e) => setMoveTo(e.target.value)}>
                <option value={monthShift(month, -1)}>{monthLabel(monthShift(month, -1))}</option>
                <option value={monthShift(month, 1)}>{monthLabel(monthShift(month, 1))}</option>
                <option value={monthShift(month, 2)}>{monthLabel(monthShift(month, 2))}</option>
                {anyMoved && <option value="dates">Their purchase months</option>}
              </select>
            </label>
            <button className="btn !min-h-10 shrink-0" onClick={moveAll}>Move</button>
          </div>
          <p className="text-[11px] text-dim">For a card bill you pay next month. Purchase dates stay the same.</p>
          <button className="min-h-10 inline-flex items-center gap-1.5 text-[13px] font-semibold text-down rounded focus-visible:outline-2 focus-visible:outline-up"
                  onClick={deleteAll}>
            <Trash2 size={14} aria-hidden />Delete all {txs.length} in {monthLabel(month, { bare: true })}
          </button>
        </div>
      )}

      {sum && txs.length === 0 && (
        <p className="px-3 pb-4 pt-1 text-[12px] text-dim">
          Nothing in {monthLabel(month, { long: true })} yet. Add one, or import a statement or screenshots.
        </p>
      )}

      <ul aria-label="Transactions">
        {shownTxs.map((t) => {
          const plus = isPlus(t);
          const open = editId === t.id;
          const sub = [catLabel(t.kind === "income" ? "income" : t.category) + (t.kind === "expense" && t.amount < 0 ? " refund" : ""),
                       dayLabel(t.date)];
          return (
            <li key={t.id} className="border-t border-edge">
              <SwipeRow label={`Delete ${t.merchant}`} onDelete={() => remove(t)}
                        className="flex items-center hover:bg-panel2">
                <button className="flex-1 min-w-0 flex items-center gap-3 pl-3 pr-3 [@media(hover:hover)]:pr-1 py-2 min-h-[52px] text-left
                                   focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-up"
                        aria-expanded={open} onClick={() => setEditId(open ? null : t.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-txt truncate">{t.merchant || "—"}</span>
                    <span className="block text-[11px] text-dim truncate tabular-nums">
                      {sub.join(" · ")}
                      {isMoved(t) && <span className="text-cyan"> · counted in {monthLabel(t.month, { bare: true })}</span>}
                    </span>
                  </span>
                  <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${plus ? "text-up" : "text-txt"}`}>
                    {plus ? "+" : ""}{fmtCents(Math.abs(t.amount))}
                  </span>
                </button>
              </SwipeRow>
              {open && (
                <TxEditor key={t.id} t={t} batchSize={t.import_batch ? batchSizes.get(t.import_batch) ?? 1 : 0}
                          onCancel={() => setEditId(null)}
                          onSaved={(moved) => {
                            setEditId(null);
                            changed();
                            if (moved && moved !== month) toast(`Now counted in ${monthLabel(moved)}`, { label: "View", run: () => view(moved) });
                          }}
                          onDelete={() => remove(t)}
                          onDeleteBatch={() => deleteBatch(t)} />
              )}
            </li>
          );
        })}
      </ul>
      {txs.length > shownTxs.length && (
        <button className="min-h-11 border-t border-edge text-[13px] text-up font-semibold focus-visible:outline-2 focus-visible:outline-up"
                onClick={() => setShowAll(true)}>
          Show all {txs.length}
        </button>
      )}

      {importing && <ImportStatement onClose={() => setImporting(false)} onDone={onImported} />}
    </section>
  );
}
