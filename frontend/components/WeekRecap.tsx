"use client";

import { useEffect, useState } from "react";
import { CalendarRange, Flame, PiggyBank, Share, TrendingDown, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { haptic, toast } from "@/lib/bus";
import { shareWeekCard } from "@/lib/shareCard";
import { fmtCents, isHidden } from "@/lib/privacy";
import Skeleton from "./Skeleton";

interface Mover { symbol: string; display: string; pct: number; usd: number }
interface Recap {
  nw_change: number | null; nw_change_pct: number | null;
  best: Mover | null; worst: Mover | null; hottest: Mover | null;
  up_count: number; down_count: number; saved_week: number;
}

const signed = (n: number) => (isHidden() ? "•••" : `${n >= 0 ? "+" : "−"}${fmtCents(Math.abs(n))}`);

/** "Your week" card: the move, who drove it, and what you put away. */
export default function WeekRecap() {
  const [r, setR] = useState<Recap | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => { setFailed(false); api.get<Recap>("/api/recap/week").then(setR).catch(() => setFailed(true)); };
  useEffect(load, []);

  const share = async () => {
    if (!r) return;
    haptic();
    const rows = [
      r.best && r.best.usd > 0 ? { label: "Carried me", name: r.best.display, pct: r.best.pct } : null,
      r.worst && r.worst.usd < 0 ? { label: "Dragged me", name: r.worst.display, pct: r.worst.pct } : null,
      r.hottest && r.hottest.symbol !== r.best?.symbol && r.hottest.pct > 0 ? { label: "Hottest mover", name: r.hottest.display, pct: r.hottest.pct } : null,
    ].filter((x): x is { label: string; name: string; pct: number } => x != null);
    try {
      const how = await shareWeekCard({ pct: r.nw_change_pct, rows, up: r.up_count, down: r.down_count });
      if (how === "downloaded") toast("Saved my-week.png. It shows percentages only.");
    } catch { toast("Couldn't make the image. Try again."); }
  };

  const Row = ({ icon, k, v, sub, tone }: { icon: React.ReactNode; k: string; v: React.ReactNode; sub?: string; tone?: string }) => (
    <div className="flex items-center gap-3 py-2 border-t border-edge/60 first:border-t-0">
      <span className="rounded-lg bg-panel2 p-1.5 text-dim shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-faint">{k}</div>
        {sub && <div className="text-[12px] text-dim truncate">{sub}</div>}
      </div>
      <div className={`text-[14px] font-bold tabular-nums ${tone ?? "text-txt"}`}>{v}</div>
    </div>
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><CalendarRange size={14} />Your Week</span>
        {r && (
          <span className="flex items-center gap-1">
            <span className="text-[10px] text-faint">{r.up_count} up · {r.down_count} down</span>
            <button type="button" onClick={share} aria-label="Share your week as an image" title="Share (percentages only)"
                    className="w-10 h-10 -my-2 -mr-2 grid place-items-center rounded-full text-dim hover:text-txt hover:bg-panel2 transition-colors focus-visible:outline-2 focus-visible:outline-up">
              <Share size={16} aria-hidden />
            </button>
          </span>
        )}
      </div>
      <div className="px-4 py-3">
        {!r && failed ? (
          <div className="py-2">
            <p className="text-[13px] text-dim">Couldn&apos;t load your week.</p>
            <button className="btn min-h-10 mt-2" onClick={load}>Try again</button>
          </div>
        ) : !r ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-40" />
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className={`font-display text-[34px] leading-none ${(r.nw_change ?? 0) >= 0 ? "text-up" : "text-down"}`}>
                {(r.nw_change_pct ?? 0) >= 0 ? "+" : "−"}{Math.abs(r.nw_change_pct ?? 0).toFixed(2)}%
              </span>
              {r.nw_change != null && <span className="text-[12px] text-dim tabular-nums">{signed(r.nw_change)} this week</span>}
            </div>
            <div className="mt-3">
              {r.best && r.best.usd > 0 && (
                <Row icon={<TrendingUp size={14} />} k="Carried you" sub={`${r.best.display} ${r.best.pct >= 0 ? "+" : ""}${r.best.pct.toFixed(1)}%`}
                     v={signed(r.best.usd)} tone="text-up" />
              )}
              {r.worst && r.worst.usd < 0 && (
                <Row icon={<TrendingDown size={14} />} k="Dragged you" sub={`${r.worst.display} ${r.worst.pct.toFixed(1)}%`}
                     v={signed(r.worst.usd)} tone="text-down" />
              )}
              {r.hottest && r.hottest.symbol !== r.best?.symbol && r.hottest.pct > 0 && (
                <Row icon={<Flame size={14} />} k="Hottest mover" sub={r.hottest.display}
                     v={`+${r.hottest.pct.toFixed(1)}%`} tone="text-up" />
              )}
              <Row icon={<PiggyBank size={14} />} k="You put away (plan pace)" v={isHidden() ? "•••" : fmtCents(r.saved_week)} tone="text-cyan" />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
