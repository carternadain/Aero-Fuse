"use client";

import { useEffect, useState } from "react";
import { Bell, CalendarClock, ChevronRight, Clock, Flag, Flame, Gauge, Snowflake, Sparkles, Star, Target, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { haptic, navigate, openTicker, type NavTarget, type TickerTarget } from "@/lib/bus";
import { isHidden } from "@/lib/privacy";
import Skeleton from "./Skeleton";

interface Item {
  icon: string; tone: "up" | "down" | "amber" | "cyan" | "flat"; text: string; sub?: string; money?: boolean;
  go?: NavTarget; ticker?: TickerTarget;
}

const ICON: Record<string, LucideIcon> = {
  target: Target, flame: Flame, snow: Snowflake, clock: Clock, bell: Bell, calendar: CalendarClock,
  gauge: Gauge, flag: Flag, star: Star,
};
const TONE: Record<Item["tone"], string> = {
  up: "text-up bg-up/10", down: "text-down bg-down/10", amber: "text-amber bg-amber/10", cyan: "text-cyan bg-cyan/10", flat: "text-dim bg-panel2",
};

let cache: { items: Item[]; more: number } | null = null;

/** The few things worth knowing today, each one tap away from where to act on it. */
export default function TodayBrief() {
  const [d, setD] = useState(cache);
  useEffect(() => {
    const load = () => api.get<{ items: Item[]; more: number }>("/api/brief").then((r) => { cache = r; setD(r); }).catch(() => setD((c) => c ?? { items: [], more: 0 }));
    load();
    const t = setInterval(load, 300_000);
    return () => clearInterval(t);
  }, []);

  const mask = (t: string) => (isHidden() ? t.replace(/[−+-]?\$[\d,]+(\.\d+)?/g, "•••") : t);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><Sparkles size={14} />Today&apos;s Brief</span>
        <span className="text-[10px] text-faint">what matters right now</span>
      </div>
      {!d ? (
        <div className="p-3 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>
      ) : !d.items.length ? (
        <p className="px-4 py-4 text-[12.5px] text-dim">Quiet day. Nothing stretched, expiring or alerting.</p>
      ) : (
        <div>
          {d.items.map((it, i) => {
            const Icon = it.icon === "move" ? (it.tone === "up" ? TrendingUp : TrendingDown) : ICON[it.icon] ?? Sparkles;
            const act = () => { haptic(); if (it.ticker) openTicker(it.ticker); else if (it.go) navigate(it.go); };
            return (
              <button key={i} onClick={act}
                      className="w-full flex items-center gap-3 px-4 py-2.5 border-t border-edge/50 first:border-t-0 text-left hover:bg-panel2/50 active:bg-panel2">
                <span className={`rounded-lg p-1.5 shrink-0 ${TONE[it.tone]}`}><Icon size={14} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-txt leading-snug">{it.money ? mask(it.text) : it.text}</span>
                  {it.sub && <span className="block text-[10.5px] text-faint">{it.sub}</span>}
                </span>
                <ChevronRight size={14} className="text-faint shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
