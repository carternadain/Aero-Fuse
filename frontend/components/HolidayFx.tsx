"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { claimPlay, currentHoliday, previewHoliday, useHolidayFx, type Holiday, type Motion } from "@/lib/holidays";

// Holiday easter egg: a hairline accent while the day lasts, a one-time canvas motion on
// first open, and a greeting pill (tap it to replay). Dependency-free, like Celebrate.

type Ctx = CanvasRenderingContext2D;
interface Scene { dur: number; draw: (c: Ctx, t: number, dt: number) => void }
type Factory = (w: number, h: number, k: number, col: string[]) => Scene;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0];
/** 0→1 over `fade` seconds at the start of a life, 1→0 over `fade` at the end. */
const env = (t: number, life: number, fade: number) => Math.max(0, Math.min(1, t / fade, (life - t) / fade));

function heart(c: Ctx, s: number) {
  c.beginPath();
  c.moveTo(0, s * 0.4);
  c.bezierCurveTo(-s * 0.95, -s * 0.1, -s * 0.45, -s * 0.8, 0, -s * 0.25);
  c.bezierCurveTo(s * 0.45, -s * 0.8, s * 0.95, -s * 0.1, 0, s * 0.4);
  c.closePath();
}

function sparkle(c: Ctx, r: number) {
  c.beginPath();
  c.moveTo(0, -r);
  c.quadraticCurveTo(0, 0, r, 0);
  c.quadraticCurveTo(0, 0, 0, r);
  c.quadraticCurveTo(0, 0, -r, 0);
  c.quadraticCurveTo(0, 0, 0, -r);
  c.closePath();
}

// ── fireworks: staggered rockets with trails that burst into twinkling sparks ──
const fireworks: Factory = (w, h, k, col) => {
  const G = 1100, SPARK_G = 120, KD = 2.2, LIFE = 1.4;
  const R = Math.max(95, Math.min(w * 0.3, 170)); // burst radius in px
  const rockets = Array.from({ length: 6 }, (_, i) => {
    const target = i === 0 ? h * rnd(0.34, 0.42) : rnd(h * 0.16, h * 0.45);
    return {
      at: i * 0.5 + rnd(0, 0.12), x: i === 0 ? rnd(w * 0.35, w * 0.65) : rnd(w * 0.15, w * 0.85), y: h + 10,
      vy: -Math.sqrt(2 * G * (h - target)), vx: rnd(-12, 12), color: col[i % col.length],
      trail: [] as [number, number][], burst: false,
    };
  });
  const sparks: { x: number; y: number; vx: number; vy: number; life: number; age: number; c: string; ph: number; r: number }[] = [];
  const per = Math.round(62 * k);
  return {
    dur: 5,
    draw(c, t, dt) {
      c.globalCompositeOperation = "lighter";
      for (const r of rockets) {
        if (t < r.at || r.burst) continue;
        r.vy += G * dt; r.x += r.vx * dt; r.y += r.vy * dt;
        r.trail.push([r.x, r.y]); if (r.trail.length > 9) r.trail.shift();
        if (r.vy > -40) {
          r.burst = true;
          const second = pick(col);
          const scale = R / ((1 - Math.exp(-KD * LIFE)) / KD);
          for (let i = 0; i < per; i++) {
            const a = (i / per) * Math.PI * 2 + rnd(-0.05, 0.05), sp = scale * rnd(0.62, 1);
            sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(1.2, 1.6), age: 0,
              c: i % 3 === 0 ? second : r.color, ph: rnd(0, 6.28), r: rnd(2, 2.5) });
          }
          continue;
        }
        c.lineCap = "round";
        for (let i = 1; i < r.trail.length; i++) {
          c.strokeStyle = r.color; c.globalAlpha = (i / r.trail.length) * 0.4; c.lineWidth = 1.5;
          c.beginPath(); c.moveTo(r.trail[i - 1][0], r.trail[i - 1][1]); c.lineTo(r.trail[i][0], r.trail[i][1]); c.stroke();
        }
      }
      const drag = Math.exp(-KD * dt);
      c.lineCap = "round";
      for (const s of sparks) {
        s.age += dt; if (s.age > s.life) continue;
        s.vx *= drag; s.vy = s.vy * drag + SPARK_G * dt;
        const px = s.x - s.vx * dt * 2.5, py = s.y - s.vy * dt * 2.5;
        s.x += s.vx * dt; s.y += s.vy * dt;
        const p = s.age / s.life;
        const tw = p > 0.6 ? 0.45 + 0.55 * Math.abs(Math.sin(s.age * 30 + s.ph)) : 1;
        const a = Math.max(0, 1 - p * p) * tw;
        c.fillStyle = s.c; c.strokeStyle = s.c;
        c.globalAlpha = a * 0.12; c.beginPath(); c.arc(s.x, s.y, s.r * 2, 0, 6.283); c.fill();
        c.globalAlpha = a; c.lineWidth = s.r;
        c.beginPath(); c.moveTo(px, py); c.lineTo(s.x, s.y); c.stroke();
      }
      c.globalCompositeOperation = "source-over";
    },
  };
};

