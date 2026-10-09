"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, LogOut, Search } from "lucide-react";
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
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 safe-top border-b border-edge bg-panel sticky top-0 z-40">
      <div className="flex items-center gap-2.5">
        <span className="live-dot inline-block w-2 h-2 rounded-full bg-up" />
        <h1 className="font-display text-[22px] leading-none text-txt">
          Swing <em className="text-up">Terminal</em>
        </h1>
        <span className="hidden sm:inline text-[10px] text-faint font-medium">
          NeuroWave × Kryptonite
        </span>
      </div>

      <div className="flex items-center gap-4 overflow-x-auto">
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

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <span className="hidden sm:inline text-[11px] text-dim tabular-nums">{clock}</span>
        <button onClick={() => setMode(mode === "simple" ? "pro" : "simple")}
                title={mode === "simple" ? "Simple view: advanced tools hidden. Tap for Pro" : "Pro view: everything shown. Tap for Simple"}
                className={`text-[10px] font-extrabold tracking-wider px-2 py-1 rounded-md border transition-colors ${
                  mode === "pro" ? "border-amber/50 text-amber bg-amber/10" : "border-edge2 text-dim"}`}>
          {mode === "pro" ? "PRO" : "SIMPLE"}
        </button>
        <button className="icon-btn !text-dim hover:!text-txt" title="Search (Ctrl K)" onClick={openSearch}>
          <Search size={15} />
        </button>
        <AlertsCenter />
        <button className="icon-btn !text-dim hover:!text-txt" title={hide ? "Show balances" : "Hide balances"}
                onClick={() => { setHidden(!hide); setHide(!hide); }}>
          {hide ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <PalettePicker />
        {authOn && (
          <button className="icon-btn" onClick={logout} title="Sign out">
            <LogOut size={14} />
          </button>
        )}
      </div>
    </header>
  );
}
