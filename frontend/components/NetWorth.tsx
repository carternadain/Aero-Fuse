"use client";

import { useEffect, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Banknote, Bitcoin, Camera, Car, CreditCard, Home, Landmark, Package, PiggyBank,
  Plus, TrendingUp, Wallet, X, type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";

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
  kind: "crypto" | "stock";
  qty: number;
  cost_basis: number | null;
  label: string;
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
  const [hf, setHf] = useState({ symbol: "", kind: "crypto", qty: "", cost_basis: "", label: "" });

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
    await api.post("/api/holdings", {
      symbol: hf.symbol, kind: hf.kind, qty, label: hf.label,
      cost_basis: isNaN(cost) ? null : cost,
    });
    setHf({ symbol: "", kind: hf.kind, qty: "", cost_basis: "", label: "" });
    setAdding(false);
    refresh();
  };

  const editQty = async (h: Holding) => {
    const v = prompt(`New quantity of ${h.symbol}:`, String(h.qty));
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
    const v = prompt(`New balance for ${a.name}:`, String(a.balance));
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

      {/* Headline number */}
      <div className="px-4 pt-3 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className={`font-display text-[40px] leading-none ${totals.net_worth >= 0 ? "text-txt" : "text-down"}`}>
            {fmtUsd(totals.net_worth)}
          </div>
          <div className="text-[10px] text-faint mt-1">
            {fmtUsd(totals.assets)} assets · {fmtUsd(totals.liabilities)} owed
          </div>
        </div>
        {hold.holdings.length > 0 && (
          <div className="text-right text-[11px] tabular-nums">
            <div className={hold.change_1d >= 0 ? "text-up" : "text-down"}>
              {hold.change_1d >= 0 ? "+" : "−"}{fmtUsd(Math.abs(hold.change_1d))}
              {hold.change_1d_pct != null && ` (${hold.change_1d_pct > 0 ? "+" : ""}${hold.change_1d_pct.toFixed(2)}%)`}
            </div>
            <div className="text-[9px] text-faint">holdings today · live</div>
          </div>
        )}
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
          <div className="grid grid-cols-3 gap-2">
            <input className="field uppercase" placeholder="BTC / RDW" value={hf.symbol}
                   onChange={(e) => setHf({ ...hf, symbol: e.target.value })} />
            <select className="field" value={hf.kind} onChange={(e) => setHf({ ...hf, kind: e.target.value })}>
              <option value="crypto">CRYPTO</option>
              <option value="stock">STOCK</option>
            </select>
            <input className="field" placeholder="Quantity" inputMode="decimal" value={hf.qty}
                   onChange={(e) => setHf({ ...hf, qty: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input className="field" placeholder="Avg cost $ (optional)" inputMode="decimal" value={hf.cost_basis}
                   onChange={(e) => setHf({ ...hf, cost_basis: e.target.value })} />
            <input className="field" placeholder="Held at (Toobit, Fidelity…)" value={hf.label}
                   onChange={(e) => setHf({ ...hf, label: e.target.value })} />
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
          <div className="grid grid-cols-2 gap-2">
            <input className="field" placeholder="Account name (e.g. Toobit, Fidelity)" value={f.name}
                   onChange={(e) => setF({ ...f, name: e.target.value })} />
            <input className="field" placeholder="Balance $" value={f.balance}
                   onChange={(e) => setF({ ...f, balance: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select className="field" value={f.kind}
                    onChange={(e) => setF({ ...f, kind: e.target.value, category: e.target.value === "asset" ? "cash" : "credit_card" })}>
              <option value="asset">ASSET</option>
              <option value="liability">LIABILITY</option>
            </select>
            <select className="field" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {(f.kind === "asset" ? ASSET_CATS : LIAB_CATS).map((c) => (
                <option key={c} value={c}>{c.replace("_", " ").toUpperCase()}</option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary w-full" onClick={add}>Add Account</button>
        </div>
      )}

      {/* History chart */}
      <div className="h-44 px-1 pt-2">
        {history.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00c87a" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#00c87a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#2b2723" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" stroke="#645e53" fontSize={9} tickLine={false}
                     tickFormatter={(d: string) => d.slice(5)} />
              <YAxis stroke="#645e53" fontSize={9} tickLine={false} width={52}
                     tickFormatter={(v: number) => fmtUsd(v)} />
              <Tooltip
                contentStyle={{ background: "#221f1c", border: "1px solid #3b3631", borderRadius: 10, fontSize: 11 }}
                labelStyle={{ color: "#9b9285" }}
                formatter={(v) => [fmtUsd(Number(v)), "Net worth"]}
              />
              <Area type="monotone" dataKey="net_worth" stroke="#00c87a" strokeWidth={2} fill="url(#nwFill)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-[11px] text-dim text-center px-6">
            {hold.holdings.length > 0
              ? "Holdings auto-snapshot every hour, so the line starts drawing itself from tomorrow."
              : "Add live holdings and this charts itself, or hit Snap after updating balances."}
          </div>
        )}
      </div>

      {/* Holdings + accounts */}
      <div className="overflow-y-auto max-h-80 border-t border-edge">
        {accounts.length === 0 && hold.holdings.length === 0 && (
          <p className="p-4 text-xs text-dim">
            Tap + to add live holdings (BTC, SOL, RDW…) or manual accounts (bank, 401k, cards).
          </p>
        )}
        {hold.holdings.length > 0 && (
          <div className="px-3 py-1.5 bg-panel2 text-[9px] font-bold tracking-widest text-cyan flex justify-between">
            <span>HOLDINGS · LIVE</span><span>{fmtUsd(hold.value)}</span>
          </div>
        )}
        {hold.holdings.map((h) => (
          <div key={h.id} className="flex items-center gap-2 px-3 py-1.5 border-t border-edge text-xs hover:bg-panel2 cursor-pointer"
               onClick={() => editQty(h)} title="Click to update quantity">
            <CatIcon category={h.kind === "crypto" ? "crypto" : "brokerage"} />
            <div className="min-w-0">
              <div className="text-txt font-bold">{h.symbol}</div>
              <div className="text-[9px] text-faint tabular-nums truncate">
                {h.qty.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                {h.price != null
                  ? ` × $${h.price.toLocaleString(undefined, { maximumFractionDigits: h.price < 10 ? 4 : 2 })}`
                  : " · no price found"}
                {h.label && ` · ${h.label}`}
              </div>
            </div>
            <div className="ml-auto text-right tabular-nums">
              <div className="font-bold text-up">{h.value != null ? fmtUsd(h.value) : "—"}</div>
              <div className="text-[9px]">
                {h.change_1d != null && (
                  <span className={h.change_1d >= 0 ? "text-up" : "text-down"}>
                    {h.change_1d > 0 ? "+" : ""}{h.change_1d.toFixed(1)}%
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
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Remove ${h.symbol}?`)) api.del(`/api/holdings/${h.id}`).then(refresh); }}>
              <X size={12} />
            </button>
          </div>
        ))}
        {assets.length > 0 && (
          <div className="px-3 py-1.5 bg-panel2 text-[9px] font-bold tracking-widest text-up flex justify-between">
            <span>ASSETS</span><span>{fmtUsd(totals.assets)}</span>
          </div>
        )}
        {assets.map((a) => (
          <div key={a.id} className="flex items-center gap-2 px-3 py-1.5 border-t border-edge text-xs hover:bg-panel2 cursor-pointer"
               onClick={() => editBalance(a)} title="Click to update balance">
            <CatIcon category={a.category} />
            <span className="text-txt">{a.name}</span>
            <span className="text-[9px] text-faint uppercase">{a.category.replace("_", " ")}</span>
            <span className="ml-auto font-bold tabular-nums text-up">{fmtUsd(a.balance)}</span>
            <button className="icon-btn"
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Remove ${a.name}?`)) api.del(`/api/accounts/${a.id}`).then(refresh); }}>
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
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Remove ${a.name}?`)) api.del(`/api/accounts/${a.id}`).then(refresh); }}>
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
