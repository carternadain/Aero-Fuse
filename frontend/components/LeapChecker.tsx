"use client";

// LEAP checker: pick a long-dated call (expiry + strike) and see what it costs, where it breaks
// even, the model's odds of getting there, and a one-line payoff at expiry. Stocks/ETFs only.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import InfoTip from "./InfoTip";
import Skeleton from "./Skeleton";
import { api, fmtPrice } from "@/lib/api";
import { haptic } from "@/lib/bus";
import { RISK_BUY, RISK_SELL } from "./CheckTicker";

interface Contract {
  strike: number; label: string; default: boolean;
  bid: number | null; ask: number | null; premium: number; cost: number;
  breakeven: number; move_pct: number; iv: number | null; odds: number | null;
  delta: number | null; open_interest: number | null;
  payoff: { price: number; pl: number }[];
}
interface LeapResponse {
  available: boolean; symbol: string; spot?: number;
  expiries?: { date: string; days: number }[]; expiry?: string; days?: number; is_leap?: boolean;
  contracts?: Contract[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymd = (d: string) => d.split("-").map(Number);
const fmtLong = (d: string) => { const [y, m, day] = ymd(d); return `${MONTHS[m - 1]} ${day}, ${y}`; };
const fmtChip = (d: string, withDay: boolean) => { const [y, m, day] = ymd(d); return `${MONTHS[m - 1]}${withDay ? ` ${day}` : ""} ’${String(y).slice(2)}`; };
const usd = (v: number) => `$${fmtPrice(v)}`;
const usdWhole = (v: number) => `${v < 0 ? "−" : ""}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
const usdStrike = (v: number) => (Number.isInteger(v) ? `$${v.toLocaleString("en-US")}` : usd(v));
const signedUsd = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
const compact = (n: number) => (n >= 1e4 ? `${Number((n / 1e3).toFixed(n >= 1e5 ? 0 : 1))}K` : n.toLocaleString("en-US"));
const LABEL_NAME: Record<string, string> = { "10% ITM": "10% in", ATM: "At money", "10% OTM": "10% out", "20% OTM": "20% out" };

/** The one line tying the option to the long-term risk read. */
function riskRead(r: number | null): { text: string; tone: string } | null {
  if (r == null) return null;
  if (r < RISK_BUY) return { text: "Long-term risk is low: a decent time to start.", tone: "bg-up" };
  if (r < 50) return { text: "Long-term risk is fair: no discount, but no rush either.", tone: "bg-dim" };
  if (r < RISK_SELL) return { text: "Long-term risk is warm: a dip would get you a cheaper entry.", tone: "bg-amber" };
  return { text: "Long-term risk is high: you'd be paying up near a top.", tone: "bg-down" };
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[10px] font-bold tracking-widest text-faint uppercase">{children}</div>
);

function Tile({ k, children, note }: { k: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-panel2/60 px-2.5 py-2 min-w-0">
      <div className="text-[11px] text-faint truncate">{k}</div>
      <div className="mt-0.5 font-bold tabular-nums text-txt text-[14px] truncate">{children}</div>
      {note != null && <div className="mt-0.5 text-[11px] text-dim leading-snug tabular-nums">{note}</div>}
    </div>
  );
}

/** Profit/loss per contract at expiry: one line, green above zero and red below, with a scrub readout. */
function PayoffLine({ c, spot, symbol, expiry }: { c: Contract; spot: number; symbol: string; expiry: string }) {
  const pts = c.payoff;
  const x0 = pts[0].price, x1 = pts[pts.length - 1].price;
  const yMin = -c.cost;
  const yMax = Math.max(...pts.map((p) => p.pl));
  const pad = (yMax - yMin) * 0.08;
  const lo = yMin - pad, hi = yMax + pad;
  const xPct = (x: number) => ((x - x0) / (x1 - x0)) * 100;
  const yPct = (y: number) => ((hi - y) / (hi - lo)) * 100;
  const zeroY = yPct(0);
  const plAt = (x: number) => (Math.max(x - c.strike, 0) - c.premium) * 100;
  const gid = `po${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const plotRef = useRef<HTMLDivElement>(null);
  const [x, setX] = useState<number | null>(null);
  useEffect(() => setX(null), [c]);

  const path = pts.map((p, i) => `${i ? "L" : "M"}${xPct(p.price).toFixed(3)},${yPct(p.pl).toFixed(3)}`).join(" ");
  const at = (clientX: number) => {
    const r = plotRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setX(x0 + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (x1 - x0));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = (x1 - x0) / 50;
    const cur = x ?? spot;
    const next = e.key === "ArrowLeft" ? cur - step : e.key === "ArrowRight" ? cur + step : e.key === "Home" ? x0 : e.key === "End" ? x1 : null;
    if (next == null) return;
    e.preventDefault();
    setX(Math.min(x1, Math.max(x0, next)));
  };
  const pl = x != null ? plAt(x) : null;
  const side = x != null && xPct(x) < 50 ? "right-1.5 text-right" : "left-1.5";
  const beLeft = xPct(c.breakeven);

  return (
    <div
      data-noswipe
      tabIndex={0}
      role="img"
      aria-label={`Profit or loss per contract at expiry. Below ${usd(c.strike)} you lose the full ${usdWhole(c.cost)}. Breakeven ${usd(c.breakeven)}. Use the arrow keys to read other prices.`}
      onKeyDown={onKey}
      onBlur={() => setX(null)}
      className="relative h-[150px] sm:h-[180px] select-none rounded-md outline-none focus-visible:outline-2 focus-visible:outline-cyan"
    >
      <div ref={plotRef} className="absolute inset-x-0 top-2 bottom-5">
        {/* zero line */}
        <div className="absolute inset-x-0 border-t border-dashed border-edge2" style={{ top: `${zeroY}%` }} aria-hidden />
        <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
              <stop offset={zeroY / 100} style={{ stopColor: "var(--color-up)" }} />
              <stop offset={zeroY / 100} style={{ stopColor: "var(--color-down)" }} />
            </linearGradient>
          </defs>
          <path d={path} fill="none" stroke={`url(#${gid})`} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        {/* today */}
        <div className="absolute top-0 bottom-0 w-px bg-faint/50" style={{ left: `${xPct(spot)}%` }} aria-hidden />
        <div className={`absolute inset-0 pointer-events-none motion-safe:transition-opacity ${x != null ? "opacity-0" : ""}`} aria-hidden>
          <span className="absolute w-2 h-2 -ml-1 -mt-1 rounded-full bg-txt ring-2 ring-panel" style={{ left: `${beLeft}%`, top: `${zeroY}%` }} />
          <span className="absolute whitespace-nowrap rounded bg-panel/85 px-1.5 py-0.5 text-[10px] leading-none text-dim tabular-nums"
                style={{ left: `${beLeft}%`, top: `${zeroY}%`, transform: `translate(${beLeft > 70 ? "-100%" : "-50%"}, calc(-100% - 6px))` }}>
            Breakeven {usd(c.breakeven)}
          </span>
          <span className="absolute left-0 whitespace-nowrap rounded bg-panel/85 px-1.5 py-0.5 text-[10px] leading-none text-dim tabular-nums" style={{ top: `${yPct(yMin)}%`, transform: "translateY(calc(-100% - 5px))" }}>
            Max loss {usdWhole(-c.cost)}
          </span>
        </div>
        {x != null && pl != null && (
          <>
            <div className="absolute top-0 bottom-0 w-px bg-faint" style={{ left: `${xPct(x)}%` }} aria-hidden />
            <span className={`absolute w-2 h-2 -ml-1 -mt-1 rounded-full ring-2 ring-panel ${pl >= 0 ? "bg-up" : "bg-down"}`} style={{ left: `${xPct(x)}%`, top: `${yPct(pl)}%` }} aria-hidden />
          </>
        )}
      </div>
      {x != null && pl != null && (
        <div className={`absolute top-1 z-10 pointer-events-none rounded-lg bg-panel/90 px-2 py-1 text-[12px] leading-tight tabular-nums ${side}`} aria-hidden>
          <div className="text-dim">{symbol} at <span className="font-bold text-txt">{usd(x)}</span></div>
          <div className="mt-0.5 font-bold text-txt">{signedUsd(pl)} <span className="font-normal text-dim">({pl >= 0 ? "+" : "−"}{Math.abs(Math.round((pl / c.cost) * 100))}%)</span></div>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 h-5 flex items-end justify-between text-[11px] text-faint tabular-nums" aria-hidden>
        <span>{usdWhole(x0)}</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${xPct(spot)}%` }}>Today</span>
        <span>{usdWhole(x1)}</span>
      </div>
      <div
        className="absolute inset-0 cursor-crosshair"
        style={{ touchAction: "pan-y" }}
        onPointerDown={(e) => { if (e.pointerType !== "mouse") (e.target as HTMLElement).setPointerCapture(e.pointerId); at(e.clientX); }}
        onPointerMove={(e) => at(e.clientX)}
        onPointerUp={(e) => { if (e.pointerType !== "mouse") setX(null); }}
        onPointerCancel={() => setX(null)}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") setX(null); }}
        title={`At expiry, ${fmtLong(expiry)}`}
      />
    </div>
  );
}

export default function LeapChecker({ symbol, price, longRisk }: { symbol: string; price: number | null; longRisk: number | null }) {
  const [data, setData] = useState<LeapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expiry, setExpiry] = useState<string | null>(null);   // null = server default (furthest)
  const [pick, setPick] = useState<string | null>(null);       // chip label, so it survives an expiry change
  const expRow = useRef<HTMLDivElement>(null);

  useEffect(() => { setExpiry(null); setPick(null); setData(null); }, [symbol]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api.get<LeapResponse>(`/api/leaps/${encodeURIComponent(symbol)}${expiry ? `?expiry=${expiry}` : ""}`)
      .then((r) => live && setData(r))
      .catch(() => live && setData({ available: false, symbol }))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [symbol, expiry]);

  const fresh = data && data.symbol === symbol.toUpperCase() ? data : null;

  // The default expiry is the furthest one, at the end of the row: bring it into view.
  useEffect(() => {
    const row = expRow.current;
    const on = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !on) return;
    const right = on.offsetLeft + on.offsetWidth + 24 - row.clientWidth;
    if (right > row.scrollLeft) row.scrollLeft = right;
    else if (on.offsetLeft < row.scrollLeft) row.scrollLeft = on.offsetLeft;
  }, [fresh?.expiry]);
  const contracts = useMemo(() => fresh?.contracts ?? [], [fresh]);
  const c = contracts.find((x) => x.label === pick) ?? contracts.find((x) => x.default) ?? contracts[0] ?? null;
  const spot = fresh?.spot ?? price;
  const expiries = fresh?.expiries ?? [];
  const sameMonth = (d: string) => expiries.filter((e) => e.date.slice(0, 7) === d.slice(0, 7)).length > 1;
  const read = riskRead(longRisk);
  const chip = (on: boolean) =>
    `shrink-0 min-h-10 px-3 rounded-md border text-[12px] font-semibold tabular-nums focus-visible:outline-2 focus-visible:outline-cyan ${on ? "border-up/50 bg-up/10 text-up" : "border-edge2 text-dim hover:text-txt"}`;

  return (
    <div id="sec-leap" className="px-4 py-3 border-t border-edge scroll-mt-28">
      <div className="flex items-center justify-between gap-2 -my-1.5">
        <Label>LEAP call</Label>
        <InfoTip topic="the LEAP checker" className="w-10 h-10 justify-center">
          <p>A LEAP is a call option that expires more than about 9 months out. You pay the premium up front, and that is the most you can lose.</p>
          <p>Premium is the middle of the bid and ask (the last trade if there is no quote), times 100 shares per contract. Breakeven is strike plus premium: where the stock has to be on expiry day for you to get your money back.</p>
          <p>Chance of profit is an estimate: a lognormal model using the option&apos;s own implied volatility and a 4% interest rate. It treats the option as European, ignores dividends and the volatility smile, and is not a forecast.</p>
          <p>Delta is roughly how much the option moves for each $1 in the stock. Open interest is how many contracts are open; thin ones have wide spreads.</p>
          <p>Prices from Yahoo Finance, refreshed every 15 minutes at most. Not financial advice.</p>
        </InfoTip>
      </div>

      {!fresh && loading ? (
        <div className="mt-2 space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-[150px] w-full" /></div>
      ) : !fresh?.available || !c || spot == null ? (
        <p className="mt-2 text-[13px] text-dim">Option data unavailable right now.</p>
      ) : (
        <div className={`mt-2 space-y-3 motion-safe:transition-opacity ${loading ? "opacity-60" : ""}`}>
          {/* Expiry + strike pickers */}
          <div className="space-y-2">
            <div ref={expRow} role="group" aria-label="Expiry" className="relative flex gap-1.5 overflow-x-auto pr-6 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]" data-noswipe>
              {expiries.map((e) => (
                <button key={e.date} aria-pressed={e.date === fresh.expiry} aria-label={`Expires ${fmtLong(e.date)}`}
                        onClick={() => { if (e.date !== fresh.expiry) { haptic(); setExpiry(e.date); } }}
                        className={chip(e.date === fresh.expiry)}>
                  {fmtChip(e.date, sameMonth(e.date))}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Strike" className="grid grid-cols-4 gap-1.5 sm:flex">
              {contracts.map((k) => (
                <button key={k.strike} aria-pressed={k === c} aria-label={`Strike ${usdStrike(k.strike)}, ${LABEL_NAME[k.label] ?? k.label}`}
                        onClick={() => { haptic(); setPick(k.label); }}
                        className={`${chip(k === c)} !px-1 sm:!px-4 min-h-11 flex flex-col items-center justify-center leading-tight`}>
                  <span className="text-[13px]">{usdStrike(k.strike)}</span>
                  <span className={`text-[10px] font-medium ${k === c ? "text-up" : "text-faint"}`}>{LABEL_NAME[k.label] ?? k.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Breakeven hero */}
          <div>
            <div className="text-[11px] text-faint">Breakeven at expiry</div>
            <div className="font-display text-[32px] leading-tight font-bold tabular-nums text-txt">{usd(c.breakeven)}</div>
            <p className="text-[13px] text-dim tabular-nums">
              {c.move_pct > 0
                ? <>Needs <span className="font-bold text-txt">+{c.move_pct.toFixed(1)}%</span> by {fmtLong(fresh.expiry!)}</>
                : <>Already above it. Expires {fmtLong(fresh.expiry!)}</>}
            </p>
            {!fresh.is_leap && <p className="mt-0.5 text-[11px] text-amber">Under 9 months out, so not a true LEAP.</p>}
          </div>

          <div className="grid grid-cols-3 gap-2 sm:max-w-xl">
            <Tile k="Cost" note={`${usdWhole(c.cost)} total`}>{usd(c.premium)}</Tile>
            <Tile k="Profit odds" note="Estimate">{c.odds != null ? `${Math.round(c.odds * 100)}%` : "—"}</Tile>
            <Tile k="Implied vol" note={c.delta != null ? `Delta ${c.delta.toFixed(2)}` : undefined}>
              {c.iv != null ? `${Math.round(c.iv * 100)}%` : "—"}
            </Tile>
          </div>

          {c.open_interest != null && c.open_interest < 100 && (
            <p className="-mt-1 text-[12px] text-amber tabular-nums">Thinly traded: {compact(c.open_interest)} open contracts, so the spread may be wide.</p>
          )}

          {/* Payoff at expiry */}
          <div>
            <div className="text-[11px] text-faint mb-0.5">Profit at expiry, per contract</div>
            <PayoffLine c={c} spot={spot} symbol={fresh.symbol} expiry={fresh.expiry!} />
          </div>

          {read && (
            <p className="flex items-start gap-2 text-[13px] text-txt leading-snug">
              <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${read.tone}`} aria-hidden />
              <span className="min-w-0">{read.text}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
