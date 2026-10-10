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
import { registerKeyboardAssist } from "@/lib/keyboard";
import CommandPalette from "@/components/CommandPalette";
import TickerHost from "@/components/TickerSheet";
import { ToastHost } from "@/components/AlertsCenter";
import MonthlyReportHost from "@/components/MonthlyReport";
import StarredList from "@/components/StarredList";
import CompareChart from "@/components/CompareChart";
import SectorMap from "@/components/SectorMap";
import TradeCalendar from "@/components/TradeCalendar";
import LiqHeatmap from "@/components/LiqHeatmap";
import ExitDesk from "@/components/ExitDesk";
import Panes from "@/components/Panes";
import Section, { ProHint } from "@/components/Section";
import { reveal } from "@/lib/prefs";
import StatsBar from "@/components/StatsBar";
import NewsFeed from "@/components/NewsFeed";
import TradeTracker from "@/components/TradeTracker";
import SignalLog from "@/components/SignalLog";
import KeyLevels from "@/components/KeyLevels";
import Portfolio from "@/components/Portfolio";
import RiskDesk from "@/components/RiskDesk";
import Analytics from "@/components/Analytics";
import SimBot from "@/components/SimBot";
import BuyZones from "@/components/BuyZones";
import SwingIdeas from "@/components/SwingIdeas";
import Overview from "@/components/Overview";
import DialogHost from "@/components/DialogHost";
import Celebrate from "@/components/Celebrate";
import PullToRefresh from "@/components/PullToRefresh";
import CryptoScreener from "@/components/CryptoScreener";
import CryptoContext from "@/components/CryptoContext";
import EconCalendar from "@/components/EconCalendar";
import Narratives from "@/components/Narratives";
import StockScreener from "@/components/StockScreener";
import OptionsWatch from "@/components/OptionsWatch";
import EarningsCalendar from "@/components/EarningsCalendar";
import WealthPages, { WEALTH_ANCHOR, type WealthPage } from "@/components/WealthPages";

// Anchors that live inside another foldable section
const PARENT: Record<string, string> = {
  "sec-goals": "sec-ontrack", "sec-health": "sec-ontrack",
  "sec-income": "sec-cashflow", "sec-spending": "sec-cashflow", "sec-budget": "sec-cashflow",
  "sec-moneylab": "sec-whatif", "sec-stress": "sec-whatif", "sec-fire": "sec-whatif",
  "sec-tradelist": "sec-trades", "sec-tradecal": "sec-trades",
  "sec-signallog": "sec-signals", "sec-levels": "sec-signals", "sec-positions": "sec-signals",
  "sec-riskdesk": "sec-edge", "sec-analytics": "sec-edge", "sec-simbot": "sec-edge",
  "sec-topbuys": "sec-ideas", "sec-swing": "sec-ideas", "sec-sectors": "sec-ideas",
  "sec-compare": "sec-research", "sec-screener": "sec-research",
  "sec-coins": "sec-crypto", "sec-narratives": "sec-crypto",
  "sec-earnings": "sec-calendar", "sec-econ": "sec-calendar",
};

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

