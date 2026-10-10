"use client";

import InfoTip from "./InfoTip";
import { useEffect, useState } from "react";
import { ChevronDown, Hourglass, Plus, RefreshCw, Target, Trash2 } from "lucide-react";
import { api, fmtPrice } from "@/lib/api";
import { haptic, navigate, openTicker } from "@/lib/bus";
import { fmtCents, isHidden } from "@/lib/privacy";
import Skeleton from "./Skeleton";

interface Sig { name: string; value: string; heat: number | null; note: string }
interface Heat {
  short: number | null; mid: number | null; long: number | null; overall: number | null;
  labels?: { short: string; mid: string; long: string; overall: string };
  daily_vol_pct?: number; signals: { short: Sig[]; mid: Sig[]; long: Sig[] };
}
interface Opt {
  underlying: string; underlying_price: number | null; strike: number; right: "call" | "put"; expiry: string; dte: number;
  moneyness_pct?: number; itm?: boolean; intrinsic?: number; time_value?: number; time_value_share?: number | null;
  fade_30d?: number; breakeven?: number; to_breakeven_pct?: number; per_day_now?: number;
}
interface Rule { tp: { pct: number; trim: number }[]; stop?: number; trail?: number; heat?: number }
interface Row {
  key: string; kind: "crypto" | "stock" | "option"; symbol: string; display: string; qty: number; value: number;
  price: number | null; change_1d: number | null; accounts: string[];
  gain_pct: number | null; gain_usd: number | null; weight_pct: number; heat: Heat; option: Opt | null;
  from_high_pct: number | null; rule: Rule | null; hits: { id: string; tone: "up" | "down" | "amber"; text: string }[];
}
interface Desk { rows: Row[] }

function heatColor(h: number | null): string {
  if (h == null) return "var(--color-faint)";
  if (h < 30) return "var(--color-cyan)";
  if (h < 45) return "var(--color-up)";
  if (h < 58) return "var(--color-dim)";
  if (h < 70) return "var(--color-amber)";
  if (h < 82) return "var(--color-warn)";
  return "var(--color-down)";
}

function Bar({ h, label }: { h: number | null; label: string }) {
  return (
    <div className="min-w-0">
      <div className="flex justify-between text-[10px]"><span className="text-faint">{label}</span>
        <span className="font-bold tabular-nums" style={{ color: heatColor(h) }}>{h != null ? h.toFixed(0) : "—"}</span></div>
      <div className="h-1.5 rounded-full bg-edge mt-1 relative overflow-hidden"
           style={{ background: "linear-gradient(90deg, var(--color-cyan), var(--color-up) 35%, var(--color-dim) 52%, var(--color-amber) 66%, var(--color-down))", opacity: 0.35 }} />
      {h != null && (
        <div className="relative h-0">
          <span className="absolute -top-[9px] w-2.5 h-2.5 rounded-full border-2 border-bg" style={{ left: `calc(${h}% - 5px)`, background: heatColor(h) }} />
        </div>
      )}
    </div>
  );
}

const PRESETS: [string, Rule][] = [
  ["Ladder 50/100/200", { tp: [{ pct: 50, trim: 25 }, { pct: 100, trim: 25 }, { pct: 200, trim: 25 }], stop: -35 }],
  ["Swing 20/40 + stop", { tp: [{ pct: 20, trim: 33 }, { pct: 40, trim: 33 }], stop: -15, trail: 12 }],
  ["Options 100% + decay", { tp: [{ pct: 100, trim: 50 }], stop: -50, heat: 80 }],
];

