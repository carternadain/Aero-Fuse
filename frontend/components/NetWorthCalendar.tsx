"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";

interface Snapshot { date: string; net_worth: number }

const WEEKS = 26;
const DAY = 86_400_000;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function NetWorthCalendar() {
  const [snaps, setSnaps] = useState<Snapshot[]>([]);

  useEffect(() => {
    api.get<Snapshot[]>("/api/networth/history").then(setSnaps).catch(() => {});
  }, []);

  const { cells, change, best, worst, tracked } = useMemo(() => {
    // Daily change vs the previous snapshot (snapshots can skip days).
    const change = new Map<string, { pct: number; usd: number; nw: number }>();
    for (let i = 1; i < snaps.length; i++) {
      const prev = snaps[i - 1].net_worth, cur = snaps[i].net_worth;
      if (prev) change.set(snaps[i].date, { pct: (cur / prev - 1) * 100, usd: cur - prev, nw: cur });
    }
    // Grid: WEEKS columns × 7 rows, ending this week, starting on a Sunday.
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    const start = new Date(today.getTime() - ((WEEKS - 1) * 7 + today.getUTCDay()) * DAY);
    const cells: { date: string; future: boolean }[] = [];
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = new Date(start.getTime() + i * DAY);
      cells.push({ date: iso(d), future: d > today });
    }
    const vals = [...change.entries()];
    const best = vals.reduce<[string, { pct: number; usd: number }] | null>((b, v) => (!b || v[1].usd > b[1].usd ? v : b), null);
    const worst = vals.reduce<[string, { pct: number; usd: number }] | null>((b, v) => (!b || v[1].usd < b[1].usd ? v : b), null);
    return { cells, change, best, worst, tracked: snaps.length };
  }, [snaps]);

  const color = (pct: number) => {
    const a = Math.min(1, 0.25 + Math.abs(pct) / 3); // ±3% day = full strength
    return `color-mix(in srgb, ${pct >= 0 ? "var(--color-up)" : "var(--color-down)"} ${Math.round(a * 100)}%, transparent)`;
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><CalendarDays size={14} />Net Worth Calendar</span>
        <span className="text-[10px] text-faint">each square is a day · last 6 months</span>
      </div>
      <div className="p-4 space-y-3">
        <div className="overflow-x-auto">
          <div className="grid grid-flow-col gap-[3px] w-max" style={{ gridTemplateRows: "repeat(7, 11px)" }}>
            {cells.map((c) => {
              const ch = change.get(c.date);
              return (
                <div key={c.date}
                     title={ch ? `${c.date}: ${ch.usd >= 0 ? "+" : "−"}${fmtUsd(Math.abs(ch.usd))} (${ch.pct.toFixed(2)}%) → ${fmtUsd(ch.nw)}` : c.date}
                     className="w-[11px] h-[11px] rounded-[2px]"
                     style={{ background: c.future ? "transparent" : ch ? color(ch.pct) : "var(--color-edge)" }} />
              );
            })}
          </div>
        </div>
        {tracked < 2 ? (
          <p className="text-[11px] text-dim">
            Fills in on its own: the backend saves your net worth every hour, so a new square lights up each day.
            Come back in a week and you&apos;ll see your up and down days.
          </p>
        ) : (
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-dim">
            <span>{tracked} days tracked</span>
            {best && <span>Best day: <span className="text-up font-bold">+{fmtUsd(best[1].usd)}</span> ({best[0]})</span>}
            {worst && worst[1].usd < 0 && <span>Worst day: <span className="text-down font-bold">−{fmtUsd(Math.abs(worst[1].usd))}</span> ({worst[0]})</span>}
          </div>
        )}
      </div>
    </section>
  );
}
