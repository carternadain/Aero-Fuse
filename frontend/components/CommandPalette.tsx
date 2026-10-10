"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bell, Bot, Download, Layers, LayoutGrid, CornerDownLeft, Eye, FileBarChart, Hash, Search, Settings as Gear, Star, Wallet, X, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { haptic, navigate, on, openAlerts, openReport, openSettings, openTicker, type Kind } from "@/lib/bus";
import { accountAnchor } from "@/lib/live";
import { isHidden, setHidden } from "@/lib/privacy";
import { useStars } from "@/lib/stars";
import { getMode, setMode, setBotTools, usePrefs } from "@/lib/prefs";

interface IndexTicker { symbol: string; kind: Kind; name: string | null; sector?: string; owned: boolean }

type Item = {
  id: string; group: "Tickers" | "Go to" | "Accounts" | "Actions";
  label: string; hint?: string; icon: LucideIcon; keywords?: string; run: () => void; rank?: number;
};

// Every place worth jumping to: [label, tab, sub, anchor id, extra keywords]
const PLACES: [string, string, string | undefined, string | undefined, string][] = [
  ["Net worth chart", "home", undefined, "sec-networth", "balance total live"],
  ["Today's map (heatmap)", "home", undefined, "sec-heatmap", "treemap movers"],
  ["Allocation", "home", undefined, "sec-allocation", "donut pie mix"],
  ["Your week", "home", undefined, "sec-week", "recap weekly"],
  ["Your accounts", "home", undefined, "sec-accounts", "holdings positions"],
  ["Starred watchlist", "markets", "ideas", "sec-starred", "favorites stars watch"],
  ["Compare tickers", "markets", "ideas", "sec-compare", "overlay vs versus"],
  ["Sector map", "markets", "ideas", "sec-sectors", "energy space heatmap"],
  ["Swing ideas", "markets", "ideas", "sec-swing", "energy nuclear space defense ai"],
  ["Check a stock or crypto", "markets", "check", "sec-topbuys", "risk score buy sell zones should I buy overheated estimate top buys best scores overbought accumulate exit desk overheated heat stop trailing trim"],
  ["Your holdings risk", "markets", "mine", "sec-holdrisk", "risk what I own overheated heat stop trailing trim"],
  ["Sell plan", "markets", "mine", "sec-exitplan", "sell ladder take profit budget sells simulator exit desk overheated heat stop trailing trim"],
  ["Options watch", "markets", "ideas", "sec-options", "contracts calls puts"],
  ["Tech stock screener", "markets", "ideas", "sec-screener", ""],
  ["BTC liquidation heatmap", "markets", "crypto", "sec-liqmap", "coinglass liquidity leverage bitcoin"],
  ["Crypto markets", "markets", "crypto", "sec-crypto", "coins bitcoin"],
  ["Narratives", "markets", "crypto", "sec-narratives", "categories"],
  ["News for my holdings", "news", undefined, "sec-news", "headlines"],
  ["Earnings calendar", "news", undefined, "sec-earnings", ""],
  ["Macro calendar", "news", undefined, "sec-econ", "economic fed cpi fomc jobs"],
  ["Options you hold", "markets", "mine", "sec-optplan", "options decay expiry exit desk take profit"],
  ["Trade log", "trading", undefined, "sec-trades", "journal"],
  ["Trading calendar & streaks", "trading", undefined, "sec-tradecal", "p&l pnl win rate"],
  ["Position sizing", "trading", undefined, "sec-riskdesk", "position size"],
  ["Signals", "trading", undefined, "sec-signals", "tradingview alerts"],
  ["Key levels", "trading", undefined, "sec-levels", "support resistance"],
  ["Positions", "trading", undefined, "sec-positions", "holdings"],
  ["Paper bot", "trading", undefined, "sec-simbot", "paper trading"],
  ["Trading stats", "trading", undefined, "sec-analytics", "expectancy"],
  ["Goals", "wealth", undefined, "sec-goals", "target progress"],
  ["Net worth by account", "wealth", undefined, "sec-wealth", "edit balances"],
  ["Net worth over time", "wealth", undefined, "sec-nwhistory", "history chart daily snapshots debts cash property"],
  ["Risk rating", "wealth", undefined, "sec-risk", "leverage"],
  ["Savings plan", "wealth", undefined, "sec-plan", "contributions 401k roth"],
  ["Dividend income", "wealth", undefined, "sec-income", "dividends payouts yield"],
  ["Money lab", "wealth", undefined, "sec-moneylab", "time machine milestones"],
  ["Stress test", "wealth", undefined, "sec-stress", "crash black swan"],
  ["Health check", "wealth", undefined, "sec-health", "free money irs limits emergency fund"],
  ["Net worth calendar", "wealth", undefined, "sec-nwcal", "daily heatmap"],
  ["Monthly budget", "wealth", undefined, "sec-budget", "monthly budget targets limits category spending left per day pace over"],
  ["Money in & out (import statements)", "wealth", undefined, "sec-spending", "budget spending import csv ofx qfx bank statement transactions categories rules subscriptions bills recurring"],
  ["FIRE calculator", "wealth", undefined, "sec-fire", "retire early independence"],
];