function RuleEditor({ row, onSaved }: { row: Row; onSaved: () => void }) {
  const [r, setR] = useState<Rule>(row.rule ?? { tp: [] });
  const save = async (rule: Rule | null) => {
    await api.put("/api/exits/rule", { key: row.key, rule });
    haptic();
    onSaved();
  };
  const num = (v: string) => (v === "" ? undefined : Number(v));
  return (
    <div className="mt-3 rounded-xl border border-edge bg-panel2/30 p-3 space-y-2 text-[12px]">
      <div className="text-[10px] font-bold tracking-widest text-faint">YOUR SELL PLAN</div>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(([n, p]) => (
          <button key={n} onClick={() => setR(p)} className="chip-tap min-h-10 px-3 rounded-md border border-edge2 text-[11px] font-semibold text-dim hover:text-txt">{n}</button>
        ))}
      </div>
      {r.tp.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-dim w-8 sm:w-20 shrink-0"><span className="sm:hidden">TP{i + 1}</span><span className="hidden sm:inline">Take profit</span></span>
          <span className="text-faint"><span className="hidden sm:inline">at </span>+</span>
          <input className="field !py-1 max-sm:flex-1 sm:w-16 min-w-0" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={t.pct}
                 onChange={(e) => setR({ ...r, tp: r.tp.map((x, j) => (j === i ? { ...x, pct: Number(e.target.value) } : x)) })} />
          <span className="text-faint whitespace-nowrap">% trim</span>
          <input className="field !py-1 max-sm:flex-1 sm:w-14 min-w-0" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={t.trim}
                 onChange={(e) => setR({ ...r, tp: r.tp.map((x, j) => (j === i ? { ...x, trim: Number(e.target.value) } : x)) })} />
          <span className="text-faint">%</span>
          <button className="icon-btn ml-auto h-10 w-10" aria-label="Remove level" onClick={() => setR({ ...r, tp: r.tp.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
        </div>
      ))}
      <button className="min-h-10 text-[11px] text-up font-semibold flex items-center gap-1"
              onClick={() => setR({ ...r, tp: [...r.tp, { pct: (r.tp.at(-1)?.pct ?? 0) + 50, trim: 25 }] })}>
        <Plus size={12} /> add take-profit level
      </button>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <label className="field-wrap"><span className="field-label">Stop at −%</span>
          <input className="field !py-1 w-full" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={r.stop != null ? Math.abs(r.stop) : ""} onChange={(e) => setR({ ...r, stop: num(e.target.value) })} /></label>
        <label className="field-wrap"><span className="field-label">Trail % off high</span>
          <input className="field !py-1 w-full" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={r.trail ?? ""} onChange={(e) => setR({ ...r, trail: num(e.target.value) })} /></label>
        <label className="field-wrap max-sm:col-span-2"><span className="field-label">Flag heat ≥</span>
          <input className="field !py-1 w-full" inputMode="decimal" autoComplete="off" enterKeyHint="done" value={r.heat ?? ""} onChange={(e) => setR({ ...r, heat: num(e.target.value) })} /></label>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        {row.rule && <button className="btn min-h-10" onClick={() => save(null)}>Remove plan</button>}
        <button className="btn btn-primary min-h-10" onClick={() => save(r)}>Save plan</button>
      </div>
      <p className="text-[10px] text-faint">Checked every 10 minutes. When a level hits you get a push notification (if on), once per hit.</p>
    </div>
  );
}

