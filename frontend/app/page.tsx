"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type {
  EdgeReport,
  NewsResponse,
  Signal,
  Stats,
  Trade,
  Level,
  Position,
} from "@/lib/types";
import Header from "@/components/Header";
import TabNav, { TABS, type TabKey } from "@/components/TabNav";
import StatsBar from "@/components/StatsBar";
import NewsFeed from "@/components/NewsFeed";
import TradeTracker from "@/components/TradeTracker";
import SignalLog from "@/components/SignalLog";
import KeyLevels from "@/components/KeyLevels";
import Portfolio from "@/components/Portfolio";
import NetWorth from "@/components/NetWorth";
import FireCalc from "@/components/FireCalc";
import BudgetTracker from "@/components/BudgetTracker";
import RiskDesk from "@/components/RiskDesk";
import Analytics from "@/components/Analytics";
import SimBot from "@/components/SimBot";
import TopBuys from "@/components/TopBuys";
import SwingIdeas from "@/components/SwingIdeas";
import Overview from "@/components/Overview";
import DialogHost from "@/components/DialogHost";
import Celebrate from "@/components/Celebrate";
import PullToRefresh from "@/components/PullToRefresh";
import RiskRating from "@/components/RiskRating";
import SavingsPlan from "@/components/SavingsPlan";
import MoneyLab from "@/components/MoneyLab";
import StressTest from "@/components/StressTest";
import WealthChecks from "@/components/WealthChecks";
import NetWorthCalendar from "@/components/NetWorthCalendar";
import CryptoScreener from "@/components/CryptoScreener";
import CryptoContext from "@/components/CryptoContext";
import EconCalendar from "@/components/EconCalendar";
import Narratives from "@/components/Narratives";
import StockScreener from "@/components/StockScreener";
import OptionsWatch from "@/components/OptionsWatch";
import EarningsCalendar from "@/components/EarningsCalendar";

function SectionDivider({ title, accent, hint }: { title: string; accent: string; hint?: string }) {
  return (
    <div className="section-divider flex items-baseline gap-3 pt-3">
      <h2 className="font-display text-[26px] leading-none text-txt">
        {title} <em className="text-amber">{accent}</em>
      </h2>
      <div className="flex-1 h-px bg-edge self-center" />
      {hint && <span className="hidden sm:inline text-[10px] text-faint font-medium">{hint}</span>}
    </div>
  );
}

