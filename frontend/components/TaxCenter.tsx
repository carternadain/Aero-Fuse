"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { haptic } from "@/lib/bus";
import { fmtUsd } from "./NetWorth";
import { askConfirm } from "./DialogHost";
import Skeleton from "./Skeleton";

type Term = "short" | "long";
interface Wash { status: "flagged" | "possible"; reason: string }
interface Realized {
  source: "trade" | "sale"; id: number; symbol: string; kind: string; direction: string | null; qty: number | null;
  acquired: string; sold: string; cost: number | null; proceeds: number | null; gain: number | null;
  term: Term; needs_cost: boolean; wash: Wash | null;
}
interface Candidate {
  holding_id: number; symbol: string; display: string; kind: string; label: string; value: number; loss: number;
  term: Term | null; acquired: string | null; est_saved: number; wash_note: string; rebuy_after: string | null;
}
interface TaxReport {
  year: number; years: number[];
  settings: { filing: "single" | "mfj"; income: number | null; state_rate: number; carryover: number };
  rates: { ordinary: number; ltcg: number; niit: number; state: number; assumed: boolean };
  summary: {
    st_gain: number; st_loss: number; lt_gain: number; lt_loss: number; net_st: number; net_lt: number; net: number;
    carryover_used: number; deductible_loss: number; carry_forward: number; est_tax: number; already_saved: number;
  };
  realized: Realized[]; harvest: Candidate[]; harvest_total: { loss: number; est_saved: number };
  wash: { symbol: string; sold: string; loss: number; status: "flagged" | "possible"; reason: string }[];
  missing_cost: number; days_left: number;
}

