"use client";

import { useEffect, useState } from "react";
import { CalendarX2, Gift, Landmark, LifeBuoy } from "lucide-react";
import { api } from "@/lib/api";
import { fmtUsd } from "./NetWorth";
import type { RiskReport } from "./RiskRating";

// IRS limits for 2026 (IR-2025-111, Nov 13 2025). Update each November.
const LIMIT_YEAR = 2026;
const LIMITS = {
  k401: 24_500, k401CatchUp50: 8_000, k401CatchUp60to63: 11_250,
  ira: 7_500, iraCatchUp50: 1_100,
};

interface Contribution {
  id: number; account: string; plan_type: "401k" | "ira" | "other";
  monthly: number; monthly_match: number; monthly_match_max: number | null;
}
interface Holding { kind: string; symbol: string; display: string; value: number | null; label: string }

function readAge(): number {
  try {
    const s = localStorage.getItem("fire-inputs-v1");
    return s ? JSON.parse(s).age ?? 25 : 25;
  } catch { return 25; }
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs font-bold text-txt">
        <span className="text-amber">{icon}</span>{title}
      </div>
      {children}
    </div>
  );
}

function Bar({ pct, color = "var(--color-up)" }: { pct: number; color?: string }) {
  return (
    <div className="h-2 rounded-full bg-edge overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </div>
  );
}

/** OCC symbol → expiry Date (AMZN271217C00260000 → 2027-12-17). */
function occExpiry(occ: string): Date | null {
  const m = occ.match(/(\d{2})(\d{2})(\d{2})[CP]\d{8}$/);
  return m ? new Date(2000 + +m[1], +m[2] - 1, +m[3]) : null;
}

