"use client";

// Wealth as an iOS-style "list you tap into": a grouped inset list of areas, each opening a
// full page with a back button. On desktop (lg+) the list sits left and the page right.

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ChevronLeft, ChevronRight, Coins, Download, FlaskConical, Landmark, PieChart, Receipt,
  ShieldCheck, Target, WalletCards, type LucideIcon,
} from "lucide-react";
import { haptic } from "@/lib/bus";
import { usePrefs } from "@/lib/prefs";
import Panes from "./Panes";
import { ProHint } from "./Section";
import NetWorthHistory from "./NetWorthHistory";
import NetWorth from "./NetWorth";
import NetWorthCalendar from "./NetWorthCalendar";
import Goals from "./Goals";
import WealthChecks from "./WealthChecks";
import TaxCenter from "./TaxCenter";
import BudgetTracker from "./BudgetTracker";
import RecurringBills from "./RecurringBills";
import MonthlyBudget from "./MonthlyBudget";
import IncomeTracker from "./IncomeTracker";
import RiskRating from "./RiskRating";
import SavingsPlan from "./SavingsPlan";
import MoneyLab from "./MoneyLab";
import StressTest from "./StressTest";
import FireCalc from "./FireCalc";
import BackupPanel from "./BackupPanel";

import type { WealthPage } from "./TabNav";
export type { WealthPage };

type Tint = "up" | "amber" | "cyan" | "down" | "warn";
const TINT: Record<Tint, string> = {
  up: "bg-up/15 text-up", amber: "bg-amber/15 text-amber", cyan: "bg-cyan/15 text-cyan",
  down: "bg-down/15 text-down", warn: "bg-warn/15 text-warn",
};

const META: Record<WealthPage, { title: string; sub: string; icon: LucideIcon; tint: Tint; pro?: boolean }> = {
  accounts: { title: "Accounts", sub: "Balances by account", icon: Landmark, tint: "up" },
  goals: { title: "Goals & health", sub: "Targets, free money, cushion", icon: Target, tint: "amber" },
  plan: { title: "Risk & savings plan", sub: "Leverage and contributions", icon: ShieldCheck, tint: "cyan" },
  spending: { title: "Spending & bills", sub: "Import statements or screenshots, subscriptions", icon: WalletCards, tint: "down" },
  budget: { title: "Budget", sub: "Monthly targets and pace", icon: PieChart, tint: "warn" },
  dividends: { title: "Dividends", sub: "Payouts and yield", icon: Coins, tint: "up" },
  taxes: { title: "Taxes", sub: "Gains, harvesting, wash sales", icon: Receipt, tint: "amber" },
  whatif: { title: "What if", sub: "Money lab, crash test, FIRE", icon: FlaskConical, tint: "cyan", pro: true },
  backup: { title: "Backup & export", sub: "Your data, downloadable", icon: Download, tint: "warn" },
};

const GROUPS: WealthPage[][] = [
  ["accounts", "goals", "plan"],
  ["spending", "budget", "dividends", "taxes"],
  ["whatif"],
  ["backup"],
];

/** Which Wealth page owns each in-page anchor (null = the net worth hero on the list itself). */
export const WEALTH_ANCHOR: Record<string, WealthPage | null> = {
  "sec-nwhistory": null,
  "sec-wealth": "accounts", "sec-nwcal": "accounts",
  "sec-ontrack": "goals", "sec-goals": "goals", "sec-health": "goals",
  "sec-risk": "plan", "sec-plan": "plan",
  "sec-cashflow": "spending", "sec-spending": "spending",
  "sec-budget": "budget",
  "sec-income": "dividends",
  "sec-taxes": "taxes",
  "sec-whatif": "whatif", "sec-moneylab": "whatif", "sec-stress": "whatif", "sec-fire": "whatif",
  "sec-backup": "backup",
};

const lgQuery = "(min-width: 1024px)";
function useIsDesktop() {
  return useSyncExternalStore(
    (f) => { const m = window.matchMedia(lgQuery); m.addEventListener("change", f); return () => m.removeEventListener("change", f); },
    () => window.matchMedia(lgQuery).matches,
    () => false,
  );
}

function PageBody({ page }: { page: WealthPage }) {
  switch (page) {
    case "accounts":
      return (
        <div id="sec-wealth" className="scroll-mt-28 space-y-3">
          <NetWorth />
          <Panes items={[{ id: "sec-nwcal", label: "Calendar", pro: true, node: <NetWorthCalendar /> }]} />
        </div>
      );
    case "goals":
      return (
        <div id="sec-ontrack" className="scroll-mt-28">
          <Panes items={[
            { id: "sec-goals", label: "Goals", node: <Goals /> },
            { id: "sec-health", label: "Health check", node: <WealthChecks /> },
          ]} />
        </div>
      );
    case "plan":
      return (
        <Panes items={[
          { id: "sec-risk", label: "Risk", node: <RiskRating /> },
          { id: "sec-plan", label: "Savings plan", node: <SavingsPlan /> },
        ]} />
      );
    case "spending":
      return (
        <div id="sec-cashflow" className="scroll-mt-28">
          <div id="sec-spending" className="scroll-mt-28 grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
            <div className="lg:col-span-7 min-w-0"><BudgetTracker /></div>
            <div className="lg:col-span-5 min-w-0"><RecurringBills /></div>
          </div>
        </div>
      );
    case "budget": return <div id="sec-budget" className="scroll-mt-28"><MonthlyBudget /></div>;
    case "dividends": return <div id="sec-income" className="scroll-mt-28"><IncomeTracker /></div>;
    case "taxes": return <div id="sec-taxes" className="scroll-mt-28"><TaxCenter /></div>;
    case "whatif":
      return (
        <div id="sec-whatif" className="scroll-mt-28">
          <Panes items={[
            { id: "sec-moneylab", label: "Money lab", node: <MoneyLab /> },
            { id: "sec-stress", label: "Stress test", node: <StressTest /> },
            { id: "sec-fire", label: "FIRE", node: <FireCalc /> },
          ]} />
        </div>
      );
    case "backup": return <div id="sec-backup" className="scroll-mt-28"><BackupPanel /></div>;
  }
}

