"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, LogOut, MoreHorizontal, Search } from "lucide-react";
import { isHidden, setHidden } from "@/lib/privacy";
import { api, fmtPrice } from "@/lib/api";
import PalettePicker from "./PalettePicker";
import AlertsCenter from "./AlertsCenter";
import { openSearch } from "@/lib/bus";
import { setMode, usePrefs } from "@/lib/prefs";

export default function Header() {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [prev, setPrev] = useState<Record<string, number>>({});
  const [clock, setClock] = useState("");
  const [authOn, setAuthOn] = useState(false);
  const [hide, setHide] = useState(false);
  const { mode } = usePrefs();
  const ref = useRef<HTMLElement>(null);
  const [menu, setMenu] = useState(false); // phones: the less-used header buttons live in a ⋯ menu
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  const toggleHide = () => { setHidden(!hide); setHide(!hide); };
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
  useEffect(() => setHide(isHidden()), []);

  useEffect(() => {
    api.get<{ auth: boolean }>("/api/auth/check").then((r) => setAuthOn(r.auth)).catch(() => {});
  }, []);

  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => {});
    window.location.href = "/login";
  };

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-US", { hour12: false }) +
          " · " +
          new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })
      );
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
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
    <header ref={ref} className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 sm:gap-x-4 lg:gap-x-6 gap-y-1 px-4 py-2 sm:py-3 safe-top border-b border-edge bg-panel sticky top-0 z-40">
      <div className="flex items-center gap-2.5 shrink-0">
        <span className="live-dot inline-block w-2 h-2 rounded-full bg-up" />
        <h1 className="font-display text-[20px] sm:text-[22px] leading-none text-txt whitespace-nowrap">
          Swing <em className="text-up">Terminal</em>
        </h1>
        <span className="hidden xl:inline text-[10px] text-faint font-medium">
          NeuroWave × Kryptonite
        </span>
      </div>

      <div className="order-last sm:order-none basis-full sm:basis-auto sm:flex-1 min-w-0 flex items-center gap-4 overflow-x-auto [scrollbar-width:none]" data-noswipe>
        {Object.entries(prices).map(([sym, price]) => {
          const dir = prev[sym] == null || price === prev[sym] ? 0 : price > prev[sym] ? 1 : -1;
          return (
            <div key={sym} className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-[10px] font-semibold text-dim">{sym}</span>
              <span
                className={
                  dir > 0 ? "text-up text-xs" : dir < 0 ? "text-down text-xs" : "text-txt text-xs"
                }
              >
                ${fmtPrice(price)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="header-tools ml-auto flex items-center sm:gap-3 shrink-0">
        <span className="hidden lg:inline text-[11px] text-dim tabular-nums">{clock}</span>
        <button onClick={() => setMode(mode === "simple" ? "pro" : "simple")}
                title={mode === "simple" ? "Simple view: advanced tools hidden. Tap for Pro" : "Pro view: everything shown. Tap for Simple"}
                className={`text-[10px] font-extrabold sm:tracking-wider px-1.5 sm:px-2 py-1 rounded-md border transition-colors ${
                  mode === "pro" ? "border-amber/50 text-amber bg-amber/10" : "border-edge2 text-dim"}`}>
          {mode === "pro" ? "PRO" : "SIMPLE"}
        </button>
        <button className="icon-btn !text-dim hover:!text-txt" title="Search (Ctrl K)" onClick={openSearch}>
          <Search size={15} />
        </button>
        <AlertsCenter />
        <div className="hidden sm:contents">
          <button className="icon-btn !text-dim hover:!text-txt" title={hide ? "Show balances" : "Hide balances"} onClick={toggleHide}>
            {hide ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <PalettePicker />
          {authOn && (
            <button className="icon-btn" onClick={logout} title="Sign out">
              <LogOut size={14} />
            </button>
          )}
        </div>
        <div className="relative sm:hidden" ref={menuRef}>
          <button className="icon-btn !text-dim" title="More" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={17} />
          </button>
          {menu && (
            <div className="absolute right-0 top-11 z-50 w-60 panel !overflow-visible p-1.5 shadow-xl">
              <button className="w-full flex items-center gap-2.5 px-2 py-2.5 rounded-md text-left text-xs font-bold text-txt hover:bg-panel2/60"
                      onClick={() => { toggleHide(); setMenu(false); }}>
                {hide ? <EyeOff size={15} className="text-dim" /> : <Eye size={15} className="text-dim" />}
                {hide ? "Show balances" : "Hide balances"}
              </button>
              <p className="px-2 pt-2 pb-1 text-[10px] text-faint border-t border-edge mt-1">Colors for gains and losses</p>
              <PalettePicker variant="list" />
              {authOn && (
                <button className="w-full flex items-center gap-2.5 px-2 py-2.5 mt-1 rounded-md text-left text-xs font-bold text-dim border-t border-edge hover:bg-panel2/60"
                        onClick={logout}>
                  <LogOut size={14} /> Sign out
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
