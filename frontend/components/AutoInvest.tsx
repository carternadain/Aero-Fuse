"use client";

// Auto-invest: recurring buys (like Robinhood's) that add shares to a holding on schedule.
// The backend buys amount ÷ that day's close on every scheduled day and keeps a ledger, so
// net worth grows by itself. Rows here; add/edit in a sheet.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Plus, Repeat, X } from "lucide-react";
import { api, fmtPrice } from "@/lib/api";
import { haptic } from "@/lib/bus";
import { fmtQty, isHidden, MASK, usePrivacy } from "@/lib/privacy";

type Freq = "weekly" | "biweekly" | "monthly";
type AssetKind = "stock" | "crypto";

interface Fill {
  id: number; sched_date: string; trade_date: string | null; qty: number; price: number | null;
  amount: number; status: "filled" | "existing" | "skipped";
}

export interface Rule {
  id: number; symbol: string; kind: AssetKind; amount: number; frequency: Freq; day: number;
  start_date: string; end_date: string | null; paused: boolean; label: string;
  buys: number; invested: number; qty: number; added_qty: number; pending: number; next_date: string | null;
  fills?: Fill[];
}

interface IndexTicker { symbol: string; kind: AssetKind | "option"; name: string | null }

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const FREQS: [Freq, string][] = [["weekly", "Weekly"], ["biweekly", "Every 2 weeks"], ["monthly", "Monthly"]];

