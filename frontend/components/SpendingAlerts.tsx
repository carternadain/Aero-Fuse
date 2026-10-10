"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { onBudgetChanged } from "@/lib/bus";

export interface SpendingAlert {
  category: string;
  spent: number;
  typical_to_date: number;
  normal_month: number;
  over_amount: number;
  over_pct: number | null;
  level: "watch" | "high";
}

export interface SpendingAlertsData {
  month: string;
  day: number;
  days_in_month: number;
  history_months: number;
  alerts: SpendingAlert[];
}

/** Loads spending-above-normal alerts; reloads when transactions or budgets change. */
export function useSpendingAlerts(enabled = true): SpendingAlertsData | null {
  const [data, setData] = useState<SpendingAlertsData | null>(null);
  useEffect(() => {
    if (!enabled) { setData(null); return; }
    let live = true;
    const load = () =>
      api.get<SpendingAlertsData>("/api/spending/alerts")
        .then((d) => { if (live) setData(d); })
        .catch(() => { if (live) setData(null); });
    load();
    const off = onBudgetChanged(load);
    return () => { live = false; off(); };
  }, [enabled]);
  return data;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export const alertColor = (l: SpendingAlert["level"]) =>
  l === "high" ? "var(--color-down)" : "var(--color-amber)";