type Pane = "harvest" | "realized" | "wash";
const PANES: { key: Pane; label: string }[] = [
  { key: "harvest", label: "Harvest" }, { key: "realized", label: "Realized" }, { key: "wash", label: "Wash sales" },
];
const num = (s: string) => parseFloat(s.replace(/[$,%]/g, ""));
const short = (d: string) => new Date(d + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" });
const today = () => new Date().toISOString().slice(0, 10);

function Chip({ term }: { term: Term | null }) {
  return (
    <span className="text-[9px] font-bold tracking-widest text-dim border border-edge2 rounded px-1 py-px">
      {term === "long" ? "LT" : term === "short" ? "ST" : "ST?"}
    </span>
  );
}

function Tile({ label, value, tone = "text-txt" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="panel px-3 py-2.5">
      <div className="text-[10px] text-faint">{label}</div>
      <div className={`text-[18px] font-extrabold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

const gainTone = (n: number) => (n > 0 ? "text-up" : n < 0 ? "text-down" : "text-txt");

/** Realized gains, loss-harvesting ideas and wash-sale warnings. Estimates only. */
export default function TaxCenter() {
  const [year, setYear] = useState<number | null>(null);
  const [d, setD] = useState<TaxReport | null>(null);
  const [err, setErr] = useState(false);
  const [pane, setPane] = useState<Pane>("harvest");
  const [setupOpen, setSetupOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback((y: number | null) => {
    api.get<TaxReport>(`/api/taxes${y ? `?year=${y}` : ""}`).then((r) => { setD(r); setErr(false); }).catch(() => setErr(true));
  }, []);
  useEffect(() => { load(year); }, [year, load]);

  if (!d) {
    return err
      ? <p className="panel px-4 py-5 text-[12px] text-dim">Couldn&apos;t load tax estimates.</p>
      : <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-40" /></div>;
  }
  const s = d.summary;
  const refresh = () => load(year);

  return (
    <div className="space-y-3">
      <div className="text-[10.5px] text-faint leading-relaxed">
        Estimates for planning, not tax advice. US federal 2026 rules.
        {d.rates.assumed && ` Using ${Math.round(d.rates.ordinary * 100)}% / ${Math.round(d.rates.ltcg * 100)}% until you set your income.`}
      </div>

      {(d.years.length > 1 || d.days_left > 0) && (
        <div className="flex items-center gap-3 flex-wrap">
          {d.years.length > 1 && (
            <select className="field !w-auto min-h-10" value={d.year} onChange={(e) => setYear(+e.target.value)}>
              {d.years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
          {d.days_left > 0 && (
            <span className="text-[11px] text-dim">{d.days_left} days left in {d.year} to harvest</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Tile label="Short-term net" value={fmtUsd(s.net_st)} tone={gainTone(s.net_st)} />
        <Tile label="Long-term net" value={fmtUsd(s.net_lt)} tone={gainTone(s.net_lt)} />
        <Tile label="Est. tax" value={s.est_tax < 0 ? `Tax cut ${fmtUsd(-s.est_tax)}` : fmtUsd(s.est_tax)}
              tone={s.est_tax < 0 ? "text-up" : "text-txt"} />
        <Tile label="Losses already saved" value={fmtUsd(s.already_saved)} tone={s.already_saved > 0 ? "text-up" : "text-txt"} />
      </div>
      {s.carry_forward > 0 && (
        <p className="text-[10.5px] text-faint">{fmtUsd(s.carry_forward)} of losses carry forward to next year.</p>
      )}

      <div className="flex p-1 rounded-xl border border-edge bg-panel max-w-md">
        {PANES.map(({ key, label }) => (
          <button key={key} onClick={() => { if (key !== pane) haptic(); setPane(key); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 min-h-10 rounded-lg text-[12px] font-bold transition-colors ${
                    pane === key ? "bg-panel2 text-up shadow-sm" : "text-dim hover:text-txt"
                  }`}>
            {label}
            {key === "wash" && d.wash.length > 0 && (
              <span className="min-w-[15px] h-[15px] px-1 rounded-full bg-amber text-bg text-[9px] font-extrabold flex items-center justify-center">{d.wash.length}</span>
            )}
          </button>
        ))}
      </div>

      {pane === "harvest" && <HarvestPane d={d} onChanged={refresh} />}
      {pane === "realized" && <RealizedPane d={d} adding={adding} setAdding={setAdding} onChanged={refresh} />}
      {pane === "wash" && (
        <div className="panel">
          {d.wash.length === 0 ? (
            <p className="px-4 py-5 text-[12px] text-dim">No wash-sale risks found.</p>
          ) : d.wash.map((w, i) => (
            <div key={i} className="flex items-start gap-3 px-3 py-2.5 border-t border-edge/50 first:border-t-0 text-[12px]">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-txt">{w.symbol}
                  <span className="ml-1.5 text-[10px] font-semibold text-faint">sold {short(w.sold)}</span>
                </div>
                <div className="text-[10.5px] text-dim">{w.reason}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="tabular-nums font-bold text-down">{fmtUsd(-Math.abs(w.loss))}</div>
                <span className={`text-[9px] font-bold tracking-widest ${w.status === "flagged" ? "text-warn" : "text-faint"}`}>
                  {w.status.toUpperCase()}
                </span>
              </div>
            </div>
          ))}
          <p className="px-3 py-2 border-t border-edge text-[10px] text-faint">Crypto isn&apos;t covered by the wash-sale rule today.</p>
        </div>
      )}

      <div className="panel">
        <button className="w-full flex items-center gap-2 px-3 min-h-10 text-left" aria-expanded={setupOpen}
                onClick={() => setSetupOpen(!setupOpen)}>
          <span className="text-xs font-bold text-txt">Your tax setup</span>
          <ChevronDown size={14} className={`ml-auto text-faint transition-transform ${setupOpen ? "" : "-rotate-90"}`} />
        </button>
        {setupOpen && <Setup d={d} onSaved={(r) => setD(r)} />}
      </div>
    </div>
  );
}

