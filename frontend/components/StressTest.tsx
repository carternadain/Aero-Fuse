"use client";

import { useEffect, useMemo, useState } from "react";
import { Zap } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";
import { BUCKET_COLORS, type RiskReport } from "./RiskRating";

type Bucket = "cash" | "retirement" | "broad" | "stocks" | "crypto_major" | "crypto_alt" | "options" | "leveraged" | "other";
type Drops = Record<Bucket, number>; // % lost, peak to bottom

interface Scenario {
  key: string;
  name: string;
  when: string;
  story: string;
  recovery: string;
  drops: Drops;
}

// Approximate peak-to-trough moves. Crypto didn't exist (or barely did) before 2010, so the
// crypto numbers in older scenarios are what a similar shock has done to crypto since.
const SCENARIOS: Scenario[] = [
  {
    key: "2008", name: "2008 Financial Crisis", when: "Oct 2007 → Mar 2009 · 17 months",
    story: "Banks failed, credit froze, and the S&P 500 fell about 57%.",
    recovery: "The S&P 500 took about 5½ years to get back to its old high (2013).",
    drops: { cash: 0, retirement: 40, broad: 55, stocks: 60, crypto_major: 75, crypto_alt: 85, options: 95, leveraged: 90, other: 20 },
  },
  {
    key: "dotcom", name: "Dot-com bust", when: "Mar 2000 → Oct 2002 · 2½ years",
    story: "The tech bubble popped. The Nasdaq fell 78% and the S&P 500 fell 49%.",
    recovery: "The S&P 500 needed about 7 years and the Nasdaq about 15.",
    drops: { cash: 0, retirement: 35, broad: 49, stocks: 75, crypto_major: 75, crypto_alt: 90, options: 100, leveraged: 95, other: 10 },
  },
  {
    key: "covid", name: "COVID crash", when: "Feb → Mar 2020 · 33 days",
    story: "The fastest crash ever: the S&P 500 fell 34% and Bitcoin fell about 50% in weeks.",
    recovery: "Stocks were back at their highs in about 5 months.",
    drops: { cash: 0, retirement: 28, broad: 34, stocks: 35, crypto_major: 50, crypto_alt: 60, options: 80, leveraged: 70, other: 5 },
  },
  {
    key: "2022", name: "2022 bear + crypto winter", when: "Nov 2021 → Nov 2022 · 12 months",
    story: "Rate hikes hit everything. The S&P 500 fell 25%, Bitcoin fell 77%, and most altcoins fell 90%+.",
    recovery: "The S&P 500 took about 2 years and Bitcoin about 2⅓. Many altcoins never came back.",
    drops: { cash: 0, retirement: 20, broad: 25, stocks: 45, crypto_major: 77, crypto_alt: 90, options: 85, leveraged: 80, other: 10 },
  },
  {
    key: "swan", name: "Black swan: everything at once", when: "hypothetical",
    story: "A 2008-size stock crash and a 2022-size crypto crash at the same time, with options going to zero.",
    recovery: "There's no history for this exact mix. Expect years, not months.",
    drops: { cash: 0, retirement: 35, broad: 45, stocks: 55, crypto_major: 80, crypto_alt: 95, options: 100, leveraged: 95, other: 20 },
  },
];

function customDrops(stock: number, crypto: number): Drops {
  const cap = (v: number) => Math.min(100, Math.round(v));
  return {
    cash: 0, retirement: cap(stock * 0.75), broad: cap(stock), stocks: cap(stock * 1.2),
    options: cap(stock * 3), leveraged: cap(stock * 2.5),
    crypto_major: cap(crypto), crypto_alt: cap(crypto * 1.2), other: cap(stock * 0.3),
  };
}

