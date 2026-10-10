"use client";

// Wealth as an iOS-style "list you tap into": a grouped inset list of areas, each opening a
// full page with a back button. On desktop (lg+) the list sits left and the page right.
// Each row shows a live one-line summary so you can see what's inside without tapping.

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  CalendarClock, ChevronLeft, ChevronRight, Coins, FlaskConical, Landmark, Receipt, Target, WalletCards,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { haptic } from "@/lib/bus";
import { isHidden, MASK } from "@/lib/privacy";
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

import type { WealthPage } from "./TabNav";
export type { WealthPage };

type Tint = "up" | "amber" | "cyan" | "down" | "warn";
const TINT: Record<Tint, string> = {
  up: "bg-up/15 text-up", amber: "bg-amber/15 text-amber", cyan: "bg-cyan/15 text-cyan",
  down: "bg-down/15 text-down", warn: "bg-warn/15 text-warn",
};

/** `sub` is the fallback line; once data loads each row shows a live summary instead. */
const META: Record<WealthPage, { title: string; sub: string; icon: LucideIcon; tint: Tint }> = {
  accounts: { title: "Accounts", sub: "Balances and risk", icon: Landmark, tint: "up" },
  budget: { title: "Budget & spending", sub: "Import statements, set limits", icon: WalletCards, tint: "down" },
  bills: { title: "Bills", sub: "Subscriptions and what's due", icon: CalendarClock, tint: "warn" },
  dividends: { title: "Dividends", sub: "Payouts and yield", icon: Coins, tint: "up" },
  taxes: { title: "Taxes", sub: "Gains, harvesting, wash sales", icon: Receipt, tint: "amber" },
  goals: { title: "Goals & plans", sub: "Targets, savings plan, free money", icon: Target, tint: "amber" },
  whatif: { title: "What if", sub: "Crash test, FIRE, time machine", icon: FlaskConical, tint: "cyan" },
};

const GROUPS: WealthPage[][] = [
  ["accounts"],
  ["budget", "bills", "dividends", "taxes"],
  ["goals", "whatif"],
];

/** Which Wealth page owns each in-page anchor (null = the net worth hero on the list itself). */
export const WEALTH_ANCHOR: Record<string, WealthPage | null> = {
  "sec-nwhistory": null,
  "sec-wealth": "accounts", "sec-risk": "accounts", "sec-nwcal": "accounts",
  "sec-cashflow": "budget", "sec-spending": "budget", "sec-budget": "budget",
  "sec-bills": "bills",
  "sec-income": "dividends",
  "sec-taxes": "taxes",
  "sec-ontrack": "goals", "sec-goals": "goals", "sec-plan": "goals", "sec-health": "goals",
  "sec-whatif": "whatif", "sec-moneylab": "whatif", "sec-stress": "whatif", "sec-fire": "whatif",
};