function RowCard({ row, onSaved }: { row: Row; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const h = row.heat;
  const o = row.option;
  const target = row.kind === "option" && o ? { symbol: o.underlying, kind: "stock" as const } : { symbol: row.symbol, kind: row.kind as "crypto" | "stock" };
  return (
    <div className="border-t border-edge/60 first:border-t-0">
      <button className="w-full text-left px-4 py-3 min-h-10" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0 border"
               style={{ borderColor: heatColor(h.overall), background: `color-mix(in srgb, ${heatColor(h.overall)} 12%, transparent)` }}>
            <span className="text-[16px] font-extrabold tabular-nums leading-none" style={{ color: heatColor(h.overall) }}>{h.overall?.toFixed(0) ?? "—"}</span>
            <span className="text-[8px] font-bold uppercase text-faint mt-0.5">heat</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-txt truncate">{row.display}</span>
              <span className="text-[10px] font-bold" style={{ color: heatColor(h.overall) }}>{h.labels?.overall}</span>
            </div>
            <div className="text-[11px] text-faint truncate tabular-nums">
              {fmtCents(row.value)} · {row.weight_pct}% of holdings
              {row.gain_pct != null && <> · <span className={row.gain_pct >= 0 ? "text-up" : "text-down"}>{row.gain_pct >= 0 ? "+" : ""}{row.gain_pct.toFixed(1)}%</span></>}
              {row.from_high_pct != null && <> · {row.from_high_pct.toFixed(0)}% off 3M high</>}
            </div>
          </div>
          <ChevronDown size={16} className={`text-faint transition-transform shrink-0 ${open ? "" : "-rotate-90"}`} />
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <Bar h={h.short} label="Short" />
          <Bar h={h.mid} label="Mid" />
          <Bar h={h.long} label="Long" />
        </div>
        {row.hits.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {row.hits.map((x) => (
              <span key={x.id} className={`text-[10.5px] font-bold px-2 py-0.5 rounded-md ${x.tone === "up" ? "bg-up/15 text-up" : x.tone === "down" ? "bg-down/15 text-down" : "bg-amber/15 text-amber"}`}>
                <Target size={10} className="inline -mt-0.5 mr-1" />{x.text}
              </span>
            ))}
          </div>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4">
          {o && (
            <div className="rounded-xl border border-edge bg-panel2/30 p-3 mb-3">
              <div className="text-[10px] font-bold tracking-widest text-faint mb-2 flex items-center gap-1"><Hourglass size={11} /> OPTION CLOCK</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[12px]">
                <Cell k="Expires" v={`${new Date(o.expiry + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric", year: "2-digit" })} · ${o.dte}d`}
                      tone={o.dte < 60 ? "text-down" : o.dte < 150 ? "text-amber" : undefined} />
                <Cell k={`${o.underlying} vs $${o.strike} strike`} v={o.moneyness_pct != null ? `${o.moneyness_pct >= 0 ? "+" : ""}${o.moneyness_pct.toFixed(1)}% ${o.itm ? "ITM" : "OTM"}` : "—"} />
                <Cell k="Breakeven at expiry" v={o.breakeven != null ? `$${fmtPrice(o.breakeven)} (${(o.to_breakeven_pct ?? 0) >= 0 ? "+" : ""}${o.to_breakeven_pct?.toFixed(1)}%)` : "—"} />
                <Cell k="Time value (of price)" v={o.time_value_share != null ? `${o.time_value_share.toFixed(0)}% · ${isHidden() ? "•••" : fmtCents(o.time_value ?? 0)}` : "—"} />
                <Cell k="Fades in next 30d" v={o.fade_30d != null ? (isHidden() ? "•••" : `≈ ${fmtCents(o.fade_30d)}`) : "—"} tone="text-amber" />
                <Cell k="Decay per day now" v={o.per_day_now != null ? (isHidden() ? "•••" : `≈ ${fmtCents(o.per_day_now)}`) : "—"} />
              </div>
              <p className="text-[10.5px] text-faint mt-2 leading-relaxed">
                If {o.underlying} doesn&apos;t move, the time-value part of the price shrinks, slowly now and faster in the last ~60 days.
                Estimates use the square-root-of-time rule, not a full options model.
              </p>
            </div>
          )}
          {(["short", "mid", "long"] as const).map((hz) => (
            <div key={hz} className="mb-2">
              <div className="text-[10px] font-bold tracking-widest text-faint uppercase">
                {hz === "short" ? "Short term" : hz === "mid" ? "Mid term" : "Long term"} · <span style={{ color: heatColor(h[hz]) }}>{h.labels?.[hz]}</span>
              </div>
              {h.signals[hz].map((s) => (
                <div key={s.name} className="flex items-start gap-2 py-1.5 border-b border-edge/40 last:border-b-0">
                  <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: heatColor(s.heat) }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2 text-[12px]"><span className="text-txt font-semibold">{s.name}</span>
                      <span className="tabular-nums text-dim">{s.value}</span></div>
                    <div className="text-[10.5px] text-faint leading-snug">{s.note}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div className="flex gap-2 mt-2">
            <button className="btn min-h-10" onClick={() => openTicker(target)}>Chart & details</button>
            <button className={`min-h-10 btn ${edit ? "" : "btn-primary"}`} onClick={() => setEdit(!edit)}>
              <Target size={12} /> {row.rule ? "Edit sell plan" : "Set sell plan"}
            </button>
          </div>
          {edit && <RuleEditor row={row} onSaved={() => { setEdit(false); onSaved(); }} />}
        </div>
      )}
    </div>
  );
}

function Cell({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg bg-panel/60 px-2.5 py-1.5 min-w-0">
      <div className="text-[10px] text-faint truncate">{k}</div>
      <div className={`font-bold tabular-nums truncate ${tone ?? "text-txt"}`}>{v}</div>
    </div>
  );
}

/** Options you hold: heat for the underlying, the option clock, and your sell plan per contract. */
export default function OptionsPlan() {
  const [d, setD] = useState<Desk | null>(null);
  const [loading, setLoading] = useState(false);
  const load = () => { setLoading(true); api.get<Desk>("/api/exits?kind=option").then(setD).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); const t = setInterval(load, 300_000); return () => clearInterval(t); }, []);

  const rows = d?.rows ?? [];
  const noCost = rows.filter((r) => r.gain_pct == null).length;

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="text-[12px] text-dim">Options you hold</span>
        <div className="flex items-center gap-1">
          <InfoTip topic="options you hold" title="Reading your options">
            <p>Heat is 0-100 for the stock behind the option: under 30 = washed out, 45-58 = neutral, over 70 = stretched, over 82 = overheated. It describes how stretched price is, not where it goes next.</p>
            <p>The option clock shows what time is costing you: days to expiry, breakeven, and how much of the price is time value that fades if the stock doesn&apos;t move.</p>
            <p>Sell plans are checked every 10 minutes. When a level hits you get a push notification (if on), once per hit.</p>
          </InfoTip>
          <button className="btn min-h-10 min-w-10 !px-2" onClick={load} disabled={loading} title="Refresh" aria-label="Refresh"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
        </div>
      </div>

      <p className="px-4 pt-2 text-[10.5px] text-faint">Tap a row for the data behind it.</p>

      {!d ? (
        <div className="p-3 space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : (
        <>
          {rows.map((r) => <RowCard key={r.key} row={r} onSaved={load} />)}
          {!rows.length && <p className="px-4 py-5 text-[12px] text-dim">No options held right now.</p>}
          <div className="px-4 py-3 border-t border-edge text-[10.5px] text-faint leading-relaxed space-y-1">
            {noCost > 0 && <p>{noCost} {noCost === 1 ? "option has" : "options have"} no cost basis, so gains and % rules can&apos;t be checked.{" "}
              <button className="text-up font-semibold min-h-10" onClick={() => navigate({ tab: "wealth", anchor: "sec-wealth" })}>Add cost basis in Wealth →</button></p>}
            <p>Not financial advice. The decision is yours; this is the data and your own plan side by side.</p>
          </div>
        </>
      )}
    </section>
  );
}
