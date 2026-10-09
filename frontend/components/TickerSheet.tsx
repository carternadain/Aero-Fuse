"use client";

import { useEffect, useState } from "react";
import { Bell, CalendarClock, History, X } from "lucide-react";
import { api, fmtPrice } from "@/lib/api";
import { on, openAlerts, type Kind, type TickerTarget } from "@/lib/bus";
import { useLive } from "@/lib/live";
import { fmtCents, fmtQty } from "@/lib/privacy";
import PriceChart, { ASSET_RANGES, POLL_MS, RANGE_LABEL, RangeTabs, fmtTime, type ChartData, type Range } from "./PriceChart";
import ScoreHistoryChart from "./ScoreHistoryChart";
import StarButton from "./StarButton";
import Skeleton from "./Skeleton";

export interface Why {
  symbol: string; kind: Kind; name: string | null; sector: string | null;
  price: number | null; change_1d: number | null;
  score: number | null; label: string | null; rsi: number | null; trend: string | null;
  sma50: number | null; sma200: number | null; high_52w: number | null; low_52w: number | null;
  chg_1w: number | null; chg_1m: number | null; chg_3m: number | null;
  daily_vol_pct: number | null; next_earnings: string | null; days_to_earnings: number | null;
  target_mean: number | null;
  reasons: { tone: "up" | "down" | "flat"; text: string }[];
}

export function scoreColor(score: number): string {
  if (score >= 75) return "var(--color-up)";
  if (score >= 60) return "var(--color-cyan)";
  if (score >= 40) return "var(--color-amber)";
  if (score >= 25) return "var(--color-warn)";
  return "var(--color-down)";
}

const pct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const usd = (v: number | null) => (v == null ? "—" : `$${fmtPrice(v)}`);