function Row({ page, active, onOpen }: { page: WealthPage; active: boolean; onOpen: (p: WealthPage) => void }) {
  const m = META[page];
  const Icon = m.icon;
  return (
    <button
      onClick={() => { haptic(); onOpen(page); }}
      aria-current={active ? "page" : undefined}
      className={`wp-row relative w-full min-h-[52px] flex items-center gap-3 pl-3.5 pr-3 py-2 text-left transition-colors
                  focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-up
                  ${active ? "lg:bg-panel2" : "active:bg-panel2 lg:hover:bg-panel2/60"}`}
    >
      <span className={`shrink-0 w-8 h-8 rounded-[9px] flex items-center justify-center ${TINT[m.tint]}`}>
        <Icon size={17} strokeWidth={2.2} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold text-txt leading-tight truncate">{m.title}</span>
        <span className="block text-[12px] text-faint leading-tight mt-0.5 truncate">{m.sub}</span>
      </span>
      {m.pro && <span className="text-[9px] font-bold tracking-widest text-faint border border-edge2 rounded px-1 py-px">PRO</span>}
      <ChevronRight size={16} className="shrink-0 text-faint" />
    </button>
  );
}

export default function WealthPages({ page, onOpen, onClose }: {
  page: WealthPage | null;
  onOpen: (p: WealthPage) => void;
  onClose: () => void;
}) {
  const p = usePrefs();
  const desktop = useIsDesktop();
  const showing: WealthPage | null = page ?? (desktop ? "accounts" : null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!page) { setScrolled(false); return; }
    const f = () => setScrolled(window.scrollY > 56);
    f();
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, [page]);

  const groups = GROUPS
    .map((g) => g.filter((k) => !META[k].pro || p.mode === "pro" || p.revealed.has("sec-whatif") || page === k))
    .filter((g) => g.length);
  const m = showing ? META[showing] : null;

  return (
    <div className="space-y-3">
      {/* net worth hero: stays mounted behind a pushed page so going back is instant */}
      <div className={page && !desktop ? "hidden" : ""}><div id="sec-nwhistory" className="scroll-mt-28"><NetWorthHistory /></div></div>

      <div className="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-4 lg:items-start">
        {(!page || desktop) && (
          <nav aria-label="Wealth" className={`space-y-4 lg:sticky lg:top-[calc(var(--header-h,49px)+57px)] ${page ? "" : "wp-pop"}`}>
            {groups.map((g, i) => (
              <div key={i} className="rounded-2xl border border-edge bg-panel overflow-hidden divide-y divide-edge">
                {g.map((k) => <Row key={k} page={k} active={showing === k} onOpen={onOpen} />)}
              </div>
            ))}
            <ProHint what="the net-worth calendar, Money Lab, the stress test and FIRE" />
          </nav>
        )}

        {showing && m && (
          <section key={showing} aria-label={m.title} className="wp-push min-w-0">
            <div className="lg:hidden sticky z-30 -mx-3 sm:-mx-4 px-2 top-[var(--header-h,49px)] sm:top-[calc(var(--header-h,49px)+41px)]
                            bg-bg/85 backdrop-blur-xl border-b border-transparent data-[s=true]:border-edge transition-colors"
                 data-s={scrolled}>
              <div className="h-11 grid grid-cols-[1fr_auto_1fr] items-center">
                <button onClick={() => { haptic(); onClose(); }}
                        className="justify-self-start min-h-[44px] -ml-0.5 pl-1 pr-3 flex items-center gap-0.5 text-[16px] text-up
                                   rounded-lg active:opacity-60 focus-visible:outline-2 focus-visible:outline-up">
                  <ChevronLeft size={24} strokeWidth={2.4} className="-mr-0.5" />Wealth
                </button>
                <span className={`text-[15px] font-semibold text-txt truncate transition-opacity duration-200 ${scrolled ? "opacity-100" : "opacity-0"}`}>{m.title}</span>
                <span />
              </div>
            </div>
            <h1 className="font-display text-[30px] leading-[1.1] font-bold text-txt tracking-tight pt-1 pb-3 lg:pt-0">{m.title}</h1>
            <PageBody page={showing} />
          </section>
        )}
      </div>
    </div>
  );
}
