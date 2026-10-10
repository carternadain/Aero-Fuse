"use client";

import { useEffect, useState } from "react";
import { Flag, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { haptic, navigate } from "@/lib/bus";
import { fmtCents, isHidden } from "@/lib/privacy";
import Skeleton from "./Skeleton";

interface Goal {
  id: string; name: string; target: number; date: string | null; metric: "net_worth" | "invested" | "cash";
  current: number; pct: number; months_left: number | null;
  at_date_flat: number | null; at_date_growth: number | null; monthly_needed: number | null;
  eta_months: number | null; eta_date: string | null; on_pace: boolean | null; assumed_growth: number;
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

function Form({ g, onDone }: { g?: Partial<Goal>; onDone: (rows?: Goal[]) => void }) {
  const [f, setF] = useState({ name: g?.name ?? "", target: g?.target ? String(g.target) : "", date: g?.date ?? "", metric: g?.metric ?? "net_worth" });
  const save = async () => {
    const target = parseFloat(f.target.replace(/[$,]/g, ""));
    if (!f.name.trim() || !(target > 0)) return;
    const r = await api.post<{ goals: Goal[] }>("/api/goals", { id: g?.id, name: f.name.trim(), target, date: f.date || null, metric: f.metric });
    haptic();
    onDone(r.goals);
  };
  return (
    <div className="p-3 space-y-2 border-t border-edge bg-panel2/30">
      <label className="field-wrap"><span className="field-label">Goal name</span>
        <input className="field w-full" placeholder="e.g. $100k club" autoComplete="off" enterKeyHint="next" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <div className="grid grid-cols-3 max-sm:grid-cols-2 gap-2">
        <label className="field-wrap"><span className="field-label">Target $</span>
          <input className="field" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></label>
        <label className="field-wrap"><span className="field-label">Target date</span>
          <input className="field" type="date" enterKeyHint="done" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="field-wrap max-sm:col-span-2"><span className="field-label">Track</span>
          <select className="field" value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value as Goal["metric"] })}>
            {Object.entries(METRIC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
      </div>
      <div className="flex gap-2 justify-end">
        <button className="btn" onClick={() => onDone()}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>Save goal</button>
      </div>
    </div>
  );
}

/** Goals with a progress ring and simple pace math from the savings plan. */
export default function Goals({ compact = false }: { compact?: boolean }) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  useEffect(() => { api.get<{ goals: Goal[] }>("/api/goals").then((r) => setGoals(r.goals)).catch(() => setGoals([])); }, []);

  const done = (rows?: Goal[]) => { if (rows) setGoals(rows); setEditing(null); };
  const del = async (id: string) => { const r = await api.del<{ goals: Goal[] }>(`/api/goals/${id}`); setGoals(r.goals); };

  const shown = compact ? (goals ?? []).slice(0, 2) : goals ?? [];

  return (
    <section className="panel">
      <div className="panel-head">
        {/* Home has no section heading above this card, so it keeps its title there */}
        {compact ? <span className="panel-title"><Flag size={14} />Goals</span>
          : <span className="text-[12px] text-dim">Targets and whether you're on pace</span>}
        {compact ? (
          <button className="text-[10px] font-bold text-dim hover:text-txt" onClick={() => navigate({ tab: "wealth", anchor: "sec-goals" })}>Manage</button>
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
                      {whole(g.current)} of {whole(g.target)} · {METRIC[g.metric]}{g.date && ` · by ${monthYear(g.date)}`}
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
                      <button className="icon-btn" onClick={() => del(g.id)} title="Delete"><Trash2 size={13} /></button>
                    </div>
                  )}
                </div>
                {editing === g.id && <Form g={g} onDone={done} />}
              </div>
            );
          })}
          {editing === "new" && <Form onDone={done} />}
        </div>
      )}
    </section>
  );
}
