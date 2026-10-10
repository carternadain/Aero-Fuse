"use client";

import InfoTip from "./InfoTip";
import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import Skeleton from "./Skeleton";

interface Liq {
  range: string; source: string; step: number; error?: string;
  times: number[]; candles: [number, number, number, number][];
  price_lo: number; price_hi: number; bins: number; peak_usd: number; matrix: number[][];
  liq_long: number[]; liq_short: number[];
  price: number; above: Cluster[]; below: Cluster[]; updated: number;
}
interface Cluster { price: number; usd: number; dist_pct: number }

const RANGES = [["24h", "24 hour"], ["3d", "3 day"], ["1w", "1 week"]] as const;
type R = (typeof RANGES)[number][0];

// colormaps: low -> high
const MAPS: Record<string, string[]> = {
  viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
  magma: ["#1b0c41", "#51127c", "#b73779", "#fc8961", "#fcfdbf"],
  ocean: ["#0b1d51", "#173f8a", "#1f77b4", "#5cc8ff", "#e8fbff"],
  ember: ["#1a0f0a", "#5c1d0f", "#b5361c", "#f08a24", "#ffe08a"],
};

function rgb(hex: string) { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function lut(stops: string[]): Uint8ClampedArray {
  const c = stops.map(rgb), out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * (c.length - 1), k = Math.min(c.length - 2, Math.floor(x)), f = x - k;
    for (let j = 0; j < 3; j++) out[i * 3 + j] = c[k][j] + (c[k + 1][j] - c[k][j]) * f;
  }
  return out;
}