// ── hearts: drifting up and swaying, fading near the end of their life ──
const hearts: Factory = (w, h, k, col) => {
  const hs = Array.from({ length: Math.round(32 * k) }, (_, i) => ({
    x: rnd(0, w), y: h + 10, vy: rnd(110, 210), s: rnd(8, 22), delay: i < 6 ? rnd(0, 0.25) : rnd(0.2, 1.4), life: rnd(3, 3.6),
    amp: rnd(10, 28), f: rnd(1, 2.2), ph: rnd(0, 6.28), c: pick(col), a: rnd(0.6, 0.95),
  }));
  return {
    dur: 5,
    draw(c, t) {
      for (const p of hs) {
        const a = t - p.delay; if (a < 0 || a > p.life) continue;
        const x = p.x + Math.sin(a * p.f + p.ph) * p.amp, y = p.y - p.vy * a;
        c.save(); c.translate(x, y); c.rotate(Math.sin(a * p.f + p.ph) * 0.3);
        c.globalAlpha = env(a, p.life, 0.7) * p.a; c.fillStyle = p.c; heart(c, p.s);
        c.fill();
        c.globalAlpha *= 0.5; c.fillStyle = "white"; c.translate(-p.s * 0.28, -p.s * 0.28); c.beginPath(); c.ellipse(0, 0, p.s * 0.1, p.s * 0.06, -0.6, 0, 6.283); c.fill();
        c.restore();
      }
    },
  };
};

// ── coins: spinning gold showering from the top, a small bounce, clover sparkles ──
const coins: Factory = (w, h, k, col) => {
  const cs = Array.from({ length: Math.round(46 * k) }, () => ({
    x: rnd(0, w), y: rnd(-60, -14), vx: rnd(-30, 30), vy: rnd(40, 160), r: rnd(7, 12),
    delay: rnd(0, 1.8), spin: rnd(6, 13), ph: rnd(0, 6.28), bounces: 0, floor: h - rnd(4, 40),
  }));
  const sp = Array.from({ length: Math.round(14 * k) }, () => ({
    x: rnd(0, w), y: rnd(h * 0.1, h * 0.8), r: rnd(4, 9), at: rnd(0.4, 3.2), c: pick([col[0], col[2]]),
  }));
  return {
    dur: 4.6,
    draw(c, t, dt) {
      for (const s of sp) {
        const a = t - s.at; if (a < 0 || a > 1.1) continue;
        c.save(); c.translate(s.x, s.y); c.rotate(a * 1.2);
        c.globalAlpha = Math.sin((a / 1.1) * Math.PI) * 0.9; c.fillStyle = s.c; sparkle(c, s.r * (0.6 + a * 0.4)); c.fill(); c.restore();
      }
      for (const p of cs) {
        const a = t - p.delay; if (a < 0) continue;
        p.vy += 780 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.y > p.floor && p.vy > 0 && p.bounces < 2) { p.y = p.floor; p.vy *= -0.38; p.vx *= 0.7; p.bounces++; }
        const sx = Math.max(0.14, Math.abs(Math.cos(a * p.spin + p.ph)));
        c.save(); c.translate(p.x, p.y); c.scale(sx, 1);
        c.fillStyle = col[1]; c.beginPath(); c.arc(0, 0, p.r, 0, 6.283); c.fill();
        c.strokeStyle = "rgb(0 0 0 / 0.28)"; c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, p.r * 0.68, 0, 6.283); c.stroke();
        c.fillStyle = "white"; c.globalAlpha = 0.55 * sx; c.beginPath(); c.ellipse(-p.r * 0.3, -p.r * 0.35, p.r * 0.22, p.r * 0.1, -0.7, 0, 6.283); c.fill();
        c.restore();
      }
    },
  };
};

