"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, fmtPrice } from "@/lib/api";
import { fmtCents, fmtQty, isHidden } from "@/lib/privacy";
import PriceChart, { ASSET_RANGES, POLL_MS, RANGE_LABEL, RangeTabs, fmtTime, type ChartData, type Range } from "./PriceChart";

export interface LiveHolding {
  id: number;
  symbol: string;
  display: string;
  kind: "crypto" | "stock" | "option";
  qty: number;
  multiplier: number;
  cost_basis: number | null;
  label: string;
  note?: string;
  price: number | null;
  change_1d: number | null;
  value: number | null;
  pnl: number | null;
}

function occInfo(occ: string): { expiry: Date; strike: number; right: string } | null {
  const m = occ.match(/(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  return m ? { expiry: new Date(2000 + +m[1], +m[2] - 1, +m[3]), right: m[4] === "C" ? "Call" : "Put", strike: +m[5] / 1000 } : null;
}

/** Full-screen (phone) / centered (desktop) sheet: live chart + your position in this asset. */
export default function AssetDetail({
  holding, all, portfolioTotal, onClose,
}: {
  holding: LiveHolding;
  all: LiveHolding[];        // every holding, to combine the same symbol across accounts
  portfolioTotal: number;
  onClose: () => void;
}) {
  const [range, setRange] = useState<Range>("1D");
  const [data, setData] = useState<ChartData | null>(null);
  const [scrub, setScrub] = useState<{ t: number; p: number } | null>(null);
  const isOption = holding.kind === "option";

  useEffect(() => {
    if (isOption) return;
    let alive = true;
    const load = () =>
      api.get<ChartData>(`/api/chart/${holding.kind}/${encodeURIComponent(holding.symbol)}?range=${range}`)
        .then((d) => { if (alive) setData(d); }).catch(() => {});
    setData(null);
    load();
    const ms = POLL_MS[range];
    const t = ms ? setInterval(load, ms) : undefined;
    return () => { alive = false; if (t) clearInterval(t); };
  }, [holding.kind, holding.symbol, range, isOption]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [onClose]);

  const same = all.filter((h) => h.symbol === holding.symbol && h.kind === holding.kind);
  const qty = same.reduce((t, h) => t + h.qty, 0);
  const value = same.reduce((t, h) => t + (h.value ?? 0), 0);
  const cost = same.every((h) => h.cost_basis) ? same.reduce((t, h) => t + h.qty * (h.cost_basis ?? 0) * h.multiplier, 0) : null;
  const todayUsd = holding.change_1d != null ? value - value / (1 + holding.change_1d / 100) : null;

  const pts = data?.points ?? [];
  const last = pts.length ? pts[pts.length - 1].p : holding.price;
  const shown = scrub?.p ?? last;
  const base = data?.baseline ?? null;
  const chg = shown != null && base != null ? shown - base : null;
  const pct = chg != null && base ? (chg / base) * 100 : null;
  const opt = isOption ? occInfo(holding.symbol) : null;
  const days = opt ? Math.ceil((opt.expiry.getTime() - Date.now()) / 86_400_000) : null;

  const Stat = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) => (
    <div className="py-2.5 border-b border-edge/60 flex justify-between text-[13px]">
      <span className="text-dim">{k}</span>
      <span className={`tabular-nums font-semibold ${tone ?? "text-txt"}`}>{v}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-end sm:items-center justify-center"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-bg sm:bg-panel w-full sm:max-w-xl h-[100dvh] sm:h-auto sm:max-h-[90vh] sm:rounded-2xl sm:border sm:border-edge overflow-y-auto
                      pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between px-4 pt-4">
          <span className="text-[11px] font-bold tracking-widest text-faint uppercase">{holding.kind === "stock" ? "Stock / ETF" : holding.kind}</span>
          <button className="p-2 -mr-2 rounded-full hover:bg-panel2 text-dim" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="px-4">
          <h2 className="text-xl font-extrabold text-txt">{holding.display}</h2>
          {holding.note && <p className="text-[12px] text-dim mt-0.5">{holding.note}</p>}
          <div className="font-display text-[40px] leading-tight text-txt [font-variant-numeric:tabular-nums] mt-1">
            {shown != null ? `$${fmtPrice(shown)}` : "—"}
          </div>
          <div className="text-[12px] h-4 tabular-nums">
            {chg != null ? (
              <span className={chg >= 0 ? "text-up" : "text-down"}>
                {chg >= 0 ? "▲" : "▼"} ${Math.abs(chg) >= 1 ? Math.abs(chg).toFixed(2) : fmtPrice(Math.abs(chg))} ({Math.abs(pct ?? 0).toFixed(2)}%)
              </span>
            ) : holding.change_1d != null && (
              <span className={holding.change_1d >= 0 ? "text-up" : "text-down"}>
                {holding.change_1d >= 0 ? "▲" : "▼"} {Math.abs(holding.change_1d).toFixed(2)}%
              </span>
            )}
            <span className="text-faint ml-1.5">{scrub ? fmtTime(scrub.t, range) : isOption ? "Today" : RANGE_LABEL[range]}</span>
          </div>
        </div>

        <div className="mt-3">
          {isOption ? (
            <div className="mx-4 rounded-xl border border-edge bg-panel2/40 p-4 text-[12px] text-dim leading-relaxed">
              Free data sources don&apos;t provide price history for option contracts, so there&apos;s no chart.
              The mark above is live from Yahoo, delayed up to about 15 minutes.
            </div>
          ) : (
            <>
              <PriceChart data={data} range={range} height={240} onScrub={setScrub} />
              <div className="px-2 mt-2 border-t border-edge/60 pt-2">
                <RangeTabs value={range} onChange={setRange} ranges={ASSET_RANGES} />
              </div>
            </>
          )}
        </div>

        <div className="px-4 mt-5 pb-8">
          <div className="text-sm font-extrabold text-txt mb-1">Your position</div>
          {opt && (
            <>
              <Stat k="Contract" v={`$${opt.strike} ${opt.right}`} />
              <Stat k="Expires" v={`${opt.expiry.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} · ${days} days`}
                    tone={days != null && days < 120 ? "text-down" : days != null && days < 365 ? "text-amber" : "text-txt"} />
            </>
          )}
          <Stat k={isOption ? "Contracts" : holding.kind === "crypto" ? "Quantity" : "Shares"} v={fmtQty(qty)} />
          <Stat k="Market value" v={fmtCents(value)} />
          {todayUsd != null && (
            <Stat k="Today's return" v={isHidden() ? "•••" : `${todayUsd >= 0 ? "+" : "−"}${fmtCents(Math.abs(todayUsd))}`}
                  tone={todayUsd >= 0 ? "text-up" : "text-down"} />
          )}
          {cost != null && (
            <Stat k="Total return" v={isHidden() ? "•••" : `${value - cost >= 0 ? "+" : "−"}${fmtCents(Math.abs(value - cost))} (${(((value - cost) / cost) * 100).toFixed(1)}%)`}
                  tone={value - cost >= 0 ? "text-up" : "text-down"} />
          )}
          <Stat k="Portfolio share" v={portfolioTotal ? `${((value / portfolioTotal) * 100).toFixed(1)}%` : "—"} />
          {same.length > 1 ? (
            same.map((h) => <Stat key={h.id} k={`In ${h.label}`} v={`${fmtQty(h.qty)} · ${fmtCents(h.value ?? 0)}`} />)
          ) : (
            <Stat k="Account" v={holding.label || "—"} />
          )}
        </div>
      </div>
    </div>
  );
}
