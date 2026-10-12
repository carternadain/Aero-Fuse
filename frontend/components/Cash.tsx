"use client";

// Cash: your checking balance, kept current from paychecks, bills and what you spend.
// One big number, a few quick actions, what's coming up, and the monthly plan behind it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, ArrowUpRight, ChevronRight, Minus, Pencil, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { budgetChanged, haptic, navigate, toast } from "@/lib/bus";
import { catLabel, dayLabel, EXPENSE_CATS, localToday, monthLabel } from "@/lib/categories";
import { fmtCents, fmtQty, usePrivacy } from "@/lib/privacy";
import { parseAmount } from "./AutoInvest";
import { CashInvestPrompt } from "./CashInvestPrompt";
import CashItemSheet from "./CashItemSheet";
import CashImport from "./CashImport";
import Skeleton from "./Skeleton";
import {
  apiError, FieldError, money, scheduleText, Sheet, signedMoney, upcomingDate,
  type CashItem, type CashPayload, type ItemType,
} from "./cashShared";

const GROUPS: { type: ItemType; title: string }[] = [
  { type: "income", title: "Income" }, { type: "bill", title: "Bills" }, { type: "debt", title: "Debts" },
  { type: "invest", title: "Investing" }, { type: "save", title: "Savings" },
];
const UNDOABLE = new Set(["transfer", "invest", "adjust"]);
const FREQ_WORD: Record<string, string> = { weekly: "Weekly", biweekly: "Every other week", monthly: "Monthly" };

/** Allows 0 and negatives (a balance can be either). */
function parseBalance(raw: string): { value: number; error: null } | { value: null; error: string } {
  const t = raw.trim().replace(/^(−|-)?\s*\$\s*/, "$1").replace(/,/g, "").replace(/\s+/g, "").replace("−", "-");
  if (!t) return { value: null, error: "Enter a balance, like $2,400." };
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return { value: null, error: "Use numbers only, like $2,400.50." };
  return { value: Math.round(Number(t) * 100) / 100, error: null };
}

type SheetState =
  | { k: "spent" } | { k: "paid" } | { k: "move" } | { k: "balance" } | { k: "import" }
  | { k: "item"; item: CashItem | null; type?: ItemType };

