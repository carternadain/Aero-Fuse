"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CandlestickChart, Droplets, Plus, Trash2, X } from "lucide-react";
import type { Trade } from "@/lib/types";
import { api, fmtPnl, fmtPrice, timeAgo } from "@/lib/api";
import { askConfirm } from "./DialogHost";

const SOURCES = ["both", "neurowave", "kryptonite", "manual"];

function computeRR(direction: string, entry: number, sl: number, tp1: number): number | null {
  const risk = Math.abs(entry - sl);
  if (!risk) return null;
  const reward = direction === "long" ? tp1 - entry : entry - tp1;
  return Math.round((reward / risk) * 100) / 100;
}

// ── New trade form ──────────────────────────────────────

function TradeForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    asset: "SOL", direction: "long", entry: "", sl: "", tp1: "", tp2: "", tp3: "",
    risk_pct: "1", signal_source: "both", liquidity_sweep: true, htf_aligned: true, notes: "",
  });
  const [err, setErr] = useState("");
  const set = (k: string, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const entry = parseFloat(f.entry), sl = parseFloat(f.sl), tp1 = parseFloat(f.tp1);
  const rr = !isNaN(entry) && !isNaN(sl) && !isNaN(tp1) ? computeRR(f.direction, entry, sl, tp1) : null;

  // Auto-fill fib extension TPs from entry + SL (1.618 / 2.618 / 3.618 of risk)
  const autoFib = () => {
    if (isNaN(entry) || isNaN(sl)) return;
    const risk = Math.abs(entry - sl);
    const sign = f.direction === "long" ? 1 : -1;
    const round = (n: number) => String(Math.round(n * 10000) / 10000);
    setF((p) => ({
      ...p,
      tp1: round(entry + sign * risk * 1.618),
      tp2: round(entry + sign * risk * 2.618),
      tp3: round(entry + sign * risk * 3.618),
    }));
  };

  const submit = async () => {
    if (isNaN(entry) || isNaN(sl)) { setErr("Entry and SL are required"); return; }
    if (rr !== null && rr < 2) {
      if (!(await askConfirm(`RR is ${rr} — below your 2:1 minimum. Take it anyway?`, false))) return;
    }
    try {
      await api.post("/api/trades", {
        asset: f.asset, direction: f.direction, entry, sl,
        tp1: f.tp1 ? parseFloat(f.tp1) : null,
        tp2: f.tp2 ? parseFloat(f.tp2) : null,
        tp3: f.tp3 ? parseFloat(f.tp3) : null,
        risk_pct: parseFloat(f.risk_pct) || 1,
        signal_source: f.signal_source,
        liquidity_sweep: f.liquidity_sweep,
        htf_aligned: f.htf_aligned,
        notes: f.notes,
      });
      onDone();
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onCancel}>
      <div className="panel w-full max-w-lg p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="panel-title">New Trade</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input className="field" placeholder="Asset" value={f.asset} onChange={(e) => set("asset", e.target.value.toUpperCase())} />
          <select className="field" value={f.direction} onChange={(e) => set("direction", e.target.value)}>
            <option value="long">LONG</option><option value="short">SHORT</option>
          </select>
          <select className="field" value={f.signal_source} onChange={(e) => set("signal_source", e.target.value)}>
            {SOURCES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
          <input className="field" placeholder="Risk %" value={f.risk_pct} onChange={(e) => set("risk_pct", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input className="field" placeholder="Entry *" value={f.entry} onChange={(e) => set("entry", e.target.value)} />
          <input className="field" placeholder="Stop Loss *" value={f.sl} onChange={(e) => set("sl", e.target.value)} />
        </div>
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
          <input className="field" placeholder="TP1 (1.618)" value={f.tp1} onChange={(e) => set("tp1", e.target.value)} />
          <input className="field" placeholder="TP2 (2.618)" value={f.tp2} onChange={(e) => set("tp2", e.target.value)} />
          <input className="field" placeholder="TP3 (3.618)" value={f.tp3} onChange={(e) => set("tp3", e.target.value)} />
          <button className="btn" title="Auto-fill fib extensions from entry/SL" onClick={autoFib}>FIB</button>
        </div>
        <div className="flex gap-4 text-[11px] text-dim">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={f.liquidity_sweep} onChange={(e) => set("liquidity_sweep", e.target.checked)} />
            Liquidity sweep ✓
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={f.htf_aligned} onChange={(e) => set("htf_aligned", e.target.checked)} />
            HTF aligned ✓
          </label>
          {rr !== null && (
            <span className={`ml-auto font-bold ${rr >= 2 ? "text-up" : "text-down"}`}>RR {rr}:1</span>
          )}
        </div>
        <textarea className="field" rows={2} placeholder="Notes / setup description" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        {err && <p className="text-[11px] text-down">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}>Log Trade</button>
        </div>
      </div>
    </div>
  );
}

// ── Close / partial dialog ──────────────────────────────

function CloseDialog({ trade, onDone, onCancel }: { trade: Trade; onDone: () => void; onCancel: () => void }) {
  const [mode, setMode] = useState<"close" | "partial">("close");
  const [price, setPrice] = useState("");
  const [pct, setPct] = useState("50");
  const [level, setLevel] = useState("TP1");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");

  const submit = async () => {
    const p = parseFloat(price);
    if (isNaN(p)) { setErr("Price required"); return; }
    try {
      if (mode === "close") {
        await api.post(`/api/trades/${trade.id}/close`, { exit_price: p, notes });
      } else {
        await api.post(`/api/trades/${trade.id}/partial`, { pct: parseFloat(pct) || 50, price: p, level });
      }
      onDone();
    } catch (e) { setErr(String(e)); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onCancel}>
      <div className="panel w-full max-w-sm p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="panel-title">#{trade.id} {trade.asset} {trade.direction.toUpperCase()}</h3>
        <div className="flex gap-2">
          <button className={`btn flex-1 ${mode === "close" ? "btn-primary" : ""}`} onClick={() => setMode("close")}>Full Close</button>
          <button className={`btn flex-1 ${mode === "partial" ? "btn-primary" : ""}`} onClick={() => setMode("partial")}>Partial</button>
        </div>
        <input className="field" placeholder="Exit price *" value={price} onChange={(e) => setPrice(e.target.value)} />
        {mode === "partial" && (
          <div className="grid grid-cols-2 gap-2">
            <input className="field" placeholder="% closed" value={pct} onChange={(e) => setPct(e.target.value)} />
            <select className="field" value={level} onChange={(e) => setLevel(e.target.value)}>
              {["TP1", "TP2", "TP3", "manual"].map((l) => <option key={l}>{l}</option>)}
            </select>
          </div>
        )}
        {mode === "close" && (
          <input className="field" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        )}
        {err && <p className="text-[11px] text-down">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}>{mode === "close" ? "Close Trade" : "Log Partial"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Main tracker ────────────────────────────────────────

export default function TradeTracker({ trades, onChanged }: { trades: Trade[]; onChanged: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [closing, setClosing] = useState<Trade | null>(null);
  const [filter, setFilter] = useState({ status: "", asset: "", source: "" });
  const [expanded, setExpanded] = useState<number | null>(null);

  const assets = useMemo(() => [...new Set(trades.map((t) => t.asset))], [trades]);

  const filtered = trades.filter(
    (t) =>
      (!filter.status || (filter.status === "open" ? t.status !== "closed" : t.status === "closed")) &&
      (!filter.asset || t.asset === filter.asset) &&
      (!filter.source || t.signal_source === filter.source)
  );

  const del = async (id: number) => {
    if (!(await askConfirm(`Delete trade #${id}? This can't be undone.`))) return;
    await api.del(`/api/trades/${id}`);
    onChanged();
  };

  return (
    <section className="panel flex flex-col max-h-[640px]">
      <div className="panel-head">
        <span className="panel-title"><CandlestickChart size={14} />Trade Tracker</span>
        <div className="flex items-center gap-2">
          <select className="field !w-auto !py-1 text-[10px]" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
            <option value="">ALL</option><option value="open">OPEN</option><option value="closed">CLOSED</option>
          </select>
          <select className="field !w-auto !py-1 text-[10px]" value={filter.asset} onChange={(e) => setFilter({ ...filter, asset: e.target.value })}>
            <option value="">ASSET</option>
            {assets.map((a) => <option key={a}>{a}</option>)}
          </select>
          <select className="field !w-auto !py-1 text-[10px] hidden sm:block" value={filter.source} onChange={(e) => setFilter({ ...filter, source: e.target.value })}>
            <option value="">SOURCE</option>
            {SOURCES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
          <button className="btn btn-primary !py-1" onClick={() => setShowForm(true)}>
            <Plus size={12} strokeWidth={3} />Trade
          </button>
        </div>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-panel2 text-[9px] uppercase tracking-widest text-dim">
            <tr>
              <th className="px-2 py-2 text-left">#</th>
              <th className="px-2 py-2 text-left">Asset</th>
              <th className="px-2 py-2 text-left">Dir</th>
              <th className="px-2 py-2 text-right">Entry</th>
              <th className="px-2 py-2 text-right hidden md:table-cell">SL</th>
              <th className="px-2 py-2 text-right hidden md:table-cell">TP1</th>
              <th className="px-2 py-2 text-right">RR</th>
              <th className="px-2 py-2 text-left hidden sm:table-cell">Source</th>
              <th className="px-2 py-2 text-right">P&L</th>
              <th className="px-2 py-2 text-left">Status</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={11} className="px-3 py-6 text-center text-dim">No trades yet — hit + TRADE or send a signal.</td></tr>
            )}
            {filtered.map((t) => (
              <Fragment key={t.id}>
                <tr
                  className="border-t border-edge hover:bg-panel2 cursor-pointer"
                  onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                >
                  <td className="px-2 py-2 text-faint">{t.id}</td>
                  <td className="px-2 py-2 font-bold text-cyan">{t.asset}</td>
                  <td className={`px-2 py-2 font-bold ${t.direction === "long" ? "text-up" : "text-down"}`}>
                    <span className="inline-flex items-center gap-0.5">
                      {t.direction === "long"
                        ? <ArrowUpRight size={13} strokeWidth={2.5} />
                        : <ArrowDownRight size={13} strokeWidth={2.5} />}
                      {t.direction === "long" ? "L" : "S"}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtPrice(t.entry)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-down hidden md:table-cell">{fmtPrice(t.sl)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-up hidden md:table-cell">{fmtPrice(t.tp1)}</td>
                  <td className={`px-2 py-2 text-right font-bold ${t.rr != null && t.rr >= 2 ? "text-up" : "text-amber"}`}>
                    {t.rr != null ? `${t.rr}` : "—"}
                  </td>
                  <td className="px-2 py-2 hidden sm:table-cell">
                    <span className={`inline-flex items-center gap-1 ${t.signal_source === "both" ? "text-amber" : "text-dim"}`}>
                      {t.signal_source.toUpperCase()}
                      {t.liquidity_sweep ? <Droplets size={11} className="text-cyan" /> : null}
                    </span>
                  </td>
                  <td className={`px-2 py-2 text-right font-bold tabular-nums ${
                    (t.pnl_pct ?? 0) > 0 ? "text-up" : (t.pnl_pct ?? 0) < 0 ? "text-down" : "text-dim"
                  }`}>
                    {fmtPnl(t.pnl_pct)}
                  </td>
                  <td className="px-2 py-2">
                    <span className={
                      t.status === "open" ? "text-cyan" : t.status === "partial" ? "text-amber" : "text-dim"
                    }>
                      {t.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {t.status !== "closed" && (
                      <button className="btn !py-1 !px-2 mr-1" title="Close / partial" onClick={() => setClosing(t)}>
                        <X size={11} />
                      </button>
                    )}
                    <button className="btn !py-1 !px-2 hover:!text-down hover:!border-down" title="Delete" onClick={() => del(t.id)}>
                      <Trash2 size={11} />
                    </button>
                  </td>
                </tr>
                {expanded === t.id && (
                  <tr className="bg-panel2 border-t border-edge">
                    <td colSpan={11} className="px-4 py-3 text-[11px] text-dim space-y-1">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <span>TP2: <span className="text-txt">{fmtPrice(t.tp2)}</span></span>
                        <span>TP3: <span className="text-txt">{fmtPrice(t.tp3)}</span></span>
                        <span>Risk: <span className="text-txt">{t.risk_pct}%</span></span>
                        <span>HTF: <span className="text-txt">{t.htf_aligned ? "✓ aligned" : "✗"}</span></span>
                        <span>Opened: <span className="text-txt">{timeAgo(t.opened_at)} ago</span></span>
                        {t.exit_price != null && <span>Exit: <span className="text-txt">{fmtPrice(t.exit_price)}</span></span>}
                      </div>
                      {t.partials.length > 0 && (
                        <div className="pt-1">
                          Partials:{" "}
                          {t.partials.map((p) => (
                            <span key={p.id} className="mr-3 text-amber">
                              {p.pct}% @ {fmtPrice(p.price)} ({p.level})
                            </span>
                          ))}
                        </div>
                      )}
                      {t.notes && <div className="pt-1 italic">“{t.notes}”</div>}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && <TradeForm onDone={() => { setShowForm(false); onChanged(); }} onCancel={() => setShowForm(false)} />}
      {closing && <CloseDialog trade={closing} onDone={() => { setClosing(null); onChanged(); }} onCancel={() => setClosing(null)} />}
    </section>
  );
}