export default function StressTest() {
  const [risk, setRisk] = useState<RiskReport | null>(null);
  const [liab, setLiab] = useState(0);
  const [monthly, setMonthly] = useState(0);
  const [pick, setPick] = useState("2022");
  const [stockDrop, setStockDrop] = useState(30);
  const [cryptoDrop, setCryptoDrop] = useState(60);

  useEffect(() => {
    api.get<RiskReport>("/api/networth/risk").then(setRisk).catch(() => {});
    api.get<{ totals: { liabilities: number } }>("/api/accounts").then((r) => setLiab(r.totals.liabilities)).catch(() => {});
    api.get<{ monthly_you: number; monthly_match: number }>("/api/contributions")
      .then((r) => setMonthly(r.monthly_you + r.monthly_match)).catch(() => {});
  }, []);

  const scenario = SCENARIOS.find((s) => s.key === pick);
  const drops = scenario ? scenario.drops : customDrops(stockDrop, cryptoDrop);

  const result = useMemo(() => {
    const rows = (risk?.buckets ?? []).map((b) => {
      const d = drops[b.key as Bucket] ?? 0;
      return { ...b, drop: d, after: b.value * (1 - d / 100), lost: b.value * (d / 100) };
    });
    const before = rows.reduce((t, r) => t + r.value, 0) - liab;
    const lost = rows.reduce((t, r) => t + r.lost, 0);
    const specLost = rows.filter((r) => r.speculative).reduce((t, r) => t + r.lost, 0);
    rows.sort((a, b) => b.lost - a.lost);
    return { rows, before, after: before - lost, lost, specLost };
  }, [risk, liab, drops]);

  const lostPct = result.before ? (result.lost / result.before) * 100 : 0;
  const refillMonths = monthly ? result.lost / monthly : null;
  const maxVal = Math.max(1, ...result.rows.map((r) => r.value));

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><Zap size={14} />Stress Test</span>
        <span className="text-[10px] text-faint">replay a crash on what you own today</span>
      </div>

      <div className="flex flex-wrap gap-1.5 px-3 py-2.5 border-b border-edge">
        {[...SCENARIOS.map((s) => ({ key: s.key, name: s.name })), { key: "custom", name: "Custom" }].map((s) => (
          <button key={s.key} onClick={() => setPick(s.key)}
                  className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold transition-colors ${
                    pick === s.key ? "border-up/50 bg-up/10 text-up" : "border-edge2 text-dim hover:text-txt"
                  }`}>
            {s.name}
          </button>
        ))}
      </div>

      {!risk || risk.buckets.length === 0 ? (
        <p className="p-4 text-xs text-dim">Add holdings or accounts to run a stress test.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
          <div className="space-y-3">
            {scenario ? (
              <div>
                <div className="text-[10px] text-faint">{scenario.when}</div>
                <p className="text-xs text-dim leading-snug mt-0.5">{scenario.story}</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {([["Stock market drop", stockDrop, setStockDrop], ["Crypto drop", cryptoDrop, setCryptoDrop]] as const).map(
                  ([label, v, set]) => (
                    <div key={label}>
                      <div className="flex justify-between text-[10px] mb-0.5">
                        <span className="text-dim uppercase tracking-wider">{label}</span>
                        <span className="text-amber font-bold tabular-nums">−{v}%</span>
                      </div>
                      <input type="range" min={0} max={90} step={5} value={v}
                             onChange={(e) => set(parseFloat(e.target.value))} className="w-full h-1 accent-up cursor-pointer" />
                    </div>
                  ),
                )}
                <p className="text-[10px] text-faint">Options move about 3× the market and leveraged ETFs about 2.5×. Altcoins fall harder than BTC.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-panel2/60 p-3">
                <div className="text-[10px] text-faint">Net worth today</div>
                <div className="font-display text-[30px] leading-tight text-txt">{fmtUsd(result.before)}</div>
              </div>
              <div className="rounded-lg bg-panel2/60 p-3">
                <div className="text-[10px] text-faint">At the bottom</div>
                <div className="font-display text-[30px] leading-tight text-down">{fmtUsd(result.after)}</div>
              </div>
            </div>
            <div className="text-sm text-txt">
              You&apos;d be down <span className="font-bold text-down tabular-nums">{fmtUsd(result.lost)}</span>{" "}
              <span className="text-dim">({lostPct.toFixed(0)}%)</span>.
            </div>
            <ul className="space-y-1.5 text-[11.5px] text-dim leading-snug">
              {result.lost > 0 && (
                <li>
                  <span className="text-txt font-bold">{((result.specLost / result.lost) * 100).toFixed(0)}%</span> of that loss comes
                  from speculative positions (altcoins, options, leveraged ETFs).
                </li>
              )}
              {refillMonths != null && (
                <li>
                  Your saving pace ({fmtUsd(monthly)}/mo) alone would refill the hole in about{" "}
                  <span className="text-txt font-bold">
                    {refillMonths < 12 ? `${refillMonths.toFixed(0)} months` : `${(refillMonths / 12).toFixed(1)} years`}
                  </span>, before any market recovery.
                </li>
              )}
              {scenario && <li>{scenario.recovery}</li>}
              <li>Cash, and your Roth and 401(k) contributions, keep buying through the bottom. That&apos;s historically when the cheapest shares get bought.</li>
            </ul>
          </div>

          <div>
            <div className="text-[10px] font-bold tracking-widest text-dim mb-2">WHAT EACH PART WOULD DO</div>
            <div className="space-y-2">
              {result.rows.map((r) => (
                <div key={r.key}>
                  <div className="flex justify-between text-[11px] mb-0.5">
                    <span className="text-dim">{r.label}</span>
                    <span className="tabular-nums">
                      <span className="text-faint">{fmtUsd(r.value)} → </span>
                      <span className="text-txt font-bold">{fmtUsd(r.after)}</span>
                      <span className="text-down ml-1.5">{r.drop ? `−${r.drop}%` : "±0"}</span>
                    </span>
                  </div>
                  <div className="relative h-2 rounded-full bg-edge overflow-hidden">
                    <div className="absolute inset-y-0 left-0 rounded-full opacity-30"
                         style={{ width: `${(r.value / maxVal) * 100}%`, background: BUCKET_COLORS[r.key] }} />
                    <div className="absolute inset-y-0 left-0 rounded-full"
                         style={{ width: `${(r.after / maxVal) * 100}%`, background: BUCKET_COLORS[r.key] }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[9px] text-faint mt-3">
              Approximate peak-to-bottom drops from each event, applied to your current mix. Real losses depend on
              exactly what you hold and when you sell. Selling at the bottom is how paper losses become real ones.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