export default function WealthChecks() {
  const [rows, setRows] = useState<Contribution[]>([]);
  const [risk, setRisk] = useState<RiskReport | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [spend, setSpend] = useState<number | null>(null);
  const [spendDraft, setSpendDraft] = useState("");
  const [age, setAge] = useState(25);

  const load = () => {
    api.get<{ contributions: Contribution[] }>("/api/contributions").then((r) => setRows(r.contributions)).catch(() => {});
    api.get<RiskReport>("/api/networth/risk").then(setRisk).catch(() => {});
    api.get<{ holdings: Holding[] }>("/api/holdings").then((r) => setHoldings(r.holdings)).catch(() => {});
    api.get<{ monthly_expenses: number | null }>("/api/settings").then((r) => {
      setSpend(r.monthly_expenses);
      setSpendDraft(r.monthly_expenses ? String(r.monthly_expenses) : "");
    }).catch(() => {});
  };

  useEffect(() => {
    load();
    setAge(readAge());
    const onFire = () => setAge(readAge());
    window.addEventListener("fire-inputs", onFire);
    return () => window.removeEventListener("fire-inputs", onFire);
  }, []);

  const saveSpend = async () => {
    const v = parseFloat(spendDraft.replace(/[$,]/g, ""));
    await api.put("/api/settings", { monthly_expenses: isNaN(v) ? null : v });
    load();
  };

  // ── Free money (employer match) ──
  const k401s = rows.filter((r) => r.plan_type === "401k");
  const matchKnown = k401s.filter((r) => r.monthly_match_max != null);
  const leftOnTable = matchKnown.reduce((t, r) => t + Math.max(0, (r.monthly_match_max ?? 0) - r.monthly_match), 0) * 12;

  // ── IRS limits (yearly pace = monthly × 12; limits are per person across all plans) ──
  const k401Limit = LIMITS.k401 + (age >= 60 && age <= 63 ? LIMITS.k401CatchUp60to63 : age >= 50 ? LIMITS.k401CatchUp50 : 0);
  const iraLimit = LIMITS.ira + (age >= 50 ? LIMITS.iraCatchUp50 : 0);
  const k401Pace = k401s.reduce((t, r) => t + r.monthly, 0) * 12;
  const iraPace = rows.filter((r) => r.plan_type === "ira").reduce((t, r) => t + r.monthly, 0) * 12;

  // ── Emergency fund ──
  const cash = risk?.buckets.find((b) => b.key === "cash")?.value ?? 0;
  const months = spend ? cash / spend : null;

  // ── Option expirations ──
  const now = new Date();
  const options = holdings
    .filter((h) => h.kind === "option")
    .map((h) => {
      const exp = occExpiry(h.symbol);
      return { ...h, exp, days: exp ? Math.ceil((exp.getTime() - now.getTime()) / 86_400_000) : null };
    })
    .sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Card icon={<Gift size={14} />} title="Free money check">
        {k401s.length === 0 ? (
          <p className="text-[11px] text-dim">Mark a Savings Plan entry as a 401(k) to check your employer match.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {k401s.map((r) => {
                const max = r.monthly_match_max;
                const full = max != null && r.monthly_match >= max - 0.5;
                return (
                  <li key={r.id} className="text-xs">
                    <div className="flex justify-between">
                      <span className="text-txt font-bold">{r.account}</span>
                      <span className="tabular-nums text-dim">
                        {fmtUsd(r.monthly_match * 12)}/yr{max != null && <> of {fmtUsd(max * 12)}</>}
                      </span>
                    </div>
                    {max != null ? (
                      <>
                        <Bar pct={(r.monthly_match / max) * 100} color={full ? "var(--color-cyan)" : "var(--color-amber)"} />
                        <div className={`text-[10px] mt-0.5 ${full ? "text-cyan" : "text-amber"}`}>
                          {full ? "✓ Getting the full match" : `Leaving ${fmtUsd((max - r.monthly_match) * 12)}/yr of free match unclaimed`}
                        </div>
                      </>
                    ) : (
                      <div className="text-[10px] text-faint">
                        Add the <span className="text-dim">max match</span> to this entry in the Savings Plan to check you&apos;re getting all of it.
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {leftOnTable > 0 && (
              <p className="text-[11px] text-amber">
                {fmtUsd(leftOnTable)} a year of match is unclaimed. An employer match is an instant 50–100% return.
              </p>
            )}
          </>
        )}
      </Card>

      <Card icon={<Landmark size={14} />} title={`${LIMIT_YEAR} contribution limits`}>
        {[
          { name: "401(k), all plans combined", pace: k401Pace, limit: k401Limit, note: "Your contributions only; the match doesn't count." },
          { name: "IRA (Roth + traditional)", pace: iraPace, limit: iraLimit, note: "Roth IRA has income limits ($153k–$168k single for 2026)." },
        ].map((l) => {
          const room = l.limit - l.pace;
          return (
            <div key={l.name} className="text-xs">
              <div className="flex justify-between mb-0.5">
                <span className="text-txt font-bold">{l.name}</span>
                <span className="tabular-nums text-dim">{fmtUsd(l.pace)} of {fmtUsd(l.limit)}/yr</span>
              </div>
              <Bar pct={(l.pace / l.limit) * 100} color={room <= 0 ? "var(--color-cyan)" : "var(--color-up)"} />
              <div className="text-[10px] mt-0.5 text-faint">
                {room <= 0
                  ? <span className="text-cyan">✓ On pace to max it out{room < 0 ? ` (over by ${fmtUsd(-room)}, so check with your plan)` : ""}</span>
                  : <>{fmtUsd(room)} of tax-advantaged room left: +{fmtUsd(room / 12)}/mo to max it. {l.note}</>}
              </div>
            </div>
          );
        })}
        <p className="text-[9px] text-faint">Pace = your Savings Plan × 12. IRS limits for {LIMIT_YEAR}, adjusted for your age ({age}).</p>
      </Card>

      <Card icon={<LifeBuoy size={14} />} title="Emergency fund">
        <div className="flex items-end gap-2 flex-wrap">
          <label className="block">
            <span className="text-[10px] text-faint">What you spend in a month</span>
            <span className="relative block">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-faint text-sm">$</span>
              <input className="field !w-32 !pl-5 !py-1 !text-sm tabular-nums" inputMode="decimal" placeholder="e.g. 2500"
                     value={spendDraft} onChange={(e) => setSpendDraft(e.target.value)}
                     onKeyDown={(e) => { if (e.key === "Enter") saveSpend(); }} />
            </span>
          </label>
          <button className="btn !py-1" onClick={saveSpend}>Save</button>
        </div>
        {months != null ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-[34px] leading-none text-txt">{months.toFixed(1)}</span>
              <span className="text-xs text-dim">months covered by {fmtUsd(cash)} in cash</span>
            </div>
            <div className="relative">
              <Bar pct={(months / 6) * 100} color={months >= 3 ? "var(--color-cyan)" : "var(--color-amber)"} />
              <div className="absolute top-0 h-2 w-px bg-txt/60" style={{ left: "50%" }} title="3 months" />
            </div>
            <div className="flex justify-between text-[9px] text-faint -mt-2">
              <span>0</span><span>3 mo</span><span>6 mo</span>
            </div>
            <p className="text-[11px] text-dim">
              {months >= 6 ? "Fully covered: a job loss or emergency won't force you to sell investments at a bad time."
                : months >= 3 ? `Solid cushion. ${fmtUsd(spend! * 6 - cash)} more gets you to 6 months.`
                : `${fmtUsd(spend! * 3 - cash)} more gets you to 3 months, so you're not forced to sell in a crash.`}
            </p>
          </>
        ) : (
          <p className="text-[11px] text-dim">Enter a rough monthly spend to see how many months your cash covers. It also sharpens the risk rating.</p>
        )}
      </Card>

      <Card icon={<CalendarX2 size={14} />} title="Option expirations">
        {options.length === 0 ? (
          <p className="text-[11px] text-dim">No options tracked. Add them in Net Worth (type: option).</p>
        ) : (
          <>
            <ul className="divide-y divide-edge">
              {options.map((o) => {
                const urgent = o.days != null && o.days < 120;
                const soon = o.days != null && o.days < 365;
                return (
                  <li key={o.symbol} className="flex items-center gap-2 py-1.5 text-xs">
                    <span className="text-txt font-bold">{o.display}</span>
                    <span className="text-faint text-[10px]">{o.label}</span>
                    <span className="ml-auto tabular-nums text-dim">{o.value != null ? fmtUsd(o.value) : "—"}</span>
                    <span className={`tabular-nums text-[11px] w-24 text-right font-bold ${urgent ? "text-down" : soon ? "text-amber" : "text-cyan"}`}>
                      {o.days != null ? (o.days < 0 ? "expired" : `${o.days} days`) : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-[10px] text-faint">
              Time decay (theta) speeds up in the last few months, so a contract loses value faster the closer it gets to expiry.
              Amber is under a year, red under 4 months.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
