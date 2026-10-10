"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";
import { haptic, navigate, onBudgetChanged, toast } from "@/lib/bus";
import { catLabel } from "@/lib/categories";
import { enablePush, pushState, pushSupport } from "@/lib/push";

export interface SpendingAlert {
  category: string;
  spent: number;
  typical_to_date: number;
  normal_month: number;
  over_amount: number;
  over_pct: number | null;
  level: "watch" | "high";
}

export interface SpendingAlerts {
  month: string;
  day: number;
  days_in_month: number;
  history_months: number;
  alerts: SpendingAlert[];
}

/** Loads spending-above-normal alerts; reloads when transactions or budgets change. */
export function useSpendingAlerts(enabled = true): SpendingAlerts | null {
  const [data, setData] = useState<SpendingAlerts | null>(null);
  useEffect(() => {
    if (!enabled) { setData(null); return; }
    let live = true;
    const load = () =>
      api.get<SpendingAlerts>("/api/spending/alerts")
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

function AlertBar({ a }: { a: SpendingAlert }) {
  const track = Math.max(a.normal_month, a.spent, 1);
  const pct = (n: number) => `${Math.min(Math.max((n / track) * 100, 0), 100)}%`;
  return (
    <div className="relative h-1.5 rounded bg-edge mt-1.5" aria-hidden>
      <div className="h-full rounded" style={{ width: pct(a.spent), background: alertColor(a.level) }} />
      {a.typical_to_date > 0 && (
        <div className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-txt" style={{ left: pct(a.typical_to_date) }} />
      )}
    </div>
  );
}

export default function SpendingAlerts() {
  const data = useSpendingAlerts();
  const [push, setPush] = useState<"on" | "off" | "denied">("denied");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    setOk(pushSupport() === "ok");
    pushState().then(setPush).catch(() => {});
  }, []);

  const alerts = data?.alerts ?? [];
  if (!alerts.length) return null;

  const enable = async () => {
    const r = await enablePush();
    if (r === "on") { setPush("on"); toast("Done. I'll let you know when spending runs high."); }
    else if (r === "denied") { setPush("denied"); toast("Notifications are blocked for this site. You can allow them in your browser settings."); }
    else toast("Couldn't turn notifications on. Try again in a bit.");
  };

  return (
    <section className="panel" aria-label="Spending above normal">
      <div className="panel-head">
        <span className="font-semibold text-txt text-[13px]">Spending above normal</span>
        <span className="text-[10px] text-faint tabular-nums">through the {ordinal(data!.day)}</span>
      </div>
      <ul>
        {alerts.map((a) => (
          <li key={a.category} className="border-t border-edge first:border-t-0">
            <button
              className="w-full min-h-10 px-3 py-2 text-left hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-up"
              onClick={() => { haptic(); navigate({ tab: "wealth", anchor: "sec-budget" }); }}
            >
              <div className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="text-txt truncate capitalize">{catLabel(a.category)}</span>
                <span className={`shrink-0 tabular-nums font-bold ${a.level === "high" ? "text-down" : "text-amber"}`}>
                  +{fmtUsd(a.over_amount)}
                </span>
              </div>
              <div className="text-[11px] text-dim tabular-nums">
                {fmtUsd(a.spent)} so far ·{" "}
                {a.level === "high" ? "more than a usual month" : `usually ${fmtUsd(a.typical_to_date)} by now`}
              </div>
              <AlertBar a={a} />
            </button>
          </li>
        ))}
      </ul>
      {ok && push !== "denied" && (
        <div className="border-t border-edge px-3 min-h-10 flex items-center">
          {push === "off" ? (
            <button className="inline-flex items-center gap-1.5 min-h-10 text-[11px] text-dim hover:text-txt focus-visible:outline-2 focus-visible:outline-up"
                    onClick={enable}>
              <BellRing size={13} />Notify me when spending runs high
            </button>
          ) : (
            <span className="text-[11px] text-faint">You&apos;ll also get a notification.</span>
          )}
        </div>
      )}
    </section>
  );
}
