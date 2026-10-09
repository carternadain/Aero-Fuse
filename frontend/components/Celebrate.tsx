"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fmtCents, isHidden } from "@/lib/privacy";

const KEY = "nw-celebrations-v1";
const MILESTONES = [25e3, 50e3, 75e3, 100e3, 150e3, 200e3, 250e3, 300e3, 400e3, 500e3, 750e3, 1e6, 1.5e6, 2e6, 3e6, 5e6];

interface State { best: number; celebrated: number[]; lastAth: string | null }

function load(): State | null {
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
function save(s: State) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

/** Tiny dependency-free confetti burst on a full-screen canvas (~2.5s). */
function confetti(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const colors = ["--color-up", "--color-amber", "--color-cyan", "--color-txt", "--color-down"].map((v) => css.getPropertyValue(v).trim() || "#fff");
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.32,
    vx: (Math.random() - 0.5) * 11, vy: -Math.random() * 11 - 4,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    w: 5 + Math.random() * 5, h: 8 + Math.random() * 6, c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  const tick = (now: number) => {
    const age = now - t0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - age / 2500);
    for (const p of parts) {
      p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      ctx.restore();
    }
    if (age < 2500) requestAnimationFrame(tick); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(tick);
}

/**
 * Watches net worth and celebrates new milestones ($75k, $100k…) and all-time highs
 * (at most once a day, and only when beating the previous best by 0.5%+).
 * The first visit just records a baseline, so there are no celebrations for old ground.
 */
export default function Celebrate() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      let nw: number;
      try { nw = (await api.get<{ totals: { net_worth: number } }>("/api/accounts")).totals.net_worth; } catch { return; }
      if (!nw || nw <= 0) return;
      const today = new Date().toISOString().slice(0, 10);
      const s = load();
      if (!s) { save({ best: nw, celebrated: MILESTONES.filter((m) => m <= nw), lastAth: today }); return; }

      const crossed = MILESTONES.filter((m) => m <= nw && !s.celebrated.includes(m));
      let msg: string | null = null;
      if (crossed.length) {
        const m = Math.max(...crossed);
        msg = isHidden() ? "🎉 New net-worth milestone reached" : `🎉 You just crossed ${fmtCents(m).replace(".00", "")}`;
        s.celebrated.push(...crossed);
      } else if (nw > s.best * 1.005 && s.lastAth !== today) {
        msg = isHidden() ? "🚀 New all-time high" : `🚀 New all-time high: ${fmtCents(nw)}`;
        s.lastAth = today;
      }
      s.best = Math.max(s.best, nw);
      save(s);
      if (msg) {
        setToast(msg);
        if (canvas.current) confetti(canvas.current);
        setTimeout(() => setToast(null), 4500);
      }
    };
    check();
    const t = setInterval(check, 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <canvas ref={canvas} className="fixed inset-0 w-full h-full pointer-events-none z-[95]" aria-hidden />
      {toast && (
        <div className="fixed top-[max(14px,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[96] tab-enter
                        px-4 py-2.5 rounded-full border border-up/40 bg-panel/95 backdrop-blur shadow-xl text-sm font-bold text-txt whitespace-nowrap">
          {toast}
        </div>
      )}
    </>
  );
}