const money = (n: number) => {
  if (isHidden()) return MASK;
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
};
const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
};
const parseDay = (iso: string) => new Date(`${iso}T12:00:00`);
const monthYear = (iso: string) => parseDay(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
const shortDate = (iso: string) => {
  const d = parseDay(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
};
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function scheduleText(r: Pick<Rule, "frequency" | "day">): string {
  if (r.frequency === "monthly") return `monthly on the ${ordinal(r.day)}`;
  const wd = WEEKDAYS[r.day] ?? "Monday";
  return r.frequency === "weekly" ? `every ${wd}` : `every other ${wd}`;
}

const perMonth = (r: Rule) => r.amount * (r.frequency === "weekly" ? 52 / 12 : r.frequency === "biweekly" ? 26 / 12 : 1);

let indexCache: { tickers: IndexTicker[]; accounts: string[] } | null = null;

export default function AutoInvest() {
  usePrivacy(); // re-render when balances are hidden/shown
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState<Rule | "new" | null>(null);

  const refresh = () =>
    api.get<Rule[]>("/api/autoinvest").then((r) => { setRules(r); setFailed(false); }).catch(() => setFailed(true));
  useEffect(() => { refresh(); }, []);

  const active = (rules ?? []).filter((r) => !r.paused && !(r.end_date && r.end_date < todayIso()));
  const monthly = active.reduce((t, r) => t + perMonth(r), 0);
  const invested = (rules ?? []).reduce((t, r) => t + r.invested, 0);

  const open = async (r: Rule) => {
    haptic();
    setSheet(r);
    api.get<Rule>(`/api/autoinvest/${r.id}`).then((full) => setSheet((s) => (s && s !== "new" && s.id === r.id ? full : s))).catch(() => {});
  };

  return (
    <section className="panel" aria-labelledby="autoinvest-h">
      <div className="panel-head">
        <span className="panel-title" id="autoinvest-h"><Repeat size={14} />Auto-invest</span>
        {!!rules?.length && (
          <button className="btn btn-primary !py-1 !px-2" onClick={() => { haptic(); setSheet("new"); }} aria-label="Add a recurring buy">
            <Plus size={12} strokeWidth={3} />
          </button>
        )}
      </div>

      {rules == null ? (
        <p className="px-4 py-5 text-[13px] text-dim">{failed ? "Couldn't load your recurring buys." : "Loading…"}</p>
      ) : rules.length === 0 ? (
        <div className="px-4 py-5 space-y-3">
          <p className="text-[13px] text-dim leading-snug max-w-sm">
            Set up your recurring buys once. Each buy adds shares to your holdings at that day&apos;s close, so your net worth keeps up on its own.
          </p>
          <button className="btn btn-primary" onClick={() => { haptic(); setSheet("new"); }}>
            <Plus size={14} strokeWidth={3} />Add recurring buy
          </button>
        </div>
      ) : (
        <>
          <div className="px-4 pt-3 pb-3">
            <div className="font-display text-[30px] leading-none text-txt tabular-nums">
              {money(Math.round(monthly))}<span className="text-base text-faint"> / month</span>
            </div>
            <div className="text-[12px] text-dim mt-1 tabular-nums">{money(Math.round(invested))} invested so far</div>
          </div>
          <ul className="border-t border-edge divide-y divide-edge">
            {rules.map((r) => <RuleRow key={r.id} r={r} onOpen={() => open(r)} />)}
          </ul>
        </>
      )}

      {sheet && (
        <RuleSheet rule={sheet === "new" ? null : sheet}
                   onClose={() => setSheet(null)}
                   onSaved={() => { setSheet(null); refresh(); }} />
      )}
    </section>
  );
}

function RuleRow({ r, onOpen }: { r: Rule; onOpen: () => void }) {
  const ended = !!r.end_date && r.end_date < todayIso();
  const bits = [
    scheduleText(r).replace(/^./, (c) => c.toUpperCase()),
    `since ${monthYear(r.start_date)}`,
    r.buys ? `${r.buys} ${r.buys === 1 ? "buy" : "buys"}, ${money(r.invested)} in` : null,
  ].filter(Boolean);
  return (
    <li>
      <button onClick={onOpen}
              className="w-full min-h-[60px] flex items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-panel2 [@media(hover:hover)]:hover:bg-panel2/60
                         focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-up">
        <span className="flex-1 min-w-0">
          <span className={`flex items-center gap-2 text-[15px] font-semibold leading-tight ${r.paused || ended ? "text-dim" : "text-txt"}`}>
            <span className="truncate tabular-nums">{money(r.amount)} into {r.symbol}</span>
            {r.paused && <span className="shrink-0 text-[10px] font-bold text-amber bg-amber/15 rounded px-1.5 py-0.5">Paused</span>}
            {ended && !r.paused && <span className="shrink-0 text-[10px] font-bold text-dim bg-panel2 rounded px-1.5 py-0.5">Ended</span>}
          </span>
          <span className="block text-[12px] text-dim leading-snug mt-1 tabular-nums">
            {bits.map((b, i) => <Fragment key={i}>{i ? " · " : ""}<span className="whitespace-nowrap">{b}</span></Fragment>)}
            {r.pending > 0 && !r.paused && <> · <span className="text-amber whitespace-nowrap">{r.pending} waiting for a price</span></>}
          </span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-faint" />
      </button>
    </li>
  );
}

// ── sheet ──────────────────────────────────────────────

interface Form {
  symbol: string; kind: AssetKind; amount: string; frequency: Freq; day: number;
  start_date: string; end_date: string; label: string; add_past: boolean; paused: boolean;
}

const fromRule = (r: Rule | null): Form => r
  ? { symbol: r.symbol, kind: r.kind, amount: String(r.amount), frequency: r.frequency, day: r.day,
      start_date: r.start_date, end_date: r.end_date ?? "", label: r.label, add_past: false, paused: r.paused }
  : { symbol: "", kind: "stock", amount: "", frequency: "monthly", day: new Date().getDate(),
      start_date: todayIso(), end_date: "", label: "", add_past: false, paused: false };

function Seg<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="seg flex rounded-[10px] border border-edge2 bg-bg p-0.5">
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v}
                onClick={() => { if (value !== v) haptic(); onChange(v); }}
                className={`flex-1 min-h-10 px-1 rounded-lg text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-cyan ${
                  value === v ? "bg-panel2 text-txt shadow-sm" : "text-dim hover:text-txt"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, sub, checked, onChange }: { label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => { haptic(); onChange(!checked); }}
            className="w-full min-h-12 flex items-center gap-3 text-left rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan">
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] text-txt">{label}</span>
        {sub && <span className="block text-[12px] text-dim leading-snug">{sub}</span>}
      </span>
      <span aria-hidden className={`relative w-[46px] h-7 rounded-full shrink-0 transition-colors ${checked ? "bg-up" : "bg-edge2"}`}>
        <span className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-txt shadow transition-transform motion-reduce:transition-none ${checked ? "translate-x-[18px]" : ""}`} />
      </span>
    </button>
  );
}

