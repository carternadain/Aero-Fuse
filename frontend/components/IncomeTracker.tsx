"use client";

import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { api } from "@/lib/api";
import { fmtCents, isHidden } from "@/lib/privacy";
import Skeleton from "./Skeleton";

interface Payer {
  symbol: string; qty: number; annual: number; yield_pct: number | null; per_share: number; freq: number;
  last_ex: string; next_est: string | null; note: string; accounts: string[];
}
interface Income { annual: number; monthly_avg: number; holdings: Payer[]; by_month: { month: string; amount: number }[] }

const FREQ: Record<number, string> = { 1: "yearly", 2: "twice a year", 4: "quarterly", 12: "monthly" };
const short = (d: string) => new Date(d + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" });

/** Dividends: trailing-12-month payouts × shares held now, projected on the same schedule. */
export default function IncomeTracker() {
  const [d, setD] = useState<Income | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { api.get<Income>("/api/income").then(setD).catch(() => setErr(true)); }, []);

  const bars = (d?.by_month ?? []).map((m) => ({
    ...m, label: new Date(m.month + "-15").toLocaleDateString([], { month: "short" }).slice(0, 3),
  }));

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><Coins size={14} />Dividend Income</span>
        <span className="text-[10px] text-faint">next 12 months, estimated</span>
      </div>
      {!d ? (
        <div className="p-4 space-y-3">{err ? <p className="text-xs text-dim">Couldn&apos;t load dividend data.</p> : <><Skeleton className="h-10 w-48" /><Skeleton className="h-28" /></>}</div>
      ) : !d.holdings.length ? (
        <p className="px-4 py-5 text-[12px] text-dim">None of your stocks or funds have paid a dividend in the past year.</p>
      ) : (
        <div className="p-4">
          <div className="flex items-baseline gap-4 flex-wrap">
            <div>
              <div className="text-[10px] text-faint">Per year</div>
              <div className="font-display text-[34px] leading-none text-txt">{fmtCents(d.annual)}</div>
            </div>
            <div>
              <div className="text-[10px] text-faint">Per month avg</div>
              <div className="text-[18px] font-extrabold text-cyan tabular-nums">{fmtCents(d.monthly_avg)}</div>
            </div>
          </div>
          <div className="h-[110px] mt-3 -mx-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--color-faint)", fontSize: 10 }} interval={0} />
                <Tooltip cursor={{ fill: "var(--color-panel2)" }}
                         contentStyle={{ background: "var(--color-panel)", border: "1px solid var(--color-edge2)", borderRadius: 8, fontSize: 12 }}
                         formatter={(v) => [isHidden() ? "•••" : fmtCents(Number(v)), "Expected"]} labelStyle={{ color: "var(--color-dim)" }} />
                <Bar dataKey="amount" fill="var(--color-cyan)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3">
            {d.holdings.map((h) => (
              <div key={h.symbol} className="flex items-center gap-3 py-2 border-t border-edge/50 text-[12px]">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold text-txt">{h.symbol}
                    <span className="ml-1.5 text-[10px] font-semibold text-faint">{FREQ[h.freq] ?? `${h.freq}×/yr`}</span>
                  </div>
                  <div className="text-[10.5px] text-faint truncate">
                    {h.next_est ? `next ~${short(h.next_est)}` : `last ${short(h.last_ex)}`}
                    {h.accounts.length > 0 && ` · ${h.accounts.join(", ")}`}
                  </div>
                </div>
                <span className="tabular-nums text-dim w-14 text-right">{h.yield_pct != null ? `${h.yield_pct.toFixed(2)}%` : "—"}</span>
                <span className="tabular-nums font-bold text-txt w-20 text-right">{fmtCents(h.annual)}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-faint mt-3 leading-relaxed">
            Based on the last 12 months of payouts × the shares you hold now. Payout dates are projected from past ones.
            In retirement accounts dividends are usually reinvested automatically.
          </p>
        </div>
      )}
    </section>
  );
}
