"use client";

import InfoTip from "./InfoTip";
import Skeleton from "./Skeleton";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, RefreshCw, Target, Trash2 } from "lucide-react";
import type { ZoneHolding, ZonesResponse } from "@/lib/types";
import { api, fmtPrice } from "@/lib/api";
import { haptic, navigate } from "@/lib/bus";
import { fmtCents, isHidden } from "@/lib/privacy";

interface Sel { kind: "stock" | "crypto"; symbol: string }
interface LadderRow { id: number; price: string; pct: string }
interface Rule { tp: { pct: number; trim: number }[]; stop?: number; trail?: number; heat?: number }
interface Level { id: number; target: number; sellPct: number; effPct: number; units: number; proceeds: number; profit: number | null }

const SEL_KEY = "exitplan:sel";
const draftKey = (s: Sel) => `exitplan:draft:${s.kind}:${s.symbol}`;
const MAX_LEVELS = 6; // the saved exit rule stores at most six take-profit levels
const EPS = 1e-9;

/** Plain-number string for an input box. */
function numStr(n: number): string {
  if (!isFinite(n)) return "";
  if (n >= 1000) return String(Math.round(n));
  if (n >= 1) return String(Number(n.toFixed(2)));
  return String(Number(n.toPrecision(4)));
}
const parse = (s: string): number | null => {
  const n = Number(s.replace(/,/g, "").trim());
  return s.trim() !== "" && isFinite(n) && n > 0 ? n : null;
};
const money = (n: number) => fmtCents(n);
const signedMoney = (n: number) => (isHidden() ? money(n) : `${n < 0 ? "−" : "+"}${money(Math.abs(n))}`);
const signedPct = (n: number) => `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(1)}%`;
const mult = (n: number) => `${Number(n.toFixed(2))}×`;
const units = (n: number) => (isHidden() ? "•••" : n.toLocaleString(undefined, { maximumFractionDigits: 6 }));

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[10px] font-bold tracking-widest text-faint uppercase">{children}</div>
);