// ── bats: flapping silhouettes on arcs, with embers drifting up ──
function bat(c: Ctx, s: number, flap: number) {
  c.beginPath();
  c.ellipse(0, 0, s * 0.11, s * 0.17, 0, 0, 6.283);
  for (const side of [-1, 1]) {
    c.moveTo(0, -s * 0.06);
    c.bezierCurveTo(side * s * 0.3, -s * 0.45 - flap * s * 0.3, side * s * 0.75, -s * 0.45 - flap * s * 0.55, side * s, -flap * s * 0.75);
    c.quadraticCurveTo(side * s * 0.78, -flap * s * 0.2 + s * 0.04, side * s * 0.62, s * 0.1 - flap * s * 0.15);
    c.quadraticCurveTo(side * s * 0.45, -s * 0.02, side * s * 0.3, s * 0.16);
    c.quadraticCurveTo(side * s * 0.14, s * 0.02, 0, s * 0.2);
    c.closePath();
  }
}
const bats: Factory = (w, h, k, col) => {
  const n = w < 500 ? 6 : 8;
  const bs = Array.from({ length: n }, (_, i) => ({
    dir: Math.random() < 0.5 ? 1 : -1, delay: 0.1 + i * 0.35 + rnd(0, 0.3), dur: rnd(2.8, 3.8), y: rnd(h * 0.18, h * 0.55),
    arc: rnd(40, 110), s: rnd(14, 26) * (w < 500 ? 0.85 : 1), f: rnd(11, 16), ph: rnd(0, 6.28),
  }));
  const em = Array.from({ length: Math.round(34 * k) }, () => ({
    x: rnd(0, w), y: h + 6, vy: rnd(45, 120), amp: rnd(6, 20), f: rnd(1, 3), ph: rnd(0, 6.28), r: rnd(1.2, 3), delay: rnd(0, 2.2), life: rnd(2, 3),
  }));
  return {
    dur: 5,
    draw(c, t) {
      c.globalCompositeOperation = "lighter";
      for (const e of em) {
        const a = t - e.delay; if (a < 0 || a > e.life) continue;
        c.globalAlpha = env(a, e.life, 0.6) * (0.55 + 0.45 * Math.sin(a * 9 + e.ph)) * 0.8;
        c.fillStyle = col[0]; c.beginPath(); c.arc(e.x + Math.sin(a * e.f + e.ph) * e.amp, e.y - e.vy * a, e.r, 0, 6.283); c.fill();
      }
      c.globalCompositeOperation = "source-over";
      for (const b of bs) {
        const a = t - b.delay; if (a < 0 || a > b.dur) continue;
        const p = a / b.dur;
        const x = b.dir > 0 ? -50 + (w + 100) * p : w + 50 - (w + 100) * p;
        const y = b.y - Math.sin(p * Math.PI) * b.arc + Math.sin(a * 6 + b.ph) * 8;
        c.save(); c.translate(x, y); c.rotate(Math.sin(a * 6 + b.ph) * 0.12 * b.dir); c.scale(b.dir, 1);
        c.globalAlpha = env(a, b.dur, 0.35);
        bat(c, b.s, Math.sin(a * b.f + b.ph) * 0.75);
        c.fillStyle = col[1]; c.fill();
        c.strokeStyle = col[2]; c.globalAlpha *= 0.45; c.lineWidth = 1; c.stroke();
        c.restore();
      }
    },
  };
};

