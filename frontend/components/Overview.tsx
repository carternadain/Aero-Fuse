"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";
import { riskColor, type RiskReport } from "./RiskRating";
import { TABS, type TabKey } from "./TabNav";
import NetWorthChart from "./NetWorthChart";
import HomePortfolio from "./HomePortfolio";

// Plain-language "what's in here" for every tab, so it's obvious where to go.
const GUIDE: Record<Exclude<TabKey, "home">, { what: string; when: string }> = {
  trading: { what: "Log trades, see incoming TradingView signals, size positions with the Risk Desk.", when: "When you're about to enter or exit a trade" },
  buys: { what: "Best long-term scores, plus Swing Ideas: 115 stocks by sector (energy, space, AI…).", when: "Looking for your next contract" },
  stocks: { what: "Your options watchlist with signal confluence, and the tech screener.", when: "Checking names you already follow" },
  crypto: { what: "Top coins with scores, what narratives are moving, and the market mood.", when: "Checking the crypto side" },
  news: { what: "Upcoming earnings, analyst targets, and headline sentiment.", when: "Before earnings or a big move" },
  wealth: { what: "Net worth by account, risk rating, savings plan, FIRE and budget.", when: "Weekly check-in on the big picture" },
};

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function Overview({ onNavigate }: { onNavigate: (t: TabKey) => void }) {
  const [risk, setRisk] = useState<RiskReport | null>(null);
  const [plan, setPlan] = useState<{ monthly_you: number; monthly_match: number } | null>(null);

  useEffect(() => {
    api.get<RiskReport>("/api/networth/risk").then(setRisk).catch(() => {});
    api.get<{ monthly_you: number; monthly_match: number }>("/api/contributions").then(setPlan).catch(() => {});
  }, []);

  const monthly = (plan?.monthly_you ?? 0) + (plan?.monthly_match ?? 0);

  return (
    <div className="space-y-4">
      <div className="pt-1">
        <h2 className="font-display text-[28px] sm:text-[40px] leading-none text-txt">
          {greeting()}<em className="text-amber">.</em>
        </h2>
        <p className="text-xs text-dim mt-1.5">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · here&apos;s where things stand.
        </p>
      </div>

      <section className="panel p-4 sm:p-5">
        <NetWorthChart />
      </section>

      <HomePortfolio />

      {/* Snapshot cards: each one jumps to where you'd act on it */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => onNavigate("wealth")} className="panel p-4 text-left hover:border-edge2 transition-colors">
          <div className="text-[10px] font-bold tracking-widest text-faint">RISK LEVEL</div>
          <div className="font-display text-[26px] sm:text-[34px] leading-tight" style={{ color: risk?.score != null ? riskColor(risk.score) : undefined }}>
            {risk?.score != null ? risk.label : "—"}
          </div>
          <div className="text-[11px] text-dim">
            {risk?.speculative_pct != null ? `${risk.speculative_pct.toFixed(0)}% in speculative positions` : "add accounts to rate"}
          </div>
        </button>

        <button onClick={() => onNavigate("wealth")} className="panel p-4 text-left hover:border-edge2 transition-colors">
          <div className="text-[10px] font-bold tracking-widest text-faint">SAVING EACH MONTH</div>
          <div className="font-display text-[26px] sm:text-[34px] leading-tight text-txt">{plan ? fmtUsd(monthly) : "—"}</div>
          <div className="text-[11px] text-dim">
            {plan?.monthly_match ? <>incl. <span className="text-cyan">{fmtUsd(plan.monthly_match)}</span> employer match</> : "set up your plan in Wealth"}
          </div>
        </button>
      </div>

      {/* Where to go */}
      <div>
        <div className="text-[10px] font-bold tracking-widest text-faint mb-2">WHERE TO GO</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {TABS.filter((t) => t.key !== "home").map(({ key, label, icon: Icon }) => {
            const g = GUIDE[key as Exclude<TabKey, "home">];
            return (
              <button key={key} onClick={() => onNavigate(key)}
                      className="panel p-3.5 text-left flex gap-3 items-start hover:border-edge2 hover:bg-panel2/40 transition-colors group">
                <span className="rounded-lg bg-panel2 p-2 text-amber shrink-0"><Icon size={16} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-sm font-bold text-txt">
                    {label}
                    <ArrowRight size={13} className="text-faint group-hover:translate-x-0.5 transition-transform" />
                  </span>
                  <span className="block text-[11.5px] text-dim leading-snug mt-0.5">{g.what}</span>
                  <span className="block text-[10px] text-faint mt-1">{g.when}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
