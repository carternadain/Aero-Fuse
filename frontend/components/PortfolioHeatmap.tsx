"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { api } from "@/lib/api";
import { fmtCents, isHidden } from "@/lib/privacy";
import AssetDetail, { type LiveHolding } from "./AssetDetail";
import Skeleton from "./Skeleton";

interface Tile { key: string; label: string; value: number; pct: number | null; rep: LiveHolding }
interface Rect extends Tile { x: number; y: number; w: number; h: number }

/** Squarified treemap (Bruls et al.): lays tiles out in rows that keep aspect ratios near 1. */
function squarify(items: Tile[], W: number, H: number): Rect[] {
  const total = items.reduce((t, i) => t + i.value, 0);
  if (!total || !W || !H) return [];
  const scale = (W * H) / total;
  const nodes = items.map((i) => ({ ...i, area: i.value * scale })).sort((a, b) => b.area - a.area);
  const out: Rect[] = [];
  let x = 0, y = 0, w = W, h = H;
  const worst = (row: { area: number }[], side: number) => {
    const s = row.reduce((t, r) => t + r.area, 0);
    const mx = Math.max(...row.map((r) => r.area)), mn = Math.min(...row.map((r) => r.area));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  let row: typeof nodes = [];
  const layout = (r: typeof nodes) => {
    const s = r.reduce((t, n) => t + n.area, 0);
    if (w >= h) {               // lay the row down the left side
      const rw = s / h; let cy = y;
      for (const n of r) { const nh = n.area / rw; out.push({ ...n, x, y: cy, w: rw, h: nh }); cy += nh; }
      x += rw; w -= rw;
    } else {                    // lay the row across the top
      const rh = s / w; let cx = x;
      for (const n of r) { const nw = n.area / rh; out.push({ ...n, x: cx, y, w: nw, h: rh }); cx += nw; }
      y += rh; h -= rh;
    }
  };
  for (const n of nodes) {
    const side = Math.min(w, h);
    if (!row.length || worst([...row, n], side) <= worst(row, side)) row.push(n);
    else { layout(row); row = [n]; }
  }
  if (row.length) layout(row);
  return out;
}

/** Diverging fill: stronger color for bigger moves, capped at ±5%. */
function tileColor(pct: number | null): string {
  if (pct == null) return "color-mix(in srgb, var(--color-panel2) 100%, transparent)";
  const k = Math.min(1, Math.abs(pct) / 5);
  const c = pct >= 0 ? "var(--color-up)" : "var(--color-down)";
  return `color-mix(in srgb, ${c} ${Math.round(14 + k * 58)}%, var(--color-panel))`;
}

export default function PortfolioHeatmap() {
  const [holdings, setHoldings] = useState<LiveHolding[] | null>(null);
  const [detail, setDetail] = useState<LiveHolding | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);

  useEffect(() => {
    const load = () => api.get<{ holdings: LiveHolding[] }>("/api/holdings").then((r) => setHoldings(r.holdings)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = W < 500 ? 300 : 340;
  const rects = useMemo(() => {
    if (!holdings) return [];
    // one tile per symbol, combining accounts (VOO in the Roth + Investing = one tile)
    const by = new Map<string, Tile>();
    for (const h of holdings) {
      if (!h.value || h.value <= 0) continue;
      const k = `${h.kind}:${h.symbol}`;
      const t = by.get(k);
      if (t) t.value += h.value;
      else by.set(k, { key: k, label: h.kind === "option" ? h.display.split(" ").slice(0, 2).join(" ") : h.symbol,
                       value: h.value, pct: h.change_1d, rep: h });
    }
    return squarify([...by.values()], W, H);
  }, [holdings, W, H]);

  const total = rects.reduce((t, r) => t + r.value, 0);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><LayoutGrid size={14} />Today&apos;s Map</span>
        <span className="text-[10px] text-faint">size = how much you hold · color = today&apos;s move</span>
      </div>
      <div ref={box} className="relative m-2" style={{ height: H }}>
        {!holdings ? (
          <Skeleton className="absolute inset-0" />
        ) : (
          rects.map((r) => {
            const big = r.w > 70 && r.h > 44, mid = r.w > 42 && r.h > 26;
            return (
              <button key={r.key} onClick={() => setDetail(r.rep)}
                      className="absolute overflow-hidden rounded-[6px] text-left transition-[filter] hover:brightness-125 active:brightness-150"
                      style={{ left: r.x + 1, top: r.y + 1, width: Math.max(0, r.w - 2), height: Math.max(0, r.h - 2), background: tileColor(r.pct) }}
                      title={`${r.label} · ${r.pct != null ? `${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(2)}%` : "no change data"}`}>
                {mid && (
                  <div className="p-1.5 leading-tight">
                    <div className={`font-extrabold text-txt truncate ${big ? "text-[13px]" : "text-[10px]"}`}>{r.label}</div>
                    {r.pct != null && (
                      <div className={`tabular-nums text-txt/85 ${big ? "text-[11px]" : "text-[9px]"}`}>
                        {r.pct >= 0 ? "+" : ""}{r.pct.toFixed(2)}%
                      </div>
                    )}
                    {big && r.h > 64 && !isHidden() && (
                      <div className="text-[10px] text-txt/60 tabular-nums mt-0.5">{fmtCents(r.value)}</div>
                    )}
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>
      {detail && holdings && (
        <AssetDetail holding={detail} all={holdings} portfolioTotal={total} onClose={() => setDetail(null)} />
      )}
    </section>
  );
}