function HarvestPane({ d, onChanged }: { d: TaxReport; onChanged: () => void }) {
  const [dates, setDates] = useState<Record<number, string>>({});
  const saveDate = async (id: number) => {
    if (!dates[id]) return;
    await api.put(`/api/taxes/holdings/${id}`, { acquired: dates[id] });
    haptic();
    onChanged();
  };
  if (!d.harvest.length) {
    return (
      <p className="panel px-4 py-5 text-[12px] text-dim">
        {d.days_left > 0 ? "No holdings at a loss right now." : `${d.year} is closed, so there's nothing left to harvest.`}
      </p>
    );
  }
  return (
    <div className="panel">
      <div className="px-3 py-2.5 text-[12px] font-bold text-txt">
        Harvest all: save <span className="text-up tabular-nums">~{fmtUsd(d.harvest_total.est_saved)}</span>
        <span className="ml-1.5 text-[10px] font-semibold text-faint">on {fmtUsd(d.harvest_total.loss)} of losses</span>
      </div>
      {d.harvest.map((h) => (
        <div key={h.holding_id} className="px-3 py-2.5 border-t border-edge/50 text-[12px]">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-txt">{h.display}
                {h.label && <span className="ml-1.5 text-[10px] font-semibold text-faint">{h.label}</span>}
              </div>
              <div className="text-[10.5px] text-dim">
                {h.rebuy_after ? `Don't rebuy before ${short(h.rebuy_after)}` : h.wash_note}
              </div>
              {h.rebuy_after && h.wash_note && <div className="text-[10.5px] text-warn">{h.wash_note}</div>}
            </div>
            <div className="text-right shrink-0">
              <div className="tabular-nums font-bold text-down">{fmtUsd(-Math.abs(h.loss))} <Chip term={h.term} /></div>
              <div className="text-[10.5px] text-up tabular-nums">~{fmtUsd(h.est_saved)} saved</div>
            </div>
          </div>
          {!h.acquired && (
            <div className="flex gap-2 mt-2 items-center">
              <span className="text-[10.5px] text-faint shrink-0">Bought on</span>
              <input className="field min-h-10" type="date" max={today()} value={dates[h.holding_id] ?? ""}
                     onChange={(e) => setDates({ ...dates, [h.holding_id]: e.target.value })} />
              <button className="btn !min-h-10" onClick={() => saveDate(h.holding_id)}>Save</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function RealizedPane({ d, adding, setAdding, onChanged }: {
  d: TaxReport; adding: boolean; setAdding: (b: boolean) => void; onChanged: () => void;
}) {
  const [costs, setCosts] = useState<Record<number, string>>({});
  const saveCost = async (id: number) => {
    const v = num(costs[id] ?? "");
    if (!(v > 0)) return;
    await api.put(`/api/taxes/trades/${id}`, { cost: v });
    haptic();
    onChanged();
  };
  const delSale = (r: Realized) =>
    askConfirm(`Remove ${r.symbol} sale?`).then((ok) => { if (ok) api.del(`/api/taxes/sales/${r.id}`).then(onChanged); });

  return (
    <div className="panel">
      {d.missing_cost > 0 && (
        <p className="px-3 py-2 text-[11px] text-warn border-b border-edge">
          {d.missing_cost} closed {d.missing_cost === 1 ? "trade needs" : "trades need"} a size to count toward your gains.
        </p>
      )}
      {d.realized.length === 0 && <p className="px-4 py-5 text-[12px] text-dim">Nothing sold in {d.year} yet.</p>}
      {d.realized.map((r) => (
        <div key={`${r.source}-${r.id}`} className="px-3 py-2.5 border-t border-edge/50 first:border-t-0 text-[12px]">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-txt">{r.symbol}
                <span className="ml-1.5 text-[10px] font-semibold text-faint">
                  sold {short(r.sold)}{r.source === "trade" ? " · journal" : ""}
                </span>
              </div>
              {r.wash && <div className="text-[10.5px] text-warn">Wash sale {r.wash.status}: {r.wash.reason}</div>}
            </div>
            <Chip term={r.term} />
            {r.gain != null && (
              <span className={`tabular-nums font-bold w-20 text-right ${gainTone(r.gain)}`}>{fmtUsd(r.gain)}</span>
            )}
            {r.source === "sale" && (
              <button className="icon-btn !min-h-10 !min-w-10 justify-center" aria-label="Delete sale" onClick={() => delSale(r)}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
          {r.needs_cost && (
            <div className="flex gap-2 mt-2 items-center">
              <input className="field min-h-10" inputMode="decimal" placeholder="$ in this trade"
                     value={costs[r.id] ?? ""} onChange={(e) => setCosts({ ...costs, [r.id]: e.target.value })} />
              <button className="btn !min-h-10" onClick={() => saveCost(r.id)}>Save</button>
            </div>
          )}
        </div>
      ))}
      {adding
        ? <SaleForm onDone={(changed) => { setAdding(false); if (changed) onChanged(); }} />
        : (
          <div className="p-3 border-t border-edge">
            <button className="btn !min-h-10 w-full" onClick={() => setAdding(true)}><Plus size={14} />Add a sale</button>
          </div>
        )}
    </div>
  );
}

function SaleForm({ onDone }: { onDone: (changed: boolean) => void }) {
  const [f, setF] = useState({ symbol: "", kind: "stock", acquired: "", sold: today(), proceeds: "", cost: "" });
  const save = async () => {
    const proceeds = num(f.proceeds), cost = num(f.cost);
    if (!f.symbol.trim() || !f.acquired || !f.sold || isNaN(proceeds) || !(cost >= 0)) return;
    await api.post("/api/taxes/sales", {
      symbol: f.symbol.trim().toUpperCase(), kind: f.kind, acquired: f.acquired, sold: f.sold, proceeds, cost,
    });
    haptic();
    onDone(true);
  };
  return (
    <div className="p-3 space-y-2 border-t border-edge bg-panel2/30">
      <div className="grid grid-cols-2 gap-2">
        <input className="field min-h-10" placeholder="Symbol" value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value })} />
        <select className="field min-h-10" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="stock">Stock</option><option value="crypto">Crypto</option><option value="option">Option</option>
        </select>
        <label className="text-[10px] text-faint">Bought
          <input className="field min-h-10 mt-0.5" type="date" max={today()} value={f.acquired} onChange={(e) => setF({ ...f, acquired: e.target.value })} />
        </label>
        <label className="text-[10px] text-faint">Sold
          <input className="field min-h-10 mt-0.5" type="date" max={today()} value={f.sold} onChange={(e) => setF({ ...f, sold: e.target.value })} />
        </label>
        <input className="field min-h-10" inputMode="decimal" placeholder="Proceeds $" value={f.proceeds} onChange={(e) => setF({ ...f, proceeds: e.target.value })} />
        <input className="field min-h-10" inputMode="decimal" placeholder="Cost $" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
      </div>
      <div className="flex gap-2 justify-end">
        <button className="btn !min-h-10" onClick={() => onDone(false)}>Cancel</button>
        <button className="btn btn-primary !min-h-10" onClick={save}>Save sale</button>
      </div>
    </div>
  );
}

function Setup({ d, onSaved }: { d: TaxReport; onSaved: (r: TaxReport) => void }) {
  const st = d.settings;
  const [f, setF] = useState({
    filing: st.filing, income: st.income != null ? String(st.income) : "",
    state: st.state_rate ? String(st.state_rate) : "", carry: st.carryover ? String(st.carryover) : "",
  });
  const save = async () => {
    const income = num(f.income);
    const r = await api.put<TaxReport>("/api/taxes/settings", {
      filing: f.filing, income: isNaN(income) ? null : income, state_rate: num(f.state) || 0, carryover: num(f.carry) || 0,
    });
    haptic();
    onSaved(r);
  };
  return (
    <div className="p-3 space-y-2 border-t border-edge">
      <div className="flex p-1 rounded-xl border border-edge bg-panel max-w-md">
        {([["single", "Single"], ["mfj", "Married joint"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setF({ ...f, filing: k })}
                  className={`flex-1 min-h-10 rounded-lg text-[12px] font-bold transition-colors ${
                    f.filing === k ? "bg-panel2 text-up shadow-sm" : "text-dim hover:text-txt"
                  }`}>{label}</button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="text-[10px] text-faint">Taxable income $
          <input className="field min-h-10 mt-0.5" inputMode="decimal" placeholder="e.g. 85000" value={f.income} onChange={(e) => setF({ ...f, income: e.target.value })} />
        </label>
        <label className="text-[10px] text-faint">State tax %
          <input className="field min-h-10 mt-0.5" inputMode="decimal" placeholder="0" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} />
        </label>
        <label className="text-[10px] text-faint">Loss carryover $
          <input className="field min-h-10 mt-0.5" inputMode="decimal" placeholder="0" value={f.carry} onChange={(e) => setF({ ...f, carry: e.target.value })} />
        </label>
      </div>
      <div className="flex justify-end">
        <button className="btn btn-primary !min-h-10" onClick={save}>Save</button>
      </div>
    </div>
  );
}
