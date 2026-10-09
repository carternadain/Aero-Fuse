"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import TabNav, { SubTabs, parseHash, type MarketsSub, type TabKey } from "@/components/TabNav";
import { haptic, on, scrollToId, type NavTarget } from "@/lib/bus";
import { registerSW } from "@/lib/push";
import CommandPalette from "@/components/CommandPalette";
import TickerHost from "@/components/TickerSheet";
import { ToastHost } from "@/components/AlertsCenter";
import MonthlyReportHost from "@/components/MonthlyReport";
import StarredList from "@/components/StarredList";
import CompareChart from "@/components/CompareChart";
import SectorMap from "@/components/SectorMap";
import TradeCalendar from "@/components/TradeCalendar";
import Goals from "@/components/Goals";
import IncomeTracker from "@/components/IncomeTracker";
import LiqHeatmap from "@/components/LiqHeatmap";
import ExitDesk from "@/components/ExitDesk";
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

// Swipe order on phones: Markets' sub-tabs sit in the middle of the sequence.
const SEQ: { tab: TabKey; sub?: MarketsSub }[] = [
  { tab: "home" }, { tab: "trading" }, { tab: "markets", sub: "ideas" }, { tab: "markets", sub: "stocks" },
  { tab: "markets", sub: "crypto" }, { tab: "news" }, { tab: "wealth" },
];

/** Inside something that scrolls sideways (a chip row, a card strip) or a chart? Then the swipe belongs to it. */
function inHScroll(el: HTMLElement | null): boolean {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.dataset.noswipe !== undefined || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)) return true;
    const ox = getComputedStyle(n).overflowX;
    if ((ox === "auto" || ox === "scroll") && n.scrollWidth > n.clientWidth + 2) return true;
  }
  return false;
}

