"use client";

import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Flame, Radio } from "lucide-react";
import type { Signal } from "@/lib/types";
import { api, fmtPrice, timeAgo } from "@/lib/api";

export default function SignalLog({ signals, onChanged }: { signals: Signal[]; onChanged: () => void }) {
  const [skipping, setSkipping] = useState<Signal | null>(null);
  const [reason, setReason] = useState("");

  const markSkipped = async () => {
    if (!skipping) return;
    await api.patch(`/api/signals/${skipping.id}`, { taken: false, skip_reason: reason || "no confluence" });
    setSkipping(null);
    setReason("");
    onChanged();
  };

  const confluencePairs = new Set<number>();
  // Flag signals that have an opposite-indicator sibling on same asset+direction within ~90 min
  for (const a of signals) {
    for (const b of signals) {
      if (
        a.id !== b.id && a.asset === b.asset && a.direction === b.direction &&
        a.indicator !== b.indicator &&
        Math.abs(new Date(a.ts).getTime() - new Date(b.ts).getTime()) < 90 * 60000
      ) {
        confluencePairs.add(a.id);
      }
    }
  }

  return (
    <section className="panel flex flex-col max-h-[480px]">
      <div className="panel-head">
        <span className="panel-title"><Radio size={14} />Signal Log</span>
        <span className="inline-flex items-center gap-1 text-[10px] text-dim">
          {signals.length} signals · <Flame size={10} className="text-amber" /> = confluence
        </span>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-panel2 text-[9px] uppercase tracking-widest text-dim">
            <tr>
              <th className="px-2 py-2 text-left">Time</th>
              <th className="px-2 py-2 text-left">Asset</th>
              <th className="px-2 py-2 text-left hidden sm:table-cell">Indicator</th>
              <th className="px-2 py-2 text-left">Dir</th>
              <th className="px-2 py-2 text-left hidden sm:table-cell">Conv</th>
              <th className="px-2 py-2 text-right hidden sm:table-cell">Price</th>
              <th className="px-2 py-2 text-left">AI</th>
              <th className="px-2 py-2 text-left">Status</th>
              <th className="px-2 py-2 hidden sm:table-cell" />
            </tr>
          </thead>
          <tbody>
            {signals.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-dim">
                No signals yet — they appear here when TradingView alerts fire.
              </td></tr>
            )}
            {signals.map((s) => (
              <tr key={s.id} className="border-t border-edge hover:bg-panel2">
                <td className="px-2 py-2 text-faint whitespace-nowrap">{timeAgo(s.ts)}</td>
                <td className="px-2 py-2 font-bold text-cyan">
                  <span className="inline-flex items-center gap-1">
                    {s.asset}
                    {confluencePairs.has(s.id) && <Flame size={11} className="text-amber" />}
                  </span>
                  <span className={`sm:hidden block text-[9px] font-semibold ${s.indicator === "neurowave" ? "text-cyan" : "text-amber"}`}>
                    {s.indicator.slice(0, 5).toUpperCase()}
                  </span>
                </td>
                <td className="px-2 py-2 hidden sm:table-cell">
                  <span className={s.indicator === "neurowave" ? "text-cyan" : "text-amber"}>
                    {s.indicator.slice(0, 5).toUpperCase()}
                  </span>
                </td>
                <td className={`px-2 py-2 font-bold ${s.direction === "buy" ? "text-up" : "text-down"}`}>
                  {s.direction === "buy"
                    ? <ArrowUpRight size={13} strokeWidth={2.5} />
                    : <ArrowDownRight size={13} strokeWidth={2.5} />}
                </td>
                <td className="px-2 py-2 hidden sm:table-cell">
                  <span className={s.conviction === "high" ? "text-up" : "text-dim"}>{s.conviction}</span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">{fmtPrice(s.price)}</td>
                <td className="px-2 py-2 whitespace-nowrap">
                  {s.ai_take == null ? (
                    <span className="text-faint" title="Awaiting AI verdict (needs ANTHROPIC_API_KEY)">·</span>
                  ) : (
                    <span
                      className={`inline-flex items-center gap-1 font-bold ${s.ai_take ? "text-up" : "text-dim"}`}
                      title={[...(s.ai_reasons ?? []), ...(s.ai_warnings ?? [])].join(" · ")}
                    >
                      {s.ai_take ? "✅ TAKE" : "⏭ SKIP"}
                      <span className="text-faint tabular-nums">{s.ai_score}/10</span>
                    </span>
                  )}
                </td>
                <td className="px-2 py-2">
                  {s.taken ? (
                    <span className={
                      s.outcome === "win" ? "text-up" : s.outcome === "loss" ? "text-down" : "text-cyan"
                    }>
                      TAKEN{s.outcome ? ` · ${s.outcome.toUpperCase()}` : ""}
                    </span>
                  ) : s.skip_reason ? (
                    <span className="text-dim" title={s.skip_reason}>SKIP · {s.skip_reason.slice(0, 18)}</span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <span className="text-amber">NEW</span>
                      <button className="btn !py-0.5 !px-2 sm:hidden" onClick={() => setSkipping(s)}>skip</button>
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right whitespace-nowrap hidden sm:table-cell">
                  {!s.taken && !s.skip_reason && (
                    <button className="btn !py-0.5 !px-2" onClick={() => setSkipping(s)}>skip</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {skipping && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setSkipping(null)}>
          <div className="panel w-full max-w-sm p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="panel-title">Skip Signal #{skipping.id} — why?</h3>
            <div className="flex flex-wrap gap-1.5">
              {["no confluence", "no liquidity sweep", "RR too low", "against HTF trend", "bad sentiment", "choppy market"].map((r) => (
                <button key={r} className={`btn !py-1 !px-2 ${reason === r ? "btn-primary" : ""}`} onClick={() => setReason(r)}>
                  {r}
                </button>
              ))}
            </div>
            <input className="field" placeholder="Or custom reason…" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setSkipping(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={markSkipped}>Log Skip</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