export default function ExitPlanner() {
  const [data, setData] = useState<ZonesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [rules, setRules] = useState<Record<string, Rule> | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [rows, setRows] = useState<LadderRow[]>([]);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [stop, setStop] = useState("");
  const [trail, setTrail] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [presetOpen, setPresetOpen] = useState(false);
  const nextId = useRef(1);

  const load = () => {
    setLoading(true);
    setFailed(false);
    api.get<ZonesResponse>("/api/zones").then(setData).catch(() => setFailed(true)).finally(() => setLoading(false));
    api.get<{ rules: Record<string, Rule> }>("/api/exits/rules").then((r) => setRules(r.rules ?? {})).catch(() => setRules((p) => p ?? {}));
  };
  useEffect(load, []);

  const holdings = useMemo(() => data?.holdings ?? [], [data]);

  // Default / remembered holding
  useEffect(() => {
    if (!holdings.length || sel) return;
    let saved: Sel | null = null;
    try { saved = JSON.parse(localStorage.getItem(SEL_KEY) || "null"); } catch { /* unavailable */ }
    const hit = saved && holdings.find((h) => h.symbol === saved!.symbol && h.kind === saved!.kind);
    const h = hit || holdings[0];
    setSel({ kind: h.kind, symbol: h.symbol });
  }, [holdings, sel]);

  const holding: ZoneHolding | null = holdings.find((h) => sel && h.symbol === sel.symbol && h.kind === sel.kind) ?? null;
  const key = sel ? `${sel.kind}:${sel.symbol}` : null;
  const Q = holding?.qty ?? 0;
  const c = holding?.cost_basis && holding.cost_basis > 0 ? holding.cost_basis : null;
  const p = holding?.price && holding.price > 0 ? holding.price : null;
  const base = c ?? p;
  const savedRule = key && rules ? rules[key] ?? null : null;

  // Load the draft for the chosen holding: local draft first, then the saved exit rule.
  useEffect(() => {
    if (!sel || !key || !holding || rules == null) return;
    let next: LadderRow[] | null = null;
    try {
      const d = JSON.parse(localStorage.getItem(draftKey(sel)) || "null");
      if (Array.isArray(d)) next = d.filter((r) => r && typeof r.price === "string" && typeof r.pct === "string").map((r) => ({ id: nextId.current++, price: r.price, pct: r.pct }));
    } catch { /* unavailable */ }
    if (!next) {
      const tp = savedRule?.tp ?? [];
      next = c && tp.length ? tp.map((t) => ({ id: nextId.current++, price: numStr(c * (1 + t.pct / 100)), pct: numStr(t.trim) })) : [];
    }
    setRows(next);
    setStop(savedRule?.stop != null ? numStr(Math.abs(savedRule.stop)) : "");
    setTrail(savedRule?.trail != null ? numStr(savedRule.trail) : "");
    setNote(null);
    setReadyKey(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, holding?.symbol, rules == null]);

  // Keep the draft per symbol so edits survive a reload.
  useEffect(() => {
    if (!sel || readyKey !== key) return;
    try { localStorage.setItem(draftKey(sel), JSON.stringify(rows.map(({ price, pct }) => ({ price, pct })))); } catch { /* unavailable */ }
  }, [rows, readyKey, key, sel]);

  const choose = (s: Sel) => {
    haptic();
    setSel(s);
    try { localStorage.setItem(SEL_KEY, JSON.stringify(s)); } catch { /* unavailable */ }
  };

  // The math. Levels fill from the lowest target up; anything past 100% of the position is ignored.
  const calc = useMemo(() => {
    const valid = rows
      .map((r) => ({ id: r.id, target: parse(r.price), sellPct: parse(r.pct) }))
      .filter((r): r is { id: number; target: number; sellPct: number } => r.target != null && r.sellPct != null)
      .sort((a, b) => a.target - b.target);
    const rawTotal = valid.reduce((s, r) => s + r.sellPct, 0);
    let left = 100;
    const levels: Level[] = valid.map((r) => {
      const effPct = Math.max(0, Math.min(r.sellPct, left));
      left -= effPct;
      const u = (Q * effPct) / 100;
      return { id: r.id, target: r.target, sellPct: r.sellPct, effPct, units: u, proceeds: u * r.target, profit: c != null ? u * (r.target - c) : null };
    });
    const kept = Math.max(0, left);
    const cashed = levels.reduce((s, l) => s + l.proceeds, 0);
    const profit = c != null ? levels.reduce((s, l) => s + (l.profit ?? 0), 0) : null;
    const lastTarget = levels.length ? levels[levels.length - 1].target : p;
    const keptUnits = (Q * kept) / 100;
    return { levels, byId: new Map(levels.map((l) => [l.id, l])), rawTotal, kept, cashed, profit, keptUnits, lastTarget, keptValue: lastTarget != null ? keptUnits * lastTarget : null };
  }, [rows, Q, c, p]);

  const over = calc.rawTotal > 100 + EPS;
  const soldPct = 100 - calc.kept;

  const setRow = (id: number, patch: Partial<LadderRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () => {
    haptic();
    const top = Math.max(0, ...calc.levels.map((l) => l.target), ...rows.map((r) => parse(r.price) ?? 0));
    const ref = top || p || c || 1;
    const fresh = Math.max(0, 100 - calc.rawTotal);
    setRows((rs) => [...rs, { id: nextId.current++, price: numStr(top ? ref * 1.25 : ref * 1.5), pct: numStr(fresh >= 25 ? 25 : fresh || 25) }]);
  };
  const removeRow = (id: number) => { haptic(); setRows((rs) => rs.filter((r) => r.id !== id)); };

  const presets: { label: string; build: () => [number, number][] }[] = base == null ? [] : [
    { label: `Ladder 25% at 2×/3×/4× ${c ? "cost" : "today"}`, build: () => [[2, 25], [3, 25], [4, 25]] },
    { label: "Thirds at +50/+100/+200%", build: () => [[1.5, 33], [2, 33], [3, 34]] },
    c
      ? { label: "Take initial back at 2×", build: () => [[2, 50]] }
      : { label: "Sell half at 2× today", build: () => [[2, 50]] },
  ];
  const applyPreset = (steps: [number, number][]) => {
    if (base == null) return;
    haptic();
    setPresetOpen(false);
    setRows(steps.map(([m, pct]) => ({ id: nextId.current++, price: numStr(base * m), pct: String(pct) })));
    setNote(null);
  };

  // Save to the exit rule: tp pct = target / cost − 1 (as %), trim = sell %; stop is stored negative.
  const tpFromLevels = calc.levels.filter((l) => c != null && l.target > c).slice(0, MAX_LEVELS);
  const dropped = calc.levels.length - tpFromLevels.length;
  const stopV = parse(stop);
  const trailV = parse(trail);
  const canSave = !!key && c != null && (tpFromLevels.length > 0 || stopV != null || trailV != null) && !saving;
  const hasSaved = !!savedRule && (!!savedRule.tp?.length || savedRule.stop != null || savedRule.trail != null);
  const put = async (rule: Rule | null) => {
    if (!key) return null;
    setSaving(true);
    try {
      const res = await api.put<{ rules: Record<string, Rule> }>("/api/exits/rule", { key, rule });
      setRules(res.rules ?? (() => { const n = { ...(rules ?? {}) }; if (rule) n[key] = rule; else delete n[key]; return n; })());
      haptic();
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  };
  const save = async () => {
    if (!key || c == null) return;
    const tp = tpFromLevels.map((l) => ({ pct: Number(((l.target / c - 1) * 100).toFixed(2)), trim: Number(l.effPct.toFixed(2)) }));
    if (!tp.length && stopV == null && trailV == null) return;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { stop: _s, trail: _t, ...rest } = savedRule ?? {};
    const rule: Rule = { ...rest, tp, ...(stopV != null ? { stop: -Math.abs(stopV) } : {}), ...(trailV != null ? { trail: trailV } : {}) };
    const ok = await put(rule);
    const parts = [tp.length ? `${tp.length} sell level${tp.length === 1 ? "" : "s"}` : "", stopV != null ? "a stop loss" : "", trailV != null ? "a trailing stop" : ""].filter(Boolean);
    setNote(ok ? `Saved ${parts.join(", ").replace(/, ([^,]*)$/, " and $1")}. You'll get a notification when one is reached.` : "Couldn't save the plan. Try again.");
  };
  const removePlan = async () => {
    const ok = await put(null);
    if (ok) { setRows([]); setStop(""); setTrail(""); setNote("Plan removed."); } else setNote("Couldn't remove the plan. Try again.");
  };

  const planned = useMemo(() => new Set(Object.entries(rules ?? {}).filter(([, v]) => v && (v.tp?.length || v.stop != null || v.trail != null)).map(([k]) => k)), [rules]);
  const hasRows = rows.length > 0;
  const allNow = p != null ? Q * p : null;
  const planTotal = calc.cashed + (calc.keptValue ?? 0);
  const diff = allNow != null ? planTotal - allNow : null;
  const sym = holding?.symbol ?? "";

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><Target size={14} /> Sell Plan</span>
        <div className="flex items-center gap-2">
          <InfoTip topic="the sell plan">
            <p>Plan your sells like a budget: pick the prices you would sell at and how much of today&apos;s position goes at each one. The totals show what you would cash out and keep.</p>
            <p>Saved plans are checked every 10 minutes and you get a notification when a level is reached. You can also add a stop loss or a trailing stop to protect the downside.</p>
          </InfoTip>
          <button className="btn !py-1.5 !px-2" onClick={load} disabled={loading} title="Refresh" aria-label="Refresh holdings">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {loading && !data && <div className="p-3 space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>}
      {failed && !data && <p className="px-3 py-6 text-center text-dim text-xs">Couldn&apos;t load your holdings. Try refresh.</p>}

      {data && (
        <>
          {/* Picker */}
          <div className="px-3 py-2 border-b border-edge">
            <div className="flex gap-1.5 overflow-x-auto pr-6 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]" data-noswipe>
              {holdings.map((h) => {
                const on = sel?.symbol === h.symbol && sel.kind === h.kind;
                return (
                  <button key={`${h.kind}-${h.symbol}`} onClick={() => choose({ kind: h.kind, symbol: h.symbol })} aria-pressed={on}
                          className={`shrink-0 h-10 px-3 inline-flex items-center rounded-md border text-[12px] font-semibold focus-visible:outline-2 focus-visible:outline-cyan ${on ? "border-up/50 bg-up/10 text-up" : "border-edge2 text-dim"}`}>
                    {h.symbol}
                    {planned.has(`${h.kind}:${h.symbol}`) && <><span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-up" aria-hidden /><span className="sr-only"> (has a plan)</span></>}
                  </button>
                );
              })}
              {holdings.length === 0 && <span className="text-xs text-dim self-center">No holdings yet</span>}
            </div>
          </div>

          {holdings.length === 0 ? (
            <div className="px-3 py-4 flex flex-wrap items-center gap-3">
              <p className="text-xs text-dim">Add holdings in Wealth to plan your exits.</p>
              <button className="btn min-h-10" onClick={() => navigate({ tab: "wealth", anchor: "sec-wealth" })}>Go to Wealth</button>
            </div>
          ) : !holding ? null : (
            <div className="p-3 space-y-4">
              <p className="text-[13px] text-dim tabular-nums leading-snug">
                You hold <span className="font-bold text-txt">{units(Q)} {sym}</span>
                {" · "}cost {c != null ? <span className="text-txt font-semibold">{isHidden() ? "$•••••" : `$${fmtPrice(c)}`}</span> : "not set"}
                {" · "}now <span className="text-txt font-semibold">{p != null ? `$${fmtPrice(p)}` : "—"}</span>
              </p>

              {/* Totals */}
              <div className="rounded-xl border border-edge bg-panel2/40 p-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <Label>Total cashed out</Label>
                    <div className="mt-1 text-[22px] leading-none font-bold tabular-nums text-txt truncate">{money(calc.cashed)}</div>
                  </div>
                  <div className="min-w-0">
                    <Label>Total profit</Label>
                    <div className={`mt-1 text-[22px] leading-none font-bold tabular-nums truncate ${calc.profit == null ? "text-dim" : calc.profit >= 0 ? "text-up" : "text-down"}`}>
                      {calc.profit == null ? "—" : signedMoney(calc.profit)}
                    </div>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <Label>Still holding</Label>
                    <div className="mt-1 text-[13px] tabular-nums text-txt">
                      <span className="font-bold">{units(calc.keptUnits)} {sym}</span>
                      <span className="text-dim"> · {calc.keptValue != null ? money(calc.keptValue) : "—"}{calc.lastTarget != null ? ` at $${fmtPrice(calc.lastTarget)}` : ""}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div role="img" aria-label={`Position: ${soldPct.toFixed(0)}% sold across ${calc.levels.length} levels, ${calc.kept.toFixed(0)}% kept`}
                       className="flex h-3 gap-0.5 overflow-hidden rounded-full">
                    {calc.levels.filter((l) => l.effPct > 0).map((l, i) => (
                      <div key={l.id} className="h-full bg-up first:rounded-l-full" style={{ width: `${l.effPct}%`, opacity: Math.max(0.35, 1 - i * 0.18) }} />
                    ))}
                    <div className="h-full flex-1 bg-edge2 last:rounded-full" style={{ minWidth: calc.kept > 0 ? undefined : 0 }} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-dim tabular-nums">
                    <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-up" aria-hidden />Sold {Number(soldPct.toFixed(1))}%{calc.levels.length ? ` in ${calc.levels.length} level${calc.levels.length === 1 ? "" : "s"}` : ""}</span>
                    <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-edge2" aria-hidden />Kept {Number(calc.kept.toFixed(1))}%</span>
                  </div>
                </div>

                {over && (
                  <p role="status" className="text-[12px] text-amber leading-snug">
                    Your levels add up to {Number(calc.rawTotal.toFixed(1))}% of the position. Only the first 100% counts, starting from the lowest target.
                  </p>
                )}
              </div>

              {/* Presets */}
              {presets.length > 0 && (
                <div>
                  <button className="btn min-h-10" onClick={() => setPresetOpen((o) => !o)} aria-expanded={presetOpen} aria-controls="exit-presets">
                    Start from a preset
                    <ChevronDown size={14} className={`motion-safe:transition-transform ${presetOpen ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                  {presetOpen && (
                    <ul id="exit-presets" className="mt-1.5 rounded-xl border border-edge2 bg-panel2/60 divide-y divide-edge overflow-hidden">
                      {presets.map((ps) => (
                        <li key={ps.label}>
                          <button onClick={() => applyPreset(ps.build())}
                                  className="w-full min-h-11 px-3 py-2 text-left text-[13px] font-semibold text-dim hover:text-txt hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan">
                            {ps.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {c == null && (
                <p className="text-[12px] text-dim leading-snug">
                  No cost basis on file, so profit can&apos;t be worked out and presets use today&apos;s price.{" "}
                  <button className="text-up font-semibold underline-offset-2 hover:underline min-h-10 focus-visible:outline-2 focus-visible:outline-cyan" onClick={() => navigate({ tab: "wealth", anchor: "sec-wealth" })}>Add cost basis in Wealth</button>
                </p>
              )}

              {/* Ladder */}
              <div className="space-y-2">
                <Label>Sell ladder</Label>
                {!hasRows && <p className="text-[12px] text-dim">No sell levels yet. Pick a preset or add your first level.</p>}
                {hasRows && (
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px] gap-2 px-0.5 field-label" aria-hidden>
                    <span>Target price ($)</span><span>Sell (% of position)</span><span />
                  </div>
                )}
                {rows.map((r, i) => {
                  const l = calc.byId.get(r.id);
                  const clipped = l != null && l.effPct < l.sellPct - EPS;
                  return (
                    <div key={r.id}>
                      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px] gap-2 items-center">
                        <input className="field !h-10 tabular-nums" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={r.price} aria-label={`Level ${i + 1} target price in dollars`}
                               onChange={(e) => setRow(r.id, { price: e.target.value })} />
                        <input className="field !h-10 tabular-nums" inputMode="decimal" autoComplete="off" enterKeyHint="done" value={r.pct} aria-label={`Level ${i + 1} percent of position to sell`}
                               onChange={(e) => setRow(r.id, { pct: e.target.value })} />
                        <button onClick={() => removeRow(r.id)} aria-label={`Remove level ${i + 1}`}
                                className="h-10 w-10 inline-flex items-center justify-center rounded-md text-faint hover:text-down focus-visible:outline-2 focus-visible:outline-cyan">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <p className="mt-1 px-0.5 text-[11px] text-dim tabular-nums leading-snug">
                        {l ? (
                          <>
                            {units(l.units)} {sym} · {money(l.proceeds)}
                            {l.profit != null && <> · <span className={l.profit >= 0 ? "text-up" : "text-down"}>{signedMoney(l.profit)}</span></>}
                            {c != null ? <> · {mult(l.target / c)}</> : p != null ? <> · {signedPct((l.target / p - 1) * 100)} vs today</> : null}
                            {clipped && <span className="text-amber"> · only {Number(l.effPct.toFixed(1))}% fits</span>}
                          </>
                        ) : (
                          <span className="text-faint">Enter a price and a percent to see the numbers.</span>
                        )}
                      </p>
                    </div>
                  );
                })}
                <div className="flex flex-wrap gap-2">
                  <button className="btn min-h-10" onClick={addRow} disabled={rows.length >= 12}><Plus size={14} /> Add level</button>
                  {hasRows && <button className="btn min-h-10" onClick={() => { haptic(); setRows([]); setNote(null); }}>Clear</button>}
                </div>
              </div>

              {/* Downside protection */}
              <div className="space-y-2">
                <Label>Protect the downside</Label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="field-wrap"><span className="field-label">Stop loss (% below cost)</span>
                    <input className="field !h-10 tabular-nums w-full" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={stop} onChange={(e) => setStop(e.target.value)} /></label>
                  <label className="field-wrap"><span className="field-label">Trailing stop (% off high)</span>
                    <input className="field !h-10 tabular-nums w-full" inputMode="decimal" autoComplete="off" enterKeyHint="done" value={trail} onChange={(e) => setTrail(e.target.value)} /></label>
                </div>
                <p className="text-[11px] text-faint leading-snug">Optional. You get a notification if price falls this far below your cost, or this far off its high.</p>
              </div>

              {/* Compare with selling everything now */}
              {allNow != null && hasRows && diff != null && (
                <p className="text-[13px] text-dim leading-snug tabular-nums">
                  Selling everything today gives <span className="text-txt font-semibold">{money(allNow)}</span>. If every target is reached, this plan is{" "}
                  <span className={`font-semibold ${diff >= 0 ? "text-up" : "text-down"}`}>{isHidden() ? "" : money(Math.abs(diff)) + " "}{diff >= 0 ? "more" : "less"}</span>.
                </p>
              )}

              {/* Save */}
              <div className="border-t border-edge pt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn btn-primary min-h-10" onClick={save} disabled={!canSave}>{saving ? "Saving…" : "Save plan"}</button>
                  {hasSaved && <button className="btn min-h-10" onClick={removePlan} disabled={saving}>Remove plan</button>}
                  {savedRule?.tp?.length ? <span className="text-[11px] text-faint tabular-nums">Saved plan: {savedRule.tp.length} level{savedRule.tp.length === 1 ? "" : "s"}</span> : null}
                </div>
                <p className="text-[11px] text-faint leading-snug" aria-live="polite">
                  {c == null
                    ? "Saving needs a cost basis, because levels and stops are measured against your cost. Add one in Wealth."
                    : note ?? (dropped > 0
                      ? `${dropped} level${dropped === 1 ? " is" : "s are"} at or below your cost or past the six-level limit and won't be saved.`
                      : "Saved plans are checked every 10 minutes and you get a notification when a level is reached.")}
                </p>
              </div>
            </div>
          )}

          <p className="px-3 py-3 text-[10.5px] text-faint border-t border-edge">Planning tool, not financial advice. Taxes not included.</p>
        </>
      )}
    </section>
  );
}