const SCHEDULE_KEYS: (keyof Form)[] = ["symbol", "kind", "amount", "frequency", "day", "start_date", "end_date", "label"];

function RuleSheet({ rule, onClose, onSaved }: { rule: Rule | null; onClose: () => void; onSaved: () => void }) {
  usePrivacy();
  const [f, setF] = useState<Form>(() => fromRule(rule));
  const [index, setIndex] = useState(indexCache);
  const [focus, setFocus] = useState(false);
  const [applyTo, setApplyTo] = useState<"future" | "all">("future");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const isNew = !rule;

  useEffect(() => {
    if (!indexCache) api.get<{ tickers: IndexTicker[]; accounts: string[] }>("/api/search/index")
      .then((i) => { indexCache = i; setIndex(i); }).catch(() => {});
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    if (isNew) setTimeout(() => first.current?.focus(), 50);
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [onClose, isNew]);

  const q = f.symbol.trim().toUpperCase();
  const matches = useMemo(() => {
    if (!q || !index) return [];
    const t = index.tickers.filter((x) => x.kind !== "option");
    const exact = t.find((x) => x.symbol === q);
    if (exact && !focus) return [];
    return t
      .map((x) => ({ x, s: x.symbol === q ? 100 : x.symbol.startsWith(q) ? 60 : (x.name ?? "").toUpperCase().includes(q) ? 20 : 0 }))
      .filter((m) => m.s > 0).sort((a, b) => b.s - a.s || a.x.symbol.localeCompare(b.x.symbol)).slice(0, 5).map((m) => m.x);
  }, [q, index, focus]);
  const accounts = useMemo(() => Array.from(new Set(index?.accounts ?? [])).slice(0, 20), [index]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const setFreq = (fr: Freq) => setF((cur) => ({
    ...cur, frequency: fr,
    day: fr === "monthly" ? (cur.frequency === "monthly" ? cur.day : parseDay(cur.start_date).getDate())
      : (cur.frequency === "monthly" ? (parseDay(cur.start_date).getDay() + 6) % 7 : cur.day),
  }));

  const amount = parseFloat(f.amount.replace(/[$,\s]/g, ""));
  const original = fromRule(rule);
  const scheduleChanged = !!rule && SCHEDULE_KEYS.some((k) => String(f[k]) !== String(original[k]));
  const pastStart = f.start_date < todayIso();
  const valid = !!q && amount > 0 && !!f.start_date && (!f.end_date || f.end_date >= f.start_date);

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr(null);
    const body = {
      symbol: q, kind: f.kind, amount, frequency: f.frequency, day: f.day,
      start_date: f.start_date, end_date: f.end_date || null, label: f.label.trim(),
    };
    try {
      if (isNew) await api.post("/api/autoinvest", { ...body, add_past: f.add_past });
      else await api.patch(`/api/autoinvest/${rule!.id}`, {
        ...(scheduleChanged ? body : {}), paused: f.paused, apply_to: applyTo,
      });
      haptic();
      onSaved();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e).replace(/^\d+:\s*/, "").replace(/^\{"detail":"(.*)"\}$/, "$1"));
      setBusy(false);
    }
  };

  const remove = async (keep: boolean) => {
    setBusy(true);
    try { await api.del(`/api/autoinvest/${rule!.id}?keep_shares=${keep}`); haptic(); onSaved(); }
    catch { setErr("Couldn't delete. Try again."); setBusy(false); }
  };

  const fills = (rule?.fills ?? []).slice(0, 5);

  return (
    <div className="fixed inset-0 z-[85] bg-black/60 flex items-end sm:items-center justify-center"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="ai-sheet-h"
           className="bg-panel w-full sm:max-w-md max-h-[92dvh] rounded-t-2xl sm:rounded-2xl border border-edge overflow-y-auto overscroll-contain
                      pb-[max(16px,env(safe-area-inset-bottom))] tab-enter">
        <div className="sticky top-0 z-10 bg-panel/95 backdrop-blur flex items-center px-4 pt-3 pb-2">
          <h2 id="ai-sheet-h" className="flex-1 text-[17px] font-bold text-txt">{isNew ? "New recurring buy" : `${rule!.symbol} recurring buy`}</h2>
          <button className="size-10 -mr-2 flex items-center justify-center rounded-full text-dim hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-cyan"
                  onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <form className="px-4 space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
          {!isNew && rule!.buys > 0 && (
            <p className="text-[13px] text-dim tabular-nums">
              {rule!.buys} {rule!.buys === 1 ? "buy" : "buys"} · {money(rule!.invested)} in · {fmtQty(rule!.qty, 6)} {rule!.kind === "crypto" ? rule!.symbol : "shares"}
              {rule!.next_date && !f.paused ? ` · next ${shortDate(rule!.next_date)}` : ""}
            </p>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <label className="field-wrap relative">
              <span className="field-label">Symbol</span>
              <input ref={first} className="field uppercase" placeholder="VOO" autoComplete="off" autoCapitalize="characters"
                     spellCheck={false} enterKeyHint="next" value={f.symbol} aria-autocomplete="list"
                     onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 120)}
                     onChange={(e) => {
                       const v = e.target.value.toUpperCase();
                       const hit = index?.tickers.find((x) => x.symbol === v.trim() && x.kind !== "option");
                       setF((cur) => ({ ...cur, symbol: v, kind: hit ? (hit.kind as AssetKind) : cur.kind }));
                     }} />
            </label>
            <label className="field-wrap">
              <span className="field-label">Amount per buy</span>
              <input className="field tabular-nums" placeholder="$200" inputMode="decimal" autoComplete="off" enterKeyHint="next"
                     value={f.amount} onChange={(e) => set("amount", e.target.value)} />
            </label>
            {focus && matches.length > 0 && (
              <ul className="col-span-2 -mt-2 rounded-[10px] border border-edge2 bg-bg overflow-hidden divide-y divide-edge" role="listbox" aria-label="Matching tickers">
                {matches.map((m) => (
                  <li key={`${m.kind}-${m.symbol}`}>
                    <button type="button" role="option" aria-selected={m.symbol === q}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { setF((cur) => ({ ...cur, symbol: m.symbol, kind: m.kind as AssetKind })); setFocus(false); }}
                            className="w-full min-h-10 flex items-center gap-2 px-3 py-1.5 text-left hover:bg-panel2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan">
                      <span className="text-[14px] font-semibold text-txt w-16 shrink-0">{m.symbol}</span>
                      <span className="text-[12px] text-dim truncate flex-1">{m.name ?? ""}</span>
                      <span className="text-[11px] text-faint shrink-0">{m.kind === "crypto" ? "Crypto" : "Stock"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Seg label="Asset type" value={f.kind} onChange={(v) => set("kind", v)}
               options={[["stock", "Stock / ETF"], ["crypto", "Crypto"]]} />

          <div className="space-y-2">
            <span className="field-label block">How often</span>
            <Seg label="How often" value={f.frequency} onChange={setFreq} options={FREQS} />
            {f.frequency === "monthly" ? (
              <label className="field-wrap">
                <span className="sr-only">Day of the month</span>
                <select className="field" value={f.day} onChange={(e) => set("day", Number(e.target.value))}>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>On the {ordinal(d)}{d >= 29 ? " (or last day)" : ""}</option>
                  ))}
                </select>
              </label>
            ) : (
              <Seg label="Day of the week" value={f.day} onChange={(v) => set("day", v)}
                   options={WEEKDAYS.map((w, i) => [i, w.slice(0, 2)] as [number, string])} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="field-wrap">
              <span className="field-label">Starting</span>
              <input type="date" className="field tabular-nums" value={f.start_date} required
                     onChange={(e) => {
                       const v = e.target.value;
                       // the first buy's date sets the day it repeats on (still changeable below)
                       setF((cur) => ({ ...cur, start_date: v, day: !v ? cur.day : cur.frequency === "monthly"
                         ? parseDay(v).getDate() : (parseDay(v).getDay() + 6) % 7 }));
                     }} />
            </label>
            <label className="field-wrap">
              <span className="field-label">Ending (optional)</span>
              <input type="date" className="field tabular-nums" value={f.end_date} min={f.start_date}
                     onChange={(e) => set("end_date", e.target.value)} />
            </label>
          </div>

          <label className="field-wrap">
            <span className="field-label">Held at</span>
            <input className="field" list="ai-accounts" placeholder="Robinhood" autoComplete="off" enterKeyHint="done"
                   value={f.label} onChange={(e) => set("label", e.target.value)} />
            <datalist id="ai-accounts">{accounts.map((a) => <option key={a} value={a} />)}</datalist>
          </label>

          {isNew && pastStart && (
            <Toggle label="Add past buys to holdings" checked={f.add_past} onChange={(v) => set("add_past", v)}
                    sub={f.add_past ? "Buys since the start date are added at each day's close." : "Off: your share count already includes them, so they only shape your net worth history."} />
          )}

          {!isNew && (
            <Toggle label="Paused" sub={f.paused ? "No buys until you turn this off. Days missed are skipped." : undefined}
                    checked={f.paused} onChange={(v) => set("paused", v)} />
          )}

          {scheduleChanged && rule!.buys > 0 && (
            <div className="space-y-2">
              <span className="field-label block">Apply changes to</span>
              <Seg label="Apply changes to" value={applyTo} onChange={setApplyTo}
                   options={[["future", "Buys from today"], ["all", "All past buys too"]]} />
              {applyTo === "all" && (
                <p className="text-[12px] text-dim leading-snug">Past buys are redone with the new settings, and your share count is updated.</p>
              )}
            </div>
          )}

          {err && <p role="alert" className="text-[13px] text-down">{err}</p>}

          <button type="submit" disabled={!valid || busy || (!isNew && !scheduleChanged && f.paused === rule!.paused)}
                  className="btn btn-primary w-full !min-h-11 !text-[15px] disabled:opacity-40">
            {busy ? "Saving…" : isNew ? (pastStart && f.add_past ? "Add and catch up" : "Add recurring buy") : "Save changes"}
          </button>
        </form>

        {!isNew && fills.length > 0 && (
          <div className="px-4 pt-5">
            <h3 className="text-[12px] font-semibold text-dim pb-1.5">Recent buys</h3>
            <ul className="rounded-xl border border-edge divide-y divide-edge">
              {fills.map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-3 min-h-11 text-[13px] tabular-nums">
                  <span className="text-txt w-16 shrink-0">{shortDate(x.trade_date ?? x.sched_date)}</span>
                  <span className="flex-1 min-w-0 truncate text-dim">
                    {fmtQty(x.qty, 6)} at {isHidden() ? MASK : `$${fmtPrice(x.price)}`}
                    {x.status === "existing" && <span className="text-faint"> · already counted</span>}
                  </span>
                  <span className="text-txt shrink-0">{money(x.amount)}</span>
                </li>
              ))}
            </ul>
            {rule!.pending > 0 && (
              <p className="text-[12px] text-amber pt-1.5">{rule!.pending} {rule!.pending === 1 ? "buy is" : "buys are"} waiting for a closing price. They&apos;ll fill on their own.</p>
            )}
          </div>
        )}

        {!isNew && (
          <div className="px-4 pt-5">
            {!confirmDel ? (
              <button type="button" onClick={() => setConfirmDel(true)}
                      className="btn w-full !min-h-11 !text-down">Delete recurring buy</button>
            ) : (
              <div role="group" aria-labelledby="ai-del-h" className="rounded-xl border border-edge2 p-3 space-y-2">
                <p id="ai-del-h" className="text-[14px] text-txt">
                  {rule!.added_qty > 0
                    ? <>Keep the {fmtQty(rule!.added_qty, 6)} {rule!.kind === "crypto" ? rule!.symbol : "shares"} it bought?</>
                    : "Delete this recurring buy?"}
                </p>
                {rule!.added_qty > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" disabled={busy} className="btn !min-h-11" onClick={() => remove(true)}>Keep them</button>
                    <button type="button" disabled={busy} className="btn !min-h-11 !bg-down !border-down !text-bg" onClick={() => remove(false)}>Remove them</button>
                  </div>
                ) : (
                  <button type="button" disabled={busy} className="btn w-full !min-h-11 !bg-down !border-down !text-bg" onClick={() => remove(true)}>Delete</button>
                )}
                <button type="button" className="btn w-full !min-h-10" onClick={() => setConfirmDel(false)}>Cancel</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