// ── leaves: tumbling and swaying down ──
const leaves: Factory = (w, h, k, col) => {
  const ls = Array.from({ length: Math.round(42 * k) }, () => ({
    x: rnd(-20, w + 20), vy: rnd(110, 200), delay: rnd(0, 1.8), s: rnd(9, 17), amp: rnd(22, 55), f: rnd(1, 2.2), ph: rnd(0, 6.28),
    rot: rnd(0, 6.28), spin: rnd(-2.2, 2.2), c: pick(col), drift: rnd(-20, 30), flip: rnd(1.5, 3.5),
  }));
  return {
    dur: 5,
    draw(c, t) {
      for (const l of ls) {
        const a = t - l.delay; if (a < 0) continue;
        const x = l.x + l.drift * a + Math.sin(a * l.f + l.ph) * l.amp, y = -24 + l.vy * a;
        if (y > h + 30) continue;
        const s = l.s;
        c.save(); c.translate(x, y); c.rotate(l.rot + l.spin * a * 0.6 + Math.sin(a * l.f + l.ph) * 0.5);
        c.scale(1, 0.55 + 0.45 * Math.abs(Math.cos(a * l.flip + l.ph)));
        c.globalAlpha = Math.min(env(t, 5, 0.9), 1) * 0.92; c.fillStyle = l.c;
        c.beginPath(); c.moveTo(0, -s);
        c.bezierCurveTo(s * 0.95, -s * 0.5, s * 0.7, s * 0.55, 0, s);
        c.bezierCurveTo(-s * 0.7, s * 0.55, -s * 0.95, -s * 0.5, 0, -s);
        c.fill();
        c.strokeStyle = "rgb(0 0 0 / 0.3)"; c.lineWidth = 1; c.beginPath(); c.moveTo(0, -s * 0.85); c.lineTo(0, s * 1.2); c.stroke();
        c.restore();
      }
    },
  };
};

// ── snow: soft flakes with parallax depth and a gentle wind ──
const snow: Factory = (w, h, k, col) => {
  const fs = Array.from({ length: Math.round(120 * k) }, () => {
    const z = Math.random();
    return { x: rnd(-40, w + 40), y: rnd(-30, h * 0.55), r: 1 + z * z * 3.4, vy: 28 + z * 80, amp: rnd(4, 16), f: rnd(0.6, 1.8), ph: rnd(0, 6.28), a: 0.35 + z * 0.55 };
  });
  return {
    dur: 5.6,
    draw(c, t) {
      const wind = 18 + 16 * Math.sin(t * 0.7);
      c.fillStyle = col[2];
      for (const f of fs) {
        const x = f.x + wind * t + Math.sin(t * f.f + f.ph) * f.amp, y = f.y + f.vy * t;
        if (y > h + 10) continue;
        const xx = ((x % (w + 80)) + (w + 80)) % (w + 80) - 40;
        const a = f.a * Math.min(1, t / 0.7);
        c.globalAlpha = a * 0.22; c.beginPath(); c.arc(xx, y, f.r * 2.1, 0, 6.283); c.fill();
        c.globalAlpha = a; c.beginPath(); c.arc(xx, y, f.r, 0, 6.283); c.fill();
      }
    },
  };
};

const FACTORIES: Record<Motion, Factory> = { fireworks, hearts, coins, bats, leaves, snow };
// Leaves/coins/fireworks draw from the tokens in this order: hol-1, hol-2, hol-3.

