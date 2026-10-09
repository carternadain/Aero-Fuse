"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bitcoin, Briefcase, ChevronDown, Landmark, PiggyBank, Wallet, type LucideIcon } from "lucide-react";
import { api, fmtPrice } from "@/lib/api";
import { fmtCents, fmtQty, isHidden } from "@/lib/privacy";
import Sparkline from "./Sparkline";
import Skeleton from "./Skeleton";
import AssetDetail, { type LiveHolding } from "./AssetDetail";

import { accountAnchor, sectionForAccount, sectionForLabel, useLive, type Account, type Section } from "@/lib/live";

const SECTION_META: Record<Section, { title: string; icon: LucideIcon; order: number }> = {
  investing: { title: "Investing", icon: Briefcase, order: 0 },
  retirement: { title: "Retirement", icon: PiggyBank, order: 1 },
  crypto: { title: "Crypto", icon: Bitcoin, order: 2 },
  cash: { title: "Cash", icon: Wallet, order: 3 },
  debt: { title: "Owed", icon: Landmark, order: 4 },
};


type PillMode = "price" | "change" | "equity";
const PILL_KEY = "home-pill";

interface Card {
  key: string;
  name: string;
  section: Section;
  live: LiveHolding[];
  manual: Account | null;
  total: number;
  todayUsd: number | null;
}

