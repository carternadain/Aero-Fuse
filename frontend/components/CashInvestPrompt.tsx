"use client";

// "Did you invest it?": the weekly cash that lands in a brokerage bucket (like Robinhood)
// waits here until you say which stock you bought. Logging it adds the shares to your holdings.

import { useEffect, useMemo, useState } from "react";
import { CircleDollarSign } from "lucide-react";
import { api } from "@/lib/api";
import { haptic, toast } from "@/lib/bus";
import { fmtQty, usePrivacy } from "@/lib/privacy";
import { dayLabel } from "@/lib/categories";
import { parseAmount } from "./AutoInvest";
import { apiError, FieldError, money, Seg, Sheet, type CashPayload, type ToInvest } from "./cashShared";

type AssetKind = "stock" | "crypto";
interface IndexTicker { symbol: string; kind: AssetKind | "option"; name: string | null }
let indexCache: { tickers: IndexTicker[]; accounts: string[] } | null = null;

interface Logged { move_id: number; symbol: string; qty: number; price: number; amount: number }

export function CashInvestPrompt({ entry, onDone }: { entry: ToInvest; onDone: (p?: CashPayload) => void }) {
  usePrivacy();
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const snooze = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const p = await api.post<CashPayload>("/api/cash/snooze", { account_id: entry.account_id });
      haptic();
      onDone(p);
    } catch (e) { setErr(apiError(e)); }
    setBusy(false);
  };

  return (
    <section className="panel p-4" aria-label={`${entry.name} waiting to invest`}>
      <div className="flex items-start gap-3">
        <span className="shrink-0 size-9 rounded-[10px] flex items-center justify-center bg-up/15 text-up"><CircleDollarSign size={19} strokeWidth={2.2} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] font-semibold text-txt leading-tight tabular-nums">{entry.name}: {money(entry.balance)} waiting</h3>
          <p className="text-[13px] text-dim mt-1 leading-snug">
            Did you invest it?{entry.last_deposit ? <span className="text-faint"> Last deposit {dayLabel(entry.last_deposit)}.</span> : null}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3.5">
        <button className="btn btn-primary !min-h-11 !text-[15px]" onClick={() => { haptic(); setSheet(true); }}>Yes, log it</button>
        <button className="btn !min-h-11 !text-[15px]" disabled={busy} onClick={snooze}>{busy ? "One moment…" : "Not yet"}</button>
      </div>
      <FieldError msg={err} />
      {sheet && <LogSheet entry={entry} onClose={() => setSheet(false)} onDone={(p) => { setSheet(false); onDone(p); }} />}
    </section>
  );
}

