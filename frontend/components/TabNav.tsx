"use client";

import {
  Activity, Bitcoin, CandlestickChart, House, Lightbulb, LineChart, Newspaper, Wallet, type LucideIcon,
} from "lucide-react";
import { haptic } from "@/lib/bus";

export type TabKey = "home" | "trading" | "markets" | "news" | "wealth";
export type MarketsSub = "ideas" | "stocks" | "crypto";
/** Pages inside the Wealth tab, addressed as #wealth/<page>. */
export type WealthPage =
  | "accounts" | "goals" | "plan" | "spending" | "budget" | "dividends" | "taxes" | "whatif" | "backup";
export const WEALTH_PAGES: WealthPage[] = ["accounts", "goals", "plan", "spending", "budget", "dividends", "taxes", "whatif", "backup"];

export const TABS: { key: TabKey; label: string; short: string; icon: LucideIcon }[] = [
  { key: "home", label: "Home", short: "Home", icon: House },
  { key: "trading", label: "Trade", short: "Trade", icon: Activity },
  { key: "markets", label: "Markets", short: "Markets", icon: LineChart },
  { key: "news", label: "News", short: "News", icon: Newspaper },
  { key: "wealth", label: "Wealth", short: "Wealth", icon: Wallet },
];

export const MARKET_SUBS: { key: MarketsSub; label: string; icon: LucideIcon }[] = [
  { key: "ideas", label: "Ideas", icon: Lightbulb },
  { key: "stocks", label: "Stocks", icon: CandlestickChart },
  { key: "crypto", label: "Crypto", icon: Bitcoin },
];

/** Old hashes (#buys, #stocks, #crypto) from before Markets existed still land in the right place. */
export function parseHash(h: string): { tab: TabKey; sub?: MarketsSub; page?: WealthPage } | null {
  const [t, s] = h.replace(/^#/, "").split("/");
  if (t === "buys") return { tab: "markets", sub: "ideas" };
  if (t === "stocks" || t === "crypto") return { tab: "markets", sub: t };
  if (!TABS.some((x) => x.key === t)) return null;
  const sub = t === "markets" && MARKET_SUBS.some((x) => x.key === s) ? (s as MarketsSub) : undefined;
  const page = t === "wealth" && WEALTH_PAGES.includes(s as WealthPage) ? (s as WealthPage) : undefined;
  return { tab: t as TabKey, sub, page };
}

export default function TabNav({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (t: TabKey) => void;
}) {
  const pick = (t: TabKey) => { if (t !== active) haptic(); onChange(t); };
  return (
    <>
      {/* Desktop / tablet: underline tabs under the header */}
      <nav className="hidden sm:block sticky top-[var(--header-h,49px)] z-30 bg-bg/85 backdrop-blur border-b border-edge">
        <div className="max-w-[1800px] mx-auto flex items-center gap-1 px-4">
          {TABS.map(({ key, label, icon: Icon }) => {
            const on = active === key;
            return (
              <button
                key={key}
                onClick={() => pick(key)}
                className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-bold whitespace-nowrap border-b-2 transition-colors ${
                  on ? "text-up border-up" : "text-dim border-transparent hover:text-txt"
                }`}
              >
                <Icon size={13} strokeWidth={2.5} />
                {label}
              </button>
            );
          })}
          <span className="ml-auto text-[10px] text-faint hidden md:inline">
            <kbd className="px-1.5 py-0.5 rounded border border-edge2 text-dim">Ctrl K</kbd> to search
          </span>
        </div>
      </nav>

      {/* Phone: thumb-reachable bottom bar, clear of the home indicator */}
      <nav className="bottom-nav sm:hidden fixed inset-x-2 z-40 bottom-[max(8px,env(safe-area-inset-bottom))]
                      rounded-2xl border border-edge2/70 bg-panel/80 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
        <div className="grid grid-cols-5 px-1 py-1.5">
          {TABS.map(({ key, short, icon: Icon }) => {
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

/** Segmented control for the Markets sub-tabs. */
export function SubTabs({ value, onChange }: { value: MarketsSub; onChange: (s: MarketsSub) => void }) {
  return (
    <div className="pt-1">
      <div className="flex p-1 rounded-xl border border-edge bg-panel max-w-md">
        {MARKET_SUBS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => { if (key !== value) haptic(); onChange(key); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-bold transition-colors ${
                    value === key ? "bg-panel2 text-up shadow-sm" : "text-dim hover:text-txt"
                  }`}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>
    </div>
  );
}