export default function Cash() {
  usePrivacy(); // re-render when balances are hidden/shown
  const [d, setD] = useState<CashPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [allUpcoming, setAllUpcoming] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    return api.get<CashPayload>("/api/cash").then(setD).catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const close = () => setSheet(null);
  const saved = (p: CashPayload) => { setD(p); setSheet(null); };

  if (!d) {
    return failed ? (
      <div className="max-w-xl rounded-2xl border border-edge bg-panel p-4 flex items-center gap-3">
        <p className="flex-1 text-[14px] text-dim">Couldn&apos;t load your cash.</p>
        <button className="btn !min-h-10" onClick={load}>Retry</button>
      </div>
    ) : (
      <div className="max-w-xl space-y-5" aria-busy="true" aria-label="Loading cash">
        <div className="space-y-2.5 pt-1"><Skeleton className="h-3 w-20 rounded" /><Skeleton className="h-9 w-48 rounded-lg" /><Skeleton className="h-3 w-64 rounded" /></div>
        <div className="grid grid-cols-3 gap-2"><Skeleton className="h-11 rounded-[10px]" /><Skeleton className="h-11 rounded-[10px]" /><Skeleton className="h-11 rounded-[10px]" /></div>
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    );
  }

  if (d.setup.account_id == null || !d.cash) {
    return (
      <div className="max-w-xl">
        <Setup d={d} onDone={setD} onImport={() => setSheet({ k: "import" })} />
        {sheet?.k === "import" && <CashImport onClose={close} onDone={saved} />}
      </div>
    );
  }

  const cash = d.cash;
  const waiting = d.to_invest.filter((t) => !t.snoozed);
  const upcoming = allUpcoming ? d.upcoming : d.upcoming.slice(0, 5);
  const monthName = new Date().toLocaleDateString("en-US", { month: "long" });
  const short = d.month_end != null && d.month_end < 0;

  const done = async (msg: string) => {
    haptic();
    budgetChanged();
    toast(msg);
    setSheet(null);
    await load();
  };

  const undo = (id: number) => {
    api.del<CashPayload>(`/api/cash/moves/${id}`)
      .then((p) => { setD(p); toast("Undone"); })
      .catch((e) => toast(apiError(e)));
  };

  return (
    <div className="max-w-xl space-y-6">
      {/* hero */}
      <div className="pt-1">
        <div className="text-[13px] font-semibold text-dim">{cash.name}</div>
        <button onClick={() => { haptic(); setSheet({ k: "balance" }); }} aria-label={`${cash.name} balance ${fmtCents(cash.balance)}. Tap to correct it`}
                className="group mt-0.5 -ml-1 px-1 min-h-11 flex items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-up">
          <span className={`font-display text-[34px] leading-none font-bold tabular-nums ${cash.balance < 0 ? "text-warn" : "text-txt"}`}>{fmtCents(cash.balance)}</span>
          <Pencil size={14} aria-hidden className="text-faint group-hover:text-dim" />
        </button>
        <p className="text-[13px] text-dim leading-snug mt-1">Updates itself from paychecks, bills and what you spend</p>
        {d.month_end != null && !short && (
          <p className="text-[13px] text-dim leading-snug mt-0.5 tabular-nums">About {money(d.month_end)} by the end of {monthName}</p>
        )}
        {short && (
          <p role="status" className="text-[13px] text-warn leading-snug mt-1 tabular-nums">
            Heads up: you could be {money(-(d.month_end ?? 0))} short by the end of {monthName}.
          </p>
        )}
      </div>

      {/* quick actions */}
      <div className="grid grid-cols-3 gap-2">
        <button className="btn !min-h-11 !text-[14px] gap-1.5" onClick={() => { haptic(); setSheet({ k: "spent" }); }}><Minus size={15} strokeWidth={2.6} aria-hidden />Spent</button>
        <button className="btn !min-h-11 !text-[14px] gap-1.5" onClick={() => { haptic(); setSheet({ k: "paid" }); }}><Plus size={15} strokeWidth={2.6} aria-hidden />Got paid</button>
        <button className="btn !min-h-11 !text-[14px] gap-1.5" onClick={() => { haptic(); setSheet({ k: "move" }); }}><ArrowLeftRight size={15} strokeWidth={2.4} aria-hidden />Move</button>
      </div>

      {waiting.length > 0 && (
        <div className="space-y-3">
          {waiting.map((t) => <CashInvestPrompt key={t.account_id} entry={t} onDone={(p) => (p ? setD(p) : load())} />)}
        </div>
      )}

      {/* coming up */}
      {d.upcoming.length > 0 && (
        <section aria-labelledby="cash-up-h">
          <h3 id="cash-up-h" className="text-[13px] font-semibold text-dim px-1 pb-1.5">Coming up</h3>
          <ul className="rounded-2xl border border-edge bg-panel divide-y divide-edge overflow-hidden">
            {upcoming.map((u, i) => (
              <li key={`${u.item_id}-${u.date}-${i}`} className="flex items-center gap-3 px-4 min-h-[56px] py-2">
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] text-txt truncate">{u.name}</span>
                  <span className="block text-[12px] text-dim mt-0.5">{upcomingDate(u.date)}</span>
                </span>
                <span className={`shrink-0 text-[15px] font-semibold tabular-nums ${u.signed > 0 ? "text-up" : "text-txt"}`}>{signedMoney(u.signed)}</span>
              </li>
            ))}
          </ul>
          {d.upcoming.length > 5 && (
            <button className="mt-1 min-h-10 px-1 text-[13px] font-semibold text-up rounded-lg focus-visible:outline-2 focus-visible:outline-up" onClick={() => setAllUpcoming((v) => !v)}>
              {allUpcoming ? "Show fewer" : `Show all ${d.upcoming.length}`}
            </button>
          )}
        </section>
      )}

      {/* the plan */}
      <section aria-labelledby="cash-plan-h" className="space-y-3">
        <div className="flex items-center px-1">
          <h3 id="cash-plan-h" className="flex-1 text-[13px] font-semibold text-dim">Every month</h3>
          <button className="min-h-10 px-2 -mr-2 inline-flex items-center gap-1 text-[13px] font-semibold text-up rounded-lg focus-visible:outline-2 focus-visible:outline-up"
                  onClick={() => { haptic(); setSheet({ k: "item", item: null }); }}>
            <Plus size={14} strokeWidth={2.8} aria-hidden />Add
          </button>
        </div>

        {d.items.length === 0 && d.autoinvest.length === 0 ? (
          <p className="rounded-2xl border border-edge bg-panel px-4 py-5 text-[14px] text-dim leading-snug">
            Nothing planned yet. Add your paychecks and bills and they&apos;ll move your balance on their own.
          </p>
        ) : (
          GROUPS.map((g) => {
            const rows = d.items.filter((it) => it.type === g.type);
            const rules = g.type === "invest" ? d.autoinvest : [];
            if (!rows.length && !rules.length) return null;
            return (
              <div key={g.type}>
                <h4 className="text-[12px] font-semibold text-faint px-1 pb-1">{g.title}</h4>
                <ul className="rounded-2xl border border-edge bg-panel divide-y divide-edge overflow-hidden">
                  {rows.map((it) => <PlanRow key={it.id} it={it} onOpen={() => { haptic(); setSheet({ k: "item", item: it }); }} />)}
                  {rules.map((r) => (
                    <li key={`ai-${r.rule_id}`}>
                      <button onClick={() => { haptic(); navigate({ tab: "wealth", anchor: "sec-autoinvest" }); }}
                              className="w-full min-h-[56px] flex items-center gap-3 px-4 py-2 text-left active:bg-panel2 [@media(hover:hover)]:hover:bg-panel2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-up">
                        <span className="flex-1 min-w-0">
                          <span className="block text-[15px] text-txt truncate">{r.symbol}</span>
                          <span className="block text-[12px] text-dim mt-0.5">Auto-invest · {FREQ_WORD[r.frequency] ?? r.frequency}</span>
                        </span>
                        <span className="shrink-0 text-[15px] font-semibold tabular-nums text-txt">{money(r.amount)}</span>
                        <ArrowUpRight size={15} className="shrink-0 text-faint" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}

        {(d.items.length > 0 || d.autoinvest.length > 0) && (
          <p className="px-1 pt-1 text-[14px] text-dim tabular-nums">
            {d.month.spending > 0 && <>After {money(d.month.spending)} budgeted for groceries and day-to-day spending. </>}
            Left after everything:{" "}
            <span className={`font-semibold ${d.month.left >= 0 ? "text-up" : "text-warn"}`}>{money(d.month.left)} a month</span>
          </p>
        )}
      </section>

      {/* recent */}
      {d.recent.length > 0 && (
        <section aria-labelledby="cash-recent-h">
          <h3 id="cash-recent-h" className="text-[13px] font-semibold text-dim px-1 pb-1.5">Recent</h3>
          <ul className="rounded-2xl border border-edge bg-panel divide-y divide-edge overflow-hidden">
            {d.recent.slice(0, 8).map((r) => (
              <li key={`${r.id}-${r.date}`} className="flex items-center gap-2 pl-4 pr-2 min-h-[56px] py-2">
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] text-txt truncate">{r.name}</span>
                  <span className="block text-[12px] text-dim mt-0.5 tabular-nums truncate">
                    {dayLabel(r.date)}{r.symbol && r.qty ? ` · ${fmtQty(r.qty, 4)} ${r.symbol}` : ""}
                  </span>
                </span>
                <span className={`shrink-0 text-[15px] font-semibold tabular-nums ${r.signed > 0 ? "text-up" : "text-txt"}`}>{signedMoney(r.signed)}</span>
                {r.move_id != null && UNDOABLE.has(r.kind) && (
                  <button className="shrink-0 min-h-10 px-2.5 rounded-lg text-[13px] font-semibold text-dim hover:text-txt hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-up"
                          onClick={() => { haptic(); undo(r.move_id!); }} aria-label={`Undo ${r.name}`}>Undo</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="px-1">
        <button className="min-h-10 text-[13px] font-semibold text-dim hover:text-txt rounded-lg focus-visible:outline-2 focus-visible:outline-up" onClick={() => setSheet({ k: "import" })}>
          Import a plan file
        </button>
      </div>

      {sheet?.k === "spent" && <EntrySheet mode="spent" d={d} onClose={close} onDone={done} />}
      {sheet?.k === "paid" && <EntrySheet mode="paid" d={d} onClose={close} onDone={done} />}
      {sheet?.k === "move" && <MoveSheet d={d} onClose={close} onDone={(p, msg) => { setD(p); haptic(); toast(msg); setSheet(null); }} />}
      {sheet?.k === "balance" && <BalanceSheet d={d} onClose={close} onDone={(p) => { haptic(); toast("Balance updated"); saved(p); }} />}
      {sheet?.k === "item" && <CashItemSheet item={sheet.item} defaultType={sheet.type} accounts={d.accounts} onClose={close} onSaved={saved} />}
      {sheet?.k === "import" && <CashImport onClose={close} onDone={saved} />}
    </div>
  );
}

function PlanRow({ it, onOpen }: { it: CashItem; onOpen: () => void }) {
  const bits = [scheduleText(it)];
  const debt = it.type === "debt" && it.account_balance != null
    ? `${money(Math.abs(it.account_balance))} left${it.payoff ? ` · paid off ~${monthLabel(it.payoff.date)}` : ""}` : null;
  return (
    <li>
      <button onClick={onOpen}
              className="w-full min-h-[56px] flex items-center gap-3 px-4 py-2 text-left active:bg-panel2 [@media(hover:hover)]:hover:bg-panel2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-up">
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 text-[15px] leading-tight">
            <span className={`truncate ${it.paused ? "text-dim" : "text-txt"}`}>{it.name}</span>
            {!!it.paused && <span className="shrink-0 text-[10px] font-bold text-amber bg-amber/15 rounded px-1.5 py-0.5">Paused</span>}
          </span>
          <span className="block text-[12px] text-dim mt-1 leading-snug tabular-nums">{bits.join(" · ")}</span>
          {debt && <span className="block text-[12px] text-dim leading-snug tabular-nums">{debt}</span>}
        </span>
        <span className={`shrink-0 text-[15px] font-semibold tabular-nums ${it.paused ? "text-dim" : it.type === "income" ? "text-up" : "text-txt"}`}>
          {it.varies ? "~" : ""}{money(it.amount)}
        </span>
        <ChevronRight size={15} className="shrink-0 text-faint -mr-1" aria-hidden />
      </button>
    </li>
  );
}

// ── first-run setup ──

function Setup({ d, onDone, onImport }: { d: CashPayload; onDone: (p: CashPayload) => void; onImport: () => void }) {
  const assets = d.accounts.filter((a) => a.kind === "asset").sort((a, b) => Number(b.category === "cash") - Number(a.category === "cash"));
  const first = assets.find((a) => a.category === "cash");
  const [sel, setSel] = useState<string>(first ? String(first.id) : "new");
  const [name, setName] = useState("Checking");
  const [bal, setBal] = useState(first ? String(first.balance) : "");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const creating = sel === "new";
  const b = parseBalance(bal);
  const nameErr = creating && !name.trim() ? "Give the account a name." : null;

  const pick = (v: string) => {
    setSel(v);
    const a = assets.find((x) => String(x.id) === v);
    setBal(a ? String(a.balance) : "");
  };
  const go = async () => {
    setTried(true);
    if (b.error || nameErr || busy) return;
    setBusy(true); setErr(null);
    try {
      const p = await api.put<CashPayload>("/api/cash/setup", {
        account_id: creating ? null : Number(sel), new_account_name: creating ? name.trim() : null, balance: b.value,
      });
      haptic();
      onDone(p);
    } catch (e) { setErr(apiError(e)); setBusy(false); }
  };

  return (
    <section className="rounded-2xl border border-edge bg-panel p-4 space-y-4" aria-labelledby="cash-setup-h">
      <div>
        <h2 id="cash-setup-h" className="text-[20px] font-bold text-txt leading-tight">Keep your cash up to date</h2>
        <p className="text-[14px] text-dim leading-snug mt-1.5">
          Tell us where your paychecks land and what&apos;s in it today. After that it moves on its own with paychecks, bills and anything you log as spent.
        </p>
      </div>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); go(); }} noValidate>
        <label className="field-wrap">
          <span className="field-label">Account</span>
          <select className="field" value={sel} onChange={(e) => pick(e.target.value)}>
            {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            <option value="new">New account</option>
          </select>
        </label>
        {creating && (
          <label className="field-wrap">
            <span className="field-label">Name</span>
            <input className="field" placeholder="Checking" autoComplete="off" value={name} aria-invalid={tried && !!nameErr} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <FieldError msg={tried ? nameErr : null} />
        <label className="field-wrap">
          <span className="field-label">What&apos;s in it right now</span>
          <input className="field tabular-nums" inputMode="decimal" placeholder="$0" autoComplete="off" value={bal} aria-invalid={tried && !!b.error} onChange={(e) => setBal(e.target.value)} />
        </label>
        <FieldError msg={tried ? b.error : null} />
        <FieldError msg={err} />
        <button type="submit" disabled={busy} className="btn btn-primary w-full !min-h-11 !text-[15px] disabled:opacity-40">{busy ? "Saving…" : "Start tracking"}</button>
      </form>
      <div className="border-t border-edge pt-3">
        <button className="min-h-10 text-[14px] font-semibold text-up rounded-lg focus-visible:outline-2 focus-visible:outline-up" onClick={onImport}>Import a plan file</button>
        <p className="text-[12px] text-dim leading-snug">Already have your paychecks and bills in a file? Bring them in all at once.</p>
      </div>
    </section>
  );
}

// ── sheets ──

function EntrySheet({ mode, d, onClose, onDone }: {
  mode: "spent" | "paid"; d: CashPayload; onClose: () => void; onDone: (msg: string) => void | Promise<void>;
}) {
  const spent = mode === "spent";
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("food");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(localToday());
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = parseAmount(amount);
  const dateErr = date ? null : "Pick a date.";

  const save = async () => {
    setTried(true);
    if (a.value == null || dateErr || busy) return;
    setBusy(true); setErr(null);
    try {
      await api.post("/api/transactions", {
        date, category: spent ? category : "income", amount: a.value, kind: spent ? "expense" : "income", note: note.trim(),
      });
      await onDone(spent ? `Took ${money(a.value)} out of ${d.cash?.name ?? "cash"}` : `Added ${money(a.value)} to ${d.cash?.name ?? "cash"}`);
    } catch (e) { setErr(apiError(e)); setBusy(false); }
  };

  return (
    <Sheet title={spent ? "What did you spend?" : "Got paid"} onClose={onClose}>
      <form className="px-4 space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <label className="field-wrap">
          <span className="field-label">Amount</span>
          <input className="field tabular-nums !text-[22px] !py-2.5 font-display" inputMode="decimal" placeholder="$0" autoComplete="off" autoFocus enterKeyHint="next"
                 value={amount} aria-invalid={tried && !!a.error} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <FieldError msg={tried ? a.error : null} />
        {spent && (
          <label className="field-wrap">
            <span className="field-label">Category</span>
            <select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
              {EXPENSE_CATS.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
            </select>
          </label>
        )}
        <label className="field-wrap">
          <span className="field-label">Note (optional)</span>
          <input className="field" autoComplete="off" enterKeyHint="next" placeholder={spent ? "Coffee, groceries…" : "Paycheck"} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="field-wrap">
          <span className="field-label">Date</span>
          <input type="date" className="field tabular-nums" value={date} aria-invalid={tried && !!dateErr} onChange={(e) => setDate(e.target.value)} />
        </label>
        <FieldError msg={tried ? dateErr : null} />
        <FieldError msg={err} />
        <button type="submit" disabled={busy} className="btn btn-primary w-full !min-h-11 !text-[15px] disabled:opacity-40">
          {busy ? "Saving…" : spent ? "Log it" : "Add it"}
        </button>
      </form>
    </Sheet>
  );
}

function MoveSheet({ d, onClose, onDone }: { d: CashPayload; onClose: () => void; onDone: (p: CashPayload, msg: string) => void }) {
  const assets = useMemo(() => d.accounts.filter((a) => a.kind === "asset"), [d.accounts]);
  const [from, setFrom] = useState(String(d.cash?.id ?? assets[0]?.id ?? ""));
  const [to, setTo] = useState(() => {
    const others = assets.filter((a) => a.id !== d.cash?.id);
    return String((others.find((a) => /sav/i.test(a.name)) ?? others[0])?.id ?? "");
  });
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = parseAmount(amount);
  const accErr = !from || !to ? "Pick both accounts." : from === to ? "Pick two different accounts." : null;

  const save = async () => {
    setTried(true);
    if (a.value == null || accErr || busy) return;
    setBusy(true); setErr(null);
    try {
      const p = await api.post<CashPayload>("/api/cash/move", { from_account_id: Number(from), to_account_id: Number(to), amount: a.value, note: note.trim() || undefined });
      const toName = assets.find((x) => String(x.id) === to)?.name ?? "that account";
      onDone(p, `Moved ${money(a.value)} to ${toName}`);
    } catch (e) { setErr(apiError(e)); setBusy(false); }
  };

  return (
    <Sheet title="Move money" onClose={onClose}>
      <form className="px-4 space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <label className="field-wrap">
          <span className="field-label">Amount</span>
          <input className="field tabular-nums !text-[22px] !py-2.5 font-display" inputMode="decimal" placeholder="$0" autoComplete="off" autoFocus
                 value={amount} aria-invalid={tried && !!a.error} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <FieldError msg={tried ? a.error : null} />
        <div className="grid grid-cols-2 gap-3">
          <label className="field-wrap">
            <span className="field-label">From</span>
            <select className="field" value={from} onChange={(e) => setFrom(e.target.value)}>
              {assets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <label className="field-wrap">
            <span className="field-label">To</span>
            <select className="field" value={to} onChange={(e) => setTo(e.target.value)}>
              {!to && <option value="">Choose one</option>}
              {assets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        </div>
        <FieldError msg={tried ? accErr : null} />
        <label className="field-wrap">
          <span className="field-label">Note (optional)</span>
          <input className="field" autoComplete="off" enterKeyHint="done" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <FieldError msg={err} />
        <button type="submit" disabled={busy} className="btn btn-primary w-full !min-h-11 !text-[15px] disabled:opacity-40">{busy ? "Moving…" : "Move it"}</button>
      </form>
    </Sheet>
  );
}

function BalanceSheet({ d, onClose, onDone }: { d: CashPayload; onClose: () => void; onDone: (p: CashPayload) => void }) {
  const [bal, setBal] = useState(String(d.cash?.balance ?? ""));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const b = parseBalance(bal);

  const save = async () => {
    setTried(true);
    if (b.value == null || busy || !d.cash) return;
    setBusy(true); setErr(null);
    try { onDone(await api.post<CashPayload>("/api/cash/balance", { account_id: d.cash.id, balance: b.value })); }
    catch (e) { setErr(apiError(e)); setBusy(false); }
  };

  return (
    <Sheet title="Correct your balance" onClose={onClose}>
      <form className="px-4 space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <p className="text-[13px] text-dim leading-snug">Bank says something different? Set the real balance.</p>
        <label className="field-wrap">
          <span className="field-label">{d.cash?.name} balance</span>
          <input className="field tabular-nums !text-[22px] !py-2.5 font-display" inputMode="decimal" autoComplete="off" autoFocus
                 value={bal} aria-invalid={tried && !!b.error} onChange={(e) => setBal(e.target.value)} />
        </label>
        <FieldError msg={tried ? b.error : null} />
        <FieldError msg={err} />
        <button type="submit" disabled={busy} className="btn btn-primary w-full !min-h-11 !text-[15px] disabled:opacity-40">{busy ? "Saving…" : "Save balance"}</button>
      </form>
    </Sheet>
  );
}
