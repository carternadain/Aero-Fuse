"use client";

import {
  Activity, Bitcoin, CandlestickChart, House, Newspaper, Target, Wallet, type LucideIcon,
} from "lucide-react";

export type TabKey = "home" | "trading" | "buys" | "stocks" | "crypto" | "news" | "wealth";

export const TABS: { key: TabKey; label: string; short: string; icon: LucideIcon }[] = [
  { key: "home", label: "Home", short: "Home", icon: House },
  { key: "trading", label: "Trading", short: "Trade", icon: Activity },
  { key: "buys", label: "Top Buys", short: "Buys", icon: Target },
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
      <nav className="sm:hidden fixed inset-x-2 z-40 bottom-[max(8px,env(safe-area-inset-bottom))]
                      rounded-2xl border border-edge2/70 bg-panel/80 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
        <div className="grid grid-cols-7 px-1 py-1.5">
          {TABS.map(({ key, short, icon: Icon }) => {
            const on = active === key;
            return (
              <button
                key={key}
                onClick={() => onChange(key)}
                aria-current={on ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-1 text-[10px] font-semibold transition-colors ${
                  on ? "text-up" : "text-faint active:text-dim"
                }`}
              >
                <span className={`flex items-center justify-center w-11 h-7 rounded-full transition-colors ${on ? "bg-up/15" : ""}`}>
                  <Icon size={19} strokeWidth={on ? 2.4 : 1.9} />
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