// ── one-line summaries ──
const usd = (n: number) => (isHidden() ? MASK : `${n < 0 ? "−" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

async function loadSummaries(): Promise<Partial<Record<WealthPage, string>>> {
  const get = <T,>(u: string) => api.get<T>(u).catch(() => null);
  const [acc, risk, plan, bills, inc, tax, goals] = await Promise.all([
    get<{ accounts: unknown[] }>("/api/accounts"),
    get<{ label?: string }>("/api/networth/risk"),
    get<{ totals: { target: number; spent: number; left: number } }>("/api/budget/plan"),
    get<{ totals: { monthly: number; count: number; upcoming_count: number } }>("/api/recurring"),
    get<{ annual: number }>("/api/income"),
    get<{ summary: { est_tax: number }; harvest_total?: { est_saved: number } }>("/api/taxes"),
    get<{ goals: { name: string; pct: number }[] }>("/api/goals"),
  ]);
  const out: Partial<Record<WealthPage, string>> = {};
  if (acc?.accounts) {
    const n = acc.accounts.length;
    out.accounts = n ? [plural(n, "account"), risk?.label ? `${risk.label} risk` : ""].filter(Boolean).join(" · ") : "Add your first account";
  }
  if (plan?.totals) {
    const t = plan.totals;
    out.budget = `${usd(t.spent)} spent this month` + (t.target > 0 ? ` · ${t.left >= 0 ? `${usd(t.left)} left` : `${usd(-t.left)} over`}` : "");
  }
  if (bills?.totals) {
    const t = bills.totals;
    out.bills = t.count
      ? `${plural(t.count, "bill")} · ${usd(t.monthly)} a month${t.upcoming_count ? ` · ${t.upcoming_count} due soon` : ""}`
      : "None found yet. Import a few months to spot them";
  }
  if (inc) out.dividends = inc.annual > 0 ? `${usd(inc.annual)} a year, about ${usd(inc.annual / 12)} a month` : "No dividends in the past year";
  if (tax?.summary) {
    const saved = tax.harvest_total?.est_saved ?? 0;
    out.taxes = saved > 0 ? `Harvesting losses could save ${usd(saved)}`
      : tax.summary.est_tax > 0 ? `About ${usd(tax.summary.est_tax)} owed on gains so far` : "No tax owed on gains so far";
  }
  if (goals?.goals) {
    const g = goals.goals;
    out.goals = g.length ? `${g[0].name}: ${Math.round(g[0].pct)}%${g.length > 1 ? ` · ${g.length - 1} more` : ""}` : "Set a target, check free money";
  }
  return out;
}

const lgQuery = "(min-width: 1024px)";
function useIsDesktop() {
  return useSyncExternalStore(
    (f) => { const m = window.matchMedia(lgQuery); m.addEventListener("change", f); return () => m.removeEventListener("change", f); },
    () => window.matchMedia(lgQuery).matches,
    () => false,
  );
}

// At most one switcher per page, and every pane is named the way you'd look for it.
function PageBody({ page }: { page: WealthPage }) {
  switch (page) {
    case "accounts":
      return (
        <div className="space-y-3">
          <Panes items={[
            { id: "sec-wealth", label: "Accounts", node: <NetWorth /> },
            { id: "sec-risk", label: "Risk", node: <RiskRating /> },
            { id: "sec-nwcal", label: "Calendar", pro: true, node: <NetWorthCalendar /> },
          ]} />
          <ProHint what="the net worth calendar" />
        </div>
      );
    case "budget":
      return (
        <div id="sec-cashflow" className="scroll-mt-28">
          <Panes items={[
            { id: "sec-spending", label: "Spending", node: <BudgetTracker /> },
            { id: "sec-budget", label: "Budget", node: <MonthlyBudget /> },
          ]} />
        </div>
      );
    case "bills": return <div id="sec-bills" className="scroll-mt-28"><RecurringBills /></div>;
    case "dividends": return <div id="sec-income" className="scroll-mt-28"><IncomeTracker /></div>;
    case "taxes": return <div id="sec-taxes" className="scroll-mt-28"><TaxCenter /></div>;
    case "goals":
      return (
        <div id="sec-ontrack" className="scroll-mt-28">
          <Panes items={[
            { id: "sec-goals", label: "Goals", node: <Goals /> },
            { id: "sec-plan", label: "Savings plan", node: <SavingsPlan /> },
            { id: "sec-health", label: "Free money", node: <WealthChecks /> },
          ]} />
        </div>
      );
    case "whatif":
      return (
        <div id="sec-whatif" className="scroll-mt-28">
          <Panes items={[
            { id: "sec-moneylab", label: "Money lab", node: <MoneyLab /> },
            { id: "sec-stress", label: "Crash test", node: <StressTest /> },
            { id: "sec-fire", label: "FIRE", node: <FireCalc /> },
          ]} />
        </div>
      );
  }
}

function Row({ page, sub, active, onOpen }: {
  page: WealthPage; sub?: string; active: boolean; onOpen: (p: WealthPage) => void;
}) {
  const m = META[page];
  const Icon = m.icon;
  return (
    <button
      onClick={() => { haptic(); onOpen(page); }}
      aria-current={active ? "page" : undefined}
      className={`wp-row relative w-full min-h-[56px] flex items-center gap-3 pl-3.5 pr-3 py-2 text-left transition-colors
                  focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-up
                  ${active ? "lg:bg-panel2" : "active:bg-panel2 lg:hover:bg-panel2/60"}`}
    >
      <span className={`shrink-0 w-8 h-8 rounded-[9px] flex items-center justify-center ${TINT[m.tint]}`}>
        <Icon size={17} strokeWidth={2.2} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold text-txt leading-tight truncate">{m.title}</span>
        <span className="block text-[12px] text-dim leading-tight mt-1 truncate tabular-nums">{sub ?? m.sub}</span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-faint" />
    </button>
  );
}

export default function WealthPages({ page, onOpen, onClose }: {
  page: WealthPage | null;
  onOpen: (p: WealthPage) => void;
  onClose: () => void;
}) {
  const desktop = useIsDesktop();
  const showing: WealthPage | null = page ?? (desktop ? "accounts" : null);
  const [scrolled, setScrolled] = useState(false);
  const [subs, setSubs] = useState<Partial<Record<WealthPage, string>>>({});
  const listShown = !page || desktop;

  useEffect(() => {
    if (!page) { setScrolled(false); return; }
    const f = () => setScrolled(window.scrollY > 56);
    f();
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, [page]);

  // Refresh the row summaries whenever the list comes (back) into view, so edits made on a page show up.
  useEffect(() => {
    if (!listShown) return;
    let alive = true;
    loadSummaries().then((s) => { if (alive) setSubs(s); });
    return () => { alive = false; };
  }, [listShown, page]);

  const m = showing ? META[showing] : null;

  return (
    <div className="space-y-3">
      {/* net worth hero: stays mounted behind a pushed page so going back is instant */}
      <div className={page && !desktop ? "hidden" : ""}><div id="sec-nwhistory" className="scroll-mt-28"><NetWorthHistory /></div></div>

      <div className="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-4 lg:items-start">
        {listShown && (
          <nav aria-label="Wealth" className={`space-y-4 lg:sticky lg:top-[calc(var(--header-h,49px)+57px)] ${page ? "" : "wp-pop"}`}>
            {GROUPS.map((g, i) => (
              <div key={i} className="rounded-2xl border border-edge bg-panel overflow-hidden divide-y divide-edge">
                {g.map((k) => <Row key={k} page={k} sub={subs[k]} active={showing === k} onOpen={onOpen} />)}
              </div>
            ))}
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
