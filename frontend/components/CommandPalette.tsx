"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bell, CornerDownLeft, Eye, FileBarChart, Hash, Search, Star, Wallet, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { haptic, navigate, on, openAlerts, openReport, openTicker, type Kind } from "@/lib/bus";
import { accountAnchor } from "@/lib/live";
import { isHidden, setHidden } from "@/lib/privacy";
import { useStars } from "@/lib/stars";

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
  ["Compare tickers", "markets", "stocks", "sec-compare", "overlay vs versus"],
  ["Sector map", "markets", "ideas", "sec-sectors", "energy space heatmap"],
  ["Swing ideas", "markets", "ideas", "sec-swing", "energy nuclear space defense ai"],
  ["Top buys", "markets", "ideas", "sec-topbuys", "best scores"],
  ["Options watch", "markets", "stocks", "sec-options", "contracts calls puts"],
  ["Tech stock screener", "markets", "stocks", "sec-screener", ""],
  ["BTC liquidation heatmap", "markets", "crypto", "sec-liqmap", "coinglass liquidity leverage bitcoin"],
  ["Crypto markets", "markets", "crypto", "sec-crypto", "coins bitcoin"],
  ["Narratives", "markets", "crypto", "sec-narratives", "categories"],
  ["News for my holdings", "news", undefined, "sec-news", "headlines"],
  ["Earnings calendar", "news", undefined, "sec-earnings", ""],
  ["Economic calendar", "news", undefined, "sec-econ", "fed cpi fomc jobs"],
  ["Trade log", "trading", undefined, "sec-trades", "journal"],
  ["Trading calendar & streaks", "trading", undefined, "sec-tradecal", "p&l pnl win rate"],
  ["Risk desk", "trading", undefined, "sec-riskdesk", "position size"],
  ["Signals", "trading", undefined, "sec-signals", "tradingview alerts"],
  ["Edge analytics", "trading", undefined, "sec-analytics", "expectancy"],
  ["Goals", "wealth", undefined, "sec-goals", "target progress"],
  ["Net worth by account", "wealth", undefined, "sec-wealth", "edit balances"],
  ["Risk rating", "wealth", undefined, "sec-risk", "leverage"],
  ["Savings plan", "wealth", undefined, "sec-plan", "contributions 401k roth"],
  ["Dividend income", "wealth", undefined, "sec-income", "dividends payouts yield"],
  ["Money lab", "wealth", undefined, "sec-moneylab", "time machine milestones"],
  ["Stress test", "wealth", undefined, "sec-stress", "crash black swan"],
  ["Health check", "wealth", undefined, "sec-health", "free money irs limits emergency fund"],
  ["FIRE & budget", "wealth", undefined, "sec-fire", "retire early spending"],
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
      out.push({ id: `p:${label}`, group: "Go to", label, hint: tab === "markets" ? `Markets · ${sub}` : tab[0].toUpperCase() + tab.slice(1),
                 icon: ArrowRight, keywords: kw, run: () => navigate({ tab, sub, anchor }) });
    }
    for (const a of index?.accounts ?? []) {
      out.push({ id: `a:${a}`, group: "Accounts", label: a, icon: Wallet, hint: "jump to account",
                 run: () => navigate({ tab: "home", anchor: accountAnchor(a) }) });
    }
    out.push(
      { id: "x:hide", group: "Actions", label: isHidden() ? "Show balances" : "Hide balances", icon: Eye, keywords: "privacy mask",
        run: () => setHidden(!isHidden()) },
      { id: "x:alert", group: "Actions", label: "New price alert", icon: Bell, keywords: "notify ping", run: () => openAlerts() },
      { id: "x:report", group: "Actions", label: "Monthly report", icon: FileBarChart, keywords: "recap summary month", run: () => openReport() },
    );
    return out;
  }, [index, stars]);

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
                      pt-[env(safe-area-inset-top)] max-h-[100dvh] sm:max-h-[70vh] flex flex-col">
        <div className="flex items-center gap-2 px-4 border-b border-edge">
          <Search size={16} className="text-faint shrink-0" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Search tickers, accounts, sections…"
                 className="flex-1 bg-transparent py-4 text-[15px] text-txt placeholder:text-faint outline-none"
                 onKeyDown={(e) => {
                   if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
                   else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
                   else if (e.key === "Enter" && results[sel]) { e.preventDefault(); pick(results[sel]); }
                   else if (e.key === "Escape") close();
                 }} />
          <button className="text-[11px] text-dim px-2 py-1 rounded-md border border-edge2" onClick={close}>Esc</button>
        </div>
        <div ref={list} className="overflow-y-auto py-1 flex-1">
          {results.length === 0 && <p className="px-4 py-6 text-center text-xs text-dim">Nothing matches “{q}”.</p>}
          {results.map((r, idx) => {
            const head = r.group !== lastGroup ? (lastGroup = r.group) : null;
            const Icon = r.icon;
            return (
              <div key={r.id}>
                {head && <div className="px-4 pt-3 pb-1 text-[10px] font-bold tracking-widest text-faint uppercase">{head}</div>}
                <button data-idx={idx} onMouseEnter={() => setSel(idx)} onClick={() => pick(r)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${idx === sel ? "bg-panel2" : ""}`}>
                  <span className={`rounded-lg p-1.5 shrink-0 ${r.group === "Tickers" ? "bg-up/10 text-up" : "bg-panel2 text-amber"}`}>
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