const usdShort = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`);
const px = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const AXIS_W = 58, TIME_H = 20;

/**
 * Coinglass-style liquidation heatmap: brighter bands = more estimated
 * liquidations sitting at that price. Candles drawn on top; drag/hover to read a cell.
 */
export default function LiqHeatmap() {
  const [range, setRange] = useState<R>("24h");
  const [d, setD] = useState<Liq | null>(null);
  const [loading, setLoading] = useState(false);
  const [map, setMap] = useState("viridis");
  const [thr, setThr] = useState(0.5);
  const [hover, setHover] = useState<{ x: number; y: number; col: number; bin: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const load = (r: R) => {
    setLoading(true);
    api.get<Liq>(`/api/liqmap?range=${r}`).then(setD)
      .catch(() => setD((cur) => cur ?? ({ error: "Couldn't load the heatmap, retrying shortly" } as Liq)))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    try { const m = localStorage.getItem("liq-map"); if (m && MAPS[m]) setMap(m); const t = localStorage.getItem("liq-thr"); if (t) setThr(+t); } catch { /* */ }
  }, []);
  useEffect(() => {
    setD(null);
    load(range);
    const t = setInterval(() => load(range), range === "24h" ? 120_000 : 300_000);
    return () => clearInterval(t);
  }, [range]);
  useEffect(() => { try { localStorage.setItem("liq-map", map); localStorage.setItem("liq-thr", String(thr)); } catch { /* */ } }, [map, thr]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.width < 500 ? 380 : 520 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const colors = useMemo(() => lut(MAPS[map]), [map]);

  // draw the heat layer + candles + axes
  useEffect(() => {
    const c = cv.current;
    if (!c || !d || !d.matrix.length || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr; c.height = size.h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const W = size.w - AXIS_W, H = size.h - TIME_H;
    const cols = d.matrix.length, bins = d.bins;

    // heat layer: draw at native resolution, then stretch
    const img = new ImageData(cols, bins);
    // Scale against the 99.5th-percentile cell (not the single max), so one spike doesn't wash everything out.
    // Threshold works like Coinglass: higher = only the strongest clusters light up.
    const all: number[] = [];
    for (const col of d.matrix) for (const v of col) if (v > 0) all.push(v);
    all.sort((p, q) => p - q);
    const p995 = all.length ? all[Math.floor(all.length * 0.995)] : 1000;
    const floor = thr * 0.6;   // share of the scale treated as background
    const gamma = 1.2 + thr * 1.6;
    for (let x = 0; x < cols; x++) {
      const col = d.matrix[x];
      for (let b = 0; b < bins; b++) {
        const raw = Math.min(1, col[b] / p995);
        const v = raw <= floor ? 0 : Math.pow((raw - floor) / (1 - floor), gamma);
        const k = Math.round(v * 255) * 3;
        const o = ((bins - 1 - b) * cols + x) * 4;
        img.data[o] = colors[k]; img.data[o + 1] = colors[k + 1]; img.data[o + 2] = colors[k + 2]; img.data[o + 3] = 255;
      }
    }
    const off = document.createElement("canvas");
    off.width = cols; off.height = bins;
    off.getContext("2d")!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, W, H);

    const y = (p: number) => H - ((p - d.price_lo) / (d.price_hi - d.price_lo)) * H;
    const cw = W / cols;

    // candles
    for (let i = 0; i < cols; i++) {
      const [o, h, l, cl] = d.candles[i];
      const up = cl >= o;
      ctx.strokeStyle = ctx.fillStyle = up ? "#2ee6a6" : "#ff5d73";
      const cx = i * cw + cw / 2;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, y(h)); ctx.lineTo(cx, y(l)); ctx.stroke();
      const top = y(Math.max(o, cl)), bh = Math.max(1, Math.abs(y(o) - y(cl)));
      ctx.fillRect(cx - Math.max(0.5, cw * 0.32), top, Math.max(1, cw * 0.64), bh);
    }

    // current price line
    const py = y(d.price);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke(); ctx.setLineDash([]);

    // price axis
    const css = getComputedStyle(document.documentElement);
    const faint = css.getPropertyValue("--color-faint").trim() || "#999";
    ctx.fillStyle = css.getPropertyValue("--color-panel").trim() || "#222";
    ctx.fillRect(W, 0, AXIS_W, size.h);
    ctx.fillRect(0, H, size.w, TIME_H);
    ctx.font = "10px ui-sans-serif, system-ui";
    ctx.fillStyle = faint; ctx.textBaseline = "middle";
    const span = d.price_hi - d.price_lo;
    const stepP = [100, 250, 500, 1000, 2000, 2500, 5000, 10000].find((s) => span / s <= 9) ?? 10000;
    for (let p = Math.ceil(d.price_lo / stepP) * stepP; p < d.price_hi; p += stepP) {
      ctx.fillText(p.toLocaleString("en-US"), W + 6, y(p));
      ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fillRect(0, Math.round(y(p)), W, 1); ctx.fillStyle = faint;
    }
    ctx.fillStyle = "#fde725"; ctx.fillRect(W, py - 8, AXIS_W, 16);
    ctx.fillStyle = "#111"; ctx.font = "bold 10px ui-sans-serif, system-ui";
    ctx.fillText(Math.round(d.price).toLocaleString("en-US"), W + 4, py);

    // time axis
    ctx.font = "10px ui-sans-serif, system-ui"; ctx.fillStyle = faint; ctx.textBaseline = "top";
    const labels = Math.max(2, Math.floor(W / 90));
    for (let k = 0; k < labels; k++) {
      const i = Math.round((k / (labels - 1)) * (cols - 1));
      const t = new Date(d.times[i] * 1000);
      const s = range === "24h" ? t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : t.toLocaleDateString([], { month: "short", day: "numeric" }) + (range === "3d" ? ` ${t.getHours()}h` : "");
      const w = ctx.measureText(s).width;
      ctx.fillText(s, Math.min(W - w, Math.max(0, i * cw + cw / 2 - w / 2)), H + 5);
    }
  }, [d, size, colors, thr, range]);

  const onMove = (e: React.PointerEvent) => {
    if (!d || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const x = e.clientX - r.left, yy = e.clientY - r.top;
    const W = size.w - AXIS_W, H = size.h - TIME_H;
    if (x < 0 || x > W || yy < 0 || yy > H) { setHover(null); return; }
    const col = Math.min(d.matrix.length - 1, Math.floor((x / W) * d.matrix.length));
    const bin = Math.min(d.bins - 1, Math.floor(((H - yy) / H) * d.bins));
    setHover({ x, y: yy, col, bin });
  };

  const hv = hover && d ? {
    t: new Date(d.times[hover.col] * 1000),
    price: d.price_lo + ((hover.bin + 0.5) / d.bins) * (d.price_hi - d.price_lo),
    usd: (d.matrix[hover.col][hover.bin] / 1000) * d.peak_usd,
    close: d.candles[hover.col][3],
  } : null;

  return (
    <section className="panel">
      <div className="panel-head flex-wrap gap-2">
        <span className="flex items-center gap-1 text-[11px] text-dim">Bitcoin, leveraged positions
          <InfoTip topic="the liquidation heatmap" title="How this is estimated">
            <p>{d ? `Estimated from ${d.source} open interest, candles and taker buy/sell volume` : "Estimated from open interest, candles and taker buy/sell volume"}: new positions are spread over 5–100× leverage and removed once price trades through their liquidation price. Like every public heatmap it&apos;s a model of one exchange, not actual orders.</p>
            {d && <p>Updated {new Date(d.updated * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</p>}
          </InfoTip>
        </span>
        <div className="flex items-center gap-2">
          <div className="seg flex rounded-lg border border-edge2 text-[11px]">
            {RANGES.map(([k, l]) => (
              <button key={k} onClick={() => setRange(k)}
                      className={`px-3 py-1.5 font-bold ${range === k ? "bg-panel2 text-up" : "text-dim hover:text-txt"}`}>{l}</button>
            ))}
          </div>
          <button className="btn !py-1.5 !px-2" onClick={() => load(range)} disabled={loading} title="Refresh">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-edge text-[11px] text-dim">
        <div className="flex gap-1.5 max-sm:gap-4">
          {Object.entries(MAPS).map(([k, stops]) => (
            <button key={k} onClick={() => setMap(k)} title={k}
                    className={`w-6 h-6 rounded-md border-2 ${map === k ? "border-txt" : "border-transparent"}`}
                    style={{ background: `linear-gradient(135deg, ${stops.join(",")})` }} />
          ))}
        </div>
        <label className="flex items-center gap-2 flex-1 min-w-[min(180px,100%)]">
          <span className="whitespace-nowrap">Threshold <b className="text-txt tabular-nums">{thr.toFixed(2)}</b></span>
          <input type="range" min={0} max={1} step={0.01} value={thr} onChange={(e) => setThr(+e.target.value)}
                 className="flex-1 min-w-0 accent-[var(--color-up)]" />
        </label>
      </div>

      <div ref={box} className="relative touch-none select-none" data-noswipe style={{ height: size.h || 380 }}
           onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
        {!d ? <Skeleton className="absolute inset-2" /> : d.error ? (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-dim">{d.error}</p>
        ) : (
          <>
            <canvas ref={cv} className="absolute inset-0 w-full h-full" />
            {hover && hv && (
              <>
                <div className="absolute pointer-events-none border-l border-dashed border-white/40" style={{ left: hover.x, top: 0, height: size.h - TIME_H }} />
                <div className="absolute pointer-events-none border-t border-dashed border-white/40" style={{ top: hover.y, left: 0, width: size.w - AXIS_W }} />
                <div className="absolute pointer-events-none rounded-lg bg-black/85 border border-white/10 px-3 py-2 text-[11.5px] text-white shadow-xl"
                     style={{ left: Math.min(hover.x + 12, size.w - AXIS_W - 190), top: Math.max(4, Math.min(hover.y + 12, size.h - TIME_H - 90)) }}>
                  <div className="font-bold mb-1">{hv.t.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                  <div className="flex justify-between gap-4"><span className="text-white/60">Price level</span><span className="tabular-nums">{px(hv.price)}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-white/60">Est. liquidations</span><span className="tabular-nums">{usdShort(hv.usd)}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-white/60">BTC close</span><span className="tabular-nums">{px(hv.close)}</span></div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {d && !d.error && (
        <div className="grid grid-cols-2 gap-3 p-3 border-t border-edge">
          {([["Biggest above (shorts)", d.above, "text-down"], ["Biggest below (longs)", d.below, "text-up"]] as const).map(([title, rows, tone]) => (
            <div key={title}>
              <div className="text-[10px] font-bold tracking-widest text-faint uppercase mb-1">{title}</div>
              {rows.map((c) => (
                <div key={c.price} className="flex justify-between text-[12px] py-0.5 tabular-nums">
                  <span className="font-bold text-txt">{px(c.price)}</span>
                  <span className={tone}>{c.dist_pct > 0 ? "+" : ""}{c.dist_pct.toFixed(1)}%</span>
                  <span className="text-dim">{usdShort(c.usd)}</span>
                </div>
              ))}
            </div>
          ))}
          <p className="col-span-2 text-[10px] text-faint">
            Model estimate, updated {new Date(d.updated * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
          </p>
        </div>
      )}
    </section>
  );
}
