"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { useLive } from "@/lib/live";
import { fmtCents, isHidden } from "@/lib/privacy";

const LAST = "last-visit-v1";
const BASE = "visit-baseline-v1";

interface Snap { ts: number; nw: number; vals: Record<string, number> }

function when(ts: number): string {
  const d = new Date(ts), now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  const part = d.getHours() < 12 ? "morning" : d.getHours() < 17 ? "afternoon" : "evening";
  if (days === 0) return Date.now() - ts < 3 * 3600_000 ? `${Math.max(1, Math.round((Date.now() - ts) / 3600_000))}h ago` : `this ${part}`;
  if (days === 1) return part === "morning" ? "yesterday morning" : `yesterday ${part === "evening" ? "evening" : "afternoon"}`;
  if (days < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** "+$412 since yesterday evening · BTC did most of it" — compared with this device's last visit. */
export default function SinceLastVisit() {
  const { holdings, totals, loaded } = useLive();
  const [base, setBase] = useState<Snap | null>(null);

  useEffect(() => {
    if (!loaded || !totals) return;
    const vals: Record<string, number> = {};
    for (const h of holdings) if (h.value) vals[h.display] = (vals[h.display] ?? 0) + h.value;
    const now: Snap = { ts: Date.now(), nw: totals.net_worth, vals };
    try {
      // The baseline is fixed for this session (the last visit before it), so the line
      // doesn't reset to $0 every time the data refreshes.
      let b: Snap | null = JSON.parse(sessionStorage.getItem(BASE) ?? "null");
      if (!b) {
        b = JSON.parse(localStorage.getItem(LAST) ?? "null");
        if (b) sessionStorage.setItem(BASE, JSON.stringify(b));
        else sessionStorage.setItem(BASE, "false");
      }
      setBase(b || null);
      localStorage.setItem(LAST, JSON.stringify(now));
    } catch { /* storage blocked */ }
  }, [loaded, totals, holdings]);

  if (!base || !totals || Date.now() - base.ts < 20 * 60_000) return null;
  const diff = totals.net_worth - base.nw;
  if (Math.abs(diff) < 1) return null;

  // same symbol across accounts counts once, matching how the baseline was saved
  const nowVals: Record<string, number> = {};
  for (const h of holdings) if (h.value) nowVals[h.display] = (nowVals[h.display] ?? 0) + h.value;
  let driver: { k: string; d: number } | null = null;
  for (const [k, v] of Object.entries(nowVals)) {
    if (base.vals[k] == null) continue;
    const d = v - base.vals[k];
    if (!driver || Math.abs(d) > Math.abs(driver.d)) driver = { k, d };
  }
  const pct = base.nw ? (diff / base.nw) * 100 : 0;
  const up = diff >= 0;
  const mostly = driver && Math.sign(driver.d) === Math.sign(diff) && Math.abs(driver.d) > Math.abs(diff) * 0.35;

  return (
    <div className="flex items-center gap-2 text-[12.5px] mt-2 text-dim">
      <History size={13} className="text-faint shrink-0" />
      <span>
        <b className={up ? "text-up" : "text-down"}>
          {isHidden() ? `${up ? "+" : "−"}${Math.abs(pct).toFixed(2)}%` : `${up ? "+" : "−"}${fmtCents(Math.abs(diff))}`}
        </b>{" "}
        since {when(base.ts)}
        {driver && (mostly ? ` · ${driver.k} did most of it` : ` · biggest mover ${driver.k}`)}
      </span>
    </div>
  );
}
