"use client";

import { useEffect, useState } from "react";
import { Flag, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { haptic, navigate } from "@/lib/bus";
import { parseAmount } from "./AutoInvest";
import { fmtCents, isHidden } from "@/lib/privacy";
import Skeleton from "./Skeleton";

interface Goal {
  id: string; name: string; target: number; date: string | null; metric: "net_worth" | "invested" | "cash";
  current: number; pct: number; months_left: number | null;
  at_date_flat: number | null; at_date_growth: number | null; monthly_needed: number | null;
  eta_months: number | null; eta_date: string | null; on_pace: boolean | null; assumed_growth: number;
  account_id?: number | null;
}

const METRIC: Record<Goal["metric"], string> = { net_worth: "Net worth", invested: "Invested", cash: "Cash" };
const whole = (n: number) => fmtCents(n).replace(/\.\d\d$/, "");
const monthYear = (d: string) => new Date(d + "T12:00:00").toLocaleDateString([], { month: "short", year: "numeric" });

function Ring({ pct, size = 64, tone }: { pct: number; size?: number; tone: string }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="-rotate-90 shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-edge)" strokeWidth={6} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={6} strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, pct) / 100)}
              style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.2,0.7,0.2,1)" }} />
    </svg>
  );
}

interface AssetAcct { id: number; name: string }