function SectionDivider({ title, accent, hint, id }: { title: string; accent: string; hint?: string; id?: string }) {
  return (
    <div id={id} className="section-divider flex items-baseline gap-3 pt-3 scroll-mt-28">
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
  const [sub, setSubState] = useState<MarketsSub>("ideas");
  const [, setPrivacyTick] = useState(0); // re-render everything when "hide balances" flips
  useEffect(() => {
    const on = () => setPrivacyTick((n) => n + 1);
    window.addEventListener("privacy", on);
    return () => window.removeEventListener("privacy", on);
  }, []);

  // Tab lives in the URL hash so refreshes / home-screen relaunches land where you left off.
  useEffect(() => {
    const fromHash = () => {
      const p = parseHash(window.location.hash);
      if (!p) return;
      setTabState(p.tab);
      if (p.sub) setSubState(p.sub);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    registerSW(); // push notifications for price alerts
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const subRef = useRef(sub);
  subRef.current = sub;
  const go = useCallback((t: TabKey, s?: MarketsSub, anchor?: string) => {
    setTabState(t);
    if (s) setSubState(s);
    history.replaceState(null, "", `#${t}${t === "markets" ? `/${s ?? subRef.current}` : ""}`);
    if (anchor) {
      // wait for the tab to render, then scroll to the section
      let tries = 0;
      const tryScroll = () => { if (!scrollToId(anchor) && tries++ < 20) setTimeout(tryScroll, 60); };
      setTimeout(tryScroll, 40);
    } else {
      window.scrollTo({ top: 0 });
    }
  }, []);
  const setTab = (t: TabKey) => go(t);
  const setSub = (s: MarketsSub) => go("markets", s);

  // Anything can ask to navigate (search, cards, links)
  useEffect(() => on<NavTarget>("app:nav", (n) => go(n.tab as TabKey, n.sub as MarketsSub | undefined, n.anchor)), [go]);

  // Phone: swipe left/right on the page to move between tabs
  const pos = useRef({ tab, sub });
  pos.current = { tab, sub };
  useEffect(() => {
    if (!window.matchMedia?.("(pointer: coarse)").matches) return;
    let sx = 0, sy = 0, t0 = 0, ok = false;
    const start = (e: TouchEvent) => {
      ok = e.touches.length === 1 && !document.body.style.overflow && !inHScroll(e.target as HTMLElement);
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = Date.now();
    };
    const end = (e: TouchEvent) => {
      if (!ok) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.5 || Date.now() - t0 > 700) return;
      const cur = pos.current;
      const i = SEQ.findIndex((x) => x.tab === cur.tab && (x.tab !== "markets" || x.sub === cur.sub));
      const next = SEQ[i + (dx < 0 ? 1 : -1)];
      if (!next) return;
      haptic();
      go(next.tab, next.sub);
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    return () => { window.removeEventListener("touchstart", start); window.removeEventListener("touchend", end); };
  }, [go]);

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
      <CommandPalette />
      <TickerHost />
      <MonthlyReportHost />
      <ToastHost />
      <main key={tab === "markets" ? `markets/${sub}` : tab} className="tab-enter p-3 sm:p-4 pb-28 sm:pb-6 space-y-3 max-w-[1800px] mx-auto">
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
            <div id="sec-exits" className="scroll-mt-28"><ExitDesk /></div>
            <div id="sec-riskdesk" className="scroll-mt-28"><RiskDesk trades={trades} /></div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-4">
                <NewsFeed news={news} loading={newsLoading} onRefresh={() => refreshNews(true)} />
              </div>
              <div className="lg:col-span-8 space-y-3">
                <div id="sec-trades" className="scroll-mt-28"><TradeTracker trades={trades} onChanged={refreshCore} /></div>
                <div id="sec-tradecal" className="scroll-mt-28"><TradeCalendar trades={trades} /></div>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div id="sec-signals" className="lg:col-span-5 scroll-mt-28">
                <SignalLog signals={signals} onChanged={refreshCore} />
              </div>
              <div className="lg:col-span-3">
                <KeyLevels levels={levels} prices={prices} onChanged={refreshCore} />
              </div>
              <div className="lg:col-span-4">
                <Portfolio positions={positions} prices={prices} onChanged={refreshCore} />
              </div>
            </div>
            <div id="sec-analytics" className="grid grid-cols-1 lg:grid-cols-2 gap-3 scroll-mt-28">
              <Analytics />
              <SimBot />
            </div>
          </>
        )}

        {/* ── Markets: Ideas / Stocks / Crypto ── */}
        {tab === "markets" && (
          <>
            <SubTabs value={sub} onChange={setSub} />
            <div id="sec-starred" className="scroll-mt-28"><StarredList /></div>
            {sub === "ideas" && (
              <>
                <SectionDivider id="sec-topbuys" title="Top" accent="Buys" hint="best long-term scores · tap for why" />
                <TopBuys />
                <SectionDivider id="sec-sectors" title="Sector" accent="Map" hint="which themes are moving" />
                <SectorMap />
                <SectionDivider id="sec-swing" title="Swing" accent="Ideas" hint="energy, nuclear, space, defense, AI & more · + adds to Options Watch" />
                <SwingIdeas />
              </>
            )}
            {sub === "stocks" && (
              <>
                <SectionDivider id="sec-options" title="Options" accent="Watch" hint="your 8 stocks · live signals" />
                <OptionsWatch />
                <SectionDivider id="sec-compare" title="Side by" accent="Side" hint="up to 4 tickers as % change" />
                <CompareChart />
                <SectionDivider id="sec-screener" title="Tech Stock" accent="Screener" hint="long-term buy / overbought" />
                <StockScreener />
              </>
            )}
            {sub === "crypto" && (
              <>
                <SectionDivider id="sec-liqmap" title="Liquidation" accent="Heatmap" hint="where leveraged BTC positions get wiped" />
                <LiqHeatmap />
                <SectionDivider id="sec-crypto" title="Crypto" accent="Markets" hint="live · tap a row for its chart" />
                <CryptoContext />
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
                  <div className="xl:col-span-8">
                    <CryptoScreener />
                  </div>
                  <div id="sec-narratives" className="xl:col-span-4 scroll-mt-28">
                    <Narratives />
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ── News ── */}
        {tab === "news" && (
          <>
            <SectionDivider title="News" accent="& Earnings" hint="projections · sentiment · macro" />
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div id="sec-news" className="lg:col-span-4 lg:order-3 scroll-mt-28">
                <NewsFeed news={news} loading={newsLoading} onRefresh={() => refreshNews(true)} />
              </div>
              <div id="sec-econ" className="lg:col-span-4 lg:order-1 scroll-mt-28">
                <EconCalendar />
              </div>
              <div id="sec-earnings" className="lg:col-span-4 lg:order-2 scroll-mt-28">
                <EarningsCalendar />
              </div>
            </div>
          </>
        )}

        {/* ── Wealth ── */}
        {tab === "wealth" && (
          <>
            <SectionDivider title="Wealth" accent="Desk" hint="tap an account to expand it · tap a row to edit" />
            <div id="sec-goals" className="scroll-mt-28"><Goals /></div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
              <div id="sec-wealth" className="lg:col-span-7 scroll-mt-28">
                <NetWorth />
              </div>
              <div className="lg:col-span-5 space-y-3">
                <div id="sec-risk" className="scroll-mt-28"><RiskRating /></div>
                <div id="sec-plan" className="scroll-mt-28"><SavingsPlan /></div>
                <div id="sec-income" className="scroll-mt-28"><IncomeTracker /></div>
              </div>
            </div>
            <SectionDivider id="sec-moneylab" title="Money" accent="Lab" hint="what your dollars turn into" />
            <MoneyLab />
            <SectionDivider id="sec-stress" title="Stress" accent="Test" hint="what a crash would do to you" />
            <StressTest />
            <SectionDivider id="sec-health" title="Health" accent="Check" hint="free money · limits · cushion · expirations" />
            <WealthChecks />
            <NetWorthCalendar />
            <SectionDivider id="sec-fire" title="Plan" accent="Ahead" hint="FIRE · budget" />
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
