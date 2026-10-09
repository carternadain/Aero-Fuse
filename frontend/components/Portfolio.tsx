"use client";

import { useState } from "react";
import { Briefcase, Plus, X } from "lucide-react";
import type { Position } from "@/lib/types";
import { api, fmtPrice } from "@/lib/api";
import { askConfirm, askText } from "./DialogHost";
import { isHidden, MASK } from "@/lib/privacy";

function pnl(p: Position, livePrice?: number): { pct: number | null; usd: number | null } {
  const mark = p.kind === "crypto" && livePrice ? livePrice : p.current;
  if (mark == null) return { pct: null, usd: null };
  const mult = p.kind === "leap" ? 100 : 1; // options contracts are 100 shares
  return {
    pct: Math.round(((mark - p.entry) / p.entry) * 10000) / 100,
    usd: Math.round((mark - p.entry) * p.qty * mult * 100) / 100,
  };
}

export default function Portfolio({
  positions,
  prices,
  onChanged,
}: {
  positions: Position[];
  prices: Record<string, number>;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({
    asset: "", kind: "crypto", qty: "", entry: "", current: "", strike: "", expiry: "", notes: "",
  });

  const add = async () => {
    const qty = parseFloat(f.qty), entry = parseFloat(f.entry);
    if (!f.asset || isNaN(qty) || isNaN(entry)) return;
    await api.post("/api/positions", {
      asset: f.asset, kind: f.kind, qty, entry,
      current: f.current ? parseFloat(f.current) : null,
      strike: f.strike ? parseFloat(f.strike) : null,
      expiry: f.expiry || null,
      notes: f.notes,
    });
    setF({ asset: "", kind: "crypto", qty: "", entry: "", current: "", strike: "", expiry: "", notes: "" });
    setAdding(false);
    onChanged();
  };

  const updateMark = async (p: Position) => {
    const v = await askText(`Current mark for ${p.asset}${p.kind === "leap" ? " (per contract)" : ""}:`, String(p.current ?? ""));
    if (v == null) return;
    const current = parseFloat(v);
    if (isNaN(current)) return;
    await api.patch(`/api/positions/${p.id}`, { current });
    onChanged();
  };

  const totalUsd = positions.reduce((sum, p) => sum + (pnl(p, prices[p.asset]).usd ?? 0), 0);
  const crypto = positions.filter((p) => p.kind === "crypto");
  const leaps = positions.filter((p) => p.kind === "leap");

  const Row = ({ p }: { p: Position }) => {
    const { pct, usd } = pnl(p, prices[p.asset]);
    const tone = (pct ?? 0) > 0 ? "text-up" : (pct ?? 0) < 0 ? "text-down" : "text-dim";
    return (
      <div className="flex items-center gap-2 px-3 py-2 border-t border-edge text-xs hover:bg-panel2 cursor-pointer"
           onClick={() => updateMark(p)} title="Click to update mark price">
        <span className="font-bold text-cyan w-12">{p.asset}</span>
        {p.kind === "leap" ? (
          <span className="text-dim text-[10px]">
            {p.qty}× ${fmtPrice(p.strike)}C {p.expiry ?? ""}
          </span>
        ) : (
          <span className="text-dim text-[10px]">{p.qty} @ {fmtPrice(p.entry)}</span>
        )}
        <span className={`ml-auto font-bold tabular-nums ${tone}`}>
          {pct != null ? `${pct > 0 ? "+" : ""}${pct}%` : "set mark"}
        </span>
        {usd != null && (
          <span className={`tabular-nums text-[10px] ${tone}`}>
            {isHidden() ? MASK : <>{usd >= 0 ? "+" : "−"}${Math.abs(usd).toLocaleString()}</>}
          </span>
        )}
        <button className="icon-btn" onClick={(e) => { e.stopPropagation(); askConfirm(`Remove ${p.asset}?`).then((ok) => { if (ok) api.del(`/api/positions/${p.id}`).then(onChanged); }); }}>
          <X size={12} />
        </button>
      </div>
    );
  };

  return (
    <section className="panel flex flex-col max-h-[480px]">
      <div className="panel-head">
        <span className="panel-title"><Briefcase size={14} />Portfolio</span>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold tabular-nums ${totalUsd > 0 ? "text-up" : totalUsd < 0 ? "text-down" : "text-dim"}`}>
            {isHidden() ? MASK : <>{totalUsd >= 0 ? "+" : "−"}${Math.abs(Math.round(totalUsd)).toLocaleString()}</>}
          </span>
          <button className="btn btn-primary !py-1 !px-2" onClick={() => setAdding(!adding)}>
            <Plus size={12} strokeWidth={3} />
          </button>
        </div>
      </div>

      {adding && (
        <div className="p-3 border-b border-edge space-y-2 bg-panel2">
          <div className="grid grid-cols-3 gap-2">
            <input className="field" placeholder="Asset" value={f.asset} onChange={(e) => setF({ ...f, asset: e.target.value.toUpperCase() })} />
            <select className="field" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="crypto">CRYPTO</option>
              <option value="leap">LEAP CALL</option>
            </select>
            <input className="field" placeholder="Qty" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input className="field" placeholder={f.kind === "leap" ? "Entry (per contract)" : "Entry price"} value={f.entry} onChange={(e) => setF({ ...f, entry: e.target.value })} />
            <input className="field" placeholder="Current mark (optional)" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
          </div>
          {f.kind === "leap" && (
            <div className="grid grid-cols-2 gap-2">
              <input className="field" placeholder="Strike" value={f.strike} onChange={(e) => setF({ ...f, strike: e.target.value })} />
              <input className="field" placeholder="Expiry (2027-12-17)" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} />
            </div>
          )}
          <button className="btn btn-primary w-full" onClick={add}>Add Position</button>
        </div>
      )}

      <div className="overflow-y-auto">
        {positions.length === 0 && (
          <p className="p-4 text-xs text-dim">Add your SOL swings and SOFI / RDW / MSFT LEAPs.</p>
        )}
        {crypto.length > 0 && (
          <div className="px-3 py-1.5 bg-panel2 text-[9px] font-bold tracking-widest text-dim">CRYPTO SWINGS</div>
        )}
        {crypto.map((p) => <Row key={p.id} p={p} />)}
        {leaps.length > 0 && (
          <div className="px-3 py-1.5 bg-panel2 text-[9px] font-bold tracking-widest text-dim">LEAP OPTIONS · 2027 TARGETS</div>
        )}
        {leaps.map((p) => <Row key={p.id} p={p} />)}
      </div>
    </section>
  );
}
