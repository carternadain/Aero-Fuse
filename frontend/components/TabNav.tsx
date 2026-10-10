"use client";

import {
  Bitcoin, Bot, BriefcaseBusiness, House, Lightbulb, LineChart, Newspaper, Search, Wallet, type LucideIcon,
} from "lucide-react";
import { haptic } from "@/lib/bus";
import { usePrefs } from "@/lib/prefs";

export type TabKey = "home" | "trading" | "markets" | "news" | "wealth";
export type MarketsSub = "check" | "mine" | "ideas" | "crypto";
/** Pages inside the Wealth tab, addressed as #wealth/<page>. */
export type WealthPage = "accounts" | "budget" | "bills" | "dividends" | "taxes" | "goals" | "whatif";
export const WEALTH_PAGES: WealthPage[] = ["accounts", "budget", "bills", "dividends", "taxes", "goals", "whatif"];
/** Pages that were renamed or merged, so old links and home-screen relaunches still land. */
const WEALTH_ALIAS: Record<string, WealthPage> = { spending: "budget", plan: "goals" };

export const TABS: { key: TabKey; label: string; short: string; icon: LucideIcon }[] = [
  { key: "home", label: "Home", short: "Home", icon: House },
  { key: "markets", label: "Invest", short: "Invest", icon: LineChart },
  { key: "news", label: "News", short: "News", icon: Newspaper },
  { key: "wealth", label: "Wealth", short: "Wealth", icon: Wallet },
  { key: "trading", label: "Bot", short: "Bot", icon: Bot }, // only shown when the "trading bot tools" pref is on
];

export const MARKET_SUBS: { key: MarketsSub; label: string; icon: LucideIcon }[] = [
  { key: "check", label: "Check", icon: Search },
  { key: "mine", label: "Mine", icon: BriefcaseBusiness },
  { key: "ideas", label: "Ideas", icon: Lightbulb },
  { key: "crypto", label: "Crypto", icon: Bitcoin },
];

/** Old hashes (#buys, #stocks, #markets/stocks, #crypto) still land in the right place. */
export function parseHash(h: string): { tab: TabKey; sub?: MarketsSub; page?: WealthPage } | null {
  const [t, s] = h.replace(/^#/, "").split("/");
  if (t === "buys" || t === "stocks") return { tab: "markets", sub: "ideas" };
  if (t === "crypto") return { tab: "markets", sub: "crypto" };
  if (t === "markets" && s === "stocks") return { tab: "markets", sub: "ideas" };
  if (!TABS.some((x) => x.key === t)) return null;
  const sub = t === "markets" && MARKET_SUBS.some((x) => x.key === s) ? (s as MarketsSub) : undefined;
  const page = t !== "wealth" ? undefined : WEALTH_PAGES.includes(s as WealthPage) ? (s as WealthPage) : WEALTH_ALIAS[s];
  return { tab: t as TabKey, sub, page };
}

export default function TabNav({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (t: TabKey) => void;
}) {
  const { botTools } = usePrefs();
  const tabs = TABS.filter((t) => t.key !== "trading" || botTools);
  const pick = (t: TabKey) => { if (t !== active) haptic(); onChange(t); };
  return (
    <>
      {/* Desktop / tablet: underline tabs under the header */}
      <nav className="hidden sm:block sticky top-[var(--header-h,49px)] z-30 bg-bg/85 backdrop-blur border-b border-edge">
        <div className="max-w-[1800px] mx-auto flex items-center gap-1 px-4">
          {tabs.map(({ key, label, icon: Icon }) => {
            const on = active === key;
            return (
              <button
                key={key}
                onClick={() => pick(key)}
                aria-current={on ? "page" : undefined}
                className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-bold whitespace-nowrap border-b-2 transition-colors ${
                  on ? "text-up border-up" : "text-dim border-transparent hover:text-txt"
                }`}
              >
                <Icon size={13} strokeWidth={2.5} />
                {label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Phone: thumb-reachable bottom bar, clear of the home indicator */}
      <nav className="bottom-nav sm:hidden fixed inset-x-2 z-40 bottom-[max(8px,env(safe-area-inset-bottom))]
                      rounded-2xl border border-edge2/70 bg-panel/80 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
        <div className="grid px-1 py-1.5" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map(({ key, short, icon: Icon }) => {
            const on = active === key;
            return (
              <button
                key={key}
                onClick={() => pick(key)}
                aria-current={on ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-1 text-[10px] font-semibold transition-colors ${
                  on ? "text-up" : "text-faint active:text-dim"
                }`}
              >
                <span className={`flex items-center justify-center w-12 h-7 rounded-full transition-colors ${on ? "bg-up/15" : ""}`}>
                  <Icon size={20} strokeWidth={on ? 2.4 : 1.9} />
                </span>
                {short}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}

/** Segmented control for the Invest sub-tabs. Four fit at 375px: tight padding, 40px tall. */
export function SubTabs({ value, onChange }: { value: MarketsSub; onChange: (s: MarketsSub) => void }) {
  return (
    <div className="pt-1">
      <div role="tablist" aria-label="Invest" className="flex p-1 rounded-xl border border-edge bg-panel max-w-md">
        {MARKET_SUBS.map(({ key, label, icon: Icon }) => (
          <button key={key} role="tab" aria-selected={value === key} onClick={() => { if (key !== value) haptic(); onChange(key); }}
                  className={`flex-1 min-w-0 min-h-10 flex items-center justify-center gap-1 sm:gap-1.5 px-1 rounded-lg text-[12px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-cyan ${
                    value === key ? "bg-panel2 text-up shadow-sm" : "text-dim hover:text-txt"
                  }`}>
            <Icon size={14} className="shrink-0" /><span className="truncate">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
