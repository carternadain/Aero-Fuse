"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import type { EconEvent } from "@/lib/types";
import { api } from "@/lib/api";

function fmtDate(d: string) {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function countdown(d: string): string {
  const diff = Math.round((new Date(d + "T00:00:00").getTime() - Date.now()) / 86400000);
  if (diff <= 0) return "today";
  if (diff === 1) return "tomorrow";
  return `in ${diff}d`;
}

export default function EconCalendar() {
  const [events, setEvents] = useState<EconEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ events: EconEvent[] }>("/api/context/calendar")
      .then((r) => setEvents(r.events))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const soonest = events[0];

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">
          <CalendarDays size={14} /> Economic Calendar
          <span className="text-[10px] text-faint font-medium ml-1">high-impact US macro</span>
        </span>
        {soonest && (
          <span className="text-[10px] text-amber font-semibold">
            next: {soonest.event.split(" ")[0]} {countdown(soonest.date)}
          </span>
        )}
      </div>
      <div className="divide-y divide-edge">
        {events.length === 0 && (
          <p className="p-4 text-xs text-dim">{loading ? "Loading…" : "No high-impact events in the next 45 days."}</p>
        )}
        {events.map((e, i) => (
          <div key={`${e.date}-${i}`} className="flex items-center gap-3 px-3 py-2.5">
            <span className="w-2 h-2 rounded-full shrink-0 bg-down" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-txt">
                {e.event} {e.approx && <span className="text-[9px] text-faint font-normal">(approx)</span>}
              </div>
              <div className="text-[10px] text-faint">{e.note}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[11px] text-dim tabular-nums">{fmtDate(e.date)}</div>
              <div className="text-[10px] text-amber">{countdown(e.date)}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="px-3 py-2 text-[10px] text-faint border-t border-edge">
        Don&apos;t open new swings right into a red event — volatility spikes blow through stops. FOMC dates exact;
        CPI approximate (~mid-month).
      </p>
    </section>
  );
}
