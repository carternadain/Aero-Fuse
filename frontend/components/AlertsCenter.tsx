"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, BellRing, Plus, Send, Smartphone, Trash2, X } from "lucide-react";
import { api, fmtPrice, timeAgo } from "@/lib/api";
import { haptic, on, openTicker, toast, type Kind, type ToastPayload } from "@/lib/bus";
import { disablePush, enablePush, pushState, pushSupport, type PushSupport } from "@/lib/push";

interface Alert {
  id: string; symbol: string; kind: Kind; op: "above" | "below"; price: number; note: string;
  created_at: string; created_price: number | null; triggered_at: string | null; triggered_price: number | null;
  current: number | null; distance_pct: number | null;
}

const SEEN_KEY = "alerts-seen";
const getSeen = () => { try { return localStorage.getItem(SEEN_KEY) ?? ""; } catch { return ""; } };
const setSeen = (v: string) => { try { localStorage.setItem(SEEN_KEY, v); } catch { /* */ } };

/** Header bell: badge for fired alerts, sheet to manage alerts and phone notifications. */
export default function AlertsCenter() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [devices, setDevices] = useState(0);
  const [open, setOpen] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [support, setSupport] = useState<PushSupport>("unsupported");
  const [state, setState] = useState<"on" | "off" | "denied">("off");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ symbol: "", kind: undefined as Kind | undefined, op: "above" as "above" | "below", price: "", note: "" });
  const toasted = useRef<Set<string> | null>(null); // fired alerts already announced this session

  const load = async () => {
    try {
      const r = await api.get<{ alerts: Alert[]; devices: number }>("/api/alerts");
      setAlerts(r.alerts);
      setDevices(r.devices);
      const seen = getSeen();
      const fresh = r.alerts.filter((a) => a.triggered_at && a.triggered_at > seen);
      setUnseen(fresh.length);
      // While the app is open, fired alerts also pop in-app (push covers when it's closed).
      if (toasted.current) {
        for (const a of fresh) {
          if (toasted.current.has(a.id)) continue;
          toasted.current.add(a.id);
          toast(`🔔 ${a.symbol} ${a.op === "above" ? "above" : "below"} $${fmtPrice(a.price)}`);
        }
      } else {
        toasted.current = new Set(fresh.map((a) => a.id));
      }
    } catch { /* offline */ }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    setSupport(pushSupport());
    pushState().then(setState);
    const off = on<{ symbol: string; kind?: Kind; price?: number } | null>("app:alerts", (p) => {
      if (p) {
        const px = p.price ? +(p.price * 1.05).toPrecision(4) : "";
        setForm({ symbol: p.symbol, kind: p.kind, op: "above", price: String(px), note: "" });
      }
      setOpen(true);
    });
    return () => { clearInterval(t); off(); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const latest = alerts.map((a) => a.triggered_at ?? "").sort().pop();
    if (latest) setSeen(latest);
    setUnseen(0);
    document.body.style.overflow = "hidden";
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", k); };
  }, [open, alerts]);

  const add = async () => {
    const price = parseFloat(form.price);
    if (!form.symbol.trim() || !(price > 0)) return;
    setBusy(true);
    try {
      await api.post("/api/alerts", { symbol: form.symbol.trim().toUpperCase(), kind: form.kind, op: form.op, price, note: form.note });
      setForm({ symbol: "", kind: undefined, op: "above", price: "", note: "" });
      haptic();
      await load();
    } catch (e) { toast(String(e).slice(0, 80)); }
    setBusy(false);
  };

  const del = async (id: string) => { await api.del(`/api/alerts/${id}`).catch(() => {}); load(); };

  const turnOn = async () => {
    setBusy(true);
    const r = await enablePush();
    setState(r === "on" ? "on" : r === "denied" ? "denied" : "off");
    if (r === "error") toast("Couldn't turn on notifications on this device");
    if (r === "on") { await api.post("/api/push/test").catch(() => {}); }
    await load();
    setBusy(false);
  };
  const turnOff = async () => { setBusy(true); await disablePush(); setState("off"); await load(); setBusy(false); };

  const active = alerts.filter((a) => !a.triggered_at);
  const fired = alerts.filter((a) => a.triggered_at);

  return (
    <>
      {/* Phones keep the header to search + settings: the bell only shows there once an alert has fired
          (alerts are always reachable from Settings and search). */}
      <span className={unseen ? "contents" : "hidden sm:contents"}>
        <button className="icon-btn relative !text-dim hover:!text-txt" title="Price alerts"
                aria-label={unseen ? `Price alerts, ${unseen} new` : "Price alerts"} onClick={() => setOpen(true)}>
          {unseen ? <BellRing size={17} className="text-amber" /> : <Bell size={17} />}
          {unseen > 0 && (
            <span aria-hidden className="absolute top-1 right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-amber text-bg text-[9px] font-extrabold flex items-center justify-center">
              {unseen}
            </span>
          )}
        </button>
      </span>

      {open && (
        <div className="fixed inset-0 z-[86] bg-black/60 flex items-end sm:items-center justify-center"
             onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="bg-bg sm:bg-panel w-full sm:max-w-lg max-h-[92dvh] rounded-t-2xl sm:rounded-2xl border border-edge overflow-y-auto tab-enter
                          pb-[max(16px,env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h2 className="text-lg font-extrabold text-txt flex items-center gap-2"><Bell size={17} className="text-amber" /> Price alerts</h2>
              <button className="w-10 h-10 -mr-2 flex items-center justify-center rounded-full hover:bg-panel2 text-dim focus-visible:outline-2 focus-visible:outline-cyan" onClick={() => setOpen(false)} aria-label="Close alerts"><X size={18} /></button>
            </div>

            {/* Phone notifications */}
            <div className="mx-4 rounded-xl border border-edge bg-panel2/40 p-3 text-[12px]">
              <div className="flex items-center gap-2 font-bold text-txt"><Smartphone size={14} /> Notifications on this device</div>
              {support === "ios-install" ? (
                <p className="text-dim mt-1 leading-relaxed">
                  On iPhone, alerts can only notify you from the Home Screen app: tap Share → <b>Add to Home Screen</b>, open it from there,
                  then come back here. Until then, alerts still show inside the app and on Telegram if it&apos;s set up.
                </p>
              ) : support === "unsupported" ? (
                <p className="text-dim mt-1">This browser can&apos;t do push notifications. Alerts still show inside the app.</p>
              ) : state === "denied" ? (
                <p className="text-dim mt-1">Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then reload.</p>
              ) : state === "on" ? (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="text-up font-semibold">On · {devices} device{devices === 1 ? "" : "s"} subscribed</span>
                  <button className="btn !py-1 ml-auto" disabled={busy} onClick={() => api.post("/api/push/test").then(() => toast("Test sent"))}>
                    <Send size={12} /> Test
                  </button>
                  <button className="btn !py-1" disabled={busy} onClick={turnOff}><BellOff size={12} /> Turn off</button>
                </div>
              ) : (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-dim flex-1">Get a ping on this device when an alert hits, even with the app closed.</span>
                  <button className="btn btn-primary !py-1.5" disabled={busy} onClick={turnOn}>Turn on</button>
                </div>
              )}
            </div>

            {/* New alert */}
            <div className="px-4 mt-4">
              <div className="text-[11px] font-bold tracking-widest text-faint mb-2">NEW ALERT</div>
              <div className="grid grid-cols-2 sm:grid-cols-[1fr_auto_1fr] gap-2 items-end">
                <label className="field-wrap"><span className="field-label">Ticker</span>
                  <input className="field uppercase" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="next" value={form.symbol}
                         onChange={(e) => setForm({ ...form, symbol: e.target.value, kind: undefined })} />
                </label>
                <div className="seg flex rounded-lg border border-edge2 text-[12px] font-bold max-sm:order-last max-sm:col-span-2 max-sm:[&>button]:flex-1">
                  {(["above", "below"] as const).map((o) => (
                    <button key={o} onClick={() => setForm({ ...form, op: o })}
                            className={`px-3 ${form.op === o ? "bg-panel2 text-up" : "text-dim"}`}>{o === "above" ? "≥ Above" : "≤ Below"}</button>
                  ))}
                </div>
                <label className="field-wrap"><span className="field-label">Price</span>
                  <input className="field" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={form.price}
                         onChange={(e) => setForm({ ...form, price: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
                </label>
              </div>
              <div className="flex gap-2 mt-2 items-end">
                <label className="field-wrap flex-1"><span className="field-label">Note (optional)</span>
                  <input className="field" autoComplete="off" enterKeyHint="go" placeholder="e.g. breakout entry" value={form.note}
                         onChange={(e) => setForm({ ...form, note: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
                </label>
                <button className="btn btn-primary" disabled={busy || !form.symbol || !form.price} onClick={add}><Plus size={14} /> Add</button>
              </div>
            </div>

            <div className="px-4 mt-5">
              <div className="text-[11px] font-bold tracking-widest text-faint mb-1">WATCHING ({active.length})</div>
              {!active.length && <p className="text-[12px] text-dim py-2">No active alerts. They&apos;re checked every minute.</p>}
              {active.map((a) => (
                <div key={a.id} className="flex items-center gap-3 py-2.5 border-b border-edge/60">
                  <button className="min-w-0 flex-1 text-left" onClick={() => { setOpen(false); openTicker({ symbol: a.symbol, kind: a.kind }); }}>
                    <div className="text-[14px] font-bold text-txt">{a.symbol} <span className="text-dim font-semibold">{a.op === "above" ? "≥" : "≤"} ${fmtPrice(a.price)}</span></div>
                    <div className="text-[11px] text-faint truncate">
                      now ${fmtPrice(a.current)}{a.distance_pct != null && ` · ${Math.abs(a.distance_pct).toFixed(1)}% away`}{a.note && ` · ${a.note}`}
                    </div>
                  </button>
                  <div className="w-16 h-1.5 rounded-full bg-edge overflow-hidden" title="How close it is">
                    <div className="h-full bg-amber rounded-full" style={{ width: `${Math.max(4, 100 - Math.min(100, Math.abs(a.distance_pct ?? 100) * 10))}%` }} />
                  </div>
                  <button className="icon-btn" onClick={() => del(a.id)} title="Delete"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>

            {fired.length > 0 && (
              <div className="px-4 mt-5">
                <div className="text-[11px] font-bold tracking-widest text-faint mb-1">FIRED</div>
                {fired.slice().reverse().slice(0, 15).map((a) => (
                  <div key={a.id} className="flex items-center gap-3 py-2 border-b border-edge/60 text-[12px]">
                    <BellRing size={13} className="text-amber shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-dim">
                      <b className="text-txt">{a.symbol}</b> {a.op} ${fmtPrice(a.price)} · hit ${fmtPrice(a.triggered_price)} · {timeAgo(a.triggered_at!)} ago
                    </span>
                    <button className="icon-btn" onClick={() => del(a.id)} title="Clear"><X size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Small transient message at the top (alerts, stars, errors). */
export function ToastHost() {
  const [t, setT] = useState<ToastPayload | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const off = on<string | ToastPayload>("app:toast", (m) => {
      const p = typeof m === "string" ? { msg: m } : m;
      setT(p); clearTimeout(timer); timer = setTimeout(() => setT(null), p.ms ?? 3500);
    });
    return () => { off(); clearTimeout(timer); };
  }, []);
  if (!t) return null;
  return (
    <div role="status" className="fixed top-[max(14px,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[97] tab-enter max-w-[92vw]
                    flex items-center gap-3 pl-4 pr-2 py-1.5 min-h-10 rounded-full border border-edge2 bg-panel/95 backdrop-blur shadow-xl text-[13px] font-bold text-txt">
      <span className="truncate">{t.msg}</span>
      {t.action && (
        <button className="shrink-0 min-h-10 px-3 rounded-full text-up hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-up"
                onClick={() => { const a = t.action!; setT(null); a.run(); }}>
          {t.action.label}
        </button>
      )}
      {!t.action && <span className="w-2" aria-hidden />}
    </div>
  );
}
