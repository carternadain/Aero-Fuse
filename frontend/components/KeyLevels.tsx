"use client";

import { useState } from "react";
import { Layers, Plus, TriangleAlert } from "lucide-react";
import type { Level } from "@/lib/types";
import { api, fmtPrice } from "@/lib/api";
import SwipeRow, { deferDelete } from "./SwipeRow";

const KIND_COLORS: Record<string, string> = {
  liquidity: "text-cyan",
  support: "text-up",
  resistance: "text-down",
  fib: "text-amber",
};

export default function KeyLevels({
  levels,
  prices,
  onChanged,
}: {
  levels: Level[];
  prices: Record<string, number>;
  onChanged: () => void;
}) {
  const [f, setF] = useState({ asset: "SOL", price: "", label: "", kind: "liquidity" });
  const [adding, setAdding] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]); // deleted, waiting out the Undo window

  const add = async () => {
    const price = parseFloat(f.price);
    if (isNaN(price)) return;
    await api.post("/api/levels", { ...f, price });
    setF({ ...f, price: "", label: "" });
    setAdding(false);
    onChanged();
  };

  const shownLevels = levels.filter((l) => !hidden.includes(String(l.id)));
  const grouped = shownLevels.reduce<Record<string, Level[]>>((acc, l) => {
    (acc[l.asset] ??= []).push(l);
    return acc;
  }, {});

  return (
    <section className="panel flex flex-col max-h-[480px]">
      <div className="panel-head">
        <span className="panel-title"><Layers size={14} />Key Levels</span>
        <button className="btn btn-primary !py-1" onClick={() => setAdding(!adding)}>
          <Plus size={12} strokeWidth={3} />Level
        </button>
      </div>

      {adding && (
        <div className="p-3 border-b border-edge space-y-2 bg-panel2">
          <div className="grid grid-cols-2 gap-2">
            <label className="field-wrap"><span className="field-label">Asset</span>
              <input className="field" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="next" value={f.asset} onChange={(e) => setF({ ...f, asset: e.target.value.toUpperCase() })} />
            </label>
            <label className="field-wrap"><span className="field-label">Price</span>
              <input className="field" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="field-wrap"><span className="field-label">Label</span>
              <input className="field" autoComplete="off" enterKeyHint="go" placeholder="e.g. weekly high sweep" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
            </label>
            <label className="field-wrap"><span className="field-label">Kind</span>
              <select className="field" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                <option value="liquidity">LIQUIDITY</option>
                <option value="support">SUPPORT</option>
                <option value="resistance">RESISTANCE</option>
                <option value="fib">FIB</option>
              </select>
            </label>
          </div>
          <button className="btn btn-primary w-full" onClick={add}>Pin Level</button>
        </div>
      )}

      <div className="overflow-y-auto">
        {shownLevels.length === 0 && (
          <p className="p-4 text-xs text-dim">Pin liquidity zones &amp; key levels per asset.</p>
        )}
        {Object.entries(grouped).map(([asset, ls]) => {
          const live = prices[asset];
          return (
            <div key={asset} className="border-b border-edge">
              <div className="px-3 py-1.5 bg-panel2 text-[10px] font-bold tracking-widest text-cyan flex justify-between">
                <span>{asset}</span>
                {live && <span className="text-dim">spot ${fmtPrice(live)}</span>}
              </div>
              {ls.map((l) => {
                const proximity = live ? Math.abs(live - l.price) / l.price : null;
                const near = proximity !== null && proximity < 0.015; // within 1.5%
                return (
                  <SwipeRow key={l.id} label="Delete level"
                            className={`flex items-center gap-2 pl-3 pr-3 [@media(hover:hover)]:pr-1 min-h-10 text-xs ${near ? "!bg-amber/10" : ""}`}
                            onDelete={() => {
                              const id = String(l.id);
                              deferDelete({
                                message: "Level deleted",
                                hide: () => setHidden((h) => [...h, id]),
                                restore: () => setHidden((h) => h.filter((i) => i !== id)),
                                commit: () => api.del(`/api/levels/${l.id}`).then(() => { onChanged(); setHidden((h) => h.filter((i) => i !== id)); }),
                              });
                            }}>
                    {near && <TriangleAlert size={11} className="live-dot text-amber shrink-0" />}
                    <span className={`font-bold tabular-nums ${KIND_COLORS[l.kind] ?? "text-txt"}`}>
                      {fmtPrice(l.price)}
                    </span>
                    <span className="text-[10px] uppercase text-faint">{l.kind.slice(0, 3)}</span>
                    <span className="text-dim truncate flex-1">{l.label}</span>
                    {near && <span className="text-[9px] text-amber font-bold whitespace-nowrap">PRICE NEAR</span>}
                  </SwipeRow>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
