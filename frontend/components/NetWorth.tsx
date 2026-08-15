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
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", kind: "asset", category: "cash", balance: "" });

  const refresh = async () => {
    try {
      const [acc, hist] = await Promise.all([
        api.get<{ accounts: Account[]; totals: typeof totals }>("/api/accounts"),
        api.get<Snapshot[]>("/api/networth/history"),
      ]);
      setAccounts(acc.accounts);
      setTotals(acc.totals);
      setHistory(hist);
    } catch { /* backend banner covers it */ }
  };

  useEffect(() => { refresh(); }, []);

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
          <span className={`text-sm font-bold tabular-nums ${totals.net_worth >= 0 ? "text-up" : "text-down"}`}>
            {fmtUsd(totals.net_worth)}
          </span>
          <button className="btn !py-1" onClick={snapshot} title="Record today's net worth on the chart">
            <Camera size={12} />Snap
          </button>
          <button className="btn btn-primary !py-1 !px-2" onClick={() => setAdding(!adding)}>
            <Plus size={12} strokeWidth={3} />
          </button>
        </div>
      </div>

      {adding && (
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
            Hit Snap after updating balances — do it weekly and watch the line go up and to the right.
          </div>
        )}
      </div>

      {/* Accounts */}
      <div className="overflow-y-auto max-h-56 border-t border-edge">
        {accounts.length === 0 && (
          <p className="p-4 text-xs text-dim">Add your accounts: exchange, brokerage, 401k, cards…</p>
        )}
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
