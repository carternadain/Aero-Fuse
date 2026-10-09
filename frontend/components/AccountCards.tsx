"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { haptic, scrollToId } from "@/lib/bus";
import { accountAnchor, sectionForAccount, sectionForLabel, useLive, type Section } from "@/lib/live";
import { fmtCents, isHidden } from "@/lib/privacy";
import { SECTION_COLOR, SECTION_LABEL } from "./AllocationDonut";
import Sparkline from "./Sparkline";
import Skeleton from "./Skeleton";

interface Spark { points: number[]; change: number | null; change_pct: number | null }
interface Card { name: string; section: Section; total: number; spark?: Spark; manual: boolean }

/** Wallet-style strip: one card per account, swipe sideways, tap to jump to it below. */
export default function AccountCards() {
  const { holdings, accounts, loaded } = useLive();
  const [sparks, setSparks] = useState<Record<string, Spark>>({});
  const strip = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const load = () => api.get<Record<string, Spark>>("/api/accounts/sparks").then(setSparks).catch(() => {});
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, []);

  const cards: Card[] = useMemo(() => {
    const by = new Map<string, number>();
    for (const h of holdings) by.set(h.label || "Other holdings", (by.get(h.label || "Other holdings") ?? 0) + (h.value ?? 0));
    const out: Card[] = [...by].map(([name, total]) => ({ name, total, section: sectionForLabel(name), spark: sparks[name], manual: false }));
    for (const a of accounts) {
      if (a.kind === "liability") continue;
      out.push({ name: a.name, total: a.balance, section: sectionForAccount(a), manual: true });
    }
    return out.sort((a, b) => b.total - a.total);
  }, [holdings, accounts, sparks]);

  const onScroll = () => {
    const el = strip.current;
    if (!el) return;
    const w = el.firstElementChild?.clientWidth ?? 1;
    setPage(Math.round(el.scrollLeft / (w + 12)));
  };

  const jump = (c: Card) => {
    haptic();
    window.dispatchEvent(new CustomEvent("app:open-account", { detail: c.name }));
    setTimeout(() => scrollToId(accountAnchor(c.name)), 60);
  };

  if (!loaded) return <div className="flex gap-3 overflow-hidden">{[0, 1].map((i) => <Skeleton key={i} className="h-[132px] w-[78%] sm:w-[260px] shrink-0 !rounded-2xl" />)}</div>;
  if (!cards.length) return null;

  return (
    <div>
      <div ref={strip} onScroll={onScroll} data-noswipe
           className="flex gap-3 overflow-x-auto snap-x snap-mandatory -mx-3 px-3 sm:mx-0 sm:px-0 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {cards.map((c) => {
          const chg = c.spark?.change ?? null;
          const up = (chg ?? 0) >= 0;
          return (
            <button key={c.name} onClick={() => jump(c)}
                    className="snap-start shrink-0 w-[78%] sm:w-[260px] rounded-2xl border border-edge p-4 text-left relative overflow-hidden
                               bg-gradient-to-br from-panel2 to-panel hover:border-edge2 transition-colors active:scale-[0.99]">
              <span className="absolute -right-8 -top-8 w-28 h-28 rounded-full opacity-15" style={{ background: SECTION_COLOR[c.section] }} />
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: SECTION_COLOR[c.section] }} />
                <span className="text-[10px] font-bold tracking-widest text-faint uppercase">{SECTION_LABEL[c.section]}</span>
              </div>
              <div className="text-[13px] font-bold text-txt truncate mt-1">{c.name}</div>
              <div className="text-[22px] font-extrabold text-txt tabular-nums leading-tight mt-0.5">{fmtCents(c.total)}</div>
              <div className="flex items-end justify-between mt-1 h-[34px]">
                <span className={`text-[11px] tabular-nums ${c.manual ? "text-faint" : up ? "text-up" : "text-down"}`}>
                  {c.manual ? "entered by hand" : chg != null ? `${up ? "▲" : "▼"} ${isHidden() ? "" : fmtCents(Math.abs(chg))} ${Math.abs(c.spark?.change_pct ?? 0).toFixed(2)}% today` : "—"}
                </span>
                {c.spark && c.spark.points.length > 1 && <Sparkline data={c.spark.points} width={96} height={32} />}
              </div>
            </button>
          );
        })}
      </div>
      {cards.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-2 sm:hidden">
          {cards.map((c, i) => (
            <span key={c.name} className={`h-1.5 rounded-full transition-all ${i === page ? "w-4 bg-txt" : "w-1.5 bg-edge2"}`} />
          ))}
        </div>
      )}
    </div>
  );
}