export default function Dashboard() {
  const [tab, setTabState] = useState<TabKey>("home");
  const [sub, setSubState] = useState<MarketsSub>("ideas");
  const [wealthPage, setWealthPage] = useState<WealthPage | null>(null);
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
      setWealthPage(p.tab === "wealth" ? p.page ?? null : null);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    registerSW(); // push notifications for price alerts
    const offKbd = registerKeyboardAssist(); // phones: keep the focused field above the keyboard
    return () => { window.removeEventListener("hashchange", fromHash); offKbd(); };
  }, []);

  const subRef = useRef(sub);
  subRef.current = sub;
  const wpRef = useRef<WealthPage | null>(null);
  wpRef.current = wealthPage;
  const listScroll = useRef(0);
  const go = useCallback((t: TabKey, s?: MarketsSub, anchor?: string) => {
    setTabState(t);
    if (s) setSubState(s);
    const page = t === "wealth" && anchor ? WEALTH_ANCHOR[anchor] ?? null : null;
    setWealthPage(page);
    const hash = `#${t}${t === "markets" ? `/${s ?? subRef.current}` : ""}${page ? `/${page}` : ""}`;
    if (page && location.hash === "#wealth") history.pushState({ wp: 1 }, "", hash); // browser back returns to the list
    else history.replaceState(null, "", hash);
    if (anchor) {
      if (PARENT[anchor]) reveal(PARENT[anchor]); // parent first so lastRevealed ends as the pane id
      reveal(anchor);
      // wait for the tab to render, then scroll to the section
      let tries = 0;
      const tryScroll = () => { if (!scrollToId(anchor) && tries++ < 20) setTimeout(tryScroll, 60); };
      setTimeout(tryScroll, 40);
    } else {
      window.scrollTo({ top: 0 });
    }
  }, []);
  const openWealthPage = useCallback((p: WealthPage) => {
    if (!wpRef.current) listScroll.current = window.scrollY;
    history.pushState({ wp: 1 }, "", `#wealth/${p}`);
    setWealthPage(p);
    if (!window.matchMedia("(min-width: 1024px)").matches) window.scrollTo({ top: 0 });
  }, []);
  const closeWealthPage = useCallback(() => {
    if (history.state?.wp) history.back(); // hashchange pops the page
    else { history.replaceState(null, "", "#wealth"); setWealthPage(null); }
  }, []);
  // popping back to the list restores where you were on it
  const hadPage = useRef(false);
  useEffect(() => {
    if (hadPage.current && !wealthPage && tab === "wealth") {
      const y = listScroll.current;
      requestAnimationFrame(() => window.scrollTo({ top: y }));
    }
    hadPage.current = !!wealthPage;
  }, [wealthPage, tab]);
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
      if (cur.tab === "wealth" && wpRef.current && dx > 0) { haptic(); closeWealthPage(); return; } // swipe back, not a tab change
      const i = SEQ.findIndex((x) => x.tab === cur.tab && (x.tab !== "markets" || x.sub === cur.sub));
      const next = SEQ[i + (dx < 0 ? 1 : -1)];
      if (!next) return;
      haptic();
      go(next.tab, next.sub);
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    return () => { window.removeEventListener("touchstart", start); window.removeEventListener("touchend", end); };
  }, [go, closeWealthPage]);

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

        {tab === "home" && <Overview onNavigate={setTab} />}

        {/* ── Trading ── */}
        {tab === "trading" && (
          <>
            <StatsBar stats={stats} edge={edge} />
            <Section id="sec-exits" title="Exit" accent="Desk" hint="how stretched each holding is · your take-profit plan">
              <ExitDesk />
            </Section>
            <Section id="sec-trades" title="Trade" accent="Log" hint="open + closed trades · P&L calendar">
              <Panes items={[
                { id: "sec-tradelist", label: "Trades", node: <TradeTracker trades={trades} onChanged={refreshCore} /> },
                { id: "sec-tradecal", label: "Calendar", node: <TradeCalendar trades={trades} /> },
              ]} />
            </Section>
            <Section id="sec-signals" title="Signals" accent="& Levels" hint="TradingView alerts · key levels · positions" pro>
              <Panes grid items={[
                { id: "sec-signallog", label: "Signals", span: "lg:col-span-5", node: <SignalLog signals={signals} onChanged={refreshCore} /> },
                { id: "sec-levels", label: "Levels", span: "lg:col-span-3", node: <KeyLevels levels={levels} prices={prices} onChanged={refreshCore} /> },
                { id: "sec-positions", label: "Positions", span: "lg:col-span-4", node: <Portfolio positions={positions} prices={prices} onChanged={refreshCore} /> },
              ]} />
            </Section>
            <Section id="sec-edge" title="Edge" accent="Desk" hint="position sizing · expectancy · paper bot" pro>
              <Panes items={[
                { id: "sec-riskdesk", label: "Sizing", node: <RiskDesk trades={trades} /> },
                { id: "sec-analytics", label: "Analytics", node: <Analytics /> },
                { id: "sec-simbot", label: "Sim bot", node: <SimBot /> },
              ]} />
            </Section>
            <ProHint what="signals, key levels, position sizing and edge analytics" />
          </>
        )}

        {/* ── Markets: Ideas / Stocks / Crypto ── */}
        {tab === "markets" && (
          <>
            <SubTabs value={sub} onChange={setSub} />
            <div id="sec-starred" className="scroll-mt-28"><StarredList /></div>
            {sub === "ideas" && (
              <Section id="sec-ideas" title="Buy" accent="Ideas" hint="buy & sell zones · swing setups · hot themes">
                <Panes items={[
                  { id: "sec-topbuys", label: "Zones", node: <BuyZones /> },
                  { id: "sec-swing", label: "Swing", node: <SwingIdeas /> },
                  { id: "sec-sectors", label: "Sectors", node: <SectorMap /> },
                ]} />
              </Section>
            )}
            {sub === "stocks" && (
              <>
                <Section id="sec-options" title="Options" accent="Watch" hint="your stocks · live signals"><OptionsWatch /></Section>
                <Section id="sec-research" title="Stock" accent="Research" hint="compare tickers · tech screener">
                  <Panes items={[
                    { id: "sec-compare", label: "Compare", node: <CompareChart /> },
                    { id: "sec-screener", label: "Screener", pro: true, node: <StockScreener /> },
                  ]} />
                </Section>
                <ProHint what="the tech stock screener" />
              </>
            )}
            {sub === "crypto" && (
              <>
                <Section id="sec-liqmap" title="Liquidation" accent="Heatmap" hint="where leveraged BTC positions get wiped"><LiqHeatmap /></Section>
                <Section id="sec-crypto" title="Crypto" accent="Markets" hint="live coins · hot sectors">
                  <Panes items={[
                    { id: "sec-coins", label: "Coins", node: <div className="space-y-3"><CryptoContext /><CryptoScreener /></div> },
                    { id: "sec-narratives", label: "Narratives", pro: true, node: <Narratives /> },
                  ]} />
                </Section>
                <ProHint what="crypto narratives" />
              </>
            )}
          </>
        )}

        {/* ── News ── */}
        {tab === "news" && (
          <>
            <Section id="sec-news" title="News" accent="For You" hint="what you own · watchlist · macro">
              <NewsFeed news={news} loading={newsLoading} onRefresh={() => refreshNews(true)} />
            </Section>
            <Section id="sec-calendar" title="Coming" accent="Up" hint="earnings · Fed · CPI · jobs">
              <Panes items={[
                { id: "sec-earnings", label: "Earnings", node: <EarningsCalendar /> },
                { id: "sec-econ", label: "Macro", pro: true, node: <EconCalendar /> },
              ]} />
            </Section>
            <ProHint what="the macro calendar" />
          </>
        )}

        {/* ── Wealth ── */}
        {tab === "wealth" && (
          <WealthPages page={wealthPage} onOpen={openWealthPage} onClose={closeWealthPage} />
        )}

        {tab === "trading" && (
          <footer className="pb-4 pt-2 text-center text-[10px] text-faint font-medium">
            Quality over quantity · Confluence + sweep + 2:1 RR minimum · 70% win rate target
          </footer>
        )}
      </main>
    </div>
  );
}
