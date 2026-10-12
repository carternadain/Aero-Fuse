"use client";

// Add or edit one thing in the monthly plan: a paycheck, bill, loan payment, or a regular
// transfer to savings / investing.

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { haptic } from "@/lib/bus";
import { catLabel, EXPENSE_CATS, localToday } from "@/lib/categories";
import { usePrivacy } from "@/lib/privacy";
import { parseAmount } from "./AutoInvest";
import {
  apiError, FieldError, ordinal, parseDay, Seg, Sheet, Toggle, weekdayIdx,
  type CashAccount, type CashItem, type CashPayload, type Frequency, type ItemType,
} from "./cashShared";

const TYPES: [ItemType, string][] = [["income", "Income"], ["bill", "Bill"], ["debt", "Debt"], ["save", "Savings"], ["invest", "Invest"]];
const FREQS: [Frequency, string][] = [
  ["weekly", "Weekly"], ["biweekly", "Every 2 weeks"], ["semimonthly", "Twice a month"],
  ["monthly", "Monthly"], ["every_n_months", "Every few months"], ["once", "One time"],
];
const WD = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const NEW = "new";

const copy: Record<ItemType, { name: string; ph: string; amount: string }> = {
  income: { name: "Name", ph: "Paycheck", amount: "Amount per payment" },
  bill: { name: "Name", ph: "Rent", amount: "Amount" },
  debt: { name: "Name", ph: "Student loan payment", amount: "Payment" },
  save: { name: "Name", ph: "Move to savings", amount: "Amount" },
  invest: { name: "Name", ph: "Weekly to Robinhood", amount: "Amount" },
};

