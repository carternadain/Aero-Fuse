"use client";

import { useEffect, useState } from "react";
import { ArrowRight, SlidersHorizontal, X } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";
import { riskColor, type RiskReport } from "./RiskRating";
import { TABS, type TabKey } from "./TabNav";
import NetWorthChart from "./NetWorthChart";
import HomePortfolio from "./HomePortfolio";
import PortfolioHeatmap from "./PortfolioHeatmap";
import WeekRecap from "./WeekRecap";
import AllocationDonut from "./AllocationDonut";
import AccountCards from "./AccountCards";
import SinceLastVisit from "./SinceLastVisit";
import StarredList from "./StarredList";
import Goals from "./Goals";
import { ReportBanner } from "./MonthlyReport";
import type { Section } from "@/lib/live";
import TodayBrief from "./TodayBrief";
import { setHomeCard, usePrefs, type Mode } from "@/lib/prefs";

// Home cards, in order. `simple` = shown by default in Simple mode (Pro shows all).
export const HOME_CARDS: { id: string; label: string; simple: boolean }[] = [
  { id: "brief", label: "Today's Brief", simple: true },
  { id: "chart", label: "Net worth chart", simple: true },
  { id: "cards", label: "Account cards", simple: true },
  { id: "heatmap", label: "Today's Map (heatmap)", simple: false },
  { id: "allocation", label: "Allocation donut", simple: true },
  { id: "week", label: "Your Week", simple: false },
  { id: "goals", label: "Goals", simple: true },
  { id: "starred", label: "Starred", simple: false },
  { id: "accounts", label: "Accounts & holdings", simple: true },
  { id: "snapshot", label: "Risk + saving snapshot", simple: false },
  { id: "guide", label: "Where to go", simple: false },
];

export function cardOn(id: string, mode: Mode, custom: Record<string, boolean>) {
  if (id in custom) return custom[id];
  return mode === "pro" || !!HOME_CARDS.find((c) => c.id === id)?.simple;
}

