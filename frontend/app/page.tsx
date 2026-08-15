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
import TabNav, { type TabKey } from "@/components/TabNav";
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
import CryptoScreener from "@/components/CryptoScreener";
import CryptoContext from "@/components/CryptoContext";
import EconCalendar from "@/components/EconCalendar";
import Narratives from "@/components/Narratives";
import StockScreener from "@/components/StockScreener";
import OptionsWatch from "@/components/OptionsWatch";
import EarningsCalendar from "@/components/EarningsCalendar";

function SectionDivider({ title, accent, hint }: { title: string; accent: string; hint?: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="text-xs font-extrabold tracking-tight text-txt">
        {title} <span className="text-amber">{accent}</span>
      </span>
      <div className="flex-1 h-px bg-edge" />
      {hint && <span className="text-[10px] text-faint font-medium">{hint}</span>}
    </div>
  );
}

export default function Dashboard() {
  const [tab, setTab] = useState<TabKey>("trading");

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
      <main className="p-3 sm:p-4 space-y-3 max-w-[1800px] mx-auto">
        {backendDown && (
          <div className="panel border-down/50 px-4 py-3 text-xs text-down">
            ⚠ Backend offline — start it with:{" "}
            <code className="text-amber">cd backend &amp;&amp; uvicorn main:app --port 8000</code>
          </div>
        )}

        {/* ── Trading ── */}
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
            <SectionDivider title="Wealth" accent="Desk" hint="Net worth · FIRE · Budget" />
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-5">
                <NetWorth />
              </div>
              <div className="lg:col-span-7">
                <FireCalc />
              </div>
            </div>
            <BudgetTracker />
          </>
        )}

        <footer className="pb-4 pt-2 text-center text-[10px] text-faint font-medium">
          Quality over quantity · Confluence + sweep + 2:1 RR minimum · 70% win rate target
        </footer>
      </main>
    </div>
  );
}