const addDays = (iso: string, n: number) => {
  const d = parseDay(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

interface Form {
  name: string; type: ItemType; amount: string; varies: boolean; frequency: Frequency; interval: string;
  day: number; day2: number; start: string; end: string; category: string; account: string; paused: boolean;
  newName: string; newBalance: string; newKind: "loan" | "credit_card"; rate: string;
}

function initial(item: CashItem | null, type: ItemType): Form {
  const today = localToday();
  if (item) return {
    name: item.name, type: item.type, amount: String(item.amount), varies: !!item.varies, frequency: item.frequency,
    interval: String(item.interval ?? 2), day: item.day ?? parseDay(item.start_date).getDate(), day2: item.day2 ?? 20,
    start: item.start_date, end: item.end_date ?? "", category: item.category ?? "other",
    account: item.account_id != null ? String(item.account_id) : "", paused: !!item.paused,
    newName: "", newBalance: "", newKind: "loan", rate: "",
  };
  return {
    name: "", type, amount: "", varies: false, frequency: "monthly", interval: "2",
    day: parseDay(today).getDate(), day2: 15, start: today, end: "", category: "other", account: "", paused: false,
    newName: "", newBalance: "", newKind: "loan", rate: "",
  };
}

export default function CashItemSheet({ item, defaultType = "income", accounts, onClose, onSaved }: {
  item: CashItem | null; defaultType?: ItemType; accounts: CashAccount[];
  onClose: () => void; onSaved: (p: CashPayload) => void;
}) {
  usePrivacy();
  const isNew = !item;
  const [f, setF] = useState<Form>(() => {
    const base = initial(item, defaultType);
    // an existing debt shows its current rate
    if (item?.type === "debt") base.rate = String(accounts.find((a) => a.id === item.account_id)?.rate ?? "");
    return base;
  });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [extra, setExtra] = useState<CashAccount[]>([]); // accounts made in this sheet (kept if the save fails)

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((c) => ({ ...c, [k]: v }));
  const all = useMemo(() => [...accounts, ...extra], [accounts, extra]);
  const wantsLiab = f.type === "debt";
  const needsAccount = f.type === "debt" || f.type === "save" || f.type === "invest";
  const pool = all.filter((a) => (wantsLiab ? a.kind === "liability" : a.kind === "asset") && a.id !== undefined);
  const creating = needsAccount && (f.account === NEW || (!f.account && pool.length === 0));
  const weekly = f.frequency === "weekly" || f.frequency === "biweekly";
  const monthDays = Array.from({ length: 31 }, (_, i) => i + 1);

  const setType = (t: ItemType) => setF((c) => ({ ...c, type: t, account: "" }));
  const setFreq = (fr: Frequency) => setF((c) => ({
    ...c, frequency: fr,
    day: fr === "weekly" || fr === "biweekly" ? weekdayIdx(c.start) : (c.frequency === "weekly" || c.frequency === "biweekly" ? parseDay(c.start).getDate() : c.day),
  }));
  // the first date and the weekday move together, since every-other-week counts from the first date
  const setStart = (v: string) => setF((c) => ({
    ...c, start: v,
    day: !v ? c.day : (c.frequency === "weekly" || c.frequency === "biweekly") ? weekdayIdx(v) : c.frequency === "monthly" || c.frequency === "every_n_months" ? parseDay(v).getDate() : c.day,
  }));
  const setWeekday = (w: number) => setF((c) => {
    const diff = (w - weekdayIdx(c.start) + 7) % 7;
    return { ...c, day: w, start: diff ? addDays(c.start, diff) : c.start };
  });

  const amt = parseAmount(f.amount);
  const intervalN = Number(f.interval);
  const rateN = f.rate.trim() === "" ? null : Number(f.rate.replace(/%/g, ""));
  const newBal = f.newBalance.trim() === "" ? 0 : Number(f.newBalance.replace(/[$,\s]/g, ""));
  const errs = {
    name: f.name.trim() ? null : "Give it a name, like Rent.",
    amount: amt.error,
    interval: f.frequency === "every_n_months" && !(Number.isInteger(intervalN) && intervalN >= 2 && intervalN <= 24) ? "Enter a number of months from 2 to 24." : null,
    start: f.start ? null : "Pick a start date.",
    end: f.end && f.start && f.end < f.start ? "The end date has to be after the start date." : null,
    days: f.frequency === "semimonthly" && f.day === f.day2 ? "Pick two different days." : null,
    account: needsAccount && !creating && !f.account ? (wantsLiab ? "Pick the loan or card this pays." : "Pick where the money goes.") : null,
    newName: creating && !f.newName.trim() ? "Name the new account." : null,
    newBal: creating && Number.isNaN(newBal) ? "Use numbers only for the balance." : null,
    rate: wantsLiab && rateN != null && (Number.isNaN(rateN) || rateN < 0 || rateN > 100) ? "Enter the yearly rate as a number, like 5.5." : null,
  };
  const firstErr = Object.values(errs).find(Boolean) ?? null;
  const show = (k: keyof typeof errs) => (tried ? errs[k] : null);

  const save = async () => {
    if (busy) return;
    setTried(true);
    if (firstErr) return;
    setBusy(true); setErr(null);
    try {
      let accountId: number | null = f.account && f.account !== NEW ? Number(f.account) : null;
      if (creating) {
        const created = await api.post<{ id: number }>("/api/accounts", {
          name: f.newName.trim(),
          kind: wantsLiab ? "liability" : "asset",
          category: wantsLiab ? f.newKind : f.type === "invest" ? "brokerage" : "cash",
          balance: newBal || 0,
        });
        accountId = created.id;
        setExtra((x) => [...x, { id: created.id, name: f.newName.trim(), kind: wantsLiab ? "liability" : "asset",
          category: wantsLiab ? f.newKind : "cash", balance: newBal || 0, rate: null }]);
        setF((c) => ({ ...c, account: String(created.id) }));
      }
      if (wantsLiab && accountId != null) {
        const prev = all.find((a) => a.id === accountId)?.rate ?? null;
        if (rateN !== prev && (rateN != null || prev != null)) await api.patch(`/api/accounts/${accountId}`, { rate: rateN });
      }
      const body = {
        name: f.name.trim(), type: f.type, amount: amt.value, varies: f.varies, frequency: f.frequency,
        interval: f.frequency === "every_n_months" ? intervalN : 1,
        day: f.frequency === "once" ? parseDay(f.start).getDate() : f.day,
        day2: f.frequency === "semimonthly" ? f.day2 : null,
        start_date: f.start, end_date: f.end || null,
        category: f.type === "bill" ? f.category : null,
        account_id: needsAccount ? accountId : null,
        ...(isNew ? {} : { paused: f.paused }),
      };
      const payload = isNew
        ? await api.post<CashPayload>("/api/cash/items", body)
        : await api.patch<CashPayload>(`/api/cash/items/${item!.id}`, body);
      haptic();
      onSaved(payload);
    } catch (e) { setErr(apiError(e)); setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setErr(null);
    try { const p = await api.del<CashPayload>(`/api/cash/items/${item!.id}`); haptic(); onSaved(p); }
    catch (e) { setErr(apiError(e)); setBusy(false); }
  };

  const c = copy[f.type];
  const title = isNew ? "Add to your plan" : item!.name;

  return (
    <Sheet title={title} onClose={onClose}>
      <form className="px-4 space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <Seg label="What is it" value={f.type} onChange={setType} options={TYPES} />

        <label className="field-wrap">
          <span className="field-label">{c.name}</span>
          <input className="field" placeholder={c.ph} autoComplete="off" enterKeyHint="next" value={f.name}
                 aria-invalid={!!show("name")} onChange={(e) => set("name", e.target.value)} autoFocus={isNew} />
        </label>
        <FieldError msg={show("name")} />

        <div className="space-y-1">
          <label className="field-wrap">
            <span className="field-label">{c.amount}</span>
            <input className="field tabular-nums" placeholder="$0" inputMode="decimal" autoComplete="off" enterKeyHint="next"
                   value={f.amount} aria-invalid={!!show("amount")} onChange={(e) => set("amount", e.target.value)} />
          </label>
          <FieldError msg={show("amount")} />
          <Toggle label="Amount varies" sub={f.varies ? "Shown as about this much." : undefined} checked={f.varies} onChange={(v) => set("varies", v)} />
        </div>

        <div className="space-y-2">
          <label className="field-wrap">
            <span className="field-label">How often</span>
            <select className="field" value={f.frequency} onChange={(e) => setFreq(e.target.value as Frequency)}>
              {FREQS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          {f.frequency === "every_n_months" && (
            <label className="field-wrap">
              <span className="field-label">Every how many months</span>
              <input className="field tabular-nums" inputMode="numeric" autoComplete="off" value={f.interval}
                     aria-invalid={!!show("interval")} onChange={(e) => set("interval", e.target.value.replace(/\D/g, ""))} />
            </label>
          )}
          <FieldError msg={show("interval")} />

          {weekly && (
            <>
              <span className="field-label block pt-1">On</span>
              <Seg label="Day of the week" value={f.day} onChange={setWeekday} options={WD.map((w, i) => [i, w] as [number, string])} />
            </>
          )}
          {(f.frequency === "monthly" || f.frequency === "every_n_months") && (
            <label className="field-wrap">
              <span className="sr-only">Day of the month</span>
              <select className="field" value={f.day} onChange={(e) => set("day", Number(e.target.value))}>
                {monthDays.map((d) => <option key={d} value={d}>On the {ordinal(d)}{d >= 29 ? " (or last day)" : ""}</option>)}
              </select>
            </label>
          )}
          {f.frequency === "semimonthly" && (
            <div className="grid grid-cols-2 gap-3">
              {([["day", "First day"], ["day2", "Second day"]] as const).map(([k, l]) => (
                <label key={k} className="field-wrap">
                  <span className="field-label">{l}</span>
                  <select className="field" value={f[k]} onChange={(e) => set(k, Number(e.target.value))}>
                    {monthDays.map((d) => <option key={d} value={d}>{ordinal(d)}{d >= 29 ? " (or last)" : ""}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          <FieldError msg={show("days")} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="field-wrap">
            <span className="field-label">{f.frequency === "once" ? "Date" : "Starts"}</span>
            <input type="date" className="field tabular-nums" value={f.start} aria-invalid={!!show("start")} onChange={(e) => setStart(e.target.value)} />
          </label>
          {f.frequency !== "once" && (
            <label className="field-wrap">
              <span className="field-label">Ends (optional)</span>
              <input type="date" className="field tabular-nums" value={f.end} min={f.start} aria-invalid={!!show("end")} onChange={(e) => set("end", e.target.value)} />
            </label>
          )}
        </div>
        <FieldError msg={show("start") ?? show("end")} />

        {f.type === "bill" && (
          <label className="field-wrap">
            <span className="field-label">Budget category</span>
            <select className="field" value={f.category} onChange={(e) => set("category", e.target.value)}>
              {EXPENSE_CATS.map((k) => <option key={k} value={k}>{catLabel(k)}</option>)}
            </select>
          </label>
        )}

        {needsAccount && (
          <div className="space-y-3">
            <label className="field-wrap">
              <span className="field-label">{wantsLiab ? "Which loan or card" : f.type === "invest" ? "Which account gets it" : "Where it goes"}</span>
              <select className="field" value={creating ? NEW : f.account} aria-invalid={!!show("account")}
                      onChange={(e) => set("account", e.target.value)}>
                {!creating && !f.account && <option value="">Choose one</option>}
                {pool.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                <option value={NEW}>{wantsLiab ? "New loan or card" : "New account"}</option>
              </select>
            </label>
            <FieldError msg={show("account")} />
            {creating && (
              <div className="grid grid-cols-2 gap-3">
                <label className="field-wrap col-span-2">
                  <span className="field-label">Account name</span>
                  <input className="field" autoComplete="off" placeholder={wantsLiab ? "Student loan" : f.type === "invest" ? "Robinhood cash" : "Savings"}
                         value={f.newName} aria-invalid={!!show("newName")} onChange={(e) => set("newName", e.target.value)} />
                </label>
                {wantsLiab && (
                  <div className="col-span-2"><Seg label="Loan or card" value={f.newKind} onChange={(v) => set("newKind", v)} options={[["loan", "Loan"], ["credit_card", "Card"]]} /></div>
                )}
                <label className="field-wrap col-span-2 sm:col-span-1">
                  <span className="field-label">{wantsLiab ? "Balance owed" : "Balance now"}</span>
                  <input className="field tabular-nums" inputMode="decimal" autoComplete="off" placeholder="$0" value={f.newBalance}
                         aria-invalid={!!show("newBal")} onChange={(e) => set("newBalance", e.target.value)} />
                </label>
              </div>
            )}
            <FieldError msg={show("newName") ?? show("newBal")} />
            {wantsLiab && (
              <label className="field-wrap">
                <span className="field-label">Interest rate, yearly % (optional)</span>
                <input className="field tabular-nums" inputMode="decimal" autoComplete="off" placeholder="5" value={f.rate}
                       aria-invalid={!!show("rate")} onChange={(e) => set("rate", e.target.value)} />
                <span className="text-[12px] text-dim leading-snug mt-0.5">With a rate, each payment splits into interest and what you owe.</span>
              </label>
            )}
            <FieldError msg={show("rate")} />
          </div>
        )}

        {!isNew && (
          <Toggle label="Pause" sub={f.paused ? "Nothing is added until you turn this off." : undefined} checked={f.paused} onChange={(v) => set("paused", v)} />
        )}

        <FieldError msg={err} />
        <button type="submit" disabled={busy} className="btn btn-primary w-full !min-h-11 !text-[15px] disabled:opacity-40">
          {busy ? "Saving…" : isNew ? "Add" : "Save changes"}
        </button>
      </form>

      {!isNew && (
        <div className="px-4 pt-4">
          {!confirmDel ? (
            <button type="button" onClick={() => setConfirmDel(true)} className="btn w-full !min-h-11 !text-down">Delete</button>
          ) : (
            <div role="group" aria-labelledby="ci-del-h" className="rounded-xl border border-edge2 p-3 space-y-2">
              <p id="ci-del-h" className="text-[14px] text-txt">Delete this? Entries already posted stay in your history.</p>
              <button type="button" disabled={busy} className="btn w-full !min-h-11 !bg-down !border-down !text-bg" onClick={remove}>{busy ? "Deleting…" : "Yes, delete"}</button>
              <button type="button" className="btn w-full !min-h-10" onClick={() => setConfirmDel(false)}>Keep it</button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
