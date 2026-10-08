"use client";

import {
  Bitcoin, CandlestickChart, House, LineChart, Newspaper, Trophy, Wallet, type LucideIcon,
} from "lucide-react";

export type TabKey = "home" | "trading" | "buys" | "stocks" | "crypto" | "news" | "wealth";

export const TABS: { key: TabKey; label: string; short: string; icon: LucideIcon }[] = [
  { key: "home", label: "Home", short: "Home", icon: House },
  { key: "trading", label: "Trading", short: "Trade", icon: LineChart },
  { key: "buys", label: "Top Buys", short: "Buys", icon: Trophy },
  { key: "stocks", label: "Stocks", short: "Stocks", icon: CandlestickChart },
  { key: "crypto", label: "Crypto", short: "Crypto", icon: Bitcoin },
  { key: "news", label: "News", short: "News", icon: Newspaper },
  { key: "wealth", label: "Wealth", short: "Wealth", icon: Wallet },
];

export default function TabNav({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (t: TabKey) => void;
}) {
  return (
    <>
      {/* Desktop / tablet: underline tabs under the header */}
      <nav className="hidden sm:block sticky top-[49px] z-30 bg-bg/85 backdrop-blur border-b border-edge">
        <div className="max-w-[1800px] mx-auto flex items-center gap-1 px-4">
          {TABS.map(({ key, label, icon: Icon }) => {
            const on = active === key;
            return (
              <button
                key={key}
                onClick={() => onChange(key)}
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
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-panel/95 backdrop-blur border-t border-edge pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-7">
          {TABS.map(({ key, short, icon: Icon }) => {
            const on = active === key;
            return (
              <button
                key={key}
                onClick={() => onChange(key)}
                className={`relative flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[9px] font-bold transition-colors ${
                  on ? "text-up" : "text-faint"
                }`}
              >
                {on && <span className="absolute top-0 h-0.5 w-6 rounded-full bg-up" />}
                <Icon size={18} strokeWidth={on ? 2.5 : 2} />
                {short}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
