"use client";

import { Bitcoin, LineChart, Newspaper, Trophy, Wallet, type LucideIcon } from "lucide-react";

export type TabKey = "trading" | "buys" | "stocks" | "crypto" | "news" | "wealth";

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: "trading", label: "Trading", icon: LineChart },
  { key: "buys", label: "Top Buys", icon: Trophy },
  { key: "stocks", label: "Stocks", icon: LineChart },
  { key: "crypto", label: "Crypto", icon: Bitcoin },
  { key: "news", label: "News", icon: Newspaper },
  { key: "wealth", label: "Wealth", icon: Wallet },
];

export default function TabNav({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (t: TabKey) => void;
}) {
  return (
    <nav className="sticky top-[49px] z-30 bg-bg/85 backdrop-blur border-b border-edge">
      <div className="max-w-[1800px] mx-auto flex items-center gap-1 px-3 sm:px-4 overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => {
          const on = active === key;
          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-bold whitespace-nowrap border-b-2 transition-colors ${
                on
                  ? "text-up border-up"
                  : "text-dim border-transparent hover:text-txt"
              }`}
            >
              <Icon size={13} strokeWidth={2.5} />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