export default function Dashboard() {
  const [tab, setTabState] = useState<TabKey>("home");
  const [, setPrivacyTick] = useState(0); // re-render everything when "hide balances" flips
  useEffect(() => {
    const on = () => setPrivacyTick((n) => n + 1);
    window.addEventListener("privacy", on);
    return () => window.removeEventListener("privacy", on);
  }, []);

  // Tab lives in the URL hash so refreshes / home-screen relaunches land where you left off.
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1) as TabKey;
      if (TABS.some((t) => t.key === h)) setTabState(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const setTab = (t: TabKey) => {
    setTabState(t);
    history.replaceState(null, "", `#${t}`);
    window.scrollTo({ top: 0 });
  };

  const [stats, setStats] = useState<Stats | null>(null);
  const [edge, setEdge] = useState<EdgeReport | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [news, setNews] = useState<NewsResponse | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [backendDown, setBackendDown] = useState(false);

  const refreshCore = useCallback(async () => {
    try {
      const [s, t, sg, lv, ps, pr, eg] = await Promise.all([
        api.get<Stats>("/api/stats"),
        api.get<Trade[]>("/api/trades"),
        api.get<Signal[]>("/api/signals"),
        api.get<Level[]>("/api/levels"),
        api.get<Position[]>("/api/positions"),
        api.get<Record<string, number>>("/api/prices"),
        api.get<EdgeReport>("/api/signals/edge-report"),
      ]);
      setStats(s); setTrades(t); setSignals(sg); setLevels(lv);
      setPositions(ps); setPrices(pr); setEdge(eg);
      setBackendDown(false);
    } catch {
      setBackendDown(true);
    }
  }, []);

  const refreshNews = useCallback(async (force = false) => {
    setNewsLoading(true);
    try {
      setNews(await api.get<NewsResponse>(`/api/news${force ? "?refresh=true" : ""}`));
    } catch {
      /* backend banner already covers this */
    } finally {
      setNewsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCore();
    refreshNews();
    const core = setInterval(refreshCore, 15000); // signals/trades poll
    const newsT = setInterval(() => refreshNews(), 5 * 60000);
    return () => { clearInterval(core); clearInterval(newsT); };
  }, [refreshCore, refreshNews]);

  return (
    <div className="min-h-screen">
      <Header />
      <TabNav active={tab} onChange={setTab} />
      <DialogHost />
      <Celebrate />
      <PullToRefresh />
      <main key={tab} className="tab-enter p-3 sm:p-4 pb-28 sm:pb-6 space-y-3 max-w-[1800px] mx-auto">
        {backendDown && (
          <div className="panel border-down/50 px-4 py-3 text-xs text-down">
            ⚠ Backend offline — start it with:{" "}
            <code className="text-amber">cd backend &amp;&amp; uvicorn main:app --port 8000</code>
          </div>
        )}

        {/* ── Trading ── */}
        {tab === "home" && <Overview onNavigate={setTab} />}

        {tab === "trading" && (
          <>
            <SectionDivider title="Trading" accent="Desk" hint="signals · trades · levels" />
            <StatsBar stats={stats} edge={edge} />
            <RiskDesk trades={trades} />
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-4">
                <NewsFeed news={news} loading={newsLoading} onRefresh={() => refreshNews(true)} />
              </div>
              <div className="lg:col-span-8">
                <TradeTracker trades={trades} onChanged={refreshCore} />
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-5">
                <SignalLog signals={signals} onChanged={refreshCore} />
              </div>
              <div className="lg:col-span-3">
                <KeyLevels levels={levels} prices={prices} onChanged={refreshCore} />
              </div>
              <div className="lg:col-span-4">
                <Portfolio positions={positions} prices={prices} onChanged={refreshCore} />
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <Analytics />
              <SimBot />
            </div>
          </>
        )}

        {/* ── Top Buys ── */}
        {tab === "buys" && (
          <>
            <SectionDivider title="Top" accent="Buys" hint="best long-term scores · click for history" />
            <TopBuys />
            <SectionDivider title="Swing" accent="Ideas" hint="energy, nuclear, space, defense, AI & more · + adds to Options Watch" />
            <SwingIdeas />
          </>
        )}

        {/* ── Stocks ── */}
        {tab === "stocks" && (
          <>
            <SectionDivider title="Options" accent="Watch" hint="your 8 stocks · live signals" />
            <OptionsWatch />
            <SectionDivider title="Tech Stock" accent="Screener" hint="long-term buy / overbought" />
            <StockScreener />
          </>
        )}

        {/* ── Crypto ── */}
        {tab === "crypto" && (
          <>
            <SectionDivider title="Crypto" accent="Markets" hint="live · CoinGecko · click a row for history" />
            <CryptoContext />
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
              <div className="xl:col-span-8">
                <CryptoScreener />
              </div>
              <div className="xl:col-span-4">
                <Narratives />
              </div>
            </div>
          </>
        )}

        {/* ── News ── */}
        {tab === "news" && (
          <>
            <SectionDivider title="News" accent="& Earnings" hint="projections · sentiment · macro" />
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-4">
                <EconCalendar />
              </div>
              <div className="lg:col-span-4">
                <EarningsCalendar />
              </div>
              <div className="lg:col-span-4">
                <NewsFeed news={news} loading={newsLoading} onRefresh={() => refreshNews(true)} />
              </div>
            </div>
          </>
        )}

        {/* ── Wealth ── */}
        {tab === "wealth" && (
          <>
            <SectionDivider title="Wealth" accent="Desk" hint="tap an account to expand it · tap a row to edit" />
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
              <div className="lg:col-span-7">
                <NetWorth />
              </div>
              <div className="lg:col-span-5 space-y-3">
                <RiskRating />
                <SavingsPlan />
              </div>
            </div>
            <SectionDivider title="Money" accent="Lab" hint="what your dollars turn into" />
            <MoneyLab />
            <SectionDivider title="Stress" accent="Test" hint="what a crash would do to you" />
            <StressTest />
            <SectionDivider title="Health" accent="Check" hint="free money · limits · cushion · expirations" />
            <WealthChecks />
            <NetWorthCalendar />
            <SectionDivider title="Plan" accent="Ahead" hint="FIRE · budget" />
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
              <div className="lg:col-span-7">
                <FireCalc />
              </div>
              <div className="lg:col-span-5">
                <BudgetTracker />
              </div>
            </div>
          </>
        )}

        <footer className="pb-4 pt-2 text-center text-[10px] text-faint font-medium">
          Quality over quantity · Confluence + sweep + 2:1 RR minimum · 70% win rate target
        </footer>
      </main>
    </div>
  );
}
