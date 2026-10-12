"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, ChevronRight, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { haptic } from "@/lib/bus";
import { parseAmount } from "./AutoInvest";
import { fmtUsd } from "./NetWorth";

interface Contribution {
  id: number;
  account: string;
  bucket: "retirement" | "brokerage" | "cash" | "crypto";
  amount: number;
  employer_match: number;
  frequency: "weekly" | "biweekly" | "semimonthly" | "monthly";
  plan_type: "401k" | "ira" | "other";
  match_max: number | null;
  monthly: number;
  monthly_match: number;
}

interface PlanResponse {
  contributions: Contribution[];
  monthly_you: number;
  monthly_match: number;
  by_bucket: Record<string, number>;
}

const FREQ_LABEL: Record<string, string> = {
  weekly: "/ week", biweekly: "/ 2 weeks", semimonthly: "twice a month", monthly: "/ month",
};
const BUCKETS = ["retirement", "brokerage", "cash", "crypto"] as const;

/** Future value of today's balance plus a monthly deposit, compounded monthly. */
function project(start: number, monthly: number, annualPct: number, years: number): number {
  const r = annualPct / 100 / 12;
  const n = years * 12;
  if (r === 0) return start + monthly * n;
  const g = Math.pow(1 + r, n);
  return start * g + monthly * ((g - 1) / r);
}

type FormState = {
  account: string; bucket: string; amount: string; employer_match: string; frequency: string;
  plan_type: string; match_max: string;
};

const EMPTY: FormState = {
  account: "", bucket: "retirement", amount: "", employer_match: "", frequency: "monthly", plan_type: "other", match_max: "",
};

/** Optional money field: blank is fine (0), junk is an error. */
function optionalAmount(raw: string): { value: number; error: string | null } {
  if (!raw.trim()) return { value: 0, error: null };
  const r = parseAmount(raw);
  if (r.error) return { value: 0, error: r.error.replace("Enter an amount, like $200.", "Use numbers only, like $50.") };
  return { value: r.value ?? 0, error: null };
}

/** Validates the form and builds the API payload (same fields and endpoints as before). */
function check(f: FormState) {
  const amount = parseAmount(f.amount);
  const match = optionalAmount(f.employer_match);
  const max = optionalAmount(f.match_max);
  const errors = {
    account: f.account.trim() ? null : "Name the account, like Roth IRA.",
    amount: amount.error,
    employer_match: match.error,
    match_max: f.plan_type === "401k" ? max.error : null,
  };
  const ok = !errors.account && !errors.amount && !errors.employer_match && !errors.match_max;
  const payload = {
    account: f.account.trim(), bucket: f.bucket, frequency: f.frequency, plan_type: f.plan_type,
    amount: amount.value ?? 0, employer_match: match.value,
    match_max: f.plan_type === "401k" ? max.value : 0,
  };
  return { errors, ok, payload };
}

const niceError = (e: unknown) =>
  String(e instanceof Error ? e.message : e).replace(/^\d+:\s*/, "").replace(/^\{"detail":"(.*)"\}$/, "$1") || "Something went wrong.";

function FieldError({ id, msg }: { id: string; msg?: string | null }) {
  return msg ? <p id={id} role="alert" className="text-[13px] leading-snug text-down">{msg}</p> : null;
}

