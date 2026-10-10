"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Settings as Gear } from "lucide-react";
import { api, fmtPrice } from "@/lib/api";
import AeroMark from "./AeroMark";
import AlertsCenter from "./AlertsCenter";
import { openSearch, openSettings } from "@/lib/bus";

/**
 * Phone: logo, search, settings (the bell only appears when an alert has fired).
 * Desktop adds the live price strip and a search field. Everything else lives in Settings.
 */
export default function Header() {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [prev, setPrev] = useState<Record<string, number>>({});
  const ref = useRef<HTMLElement>(null);

  // The desktop tab bar sticks right under the header, so publish the header's real height
  // (it changes with the safe-area inset and window width) for it to use.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!window.matchMedia("(min-width: 640px)").matches) return; // the strip is desktop-only
    const load = () =>
      api
        .get<Record<string, number>>("/api/prices")
        .then((p) => {
          setPrices((old) => {
            setPrev(old);
            return p;
          });
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <header ref={ref} className="flex items-center gap-3 sm:gap-4 lg:gap-6 px-4 py-2 sm:py-3 safe-top border-b border-edge bg-panel sticky top-0 z-40">
      <h1 className="flex items-center gap-2.5 shrink-0 h-10 font-display text-[20px] sm:text-[22px] leading-none text-txt whitespace-nowrap">
        <AeroMark size={22} />
        Aero
      </h1>

      <div className="hidden sm:flex flex-1 min-w-0 items-center gap-4 overflow-x-auto [scrollbar-width:none]" data-noswipe>
        {Object.entries(prices).map(([sym, price]) => {
          const dir = prev[sym] == null || price === prev[sym] ? 0 : price > prev[sym] ? 1 : -1;
          return (
            <div key={sym} className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-[10px] font-semibold text-dim">{sym}</span>
              <span className={`text-xs tabular-nums ${dir > 0 ? "text-up" : dir < 0 ? "text-down" : "text-txt"}`}>
                ${fmtPrice(price)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="header-tools ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
        {/* Desktop: a real-looking search field */}
        <button onClick={openSearch}
                className="hidden sm:flex items-center gap-2 h-9 w-52 lg:w-64 pl-3 pr-1.5 rounded-lg border border-edge2 bg-bg/60 text-[13px] text-faint hover:text-dim hover:border-dim/40 transition-colors focus-visible:outline-2 focus-visible:outline-cyan">
          <Search size={14} aria-hidden />
          <span className="flex-1 text-left">Search</span>
          <kbd className="px-1.5 py-0.5 rounded border border-edge2 text-[10px] text-dim font-sans">Ctrl K</kbd>
        </button>
        {/* Phone: just the icon */}
        <span className="sm:hidden">
          <button className="icon-btn !text-dim hover:!text-txt" aria-label="Search" onClick={openSearch}>
            <Search size={19} />
          </button>
        </span>
        <AlertsCenter />
        <button className="icon-btn !text-dim hover:!text-txt" aria-label="Settings" title="Settings" onClick={() => openSettings()}>
          <Gear size={19} className="sm:size-[17px]" />
        </button>
      </div>
    </header>
  );
}