/** Runs a scene on the canvas; returns a stop() that cancels and clears everything. */
function run(canvas: HTMLCanvasElement, motion: Motion): () => void {
  const c = canvas.getContext("2d");
  if (!c) return () => {};
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const css = getComputedStyle(document.documentElement);
  const col = ["--color-hol-1", "--color-hol-2", "--color-hol-3"].map((v) => css.getPropertyValue(v).trim() || "white");
  const scene = FACTORIES[motion](w, h, w < 500 ? 0.62 : 1, col);
  let raf = 0, last = 0, t = 0, stopped = false;
  const clear = () => { c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, canvas.width, canvas.height); };
  const stop = () => {
    if (stopped) return;
    stopped = true; cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", onVis); clear();
  };
  const onVis = () => { if (document.hidden) stop(); };
  document.addEventListener("visibilitychange", onVis);
  const tick = (now: number) => {
    if (stopped) return;
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
    last = now; t += dt;
    if (t >= scene.dur) { stop(); return; }
    clear(); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalAlpha = 1;
    scene.draw(c, t, dt);
    // global fade-out over the last 0.9s
    const left = scene.dur - t;
    if (left < 0.9) { c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = "destination-out"; c.globalAlpha = 1 - left / 0.9; c.fillStyle = "black"; c.fillRect(0, 0, canvas.width, canvas.height); c.globalCompositeOperation = "source-over"; c.globalAlpha = 1; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return stop;
}

export default function HolidayFx() {
  const { off } = useHolidayFx();
  const canvas = useRef<HTMLCanvasElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const claimed = useRef<string | null>(null); // survives StrictMode's double effect
  const pillTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [hol, setHol] = useState<Holiday | null>(null);
  const [pill, setPill] = useState(false);

  const play = useCallback((h: Holiday, delay = 0) => {
    stopRef.current?.(); stopRef.current = null;
    clearTimeout(pillTimer.current);
    setPill(true);
    pillTimer.current = setTimeout(() => setPill(false), 4000 + delay);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.hidden) return;
    const start = () => { if (canvas.current && !document.hidden) stopRef.current = run(canvas.current, h.motion); };
    let idle = 0;
    const t = setTimeout(() => {
      if ("requestIdleCallback" in window) idle = window.requestIdleCallback(start, { timeout: 600 });
      else start();
    }, delay);
    stopRef.current = () => { clearTimeout(t); if (idle) window.cancelIdleCallback?.(idle); };
  }, []);

  useEffect(() => {
    const preview = !!previewHoliday();
    const h = currentHoliday();
    if (!h || (off && !preview)) { setHol(null); return; }
    document.documentElement.dataset.holiday = h.key;
    setHol(h);
    const tag = `${h.key}:${preview ? "p" : "d"}`;
    if (claimed.current !== tag) claimed.current = preview || claimPlay(h) ? tag : `${tag}:no`;
    if (!claimed.current.endsWith(":no")) play(h, 400);
    return () => {
      delete document.documentElement.dataset.holiday;
      stopRef.current?.(); stopRef.current = null; clearTimeout(pillTimer.current);
    };
  }, [off, play]);

  if (!hol) return null;
  return (
    <>
      <div className="holiday-hairline" aria-hidden />
      <canvas ref={canvas} className="fixed inset-0 w-full h-full pointer-events-none z-[94]" aria-hidden />
      <div aria-live="polite" className="fixed top-[calc(max(12px,env(safe-area-inset-top))+58px)] sm:top-[100px] left-1/2 -translate-x-1/2 z-[96] pointer-events-none">
        {pill && (
          <button
            type="button"
            onClick={() => play(hol)}
            aria-label={`${hol.greeting}. Replay animation`}
            className="holiday-pill tab-enter pointer-events-auto min-h-10 px-4 py-2 rounded-full border bg-panel/95 backdrop-blur shadow-xl
                       text-sm font-bold text-txt whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-hol-1)]"
          >
            {hol.emoji} {hol.greeting}
          </button>
        )}
      </div>
    </>
  );
}
