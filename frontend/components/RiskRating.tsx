"use client";

import InfoTip from "./InfoTip";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Gauge, Info } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";

export interface RiskReport {
  score: number | null;
  label: string;
  speculative_pct?: number;
  crypto_pct?: number;
  top_position?: { name: string; pct: number };
  debt_ratio?: number;
  months_cash?: number | null;
  buckets: { key: string; label: string; value: number; pct: number; speculative: boolean }[];
  findings: { level: "high" | "medium" | "good"; text: string }[];
}

// Categorical, deliberately not green/red — allocation isn't good/bad, just different.
export const BUCKET_COLORS: Record<string, string> = {
  cash: "#9ccfe6",
  retirement: "#6c9cff",
  broad: "#8fb8ff",
  stocks: "#b08bd9",
  crypto_major: "#ffc24d",
  crypto_alt: "#f4a261",
  options: "#e98cb4",
  leveraged: "#d46a9f",
  other: "#9b9285",
};

export function riskColor(score: number): string {
  if (score >= 75) return "var(--color-down)";
  if (score >= 55) return "var(--color-warn)";
  if (score >= 35) return "var(--color-amber)";
  return "var(--color-cyan)";
}

const LEVEL_ICON = {
  high: <AlertTriangle size={13} className="text-down shrink-0 mt-0.5" />,
  medium: <Info size={13} className="text-amber shrink-0 mt-0.5" />,
  good: <CheckCircle2 size={13} className="text-cyan shrink-0 mt-0.5" />,
};

export default function RiskRating() {
  const [r, setR] = useState<RiskReport | null>(null);

  useEffect(() => {
    const load = () => api.get<RiskReport>("/api/networth/risk").then(setR).catch(() => {});
    load();
    const t = setInterval(load, 5 * 60000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><Gauge size={14} />Risk Rating</span>
        <span className="flex items-center gap-1 text-[10px] text-faint">how much could swing hard or go to $0
          <InfoTip topic="the risk rating"><p>Rules of thumb computed from your own numbers, not financial advice.</p></InfoTip>
        </span>
      </div>

      {!r || r.score == null ? (
        <p className="p-4 text-xs text-dim">Add holdings or accounts to Net Worth to get a rating.</p>
      ) : (
        <div className="p-4 space-y-4">
          {/* Score */}
          <div className="flex items-end gap-4">
            <div>
              <div className="font-display text-[40px] leading-none" style={{ color: riskColor(r.score) }}>
                {r.label}
              </div>
              <div className="text-[10px] text-faint mt-1">
                Risk score <span className="tabular-nums text-dim font-bold">{r.score}</span>/100
              </div>
            </div>
          </div>
          <div className="relative h-2 rounded-full overflow-hidden"
               style={{ background: "linear-gradient(90deg, var(--color-cyan), var(--color-amber), var(--color-warn), var(--color-down))" }}>
            <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-bg bg-txt"
                 style={{ left: `${r.score}%` }} />
          </div>
          <div className="flex justify-between text-[9px] text-faint -mt-2">
            <span>Conservative</span><span>Moderate</span><span>Aggressive</span><span>High</span><span>Very high</span>
          </div>

          {/* Allocation */}
          <div>
            <div className="text-[10px] font-bold tracking-widest text-dim mb-1.5">WHERE YOUR MONEY IS</div>
            <div className="flex h-3 rounded-md overflow-hidden">
              {r.buckets.map((b) => (
                <div key={b.key} title={`${b.label}: ${b.pct}%`}
                     style={{
                       width: `${b.pct}%`,
                       background: b.speculative
                         ? `repeating-linear-gradient(135deg, ${BUCKET_COLORS[b.key]} 0 4px, color-mix(in srgb, ${BUCKET_COLORS[b.key]} 55%, transparent) 4px 7px)`
                         : BUCKET_COLORS[b.key],
                     }} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
              {r.buckets.map((b) => (
                <div key={b.key} className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: BUCKET_COLORS[b.key] }} />
                  <span className="text-dim truncate">{b.label}{b.speculative && <span className="text-faint"> *</span>}</span>
                  <span className="ml-auto tabular-nums text-txt">{b.pct.toFixed(0)}%</span>
                  <span className="tabular-nums text-faint w-14 text-right">{fmtUsd(b.value)}</span>
                </div>
              ))}
            </div>
            <p className="text-[9px] text-faint mt-1.5">* striped = speculative ({r.speculative_pct?.toFixed(0)}% of your assets)</p>
          </div>

          {/* Findings */}
          <ul className="space-y-1.5">
            {r.findings.map((f, i) => (
              <li key={i} className="flex gap-2 text-[11.5px] text-dim leading-snug">
                {LEVEL_ICON[f.level]}
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