function Form({ g, accounts, onDone }: { g?: Partial<Goal>; accounts: AssetAcct[]; onDone: (rows?: Goal[]) => void }) {
  const [f, setF] = useState({
    name: g?.name ?? "", target: g?.target ? String(g.target) : "", date: g?.date ?? "",
    metric: g?.metric ?? "net_worth", account: g?.account_id != null ? String(g.account_id) : "",
  });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const target = parseAmount(f.target);
  const errs = {
    name: f.name.trim() ? null : "Give your goal a name, like $100k club.",
    target: target.error?.replace("Enter an amount, like $200.", "Enter a target, like $100,000.") ?? null,
  };
  const show = (k: keyof typeof errs) => (tried ? errs[k] : null);

  const save = async (ev?: React.FormEvent) => {
    ev?.preventDefault();
    if (busy) return;
    setTried(true); setErr(null);
    if (errs.name || errs.target) return;
    setBusy(true);
    try {
      const r = await api.post<{ goals: Goal[] }>("/api/goals", {
        id: g?.id, name: f.name.trim(), target: target.value, date: f.date || null, metric: f.metric,
        account_id: f.account ? Number(f.account) : null,
      });
      haptic();
      onDone(r.goals);
    } catch (x) {
      setErr(`Couldn't save. ${String(x instanceof Error ? x.message : x).replace(/^\d+:\s*/, "").replace(/^\{"detail":"(.*)"\}$/, "$1")}`);
      setBusy(false);
    }
  };
  const tracked = !!f.account;
  const known = accounts.some((a) => String(a.id) === f.account);
  return (
    <form noValidate onSubmit={save} className="p-4 space-y-3 border-t border-edge bg-panel2/30">
      <div className="field-wrap">
        <label htmlFor="goal-name" className="field-label">Goal name</label>
        <input id="goal-name" className="field" placeholder="e.g. $100k club" autoComplete="off" enterKeyHint="next" value={f.name}
               aria-invalid={!!show("name")} aria-describedby={show("name") ? "goal-name-err" : undefined}
               onChange={(e) => setF({ ...f, name: e.target.value })} />
        {show("name") && <p id="goal-name-err" role="alert" className="text-[13px] text-down">{show("name")}</p>}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <div className="field-wrap">
          <label htmlFor="goal-target" className="field-label">Target</label>
          <input id="goal-target" className="field tabular-nums" type="text" inputMode="decimal" placeholder="$100,000" autoComplete="off" autoCorrect="off"
                 enterKeyHint="next" value={f.target} aria-invalid={!!show("target")} aria-describedby={show("target") ? "goal-target-err" : undefined}
                 onChange={(e) => setF({ ...f, target: e.target.value })} />
          {show("target") && <p id="goal-target-err" role="alert" className="text-[13px] leading-snug text-down">{show("target")}</p>}
        </div>
        <label className="field-wrap"><span className="field-label">Target date (optional)</span>
          <input className="field tabular-nums" type="date" enterKeyHint="done" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
      </div>
      <label className="field-wrap"><span className="field-label">Measured by</span>
        <select className="field" value={f.metric} disabled={tracked} onChange={(e) => setF({ ...f, metric: e.target.value as Goal["metric"] })}>
          {Object.entries(METRIC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></label>
      {(accounts.length > 0 || tracked) && (
        <label className="field-wrap"><span className="field-label">Track an account</span>
          <select className="field" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}>
            <option value="">None, use the measure above</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            {tracked && !known && <option value={f.account}>Linked account</option>}
          </select>
          <span className="text-[12px] text-dim leading-snug mt-0.5">
            {tracked ? "Progress is this account's balance." : "Optional. Progress follows one account's balance, like a house fund."}
          </span>
        </label>
      )}
      {err && <p role="alert" className="text-[13px] leading-snug text-down">{err}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn" disabled={busy} onClick={() => onDone()}>Cancel</button>
        <button type="submit" className="btn btn-primary disabled:opacity-40" disabled={busy}>{busy ? "Saving…" : "Save goal"}</button>
      </div>
    </form>
  );
}

/** Goals with a progress ring and simple pace math from the savings plan. */
export default function Goals({ compact = false }: { compact?: boolean }) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [accounts, setAccounts] = useState<AssetAcct[]>([]);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [delErr, setDelErr] = useState<string | null>(null);

  useEffect(() => { api.get<{ goals: Goal[] }>("/api/goals").then((r) => setGoals(r.goals)).catch(() => setGoals([])); }, []);
  useEffect(() => {
    api.get<{ accounts: { id: number; name: string; kind: string }[] }>("/api/accounts") // compact (Home) still needs names for the row label
      .then((r) => setAccounts((r.accounts ?? []).filter((a) => a.kind === "asset").map((a) => ({ id: a.id, name: a.name }))))
      .catch(() => {});
  }, []);

  const done = (rows?: Goal[]) => { if (rows) setGoals(rows); setEditing(null); };
  const del = async (id: string) => {
    setDelErr(null);
    try { const r = await api.del<{ goals: Goal[] }>(`/api/goals/${id}`); setGoals(r.goals); setConfirmDel(null); haptic(); }
    catch { setDelErr("Couldn't delete that goal. Try again."); }
  };
  const acctName = (id?: number | null) => (id == null ? null : accounts.find((a) => a.id === id)?.name ?? "Linked account");

  const shown = compact ? (goals ?? []).slice(0, 2) : goals ?? [];

  return (
    <section className="panel">
      <div className="panel-head">
        {/* Home has no section heading above this card, so it keeps its title there */}
        {compact ? <span className="panel-title"><Flag size={14} />Goals</span>
          : <span className="text-[12px] text-dim">Targets and whether you're on pace</span>}
        {compact ? (
          <button className="min-h-10 px-2 -mx-2 text-[10px] font-bold text-dim hover:text-txt focus-visible:outline-2 focus-visible:outline-cyan rounded" onClick={() => navigate({ tab: "wealth", anchor: "sec-goals" })}>Manage</button>
        ) : (
          <button className="icon-btn" onClick={() => setEditing("new")} title="New goal"><Plus size={14} /></button>
        )}
      </div>
      {!goals ? (
        <div className="p-3"><Skeleton className="h-16" /></div>
      ) : !goals.length && editing !== "new" ? (
        <div className="px-4 py-5 text-[12px] text-dim">
          Set a target, like <b className="text-txt">$100k by June 2027</b>, and see whether your plan gets you there on time.
          <div className="mt-3">
            <button className="btn btn-primary" onClick={() => compact ? navigate({ tab: "wealth", anchor: "sec-goals" }) : setEditing("new")}>
              <Plus size={13} /> Add a goal
            </button>
          </div>
        </div>
      ) : (
        <div>
          {shown.map((g) => {
            const tone = g.pct >= 100 ? "var(--color-up)" : g.on_pace === false ? "var(--color-amber)" : "var(--color-cyan)";
            return (
              <div key={g.id} className="border-t border-edge/50 first:border-t-0">
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="relative">
                    <Ring pct={g.pct} tone={tone} size={compact ? 54 : 64} />
                    <span className="absolute inset-0 flex items-center justify-center text-[12px] font-extrabold text-txt tabular-nums">
                      {Math.floor(g.pct)}%
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-bold text-txt truncate">{g.name}</span>
                      {g.pct >= 100 ? <span className="text-[10px] font-bold text-up">REACHED</span>
                        : g.on_pace != null && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${g.on_pace ? "bg-up/15 text-up" : "bg-amber/15 text-amber"}`}>
                            {g.on_pace ? "ON PACE" : "BEHIND"}
                          </span>
                        )}
                    </div>
                    <div className="text-[12px] text-dim tabular-nums">
                      {whole(g.current)} of {whole(g.target)} · {g.account_id != null ? acctName(g.account_id) : METRIC[g.metric]}{g.date && ` · by ${monthYear(g.date)}`}
                    </div>
                    {!compact && g.pct < 100 && (
                      <div className="text-[11px] text-faint mt-1 leading-snug">
                        {g.at_date_growth != null && g.date && <>At your plan&apos;s pace you&apos;d have about {isHidden() ? "•••" : whole(g.at_date_growth)} by then
                          (assuming {(g.assumed_growth * 100).toFixed(0)}%/yr growth; {isHidden() ? "•••" : whole(g.at_date_flat ?? 0)} with none). </>}
                        {g.monthly_needed != null && <>Needs {isHidden() ? "•••" : whole(g.monthly_needed)}/mo with no growth. </>}
                        {g.eta_date && <>Plan pace gets there around {monthYear(g.eta_date)}.</>}
                      </div>
                    )}
                  </div>
                  {!compact && (
                    <div className="flex flex-col">
                      <button className="icon-btn" onClick={() => setEditing(g.id)} title="Edit"><Pencil size={13} /></button>
                      <button className="icon-btn" onClick={() => { setDelErr(null); setConfirmDel(confirmDel === g.id ? null : g.id); }} title="Delete" aria-label={`Delete ${g.name}`}><Trash2 size={13} /></button>
                    </div>
                  )}
                </div>
                {confirmDel === g.id && (
                  <div role="group" aria-label={`Delete ${g.name}?`} className="mx-4 mb-3 rounded-xl border border-edge2 p-3 space-y-2">
                    <p className="text-[14px] text-txt">Delete &ldquo;{g.name}&rdquo;?</p>
                    {delErr && <p role="alert" className="text-[13px] text-down">{delErr}</p>}
                    <div className="grid grid-cols-2 gap-2">
                      <button className="btn !min-h-11" onClick={() => setConfirmDel(null)}>Keep</button>
                      <button className="btn !min-h-11 !bg-down !border-down !text-bg" onClick={() => del(g.id)}>Delete</button>
                    </div>
                  </div>
                )}
                {editing === g.id && <Form g={g} accounts={accounts} onDone={done} />}
              </div>
            );
          })}
          {editing === "new" && <Form accounts={accounts} onDone={done} />}
        </div>
      )}
    </section>
  );
}