function Customize({ onClose }: { onClose: () => void }) {
  const p = usePrefs();
  return (
    <div className="fixed inset-0 z-[86] bg-black/60 flex items-end sm:items-center justify-center"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-bg sm:bg-panel w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-edge tab-enter pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between px-4 pt-4 pb-1">
          <h2 className="text-lg font-extrabold text-txt">Customize Home</h2>
          <button className="p-2 -mr-2 rounded-full hover:bg-panel2 text-dim" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="px-4 text-[11.5px] text-dim">Pick what shows on Home. Everything else is still one search away.</p>
        <div className="px-2 py-2">
          {HOME_CARDS.map((c) => {
            const on = cardOn(c.id, p.mode, p.home);
            return (
              <button key={c.id} onClick={() => setHomeCard(c.id, !on)}
                      className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-panel2/60 text-left">
                <span className="flex-1 text-[13.5px] text-txt">{c.label}</span>
                <span className={`w-10 h-6 rounded-full relative transition-colors ${on ? "bg-up" : "bg-edge2"}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-bg transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
                </span>
              </button>
            );
          })}
        </div>
        <div className="px-4 flex justify-between items-center">
          <span className="text-[10.5px] text-faint">Defaults follow {p.mode === "simple" ? "Simple" : "Pro"} mode</span>
          <button className="btn" onClick={() => HOME_CARDS.forEach((c) => setHomeCard(c.id, null))}>Reset</button>
        </div>
      </div>
    </div>
  );
}

// Plain-language "what's in here" for every tab, so it's obvious where to go.
const GUIDE: Record<Exclude<TabKey, "home">, { what: string; when: string }> = {
  trading: { what: "Exit Desk (how overheated each holding is + your take-profit plan), trade log, P&L calendar, signals.", when: "When you're about to enter or exit a trade" },
  markets: { what: "Ideas (top buys, sector map, 115 swing names), Stocks (options watch, compare) and Crypto (liquidation heatmap, coins).", when: "Looking for your next contract" },
  news: { what: "Headlines for what you own, upcoming earnings and the macro calendar.", when: "Before earnings or a big move" },
  wealth: { what: "Goals, net worth by account, risk, savings plan, dividends, stress test, FIRE and budget.", when: "Weekly check-in on the big picture" },
};

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function Overview({ onNavigate }: { onNavigate: (t: TabKey) => void }) {
  const [risk, setRisk] = useState<RiskReport | null>(null);
  const [plan, setPlan] = useState<{ monthly_you: number; monthly_match: number } | null>(null);
  const [only, setOnly] = useState<Section | null>(null);
  const [customize, setCustomize] = useState(false);
  const prefs = usePrefs();
  // a card hidden by default still appears when search or the brief jumps to it
  const ANCHOR: Record<string, string> = { heatmap: "sec-heatmap", allocation: "sec-allocation", week: "sec-week", accounts: "sec-accounts", chart: "sec-networth" };
  const on = (id: string) => cardOn(id, prefs.mode, prefs.home) || (!!ANCHOR[id] && prefs.revealed.has(ANCHOR[id]));

  useEffect(() => {
    api.get<RiskReport>("/api/networth/risk").then(setRisk).catch(() => {});
    api.get<{ monthly_you: number; monthly_match: number }>("/api/contributions").then(setPlan).catch(() => {});
  }, []);

  const monthly = (plan?.monthly_you ?? 0) + (plan?.monthly_match ?? 0);

  return (
    <div className="space-y-4">
      <div className="pt-1">
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-display text-[28px] sm:text-[40px] leading-none text-txt">
            {greeting()}<em className="text-amber">.</em>
          </h2>
          <button className="icon-btn !text-dim hover:!text-txt" onClick={() => setCustomize(true)} title="Customize Home">
            <SlidersHorizontal size={16} />
          </button>
        </div>
        <p className="text-xs text-dim mt-1.5">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · here&apos;s where things stand.
        </p>
        <SinceLastVisit />
      </div>

      <ReportBanner />
      {customize && <Customize onClose={() => setCustomize(false)} />}

      {on("brief") && <TodayBrief />}

      {on("chart") && (
        <section id="sec-networth" className="panel p-4 sm:p-5 scroll-mt-28">
          <NetWorthChart />
        </section>
      )}

      {on("cards") && <AccountCards />}

      {(on("heatmap") || on("allocation") || on("week")) && (
        <div className={`grid grid-cols-1 gap-3 ${on("heatmap") ? "lg:grid-cols-5" : "lg:grid-cols-2"}`}>
          {on("heatmap") && <div id="sec-heatmap" className="lg:col-span-3 scroll-mt-28"><PortfolioHeatmap /></div>}
          <div className={`${on("heatmap") ? "lg:col-span-2 space-y-3" : "contents"}`}>
            {on("allocation") && (
              <div id="sec-allocation" className="scroll-mt-28">
                <AllocationDonut filter={only} onFilter={(s) => {
                  setOnly(s);
                  if (s) setTimeout(() => document.getElementById("sec-accounts")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                }} />
              </div>
            )}
            {on("week") && <div id="sec-week" className="scroll-mt-28"><WeekRecap /></div>}
          </div>
        </div>
      )}

      {(on("goals") || on("starred")) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          {on("goals") && <Goals compact />}
          {on("starred") && <StarredList compact />}
        </div>
      )}

      {on("accounts") && (
        <div id="sec-accounts" className="scroll-mt-28">
          <HomePortfolio only={only} onClearFilter={() => setOnly(null)} />
        </div>
      )}

      {/* Snapshot cards: each one jumps to where you'd act on it */}
      {on("snapshot") && <div className="grid grid-cols-2 gap-3">
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
      </div>}

      {/* Where to go */}
      {on("guide") && <div>
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
      </div>}
    </div>
  );
}
