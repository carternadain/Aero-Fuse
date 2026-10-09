"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Banknote, Bitcoin, Camera, Car, CreditCard, Home, Landmark, Package, PiggyBank,
  ChevronDown, ChevronRight, Plus, TrendingUp, Wallet, X, type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import NetWorthChart from "./NetWorthChart";
import { fmtQty, isHidden, MASK } from "@/lib/privacy";
import { askConfirm, askText } from "./DialogHost";

interface Account {
  id: number;
  name: string;
  category: string;
  kind: "asset" | "liability";
  balance: number;
  updated_at: string;
}

interface Holding {
  id: number;
  symbol: string;
  kind: "crypto" | "stock" | "option";
  display: string;
  multiplier: number;
  qty: number;
  cost_basis: number | null;
  label: string;
  note?: string;
  price: number | null;
  change_1d: number | null;
  value: number | null;
  pnl: number | null;
}

interface HoldingsResponse {
  holdings: Holding[];
  value: number;
  change_1d: number;
  change_1d_pct: number | null;
}

interface Snapshot {
  date: string;
  assets: number;
  liabilities: number;
  net_worth: number;
}

const ASSET_CATS = ["cash", "brokerage", "crypto", "retirement", "real_estate", "vehicle", "other"];
const LIAB_CATS = ["credit_card", "loan", "mortgage", "other"];

const CAT_ICONS: Record<string, LucideIcon> = {
  cash: Banknote, brokerage: TrendingUp, crypto: Bitcoin, retirement: PiggyBank,
  real_estate: Home, vehicle: Car, credit_card: CreditCard, loan: Landmark, mortgage: Home, other: Package,
};

function CatIcon({ category }: { category: string }) {
  const Icon = CAT_ICONS[category] ?? Package;
  return <Icon size={13} className="text-dim shrink-0" />;
}