function Sheet({ target, onClose }: { target: TickerTarget; onClose: () => void }) {
  const sym = target.symbol.toUpperCase();
  const [kind, setKind] = useState<Kind | undefined>(target.kind);
  const [why, setWhy] = useState<Why | null>(null);
  const [range, setRange] = useState<Range>("1D");
  const [data, setData] = useState<ChartData | null>(null);
  const [scrub, setScrub] = useState<{ t: number; p: number } | null>(null);
  const [history, setHistory] = useState(false);
  const { holdings } = useLive();

  useEffect(() => {
    api.get<Why>(`/api/ticker/${encodeURIComponent(sym)}/why${target.kind ? `?kind=${target.kind}` : ""}`)
      .then((w) => { setWhy(w); setKind(w.kind); }).catch(() => setKind((k) => k ?? "stock"));
  }, [sym, target.kind]);

  useEffect(() => {
    if (!kind) return;
    let alive = true;
    const load = () => api.get<ChartData>(`/api/chart/${kind}/${encodeURIComponent(sym)}?range=${range}`)
      .then((d) => { if (alive) setData(d); }).catch(() => {});
    setData(null);
    load();
    const ms = POLL_MS[range];
    const t = ms ? setInterval(load, ms) : undefined;
    return () => { alive = false; if (t) clearInterval(t); };
  }, [kind, sym, range]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [onClose]);

  const pts = data?.points ?? [];
  const last = pts.length ? pts[pts.length - 1].p : why?.price ?? null;
  const shown = scrub?.p ?? last;
  const base = data?.baseline ?? null;
  const chg = shown != null && base != null ? shown - base : null;
  const chgPct = chg != null && base ? (chg / base) * 100 : null;

  const mine = holdings.filter((h) => h.symbol === sym && h.kind === kind);
  const mineQty = mine.reduce((t, h) => t + h.qty, 0);
  const mineVal = mine.reduce((t, h) => t + (h.value ?? 0), 0);

  const Stat = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) => (
    <div className="rounded-lg bg-panel2/50 px-3 py-2">
      <div className="text-[10px] text-faint">{k}</div>
      <div className={`text-[13px] font-bold tabular-nums ${tone ?? "text-txt"}`}>{v}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[85] bg-black/60 flex items-end sm:items-center justify-center"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-bg sm:bg-panel w-full sm:max-w-xl h-[100dvh] sm:h-auto sm:max-h-[92vh] sm:rounded-2xl sm:border sm:border-edge overflow-y-auto
                      pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] tab-enter">
        <div className="flex items-center gap-1 px-4 pt-4">
          <span className="text-[11px] font-bold tracking-widest text-faint uppercase flex-1">
            {kind === "crypto" ? "Crypto" : "Stock / ETF"}{why?.sector ? ` · ${why.sector}` : ""}
          </span>
          <StarButton symbol={sym} kind={kind} size={17} />
          <button className="icon-btn" title="Price alert" onClick={() => openAlerts({ symbol: sym, kind, price: last ?? undefined })}>
            <Bell size={17} />
          </button>
          <button className="p-2 -mr-2 rounded-full hover:bg-panel2 text-dim" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="px-4">
          <h2 className="text-xl font-extrabold text-txt">{sym}</h2>
          {why?.name && <p className="text-[12px] text-dim">{why.name}</p>}
          <div className="font-display text-[40px] leading-tight text-txt [font-variant-numeric:tabular-nums] mt-1">
            {shown != null ? `$${fmtPrice(shown)}` : <Skeleton className="h-10 w-44" />}
          </div>
          <div className="text-[12px] h-4 tabular-nums">
            {chg != null && (
              <span className={chg >= 0 ? "text-up" : "text-down"}>
                {chg >= 0 ? "▲" : "▼"} ${Math.abs(chg) >= 1 ? Math.abs(chg).toFixed(2) : fmtPrice(Math.abs(chg))} ({Math.abs(chgPct ?? 0).toFixed(2)}%)
              </span>
            )}
            <span className="text-faint ml-1.5">{scrub ? fmtTime(scrub.t, range) : RANGE_LABEL[range]}</span>
          </div>
        </div>

        <div className="mt-3" data-noswipe>
          <PriceChart data={data} range={range} height={220} onScrub={setScrub} />
          <div className="px-2 mt-2 border-t border-edge/60 pt-2">
            <RangeTabs value={range} onChange={setRange} ranges={ASSET_RANGES} />
          </div>
        </div>

        {mine.length > 0 && (
          <div className="mx-4 mt-4 rounded-xl border border-edge bg-panel2/30 px-4 py-3 flex justify-between text-[13px]">
            <span className="text-dim">You own {fmtQty(mineQty, 4)} {kind === "crypto" ? sym : mineQty === 1 ? "share" : "shares"}</span>
            <span className="font-bold tabular-nums text-txt">{fmtCents(mineVal)}</span>
          </div>
        )}

        <div className="px-4 mt-5 pb-8">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-extrabold text-txt">Why it&apos;s on the list</div>
            {why?.score != null && (
              <button className="text-[11px] text-dim hover:text-txt flex items-center gap-1" onClick={() => setHistory(true)}>
                <History size={12} /> Score history
              </button>
            )}
          </div>
          {!why ? (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : (
            <>
              {why.score != null && (
                <div className="flex items-center gap-3 mb-3">
                  <div className="font-display text-[34px] leading-none" style={{ color: scoreColor(why.score) }}>{why.score.toFixed(0)}</div>
                  <div className="flex-1">
                    <div className="text-[12px] font-bold" style={{ color: scoreColor(why.score) }}>{why.label}</div>
                    <div className="h-1.5 rounded-full bg-edge mt-1 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${why.score}%`, background: scoreColor(why.score) }} />
                    </div>
                  </div>
                </div>
              )}
              <ul className="space-y-1.5">
                {why.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2.5 text-[12.5px] leading-snug text-dim">
                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${r.tone === "up" ? "bg-up" : r.tone === "down" ? "bg-down" : "bg-faint"}`} />
                    {r.text}
                  </li>
                ))}
                {!why.reasons.length && <li className="text-[12px] text-faint">Not enough price history to explain this one yet.</li>}
              </ul>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4">
                <Stat k="1 week" v={pct(why.chg_1w)} tone={(why.chg_1w ?? 0) >= 0 ? "text-up" : "text-down"} />
                <Stat k="1 month" v={pct(why.chg_1m)} tone={(why.chg_1m ?? 0) >= 0 ? "text-up" : "text-down"} />
                <Stat k="3 months" v={pct(why.chg_3m)} tone={(why.chg_3m ?? 0) >= 0 ? "text-up" : "text-down"} />
                <Stat k="52-week high" v={usd(why.high_52w)} />
                <Stat k="52-week low" v={usd(why.low_52w)} />
                <Stat k="RSI (14)" v={why.rsi?.toFixed(0) ?? "—"} />
                <Stat k="50-day avg" v={usd(why.sma50)} />
                <Stat k="200-day avg" v={usd(why.sma200)} />
                <Stat k="Typical day" v={why.daily_vol_pct != null ? `±${why.daily_vol_pct.toFixed(1)}%` : "—"} />
                {why.target_mean != null && <Stat k="Analyst target" v={usd(why.target_mean)} />}
                {why.next_earnings && (
                  <Stat k="Next earnings" tone={(why.days_to_earnings ?? 99) <= 14 ? "text-amber" : undefined}
                        v={<span className="flex items-center gap-1"><CalendarClock size={12} />
                          {new Date(why.next_earnings + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" })}</span>} />
                )}
              </div>
              <p className="text-[10px] text-faint mt-3">Facts from price history and public analyst data, not a recommendation.</p>
            </>
          )}
        </div>
      </div>
      {history && (
        <ScoreHistoryChart kind={kind === "crypto" ? "crypto" : "stock"} id={kind === "crypto" ? target.cgId ?? sym.toLowerCase() : sym}
                           symbol={sym} onClose={() => setHistory(false)} />
      )}
    </div>
  );
}

/** Mount once: opens the ticker sheet whenever anything calls openTicker(). */
export default function TickerHost() {
  const [t, setT] = useState<TickerTarget | null>(null);
  useEffect(() => on<TickerTarget>("app:ticker", setT), []);
  return t ? <Sheet key={`${t.symbol}:${t.kind}`} target={t} onClose={() => setT(null)} /> : null;
}