/** Bottom sheet (centered dialog on desktop) for adding or editing one contribution. */
function ContributionSheet({
  title, initial, saveLabel, onClose, onSubmit, onDelete,
}: {
  title: string;
  initial: FormState;
  saveLabel: string;
  onClose: () => void;
  onSubmit: (payload: ReturnType<typeof check>["payload"]) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [f, setF] = useState<FormState>(initial);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    const t = !initial.account ? setTimeout(() => first.current?.focus(), 50) : undefined;
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; if (t) clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { errors, ok, payload } = check(f);
  const set = (patch: Partial<FormState>) => setF((cur) => ({ ...cur, ...patch }));
  const e = (k: keyof typeof errors) => (tried ? errors[k] : null);

  const submit = async () => {
    if (busy) return;
    setTried(true); setErr(null);
    if (!ok) return;
    setBusy(true);
    try { await onSubmit(payload); }
    catch (x) { setErr(`Couldn't save. ${niceError(x)}`); setBusy(false); }
  };
  const del = async () => {
    if (!onDelete || busy) return;
    setBusy(true); setErr(null);
    try { await onDelete(); }
    catch (x) { setErr(`Couldn't delete. ${niceError(x)}`); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[85] bg-black/60 flex items-end sm:items-center justify-center"
         onMouseDown={(ev) => { if (ev.target === ev.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="sp-sheet-h"
           className="bg-panel w-full sm:max-w-md max-h-[92dvh] rounded-t-2xl sm:rounded-2xl border border-edge overflow-y-auto overscroll-contain
                      pb-[max(16px,env(safe-area-inset-bottom))] tab-enter">
        <div className="sticky top-0 z-10 bg-panel/95 backdrop-blur flex items-center px-4 pt-3 pb-2">
          <h2 id="sp-sheet-h" className="flex-1 text-[17px] font-bold text-txt">{title}</h2>
          <button type="button" className="size-10 -mr-2 flex items-center justify-center rounded-full text-dim hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-cyan"
                  onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <form className="px-4 space-y-4" noValidate onSubmit={(ev) => { ev.preventDefault(); submit(); }}>
          <div className="field-wrap">
            <label htmlFor="sp-account" className="field-label">Account</label>
            <input id="sp-account" ref={first} className="field" placeholder="e.g. Roth IRA" autoComplete="off" enterKeyHint="next"
                   value={f.account} aria-invalid={!!e("account")} aria-describedby={e("account") ? "sp-account-err" : undefined}
                   onChange={(ev) => set({ account: ev.target.value })} />
            <FieldError id="sp-account-err" msg={e("account")} />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <div className="field-wrap">
              <label htmlFor="sp-amount" className="field-label">You put in</label>
              <input id="sp-amount" className="field tabular-nums" type="text" inputMode="decimal" placeholder="$500" autoComplete="off" autoCorrect="off"
                     enterKeyHint="next" value={f.amount} aria-invalid={!!e("amount")} aria-describedby={e("amount") ? "sp-amount-err" : undefined}
                     onChange={(ev) => set({ amount: ev.target.value })} />
              <FieldError id="sp-amount-err" msg={e("amount")} />
            </div>
            <div className="field-wrap">
              <label htmlFor="sp-match" className="field-label">Employer match</label>
              <input id="sp-match" className="field tabular-nums" type="text" inputMode="decimal" placeholder="$0" autoComplete="off" autoCorrect="off"
                     enterKeyHint="next" value={f.employer_match} aria-invalid={!!e("employer_match")} aria-describedby={e("employer_match") ? "sp-match-err" : undefined}
                     onChange={(ev) => set({ employer_match: ev.target.value })} />
              <FieldError id="sp-match-err" msg={e("employer_match")} />
            </div>
          </div>
          <p className="-mt-2 text-[12px] text-dim leading-snug">Both amounts are per payment, on the schedule below.</p>

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <label className="field-wrap">
              <span className="field-label">How often</span>
              <select className="field" value={f.frequency} onChange={(ev) => set({ frequency: ev.target.value })}>
                <option value="weekly">Every week</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="semimonthly">Twice a month</option>
                <option value="monthly">Every month</option>
              </select>
            </label>
            <label className="field-wrap">
              <span className="field-label">Goes to</span>
              <select className="field" value={f.bucket} onChange={(ev) => set({ bucket: ev.target.value })}>
                <option value="retirement">Retirement</option>
                <option value="brokerage">Brokerage</option>
                <option value="cash">Cash savings</option>
                <option value="crypto">Crypto</option>
              </select>
            </label>
          </div>

          <label className="field-wrap">
            <span className="field-label">Account type (for IRS limits)</span>
            <select className="field" value={f.plan_type} onChange={(ev) => set({ plan_type: ev.target.value })}>
              <option value="401k">401(k) / 403(b)</option>
              <option value="ira">IRA (Roth or traditional)</option>
              <option value="other">Other / taxable</option>
            </select>
          </label>

          {f.plan_type === "401k" && (
            <div className="field-wrap">
              <label htmlFor="sp-max" className="field-label">Max employer match</label>
              <input id="sp-max" className="field tabular-nums" type="text" inputMode="decimal" placeholder="Optional" autoComplete="off" autoCorrect="off"
                     enterKeyHint="done" value={f.match_max} aria-invalid={!!e("match_max")}
                     aria-describedby={e("match_max") ? "sp-max-err" : "sp-max-hint"}
                     onChange={(ev) => set({ match_max: ev.target.value })} />
              <FieldError id="sp-max-err" msg={e("match_max")} />
              {!e("match_max") && <span id="sp-max-hint" className="text-[12px] text-dim leading-snug">The most your employer will add per payment, if you know it.</span>}
            </div>
          )}

          {err && <p role="alert" className="text-[13px] leading-snug text-down">{err}</p>}

          <button type="submit" disabled={busy} className="btn btn-primary w-full !min-h-11 !text-[15px] disabled:opacity-40">
            {busy && !confirmDel ? "Saving…" : saveLabel}
          </button>
        </form>

        {onDelete && (
          <div className="px-4 pt-4">
            {!confirmDel ? (
              <button type="button" onClick={() => setConfirmDel(true)} disabled={busy}
                      className="btn w-full !min-h-11 !text-down">Delete contribution</button>
            ) : (
              <div role="group" aria-labelledby="sp-del-h" className="rounded-xl border border-edge2 p-3 space-y-2">
                <p id="sp-del-h" className="text-[14px] text-txt">Remove this from your savings plan?</p>
                <button type="button" disabled={busy} className="btn w-full !min-h-11 !bg-down !border-down !text-bg" onClick={del}>
                  {busy ? "Deleting…" : "Delete"}
                </button>
                <button type="button" disabled={busy} className="btn w-full !min-h-10" onClick={() => setConfirmDel(false)}>Cancel</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SavingsPlan() {
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [nw, setNw] = useState(0);
  const [ret, setRet] = useState(7);
  const [sheet, setSheet] = useState<{ id: number | null; form: FormState } | null>(null);

  const refresh = () => {
    api.get<PlanResponse>("/api/contributions").then((p) => { setPlan(p); setFailed(false); }).catch(() => setFailed(true));
    api.get<{ totals: { net_worth: number } }>("/api/accounts").then((r) => setNw(r.totals.net_worth)).catch(() => {});
  };
  useEffect(refresh, []);

  const openNew = () => { haptic(); setSheet({ id: null, form: { ...EMPTY } }); };
  const startEdit = (c: Contribution) => {
    haptic();
    setSheet({
      id: c.id,
      form: {
        account: c.account, bucket: c.bucket, frequency: c.frequency,
        amount: String(c.amount), employer_match: c.employer_match ? String(c.employer_match) : "",
        plan_type: c.plan_type, match_max: c.match_max ? String(c.match_max) : "",
      },
    });
  };

  const submit = async (payload: ReturnType<typeof check>["payload"]) => {
    if (sheet?.id == null) await api.post("/api/contributions", { ...payload, match_max: payload.match_max || null });
    else await api.patch(`/api/contributions/${sheet.id}`, payload); // match_max 0 clears it
    haptic();
    setSheet(null);
    refresh();
  };

  const remove = async () => {
    if (sheet?.id == null) return;
    await api.del(`/api/contributions/${sheet.id}`);
    haptic();
    setSheet(null);
    refresh();
  };

  const monthlyTotal = (plan?.monthly_you ?? 0) + (plan?.monthly_match ?? 0);
  const proj = useMemo(
    () => [1, 5, 10, 20].map((y) => ({ y, v: project(nw, monthlyTotal, ret, y) })),
    [nw, monthlyTotal, ret],
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><CalendarClock size={14} />Savings Plan</span>
        <button className="btn btn-primary !py-1 !px-2" onClick={openNew} aria-label="Add a recurring contribution">
          <Plus size={12} strokeWidth={3} />
        </button>
      </div>

      <div className="px-4 pt-3">
        <div className="font-display text-[34px] leading-none text-txt tabular-nums">
          {fmtUsd(monthlyTotal)}<span className="text-base text-faint"> / month</span>
        </div>
        <div className="text-[13px] text-dim mt-1.5 tabular-nums">
          {fmtUsd(plan?.monthly_you ?? 0)} from you
          {(plan?.monthly_match ?? 0) > 0 && <> + <span className="text-cyan">{fmtUsd(plan!.monthly_match)} free employer match</span></>}
          {" · "}{fmtUsd(monthlyTotal * 12)} a year
        </div>
      </div>

      <div className="mt-3 border-t border-edge">
        {failed && !plan && <p className="p-4 text-[13px] text-dim">Couldn&apos;t load your savings plan.</p>}
        {plan?.contributions.length === 0 && (
          <div className="p-4 space-y-3">
            <p className="text-[13px] text-dim leading-snug">Add what you put away each paycheck or month: 401(k), Roth, brokerage, savings.</p>
            <button className="btn btn-primary" onClick={openNew}><Plus size={14} strokeWidth={3} />Add contribution</button>
          </div>
        )}
        {plan?.contributions.map((c) => (
          <button key={c.id} onClick={() => startEdit(c)}
                  className="w-full min-h-[60px] text-left flex items-center gap-3 px-4 py-2.5 border-t border-edge first:border-t-0 transition-colors
                             active:bg-panel2 [@media(hover:hover)]:hover:bg-panel2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan">
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-txt leading-tight truncate">{c.account}</span>
              <span className="block text-[13px] text-dim leading-snug mt-0.5 tabular-nums">
                {fmtUsd(c.amount)} {FREQ_LABEL[c.frequency]}
                {c.employer_match > 0 && <span className="text-cyan"> + {fmtUsd(c.employer_match)} match</span>}
                <span className="capitalize"> · {c.bucket}</span>
              </span>
            </span>
            <span className="text-right tabular-nums shrink-0">
              <span className="block text-[15px] font-semibold text-txt">{fmtUsd(c.monthly + c.monthly_match)}</span>
              <span className="block text-[12px] text-faint">per month</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-faint" />
          </button>
        ))}
      </div>

      {/* Projection */}
      <div className="border-t border-edge p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <span className="text-[12px] font-bold tracking-wider text-dim">IF YOU KEEP THIS UP</span>
          <div className="seg flex rounded-lg border border-edge2 text-[13px]" role="radiogroup" aria-label="Average yearly return">
            {[4, 7, 10].map((p) => (
              <button key={p} role="radio" aria-checked={ret === p} onClick={() => setRet(p)}
                      className={`chip-tap px-3 py-1 font-semibold tabular-nums focus-visible:outline-2 focus-visible:outline-cyan ${ret === p ? "bg-panel2 text-up" : "text-dim hover:text-txt"}`}>
                {p}%/yr
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {proj.map(({ y, v }) => (
            <div key={y} className="rounded-lg bg-panel2/60 px-1 py-2 text-center min-w-0">
              <div className="text-[12px] text-dim">{y} {y === 1 ? "year" : "years"}</div>
              <div className="text-[14px] font-bold tabular-nums text-txt truncate">{fmtUsd(v)}</div>
            </div>
          ))}
        </div>
        <p className="text-[12px] text-dim leading-snug mt-3">
          Starts from today&apos;s net worth and adds your monthly total at an average {ret}% a year. Real markets go up and down.
        </p>
      </div>

      {sheet && (
        <ContributionSheet
          key={sheet.id ?? "new"}
          title={sheet.id == null ? "New contribution" : "Edit contribution"}
          initial={sheet.form}
          saveLabel={sheet.id == null ? "Add contribution" : "Save changes"}
          onClose={() => setSheet(null)}
          onSubmit={submit}
          onDelete={sheet.id == null ? undefined : remove}
        />
      )}
    </section>
  );
}
