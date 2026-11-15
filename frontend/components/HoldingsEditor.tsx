"use client";

// Update holdings in one place: edit every position's shares and average cost, log a buy or a
// sell and let the math happen, or paste positions from a brokerage. Nothing saves until "Save".

import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste, Loader2, Minus, Pencil, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { accountsChanged, haptic, on, toast } from "@/lib/bus";
import { refreshLive } from "@/lib/live";
import { costAfterBuy, parsePositions, type PastedRow } from "@/lib/holdingsPaste";
import { askConfirm } from "./DialogHost";
import { fmtUsd } from "./NetWorth";

interface Holding {
  id: number; symbol: string; kind: "crypto" | "stock" | "option"; display: string; multiplier: number;
  qty: number; cost_basis: number | null; label: string; note?: string; price: number | null; value: number | null;
}
interface Draft { qty: string; cost: string }
interface Trade { id: number; side: "buy" | "sell"; shares: string; price: string }

const CRYPTO = new Set(["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "LINK", "DOT", "LTC", "BNB", "MATIC", "ATOM", "NEAR", "SUI", "UNI"]);
const toNum = (s: string) => { const n = parseFloat(s.replace(/[$,\s]/g, "")); return isFinite(n) ? n : NaN; };
const trim = (n: number, dp = 6) => String(+n.toFixed(dp));
const unit = (h: Holding) => (h.kind === "option" ? "Contracts" : h.kind === "crypto" ? "Units" : "Shares");

export default function HoldingsEditor() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"edit" | "paste">("edit");
  const [rows, setRows] = useState<Holding[] | null>(null);
  const [draft, setDraft] = useState<Record<number, Draft>>({});
  const [trade, setTrade] = useState<Trade | null>(null);
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const opener = useRef<Element | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const escape = useRef<() => void>(() => {});

  useEffect(() => on<null>("app:holdings", () => { opener.current = document.activeElement; setOpen(true); }), []);

  useEffect(() => {
    if (!open) return;
    setRows(null); setDraft({}); setTrade(null); setText(""); setErr(null); setTab("edit");
    api.get<{ holdings: Holding[] }>("/api/holdings").then((r) => setRows(r.holdings)).catch(() => setErr("Couldn't load your holdings. Close this and try again."));
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => closeBtn.current?.focus(), 40);
    // On the window, not the sheet: focus can land on the page after a row's trade form closes.
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector('[role="alertdialog"]')) escape.current(); };
    window.addEventListener("keydown", esc);
    return () => { clearTimeout(t); window.removeEventListener("keydown", esc); document.body.style.overflow = ""; (opener.current as HTMLElement | null)?.focus?.(); };
  }, [open]);

  const base = (h: Holding): Draft => ({ qty: trim(h.qty), cost: h.cost_basis != null ? trim(h.cost_basis, 4) : "" });
  const cur = (h: Holding): Draft => draft[h.id] ?? base(h);
  const set = (h: Holding, patch: Partial<Draft>) => setDraft((d) => ({ ...d, [h.id]: { ...cur(h), ...patch } }));

  const changes = useMemo(() => (rows ?? []).flatMap((h) => {
    const d = draft[h.id];
    if (!d) return [];
    const qty = toNum(d.qty), cost = toNum(d.cost);
    const body: { qty?: number; cost_basis?: number } = {};
    if (!isNaN(qty) && qty >= 0 && Math.abs(qty - h.qty) > 1e-9) body.qty = qty;
    if (!isNaN(cost) && cost > 0 && Math.abs(cost - (h.cost_basis ?? -1)) > 1e-9) body.cost_basis = cost;
    return Object.keys(body).length ? [{ h, body }] : [];
  }), [rows, draft]);
  const invalid = (rows ?? []).some((h) => { const d = draft[h.id]; return d && (isNaN(toNum(d.qty)) || toNum(d.qty) < 0 || (d.cost.trim() !== "" && !(toNum(d.cost) > 0))); });

  const pasted = useMemo(() => parsePositions(text), [text]);
  const plan = useMemo(() => pasted.map((p) => {
    const match = (rows ?? []).filter((h) => h.kind !== "option" && h.symbol.toUpperCase() === p.symbol);
    const h = match.length === 1 ? match[0] : null;
    const same = h && Math.abs(h.qty - p.qty) < 1e-9 && (p.cost == null || Math.abs((h.cost_basis ?? -1) - p.cost) < 1e-9);
    return { p, h, status: match.length > 1 ? "twice" as const : !h ? "new" as const : same ? "same" as const : "update" as const };
  }), [pasted, rows]);
  const labels = useMemo(() => [...new Set((rows ?? []).map((h) => h.label).filter(Boolean))], [rows]);
  const pasteCount = plan.filter((x) => x.status === "new" || x.status === "update").length;

  if (!open) return null;

  const close = async () => {
    if (saving) return;
    if ((changes.length || pasteCount) && !(await askConfirm("Close without saving your changes?", false))) return;
    setOpen(false);
  };
  escape.current = close;

  const applyTrade = (h: Holding) => {
    if (!trade) return;
    const shares = toNum(trade.shares), price = toNum(trade.price);
    const d = cur(h), qty = toNum(d.qty) || 0, cost = d.cost.trim() ? toNum(d.cost) : null;
    if (!(shares > 0)) return;
    if (trade.side === "buy") {
      const next = !isNaN(price) && price > 0 ? costAfterBuy(qty, cost, shares, price) : cost;
      set(h, { qty: trim(qty + shares), cost: next != null ? trim(next, 4) : d.cost });
    } else set(h, { qty: trim(Math.max(0, qty - shares)) });
    setTrade(null); haptic();
  };

  const done = (n: number) => { accountsChanged(); refreshLive(); toast(`Saved. ${n} holding${n === 1 ? "" : "s"} updated.`); setOpen(false); };

  const save = async () => {
    const zero = changes.filter((c) => c.body.qty === 0);
    if (zero.length && !(await askConfirm(`${zero.map((c) => c.h.display).join(", ")} will be removed because the amount is zero. Continue?`))) return;
    setSaving(true); setErr(null);
    const results = await Promise.allSettled(changes.map((c) =>
      c.body.qty === 0 ? api.del(`/api/holdings/${c.h.id}`) : api.patch(`/api/holdings/${c.h.id}`, c.body)));
    setSaving(false);
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) {
      accountsChanged();
      setErr(`${failed} of ${changes.length} didn't save. Close and reopen to see what did, then try again.`);
    } else done(changes.length);
  };

  const savePaste = async () => {
    const todo = plan.filter((x) => x.status === "new" || x.status === "update");
    setSaving(true); setErr(null);
    const results = await Promise.allSettled(todo.map(({ p, h }) => h
      ? api.patch(`/api/holdings/${h.id}`, { qty: p.qty, ...(p.cost != null ? { cost_basis: p.cost } : {}) })
      : api.post("/api/holdings", { symbol: p.symbol, kind: CRYPTO.has(p.symbol) ? "crypto" : "stock", qty: p.qty, cost_basis: p.cost, label })));
    setSaving(false);
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) { accountsChanged(); setErr(`${failed} of ${todo.length} didn't save. Close and reopen to see what did, then try again.`); }
    else done(todo.length);
  };

  const groups = new Map<string, Holding[]>();
  for (const h of rows ?? []) groups.set(h.label || "Other holdings", [...(groups.get(h.label || "Other holdings") ?? []), h]);

  return (
    <div className="fixed inset-0 z-[86] bg-black/60 flex items-end sm:items-center justify-center"
         onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="hold-title"
           className="sheet-rise w-full sm:max-w-2xl h-[92dvh] sm:h-[min(760px,86dvh)] flex flex-col bg-panel border border-edge2 rounded-t-3xl sm:rounded-3xl shadow-[0_18px_50px_var(--color-shade-float)] overflow-hidden">
        <div className="flex items-center gap-2 pl-4 pr-1.5 min-h-14 border-b border-edge">
          <h2 id="hold-title" className="flex-1 font-display text-[19px] text-txt">Update holdings</h2>
          <button ref={closeBtn} type="button" onClick={close} aria-label="Close"
                  className="w-10 h-10 grid place-items-center rounded-full text-dim hover:text-txt hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-cyan">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div role="tablist" aria-label="How to update" className="seg flex gap-1 p-1 m-3 mb-0 rounded-xl border border-edge bg-bg/50 w-fit">
          {([["edit", "Edit each one", Pencil], ["paste", "Paste a list", ClipboardPaste]] as const).map(([id, name, Icon]) => (
            <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => { setTab(id); setErr(null); }}
                    className={`flex items-center gap-1.5 px-3 min-h-10 rounded-lg text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-cyan ${tab === id ? "bg-panel2 text-up" : "text-dim hover:text-txt"}`}>
              <Icon size={14} aria-hidden />{name}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
          {err && <p role="alert" className="text-[13px] text-down px-1">{err}</p>}
          {rows == null && !err && <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-20" />)}</div>}

          {tab === "edit" && rows != null && (rows.length === 0
            ? <p className="text-[14px] text-dim px-1 py-6 text-center">No holdings yet. Paste a list from your brokerage to add them all at once.</p>
            : [...groups.entries()].map(([name, list]) => (
              <section key={name} aria-label={name} className="rounded-2xl border border-edge overflow-hidden">
                <h3 className="px-3 py-2 bg-panel2 text-[12px] font-bold text-dim">{name}</h3>
                <ul className="divide-y divide-edge">
                  {list.map((h) => {
                    const d = cur(h), dirty = changes.some((c) => c.h.id === h.id), t = trade?.id === h.id ? trade : null;
                    const q = toNum(d.qty), live = h.price != null && !isNaN(q) ? q * h.price * h.multiplier : null;
                    return (
                      <li key={h.id} className={`px-3 py-3 space-y-2.5 border-l-2 ${dirty ? "border-l-up bg-up/5" : "border-l-transparent"}`}>
                        <div className="flex items-baseline gap-2">
                          <span className="text-[15px] font-bold text-txt truncate">{h.display}</span>
                          {h.note && <span className="text-[11.5px] text-dim truncate">{h.note.split(" · ")[0]}</span>}
                          <span className="ml-auto text-[13.5px] tabular-nums text-dim" data-private>{live != null ? fmtUsd(live) : "No price"}</span>
                        </div>
                        <div className="flex items-end gap-2">
                          <label className="flex-1 min-w-0">
                            <span className="field-label block mb-1 text-[11.5px] text-dim">{unit(h)}</span>
                            <input className="field tabular-nums" inputMode="decimal" value={d.qty} aria-invalid={isNaN(q) || q < 0}
                                   onChange={(e) => set(h, { qty: e.target.value })} />
                          </label>
                          <label className="flex-1 min-w-0">
                            <span className="field-label block mb-1 text-[11.5px] text-dim">Avg cost</span>
                            <input className="field tabular-nums" inputMode="decimal" value={d.cost} placeholder="Not set"
                                   aria-invalid={d.cost.trim() !== "" && !(toNum(d.cost) > 0)}
                                   onChange={(e) => set(h, { cost: e.target.value })} />
                          </label>
                          <button type="button" aria-label={`Log a buy of ${h.display}`} aria-expanded={t?.side === "buy"}
                                  onClick={() => setTrade(t?.side === "buy" ? null : { id: h.id, side: "buy", shares: "", price: h.price != null ? trim(h.price, 4) : "" })}
                                  className="btn !w-10 !h-10 !p-0 shrink-0"><Plus size={16} aria-hidden /></button>
                          <button type="button" aria-label={`Log a sale of ${h.display}`} aria-expanded={t?.side === "sell"}
                                  onClick={() => setTrade(t?.side === "sell" ? null : { id: h.id, side: "sell", shares: "", price: "" })}
                                  className="btn !w-10 !h-10 !p-0 shrink-0"><Minus size={16} aria-hidden /></button>
                        </div>
                        {t && (
                          <form className="flex items-end gap-2 rounded-xl bg-bg/60 border border-edge p-2.5"
                                onSubmit={(e) => { e.preventDefault(); applyTrade(h); }}>
                            <label className="flex-1 min-w-0">
                              <span className="block mb-1 text-[11.5px] text-dim">{t.side === "buy" ? "Bought" : "Sold"}</span>
                              <input autoFocus className="field tabular-nums" inputMode="decimal" placeholder={unit(h).toLowerCase()} value={t.shares}
                                     onChange={(e) => setTrade({ ...t, shares: e.target.value })} />
                            </label>
                            {t.side === "buy" && (
                              <label className="flex-1 min-w-0">
                                <span className="block mb-1 text-[11.5px] text-dim">At price</span>
                                <input className="field tabular-nums" inputMode="decimal" placeholder="optional" value={t.price}
                                       onChange={(e) => setTrade({ ...t, price: e.target.value })} />
                              </label>
                            )}
                            <button type="submit" className="btn btn-primary !min-h-10 shrink-0" disabled={!(toNum(t.shares) > 0)}>Apply</button>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )))}

          {tab === "paste" && rows != null && (
            <div className="space-y-3">
              <label className="block">
                <span className="block mb-1.5 text-[13px] text-dim leading-relaxed">
                  Paste your positions, one per line: symbol, amount, then average cost if you have it. A table copied from your brokerage works too.
                </span>
                <textarea className="field tabular-nums min-h-32 !py-2.5" value={text} onChange={(e) => setText(e.target.value)}
                          placeholder={"AAPL 25 150.20\nVOO 42\nBTC 0.12 61000"} spellCheck={false} autoCapitalize="characters" />
              </label>
              {text.trim() !== "" && pasted.length === 0 && <p className="text-[13px] text-warn">I couldn&apos;t find any positions in that. Each line needs a symbol and an amount.</p>}
              {plan.length > 0 && (
                <>
                  <ul className="rounded-2xl border border-edge divide-y divide-edge overflow-hidden">
                    {plan.map(({ p, h, status }) => (
                      <li key={p.symbol} className="flex items-center gap-2 px-3 min-h-11 py-1.5 text-[13.5px]">
                        <span className="font-bold text-txt w-16 shrink-0 truncate">{p.symbol}</span>
                        <span className="flex-1 min-w-0 tabular-nums text-dim truncate">
                          {status === "update" && h ? `${trim(h.qty)} to ${trim(p.qty)}` : trim(p.qty)}
                          {p.cost != null ? ` at $${trim(p.cost, 4)}` : ""}
                        </span>
                        <span className={`shrink-0 text-[12px] font-semibold ${status === "new" || status === "update" ? "text-up" : status === "twice" ? "text-warn" : "text-dim"}`}>
                          {status === "new" ? "New" : status === "update" ? "Update" : status === "same" ? "No change" : "Held in two places, skipped"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {plan.some((x) => x.status === "new") && (
                    <label className="flex items-center gap-2 text-[13px] text-dim">
                      <span className="shrink-0">New ones are held at</span>
                      <input className="field" list="hold-labels" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Fidelity (optional)" />
                      <datalist id="hold-labels">{labels.map((l) => <option key={l} value={l} />)}</datalist>
                    </label>
                  )}
                  <p className="text-[12px] text-dim">Holdings that aren&apos;t in your list are left as they are.</p>
                </>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-edge p-3 pb-[max(12px,env(safe-area-inset-bottom))] flex items-center gap-3">
          <p className="flex-1 text-[12.5px] text-dim" aria-live="polite">
            {tab === "edit"
              ? invalid ? "Fix the highlighted amount first." : changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"} ready` : "Change an amount, or tap + or − to log a trade."
              : pasteCount ? `${pasteCount} to save` : "Nothing to save yet."}
          </p>
          <button type="button" className="btn btn-primary !min-h-11 !px-5 !text-[14px] disabled:opacity-40"
                  disabled={saving || (tab === "edit" ? !changes.length || invalid : !pasteCount)}
                  onClick={tab === "edit" ? save : savePaste}>
            {saving && <Loader2 size={15} className="animate-spin" aria-hidden />}Save
          </button>
        </div>
      </div>
    </div>
  );
}