export function fmtUsd(n: number): string {
  if (isHidden()) return MASK;
  const abs = Math.abs(n);
  const s = abs >= 1_000_000
    ? `$${(abs / 1_000_000).toFixed(2)}M`
    : abs >= 10_000
    ? `$${Math.round(abs).toLocaleString()}`
    : `$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return n < 0 ? `−${s}` : s;
}

export default function NetWorth() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [totals, setTotals] = useState({ assets: 0, liabilities: 0, net_worth: 0 });
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [hold, setHold] = useState<HoldingsResponse>({ holdings: [], value: 0, change_1d: 0, change_1d_pct: null });
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<"holding" | "account">("holding");
  const [f, setF] = useState({ name: "", kind: "asset", category: "cash", balance: "" });
  const [hf, setHf] = useState({ symbol: "", kind: "crypto", qty: "", cost_basis: "", label: "",
                                 expiry: "", strike: "", right: "C" });
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const refresh = async () => {
    try {
      const [acc, hist, h] = await Promise.all([
        api.get<{ accounts: Account[]; totals: typeof totals }>("/api/accounts"),
        api.get<Snapshot[]>("/api/networth/history"),
        api.get<HoldingsResponse>("/api/holdings"),
      ]);
      setAccounts(acc.accounts);
      setTotals(acc.totals);
      setHistory(hist);
      setHold(h);
    } catch { /* backend banner covers it */ }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60000); // holdings re-mark to live prices every minute
    return () => clearInterval(t);
  }, []);

  const addHolding = async () => {
    const qty = parseFloat(hf.qty.replace(/,/g, ""));
    const cost = parseFloat(hf.cost_basis.replace(/[$,]/g, ""));
    if (!hf.symbol.trim() || isNaN(qty)) return;
    let symbol = hf.symbol.trim().toUpperCase();
    if (hf.kind === "option") {
      // Build the standard OCC contract symbol: ROOT + YYMMDD + C/P + strike x1000 (8 digits)
      const strike = parseFloat(hf.strike);
      if (!hf.expiry || isNaN(strike)) return;
      const [y, m, d] = hf.expiry.split("-");
      symbol = `${symbol}${y.slice(2)}${m}${d}${hf.right}${String(Math.round(strike * 1000)).padStart(8, "0")}`;
    }
    await api.post("/api/holdings", {
      symbol, kind: hf.kind, qty, label: hf.label,
      cost_basis: isNaN(cost) ? null : cost,
    });
    setHf({ ...hf, symbol: "", qty: "", cost_basis: "", expiry: "", strike: "" });
    setAdding(false);
    refresh();
  };

  const editQty = async (h: Holding) => {
    if (h.note && h.price) {
      // Proxy-tracked funds (e.g. a 401(k) fund via its index ETF): update by the balance
      // your 401(k) site shows; units are re-derived from the live price.
      const v = await askText(`Current balance of ${h.note.split(" · ")[0]} ($):`, String(Math.round(h.value ?? 0)));
      if (v == null) return;
      const bal = parseFloat(v.replace(/[$,]/g, ""));
      if (isNaN(bal) || bal < 0) return;
      await api.patch(`/api/holdings/${h.id}`, { qty: +(bal / (h.price * h.multiplier)).toFixed(6) });
      refresh();
      return;
    }
    const v = await askText(`New ${h.kind === "option" ? "number of contracts" : "quantity"} for ${h.display}:`, String(h.qty));
    if (v == null) return;
    const qty = parseFloat(v.replace(/,/g, ""));
    if (isNaN(qty)) return;
    await api.patch(`/api/holdings/${h.id}`, { qty });
    refresh();
  };

  const add = async () => {
    const balance = parseFloat(f.balance);
    if (!f.name || isNaN(balance)) return;
    await api.post("/api/accounts", { ...f, balance });
    setF({ name: "", kind: "asset", category: "cash", balance: "" });
    setAdding(false);
    refresh();
  };

  const editBalance = async (a: Account) => {
    const v = await askText(`New balance for ${a.name}:`, String(a.balance));
    if (v == null) return;
    const balance = parseFloat(v.replace(/[$,]/g, ""));
    if (isNaN(balance)) return;
    await api.patch(`/api/accounts/${a.id}`, { balance });
    refresh();
  };

  const snapshot = async () => {
    await api.post("/api/networth/snapshot");
    refresh();
  };

  const assets = accounts.filter((a) => a.kind === "asset");
  const manualAssets = assets.reduce((t, a) => t + a.balance, 0);

  // Live holdings grouped by where they're held, biggest account first.
  const groups = useMemo(() => {
    const m = new Map<string, Holding[]>();
    for (const h of hold.holdings) {
      const k = h.label || "Other holdings";
      m.set(k, [...(m.get(k) ?? []), h]);
    }
    const sum = (rows: Holding[]) => rows.reduce((t, h) => t + (h.value ?? 0), 0);
    return [...m.entries()].sort((a, b) => sum(b[1]) - sum(a[1]));
  }, [hold.holdings]);
  const liabs = accounts.filter((a) => a.kind === "liability");

  return (
    <section className="panel flex flex-col">
      <div className="panel-head">
        <span className="panel-title"><Wallet size={14} />Net Worth</span>
        <div className="flex items-center gap-2">
          <button className="btn !py-1" onClick={snapshot} title="Record today's net worth on the chart">
            <Camera size={12} />Snap
          </button>
          <button className="btn btn-primary !py-1 !px-2" onClick={() => setAdding(!adding)}>
            <Plus size={12} strokeWidth={3} />
          </button>
        </div>
      </div>

      <div className="px-3 pt-3 pb-1">
        <NetWorthChart height={170} />
      </div>

      {adding && (
        <div className="mt-3 flex border-y border-edge text-[10px] font-bold">
          {(["holding", "account"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)}
                    className={`flex-1 py-1.5 uppercase tracking-widest transition-colors ${
                      mode === m ? "bg-panel2 text-up" : "text-dim hover:text-txt"}`}>
              {m === "holding" ? "Live holding" : "Manual account"}
            </button>
          ))}
        </div>
      )}

      {adding && mode === "holding" && (
        <div className="p-3 border-b border-edge space-y-2 bg-panel2">
          <div className="grid grid-cols-3 max-sm:grid-cols-2 gap-2">
            <label className="field-wrap max-sm:col-span-2"><span className="field-label">Symbol</span>
              <input className="field uppercase" placeholder="BTC / RDW" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="next" value={hf.symbol}
                     onChange={(e) => setHf({ ...hf, symbol: e.target.value })} /></label>
            <label className="field-wrap"><span className="field-label">Type</span>
              <select className="field" value={hf.kind} onChange={(e) => setHf({ ...hf, kind: e.target.value })}>
                <option value="crypto">CRYPTO</option>
                <option value="stock">STOCK / ETF</option>
                <option value="option">OPTION</option>
              </select></label>
            <label className="field-wrap"><span className="field-label">{hf.kind === "option" ? "Contracts" : "Quantity"}</span>
              <input className="field" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={hf.qty}
                     onChange={(e) => setHf({ ...hf, qty: e.target.value })} /></label>
          </div>
          {hf.kind === "option" && (
            <div className="grid grid-cols-3 max-sm:grid-cols-2 gap-2">
              <label className="field-wrap max-sm:col-span-2"><span className="field-label">Expiration</span>
                <input className="field" type="date" enterKeyHint="next" value={hf.expiry}
                       onChange={(e) => setHf({ ...hf, expiry: e.target.value })} /></label>
              <label className="field-wrap"><span className="field-label">Strike $</span>
                <input className="field" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={hf.strike}
                       onChange={(e) => setHf({ ...hf, strike: e.target.value })} /></label>
              <label className="field-wrap"><span className="field-label">Call / put</span>
                <select className="field" value={hf.right} onChange={(e) => setHf({ ...hf, right: e.target.value })}>
                  <option value="C">CALL</option>
                  <option value="P">PUT</option>
                </select></label>
            </div>
          )}
          <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-2">
            <label className="field-wrap"><span className="field-label">{hf.kind === "option" ? "Avg premium $ (optional)" : "Avg cost $ (optional)"}</span>
              <input className="field" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={hf.cost_basis}
                     onChange={(e) => setHf({ ...hf, cost_basis: e.target.value })} /></label>
            <label className="field-wrap"><span className="field-label">Held at</span>
              <input className="field" placeholder="Toobit, Fidelity…" autoComplete="off" enterKeyHint="done" value={hf.label}
                     onChange={(e) => setHf({ ...hf, label: e.target.value })} /></label>
          </div>
          <button className="btn btn-primary w-full" onClick={addHolding}>Add Holding</button>
          <p className="text-[10px] text-faint">
            Valued at live prices and added to net worth automatically. Don&apos;t also enter that
            account&apos;s balance manually, or it counts twice.
          </p>
        </div>
      )}

      {adding && mode === "account" && (
        <div className="p-3 border-b border-edge space-y-2 bg-panel2">
          <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-2">
            <label className="field-wrap"><span className="field-label">Account name</span>
              <input className="field" placeholder="e.g. Toobit, Fidelity" autoComplete="off" enterKeyHint="next" value={f.name}
                     onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="field-wrap"><span className="field-label">Balance $</span>
              <input className="field" inputMode="decimal" autoComplete="off" enterKeyHint="done" value={f.balance}
                     onChange={(e) => setF({ ...f, balance: e.target.value })}
                     onKeyDown={(e) => { if (e.key === "Enter") add(); }} /></label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="field-wrap"><span className="field-label">Kind</span>
              <select className="field" value={f.kind}
                      onChange={(e) => setF({ ...f, kind: e.target.value, category: e.target.value === "asset" ? "cash" : "credit_card" })}>
                <option value="asset">ASSET</option>
                <option value="liability">LIABILITY</option>
              </select></label>
            <label className="field-wrap"><span className="field-label">Category</span>
              <select className="field" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {(f.kind === "asset" ? ASSET_CATS : LIAB_CATS).map((c) => (
                  <option key={c} value={c}>{c.replace("_", " ").toUpperCase()}</option>
                ))}
              </select></label>
          </div>
          <button className="btn btn-primary w-full" onClick={add}>Add Account</button>
        </div>
      )}

      {/* Holdings + accounts */}
      <div className="border-t border-edge">
        {accounts.length === 0 && hold.holdings.length === 0 && (
          <p className="p-4 text-xs text-dim">
            Tap + to add live holdings (BTC, SOL, RDW…) or manual accounts (bank, 401k, cards).
          </p>
        )}
        {groups.map(([label, rows]) => {
          const total = rows.reduce((t, h) => t + (h.value ?? 0), 0);
          const open = openGroups[label] ?? false;
          return (
            <div key={label}>
              <button
                onClick={() => setOpenGroups({ ...openGroups, [label]: !open })}
                className="w-full flex items-center gap-2 px-3 py-2 border-t border-edge bg-panel2/50 hover:bg-panel2 text-left"
              >
                {open ? <ChevronDown size={13} className="text-dim" /> : <ChevronRight size={13} className="text-dim" />}
                <span className="text-xs font-bold text-txt">{label}</span>
                <span className="text-[10px] text-faint">{rows.length} live</span>
                <span className="ml-auto text-xs font-bold tabular-nums text-txt">{fmtUsd(total)}</span>
                <span className="text-[10px] text-faint tabular-nums w-10 text-right">
                  {totals.assets ? `${((total / totals.assets) * 100).toFixed(0)}%` : ""}
                </span>
              </button>
              {open && rows.map((h) => (
                <div key={h.id} className="flex items-center gap-2 pl-8 pr-3 py-1.5 border-t border-edge/60 text-xs hover:bg-panel2 cursor-pointer"
                     onClick={() => editQty(h)} title="Click to update quantity">
                  <div className="min-w-0">
                    <div className="text-txt font-bold">{h.display}</div>
                    {h.note && <div className="text-[10px] text-dim truncate">{h.note}</div>}
                    <div className="text-[9px] text-faint tabular-nums truncate">
                      {fmtQty(h.qty)}
                      {h.kind === "option" ? (h.qty === 1 ? " contract" : " contracts") : ""}
                      {h.price != null
                        ? ` × $${h.price.toLocaleString(undefined, { maximumFractionDigits: h.price < 10 ? 4 : 2 })}${h.multiplier > 1 ? " ×100" : ""}`
                        : " · no price found"}
                    </div>
                  </div>
                  <div className="ml-auto text-right tabular-nums">
                    <div className="font-bold text-txt">{h.value != null ? fmtUsd(h.value) : "—"}</div>
                    <div className="text-[9px]">
                      {h.change_1d != null && (
                        <span className={h.change_1d >= 0 ? "text-up" : "text-down"}>
                          {h.change_1d >= 0 ? "▲" : "▼"} {Math.abs(h.change_1d).toFixed(1)}%
                        </span>
                      )}
                      {h.pnl != null && (
                        <span className={`ml-1.5 ${h.pnl >= 0 ? "text-up" : "text-down"}`}>
                          P/L {h.pnl >= 0 ? "+" : "−"}{fmtUsd(Math.abs(h.pnl))}
                        </span>
                      )}
                    </div>
                  </div>
                  <button className="icon-btn"
                          onClick={(e) => { e.stopPropagation(); askConfirm(`Remove ${h.display}?`).then((ok) => { if (ok) api.del(`/api/holdings/${h.id}`).then(refresh); }); }}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          );
        })}
        {assets.length > 0 && (
          <div className="px-3 py-1.5 border-t border-edge bg-panel2 text-[9px] font-bold tracking-widest text-dim flex justify-between">
            <span>OTHER ACCOUNTS · ENTERED BY HAND</span><span>{fmtUsd(manualAssets)}</span>
          </div>
        )}
        {assets.map((a) => (
          <div key={a.id} className="flex items-center gap-2 px-3 py-1.5 border-t border-edge text-xs hover:bg-panel2 cursor-pointer"
               onClick={() => editBalance(a)} title="Click to update balance">
            <CatIcon category={a.category} />
            <span className="text-txt">{a.name}</span>
            <span className="text-[9px] text-faint uppercase">{a.category.replace("_", " ")}</span>
            <span className="ml-auto font-bold tabular-nums text-txt">{fmtUsd(a.balance)}</span>
            <button className="icon-btn"
                    onClick={(e) => { e.stopPropagation(); askConfirm(`Remove ${a.name}?`).then((ok) => { if (ok) api.del(`/api/accounts/${a.id}`).then(refresh); }); }}>
              <X size={12} />
            </button>
          </div>
        ))}
        {liabs.length > 0 && (
          <div className="px-3 py-1.5 bg-panel2 text-[9px] font-bold tracking-widest text-down flex justify-between">
            <span>LIABILITIES</span><span>{fmtUsd(totals.liabilities)}</span>
          </div>
        )}
        {liabs.map((a) => (
          <div key={a.id} className="flex items-center gap-2 px-3 py-1.5 border-t border-edge text-xs hover:bg-panel2 cursor-pointer"
               onClick={() => editBalance(a)} title="Click to update balance">
            <CatIcon category={a.category} />
            <span className="text-txt">{a.name}</span>
            <span className="text-[9px] text-faint uppercase">{a.category.replace("_", " ")}</span>
            <span className="ml-auto font-bold tabular-nums text-down">{fmtUsd(a.balance)}</span>
            <button className="icon-btn"
                    onClick={(e) => { e.stopPropagation(); askConfirm(`Remove ${a.name}?`).then((ok) => { if (ok) api.del(`/api/accounts/${a.id}`).then(refresh); }); }}>
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