function LogSheet({ entry, onClose, onDone }: { entry: ToInvest; onClose: () => void; onDone: (p?: CashPayload) => void }) {
  usePrivacy();
  const [symbol, setSymbol] = useState(""); // what was typed; shown uppercase by CSS, normalised only on use
  const [manualKind, setManualKind] = useState<AssetKind>("stock");
  const [amount, setAmount] = useState(String(Math.round(entry.balance * 100) / 100));
  const [price, setPrice] = useState("");
  const [index, setIndex] = useState(indexCache);
  const [focus, setFocus] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!indexCache) api.get<{ tickers: IndexTicker[]; accounts: string[] }>("/api/search/index")
      .then((i) => { indexCache = i; setIndex(i); }).catch(() => {});
  }, []);

  const q = symbol.trim().toUpperCase();
  const known = useMemo(() => index?.tickers.find((x) => x.symbol === q && x.kind !== "option"), [index, q]);
  const kind: AssetKind = (known?.kind as AssetKind | undefined) ?? manualKind;
  const matches = useMemo(() => {
    if (!q || !index) return [];
    const t = index.tickers.filter((x) => x.kind !== "option");
    if (t.some((x) => x.symbol === q) && !focus) return [];
    return t
      .map((x) => ({ x, s: x.symbol === q ? 100 : x.symbol.startsWith(q) ? 60 : (x.name ?? "").toUpperCase().includes(q) ? 20 : 0 }))
      .filter((m) => m.s > 0).sort((a, b) => b.s - a.s || a.x.symbol.localeCompare(b.x.symbol)).slice(0, 5).map((m) => m.x);
  }, [q, index, focus]);

  const amt = parseAmount(amount);
  const px = price.trim() ? parseAmount(price) : null;
  const errs = {
    symbol: q ? (/^[A-Z0-9.\-]{1,15}$/.test(q) ? null : "Tickers use letters and numbers only, like VOO.") : "Enter a ticker, like VOO.",
    amount: amt.error ?? (amt.value > entry.balance + 0.005 ? `That's more than the ${money(entry.balance)} you have here.` : null),
    price: px?.error ?? null,
  };
  const valid = !errs.symbol && !errs.amount && !errs.price;

  const save = async () => {
    if (busy) return;
    setTried(true);
    if (!valid) return;
    setBusy(true); setErr(null);
    try {
      const res = await api.post<CashPayload & { logged?: Logged }>("/api/cash/invest", {
        account_id: entry.account_id, symbol: q, kind, amount: amt.value,
        ...(px?.value ? { price: px.value } : {}),
      });
      haptic();
      const lg = res.logged;
      toast(lg ? `Added ${fmtQty(lg.qty, 4)} ${lg.symbol}` : `Logged ${q}`, lg ? {
        label: "Undo",
        run: () => { api.del<CashPayload>(`/api/cash/moves/${lg.move_id}`).then((p) => onDone(p)).catch(() => toast("Couldn't undo that")); },
      } : undefined);
      onDone(res);
    } catch (e) { setErr(apiError(e)); setBusy(false); }
  };

  return (
    <Sheet title="Log your buy" onClose={onClose}>
      <form className="px-4 space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <p className="text-[13px] text-dim leading-snug">What did you buy with the {money(entry.balance)} in {entry.name}?</p>

        <div className="space-y-2">
          <label className="field-wrap relative">
            <span className="field-label">What did you buy?</span>
            <input className="field uppercase" placeholder="VOO" autoComplete="off" autoCapitalize="characters" spellCheck={false}
                   enterKeyHint="next" autoFocus value={symbol} aria-autocomplete="list" aria-invalid={tried && !!errs.symbol}
                   onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 120)}
                   onChange={(e) => setSymbol(e.target.value)} />
          </label>
          {focus && matches.length > 0 && (
            <ul className="rounded-[10px] border border-edge2 bg-bg overflow-hidden divide-y divide-edge" role="listbox" aria-label="Matching tickers">
              {matches.map((m) => (
                <li key={`${m.kind}-${m.symbol}`}>
                  <button type="button" role="option" aria-selected={m.symbol === q}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { setSymbol(m.symbol); setManualKind(m.kind as AssetKind); setFocus(false); }}
                          className="w-full min-h-10 flex items-center gap-2 px-3 py-1.5 text-left hover:bg-panel2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan">
                    <span className="text-[14px] font-semibold text-txt w-16 shrink-0">{m.symbol}</span>
                    <span className="text-[12px] text-dim truncate flex-1">{m.name ?? ""}</span>
                    <span className="text-[11px] text-faint shrink-0">{m.kind === "crypto" ? "Crypto" : "Stock"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {tried && <FieldError msg={errs.symbol} />}
          {q && !known && index && <Seg label="Asset type" value={manualKind} onChange={setManualKind} options={[["stock", "Stock / ETF"], ["crypto", "Crypto"]]} />}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="field-wrap">
            <span className="field-label">Amount</span>
            <input className="field tabular-nums" inputMode="decimal" autoComplete="off" enterKeyHint="next"
                   value={amount} aria-invalid={tried && !!errs.amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="field-wrap">
            <span className="field-label">Price paid (optional)</span>
            <input className="field tabular-nums" inputMode="decimal" autoComplete="off" enterKeyHint="done" placeholder="Today's price"
                   value={price} aria-invalid={tried && !!errs.price} onChange={(e) => setPrice(e.target.value)} />
          </label>
        </div>
        {tried && <FieldError msg={errs.amount ?? errs.price} />}
        <FieldError msg={err} />

        <button type="submit" disabled={busy} className="btn btn-primary w-full !min-h-11 !text-[15px] disabled:opacity-40">
          {busy ? "Saving…" : "Add to my holdings"}
        </button>
      </form>
    </Sheet>
  );
}

/** Self-loading wrapper for Home: shows a card per bucket waiting to be invested, nothing otherwise. */
export function CashInvestPrompts() {
  const [data, setData] = useState<CashPayload | null>(null);
  useEffect(() => {
    let alive = true;
    api.get<CashPayload>("/api/cash").then((p) => { if (alive) setData(p); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const waiting = (data?.to_invest ?? []).filter((t) => !t.snoozed);
  if (!waiting.length) return null;
  return (
    <div className="space-y-3">
      {waiting.map((t) => <CashInvestPrompt key={t.account_id} entry={t} onDone={(p) => { if (p) setData(p); }} />)}
    </div>
  );
}