export default function HomePortfolio({ only = null, onClearFilter }: { only?: Section | null; onClearFilter?: () => void }) {
  const { holdings, accounts, loaded } = useLive();
  // last price we showed per holding, so a changed price can flash up/down
  const lastPx = useRef<Record<number, number>>({});
  const [ticks, setTicks] = useState<Record<number, "up" | "down">>({});
  const [sparks, setSparks] = useState<Record<string, number[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [pill, setPill] = useState<PillMode>("price");
  const [detail, setDetail] = useState<LiveHolding | null>(null);

  useEffect(() => {
    try { const p = localStorage.getItem(PILL_KEY) as PillMode | null; if (p) setPill(p); } catch { /* */ }
    const loadSparks = () => api.get<Record<string, number[]>>("/api/portfolio/sparks").then(setSparks).catch(() => {});
    loadSparks();
    const b = setInterval(loadSparks, 300_000);
    // an account card was tapped: make sure that account is expanded when we scroll to it
    const openAcct = (e: Event) => setOpen((o) => ({ ...o, [`l:${(e as CustomEvent<string>).detail}`]: true }));
    window.addEventListener("app:open-account", openAcct);
    return () => { clearInterval(b); window.removeEventListener("app:open-account", openAcct); };
  }, []);

  // flash a price pill when its price changes between refreshes
  useEffect(() => {
    const t: Record<number, "up" | "down"> = {};
    for (const h of holdings) {
      const prev = lastPx.current[h.id];
      if (prev != null && h.price != null && h.price !== prev) t[h.id] = h.price > prev ? "up" : "down";
      if (h.price != null) lastPx.current[h.id] = h.price;
    }
    setTicks(t);
  }, [holdings]);

  const cyclePill = () => {
    const next: PillMode = pill === "price" ? "change" : pill === "change" ? "equity" : "price";
    setPill(next);
    try { localStorage.setItem(PILL_KEY, next); } catch { /* */ }
  };

  const { cards, liveTotal } = useMemo(() => {
    const byLabel = new Map<string, LiveHolding[]>();
    for (const h of holdings) {
      const k = h.label || "Other holdings";
      byLabel.set(k, [...(byLabel.get(k) ?? []), h]);
    }
    const cards: Card[] = [];
    for (const [name, rows] of byLabel) {
      rows.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
      const total = rows.reduce((t, h) => t + (h.value ?? 0), 0);
      const today = rows.reduce((t, h) => (h.value != null && h.change_1d != null ? t + h.value - h.value / (1 + h.change_1d / 100) : t), 0);
      cards.push({ key: `l:${name}`, name, section: sectionForLabel(name), live: rows, manual: null, total, todayUsd: today });
    }
    for (const a of accounts) {
      cards.push({ key: `a:${a.id}`, name: a.name, section: sectionForAccount(a), live: [], manual: a,
                   total: a.kind === "liability" ? -a.balance : a.balance, todayUsd: null });
    }
    cards.sort((x, y) => SECTION_META[x.section].order - SECTION_META[y.section].order || Math.abs(y.total) - Math.abs(x.total));
    const liveTotal = holdings.reduce((t, h) => t + (h.value ?? 0), 0);
    return { cards, liveTotal };
  }, [holdings, accounts]);

  const grandTotal = cards.reduce((t, c) => t + Math.max(0, c.total), 0);
  const sections = (Object.keys(SECTION_META) as Section[]).filter((s) => cards.some((c) => c.section === s) && (!only || s === only));

  const pillText = (h: LiveHolding) => {
    if (pill === "change") return h.change_1d != null ? `${h.change_1d >= 0 ? "+" : ""}${h.change_1d.toFixed(2)}%` : "—";
    if (pill === "equity") return h.value != null ? fmtCents(h.value) : "—";
    return h.price != null ? `$${fmtPrice(h.price)}` : "—";
  };

  if (!loaded) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="panel p-4 space-y-3">
            <div className="flex justify-between"><Skeleton className="h-4 w-36" /><Skeleton className="h-4 w-20" /></div>
            {[0, 1].map((j) => (
              <div key={j} className="flex items-center gap-3">
                <Skeleton className="h-8 w-24" /><Skeleton className="h-6 flex-1" /><Skeleton className="h-8 w-20" />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (!holdings.length && !accounts.length) {
    return <p className="text-xs text-dim">Add holdings and accounts on the Wealth tab and they&apos;ll show up here.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-widest text-faint">
          YOUR ACCOUNTS
          {only && <button className="ml-2 normal-case tracking-normal text-up" onClick={onClearFilter}>· {SECTION_META[only].title} only · show all</button>}
        </span>
        <button onClick={cyclePill} className="text-[11px] font-semibold text-dim hover:text-txt px-2 py-1 rounded-md border border-edge2">
          Showing: <span className="text-txt">{pill === "price" ? "Price" : pill === "change" ? "Today %" : "Equity"}</span>
        </button>
      </div>

      {sections.map((s) => {
        const Icon = SECTION_META[s].icon;
        const sc = cards.filter((c) => c.section === s);
        const sTotal = sc.reduce((t, c) => t + c.total, 0);
        return (
          <div key={s}>
            <div className="flex items-baseline gap-2 mb-2 px-1">
              <Icon size={15} className="text-amber self-center" />
              <h3 className="text-[15px] font-extrabold text-txt">{SECTION_META[s].title}</h3>
              <span className="ml-auto text-[13px] font-bold tabular-nums text-dim">{fmtCents(sTotal)}</span>
            </div>
            <div className="space-y-2">
              {sc.map((c) => {
                const isOpen = open[c.key] ?? c.live.length > 0;
                return (
                  <div key={c.key} id={accountAnchor(c.name)} className="panel scroll-mt-28">
                    <button className="w-full flex items-center gap-3 px-4 py-3 text-left"
                            onClick={() => c.live.length && setOpen({ ...open, [c.key]: !isOpen })}>
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-bold text-txt truncate">{c.name}</div>
                        <div className="text-[11px] text-faint">
                          {c.live.length ? `${c.live.length} holdings · live`
                            : `entered by hand · updated ${new Date(c.manual!.updated_at).toLocaleDateString([], { month: "short", day: "numeric" })}`}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-[15px] font-bold tabular-nums ${c.total < 0 ? "text-down" : "text-txt"}`}>{fmtCents(c.total)}</div>
                        {c.todayUsd != null && c.todayUsd !== 0 && (
                          <div className={`text-[11px] tabular-nums ${c.todayUsd >= 0 ? "text-up" : "text-down"}`}>
                            {c.todayUsd >= 0 ? "▲" : "▼"} {isHidden() ? "" : fmtCents(Math.abs(c.todayUsd))}
                            {c.total ? ` ${Math.abs((c.todayUsd / (c.total - c.todayUsd)) * 100).toFixed(2)}%` : ""}
                          </div>
                        )}
                      </div>
                      {c.live.length > 0 && (
                        <ChevronDown size={16} className={`text-faint transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                      )}
                    </button>

                    {isOpen && c.live.length > 0 && (
                      <div className="border-t border-edge">
                        {c.live.map((h) => {
                          const sp = sparks[String(h.id)];
                          const up = (h.change_1d ?? 0) >= 0;
                          return (
                            <button key={h.id} onClick={() => setDetail(h)}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 border-t border-edge/50 first:border-t-0 hover:bg-panel2/60 text-left active:bg-panel2">
                              <div className="min-w-0 w-[34%]">
                                <div className="text-[14px] font-bold text-txt truncate">{h.display}</div>
                                <div className="text-[11px] text-faint truncate">
                                  {h.note ? h.note : <>{fmtQty(h.qty, 4)} {h.kind === "option" ? (h.qty === 1 ? "contract" : "contracts")
                                    : h.kind === "stock" ? (h.qty === 1 ? "share" : "shares") : h.symbol}</>}
                                </div>
                              </div>
                              <div className="flex-1 flex justify-center min-w-0">
                                {sp && sp.length > 1 ? <Sparkline data={sp} width={92} height={30} />
                                  : <span className="block w-[92px] border-t border-dashed border-edge2" title="No intraday history for options" />}
                              </div>
                              <span key={`${h.id}:${h.price}`}
                                    className={`shrink-0 min-w-[86px] text-center px-2 py-1.5 rounded-lg text-[12px] font-bold tabular-nums border ${
                                up ? "border-up/50 text-up" : "border-down/50 text-down"} ${ticks[h.id] === "up" ? "flash-up" : ticks[h.id] === "down" ? "flash-down" : ""}`}>
                                {pillText(h)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {detail && (
        <AssetDetail holding={detail} all={holdings} portfolioTotal={grandTotal || liveTotal} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}