let indexCache: { tickers: IndexTicker[]; accounts: string[] } | null = null;

function score(q: string, text: string): number {
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t === q) return 100;
  if (t.startsWith(q)) return 60;
  const w = t.split(/[\s/&·(),-]+/);
  if (w.some((x) => x.startsWith(q))) return 40;
  if (t.includes(q)) return 25;
  let i = 0;
  for (const c of t) if (c === q[i]) i++;
  return i === q.length ? 8 : 0;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [index, setIndex] = useState(indexCache);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { items: stars } = useStars();
  const { botTools } = usePrefs();

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? "");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", k);
    const off = on("app:search", () => setOpen(true));
    return () => { window.removeEventListener("keydown", k); off(); };
  }, []);

  // Phones: fit the sheet above the on-screen keyboard so the last results aren't hidden under it
  const [vh, setVh] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !vv) return;
    const fit = () => setVh(vv.height);
    fit();
    vv.addEventListener("resize", fit);
    return () => vv.removeEventListener("resize", fit);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQ(""); setSel(0);
    setTimeout(() => input.current?.focus(), 30);
    if (!indexCache) {
      api.get<{ tickers: IndexTicker[]; accounts: string[] }>("/api/search/index")
        .then((r) => { indexCache = r; setIndex(r); }).catch(() => {});
    }
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const close = () => setOpen(false);

  const all: Item[] = useMemo(() => {
    const out: Item[] = [];
    const starSet = new Set(stars.map((s) => s.symbol));
    for (const t of index?.tickers ?? []) {
      out.push({
        id: `t:${t.kind}:${t.symbol}`, group: "Tickers", label: t.symbol, icon: starSet.has(t.symbol) ? Star : Hash,
        hint: [t.name, t.sector, t.owned ? "you own this" : null, t.kind === "crypto" ? "crypto" : null].filter(Boolean).join(" · "),
        keywords: `${t.name ?? ""} ${t.sector ?? ""}`, rank: (t.owned ? 3 : 0) + (starSet.has(t.symbol) ? 2 : 0),
        run: () => openTicker({ symbol: t.symbol, kind: t.kind }),
      });
    }
    for (const [label, tab, sub, anchor, kw] of PLACES) {
      if (!botTools && tab === "trading") continue;
      out.push({ id: `p:${label}`, group: "Go to", label, hint: tab === "markets" ? `Invest · ${sub![0].toUpperCase() + sub!.slice(1)}` : tab === "trading" ? "Bot" : tab[0].toUpperCase() + tab.slice(1),
                 icon: ArrowRight, keywords: kw, run: () => navigate({ tab, sub, anchor }) });
    }
    for (const a of index?.accounts ?? []) {
      out.push({ id: `a:${a}`, group: "Accounts", label: a, icon: Wallet, hint: "jump to account",
                 run: () => navigate({ tab: "home", anchor: accountAnchor(a) }) });
    }
    out.push(
      { id: "x:hide", group: "Actions", label: isHidden() ? "Show balances" : "Hide balances", icon: Eye, keywords: "privacy mask",
        run: () => setHidden(!isHidden()) },
      { id: "x:mode", group: "Actions", label: getMode() === "simple" ? "Switch to Pro mode (show everything)" : "Switch to Simple mode",
        icon: Layers, keywords: "simple pro advanced declutter view", run: () => setMode(getMode() === "simple" ? "pro" : "simple") },
      { id: "x:bot", group: "Actions", label: botTools ? "Hide trading bot tools" : "Show trading bot tools", icon: Bot,
        keywords: "bot trade log signals paper simbot switch", run: () => {
          setBotTools(!botTools);
          if (botTools && window.location.hash.startsWith("#trading")) navigate({ tab: "home" });
        } },
      { id: "x:settings", group: "Actions", label: "Settings", icon: Gear, keywords: "preferences options colors palette theme holiday view simple pro log out sign out logout",
        run: () => openSettings() },
      { id: "x:home", group: "Actions", label: "Customize Home", icon: LayoutGrid, keywords: "home cards edit show hide layout settings",
        run: () => openSettings("home") },
      { id: "x:panels", group: "Actions", label: "Choose Invest and News panels", icon: LayoutGrid, keywords: "panels show hide settings narratives macro screener heatmap",
        run: () => openSettings("panels") },
      { id: "x:backup", group: "Actions", label: "Backup and export", icon: Download, keywords: "download csv json database restore backup export settings",
        run: () => openSettings("backup") },
      { id: "x:alert", group: "Actions", label: "New price alert", icon: Bell, keywords: "notify ping", run: () => openAlerts() },
      { id: "x:report", group: "Actions", label: "Monthly report", icon: FileBarChart, keywords: "recap summary month", run: () => openReport() },
    );
    return out;
  }, [index, stars, botTools]);

  const ql = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!ql) {
      const owned = all.filter((i) => i.group === "Tickers" && (i.rank ?? 0) >= 2).slice(0, 6);
      return [...owned, ...all.filter((i) => i.group === "Go to").slice(0, 8), ...all.filter((i) => i.group === "Actions")];
    }
    const scored = all
      .map((i) => ({ i, s: Math.max(score(ql, i.label) * (i.group === "Tickers" ? 1.3 : 1), score(ql, i.keywords ?? "") * 0.6,
                                    score(ql, i.hint ?? "") * 0.4) + (i.rank ?? 0) }))
      .filter((x) => x.s > (x.i.rank ?? 0)) // must actually match, not just be popular
      .sort((a, b) => b.s - a.s)
      .slice(0, 30)
      .map((x) => x.i);
    // Let any ticker-looking query open directly, even if it isn't in the index.
    if (/^[a-z.]{1,6}$/.test(ql) && !scored.some((i) => i.group === "Tickers" && i.label.toLowerCase() === ql)) {
      scored.push({ id: `t:any:${ql}`, group: "Tickers", label: ql.toUpperCase(), icon: Search, hint: "look up this ticker",
                    run: () => openTicker({ symbol: ql.toUpperCase() }) });
    }
    // keep each group together, groups ordered by their best match
    const groups = [...new Set(scored.map((i) => i.group))];
    return groups.flatMap((g) => scored.filter((i) => i.group === g));
  }, [all, ql]);

  useEffect(() => { setSel(0); }, [ql]);
  useEffect(() => {
    list.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const pick = (i: Item) => { haptic(); close(); setTimeout(i.run, 20); };

  if (!open) return null;

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[88] bg-black/60 flex items-start justify-center sm:pt-[12vh]"
         onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="w-full sm:max-w-xl bg-panel sm:rounded-2xl border-b sm:border border-edge2 shadow-2xl overflow-hidden tab-enter
                      pt-[env(safe-area-inset-top)] max-h-[100dvh] sm:max-h-[70vh] flex flex-col"
           role="dialog" aria-modal="true" aria-label="Search" style={vh ? { maxHeight: `min(${vh}px, 100dvh)` } : undefined}>
        <div className="flex items-center gap-2 pl-4 pr-2 border-b border-edge">
          <Search size={16} className="text-faint shrink-0" />
          <input ref={input} type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Search tickers, accounts, sections…" aria-label="Search"
                 className="no-search-cancel flex-1 min-w-0 bg-transparent py-4 text-base sm:text-[15px] text-txt placeholder:text-faint outline-none"
                 onKeyDown={(e) => {
                   if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
                   else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
                   else if (e.key === "Enter" && results[sel]) { e.preventDefault(); pick(results[sel]); }
                   else if (e.key === "Escape") close();
                 }} />
          <button onClick={close} aria-label="Close search" title="Close (Esc)"
                  className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full text-dim hover:text-txt hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-cyan">
            <X size={20} aria-hidden />
          </button>
        </div>
        <div ref={list} className="overflow-y-auto py-1 flex-1">
          {results.length === 0 && (
            <div className="px-6 py-10 text-center">
              <p className="text-[14px] font-semibold text-txt">No matches for “{q.trim()}”</p>
              <p className="mt-1 text-[12px] text-dim">Try a ticker like AAPL, an account name, or a section like budget.</p>
            </div>
          )}
          {results.map((r, idx) => {
            const head = r.group !== lastGroup ? (lastGroup = r.group) : null;
            const Icon = r.icon;
            return (
              <div key={r.id}>
                {head && <div className="px-4 pt-3 pb-1 text-[10px] font-bold tracking-widest text-faint uppercase">{head}</div>}
                <button data-idx={idx} onMouseEnter={() => setSel(idx)} onClick={() => pick(r)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${idx === sel ? "bg-panel2" : ""}`}>
                  <span className={`rounded-lg p-1.5 shrink-0 ${r.group === "Tickers" ? "bg-up/10 text-up" : "bg-bg/60 text-amber"}`}>
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-bold text-txt truncate">{r.label}</span>
                    {r.hint && <span className="block text-[11px] text-faint truncate">{r.hint}</span>}
                  </span>
                  {idx === sel && <CornerDownLeft size={13} className="text-faint hidden sm:block" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
