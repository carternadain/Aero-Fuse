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
        c.globalAlpha = a * 0.1; c.beginPath(); c.arc(xx, y, f.r * 1.6, 0, 6.283); c.fill();
        c.globalAlpha = a; c.beginPath(); c.arc(xx, y, f.r, 0, 6.283); c.fill();
      }
    },
  };
};

// ── shared shapes (intro scenes and ambient layer) ──
function leaf(c: Ctx, s: number) {
  c.beginPath(); c.moveTo(0, -s);
  c.bezierCurveTo(s * 0.95, -s * 0.5, s * 0.7, s * 0.55, 0, s);
  c.bezierCurveTo(-s * 0.7, s * 0.55, -s * 0.95, -s * 0.5, 0, -s);
}
/** One notched cherry-blossom petal, pointing down. */
function petal(c: Ctx, s: number) {
  c.beginPath(); c.moveTo(0, s);
  c.bezierCurveTo(s * 0.85, s * 0.3, s * 0.65, -s * 0.95, s * 0.1, -s * 0.7);
  c.lineTo(0, -s * 0.55); c.lineTo(-s * 0.1, -s * 0.7);
  c.bezierCurveTo(-s * 0.65, -s * 0.95, -s * 0.85, s * 0.3, 0, s);
}
/** Five-petal blossom with a small centre. `ctr` is the centre colour. */
function blossom(c: Ctx, s: number, ctr: string) {
  for (let i = 0; i < 5; i++) {
    c.save(); c.rotate(i * 1.2566); c.translate(0, -s * 0.5); c.rotate(Math.PI); petal(c, s * 0.52); c.fill(); c.restore();
  }
  c.fillStyle = ctr; c.beginPath(); c.arc(0, 0, s * 0.16, 0, 6.283); c.fill();
}
function eggPath(c: Ctx, s: number) {
  c.beginPath(); c.moveTo(0, -s * 1.1);
  c.bezierCurveTo(s * 0.8, -s * 1.1, s * 0.98, s * 0.85, 0, s * 0.95);
  c.bezierCurveTo(-s * 0.98, s * 0.85, -s * 0.8, -s * 1.1, 0, -s * 1.1);
}
function flake(c: Ctx, x: number, y: number, r: number) { c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill(); }

// ── blossoms: pastel petals and blossoms twirling down, a few eggs tumbling in ──
const blossoms: Factory = (w, h, k, col) => {
  const ps = Array.from({ length: Math.round(38 * k) }, () => ({
    x: rnd(-20, w + 20), vy: rnd(100, 180), delay: rnd(0, 1.6), s: rnd(7, 15), amp: rnd(20, 50), f: rnd(1, 2), ph: rnd(0, 6.28),
    rot: rnd(0, 6.28), spin: rnd(-2.4, 2.4), c: pick(col), drift: rnd(-15, 25), flip: rnd(1.5, 3.5), whole: Math.random() < 0.35,
  }));
  const es = Array.from({ length: w < 500 ? 4 : 6 }, (_, i) => ({
    x: rnd(w * 0.08, w * 0.92), y: -30, vx: rnd(-26, 26), vy: rnd(10, 60), s: rnd(11, 16), delay: 0.2 + i * 0.35 + rnd(0, 0.3),
    rot: rnd(-0.6, 0.6), spin: rnd(-3, 3), c: col[i % col.length], band: i % 2, bounces: 0, floor: h - rnd(14, 70),
  }));
  return {
    dur: 4.8,
    draw(c, t, dt) {
      for (const p of ps) {
        const a = t - p.delay; if (a < 0) continue;
        const y = -24 + p.vy * a; if (y > h + 30) continue;
        const x = p.x + p.drift * a + Math.sin(a * p.f + p.ph) * p.amp;
        c.save(); c.translate(x, y); c.rotate(p.rot + p.spin * a * 0.7 + Math.sin(a * p.f + p.ph) * 0.5);
        c.scale(1, 0.5 + 0.5 * Math.abs(Math.cos(a * p.flip + p.ph)));
        c.globalAlpha = Math.min(env(t, 4.8, 0.8), 1) * 0.92; c.fillStyle = p.c;
        if (p.whole) blossom(c, p.s * 1.3, col[2]); else { petal(c, p.s); c.fill(); }
        c.restore();
      }
      for (const e of es) {
        const a = t - e.delay; if (a < 0) continue;
        e.vy += 520 * dt; e.x += e.vx * dt; e.y += e.vy * dt;
        if (e.y > e.floor && e.vy > 0 && e.bounces < 2) { e.y = e.floor; e.vy *= -0.35; e.vx *= 0.6; e.spin *= 0.4; e.bounces++; }
        e.rot += e.spin * dt; if (e.bounces >= 2) e.spin *= 0.94;
        c.save(); c.translate(e.x, e.y); c.rotate(e.rot); c.globalAlpha = Math.min(env(t, 4.8, 0.8), 1) * 0.95;
        c.fillStyle = e.c; eggPath(c, e.s); c.fill(); c.clip();
        c.strokeStyle = "rgb(255 255 255 / 0.7)"; c.lineWidth = e.s * 0.2; c.lineJoin = "round";
        if (e.band) {
          c.beginPath(); c.moveTo(-e.s, 0);
          for (let i = 0; i < 6; i++) c.lineTo(-e.s + (i + 1) * (e.s / 3), i % 2 ? e.s * 0.1 : -e.s * 0.28);
          c.stroke();
        } else {
          c.fillStyle = "rgb(255 255 255 / 0.7)";
          for (let i = -1; i <= 1; i++) { c.beginPath(); c.arc(i * e.s * 0.5, -e.s * 0.1 + Math.abs(i) * e.s * 0.15, e.s * 0.14, 0, 6.283); c.fill(); }
        }
        c.restore();
      }
    },
  };
};

const FACTORIES: Record<Motion, Factory> = { fireworks, hearts, coins, bats, leaves, snow, blossoms };
// Leaves/coins/fireworks draw from the tokens in this order: hol-1, hol-2, hol-3.

const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const tokenColors = () => {
  const css = getComputedStyle(document.documentElement);
  return ["--color-hol-1", "--color-hol-2", "--color-hol-3"].map((v) => css.getPropertyValue(v).trim() || "white");
};

/** Runs an intro scene on the canvas; returns a stop() that cancels and clears everything.
 *  `onEnd` fires when the scene finishes (or the tab is hidden), not on an explicit stop(). */
function run(canvas: HTMLCanvasElement, motion: Motion, onEnd?: () => void): () => void {
  const c = canvas.getContext("2d");
  if (!c) return () => {};
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const scene = FACTORIES[motion](w, h, w < 500 ? 0.62 : 1, tokenColors());
  let raf = 0, last = 0, t = 0, stopped = false;
  const clear = () => { c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, canvas.width, canvas.height); };
  const stop = () => {
    if (stopped) return;
    stopped = true; cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", onVis); clear();
  };
  const finish = () => { if (stopped) return; stop(); onEnd?.(); };
  const onVis = () => { if (document.hidden) finish(); };
  document.addEventListener("visibilitychange", onVis);
  const tick = (now: number) => {
    if (stopped) return;
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
    last = now; t += dt;
    if (t >= scene.dur) { finish(); return; }
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

// ── ambient layer: a LIGHT, continuous version of the all-day motion ──
// One fixed pool of particle objects, mutated in place (no per-frame allocation), 30fps,
// DPR <= 1.5, no shadowBlur, and no loop at all while the tab is hidden.
interface P { x: number; y: number; bx: number; vx: number; vy: number; s: number; ph: number; f: number; amp: number; rot: number; spin: number; fl: number; a: number; ci: number; k: number; wait: number; t: number; dur: number; dir: number }
const mkP = (): P => ({ x: 0, y: 0, bx: 0, vx: 0, vy: 0, s: 1, ph: 0, f: 1, amp: 0, rot: 0, spin: 0, fl: 1, a: 1, ci: 0, k: 0, wait: 0, t: 0, dur: 1, dir: 1 });

function ambientCount(kind: Motion, w: number): number {
  const phone = w < 500;
  switch (kind) {
    case "snow": return phone ? 34 : 55;
    case "leaves": return phone ? 5 : 8;
    case "blossoms": return phone ? 6 : 10;
    case "bats": return 1 + (phone ? 12 : 18); // index 0 is the bat, the rest embers
    default: return 0;
  }
}

function spawn(p: P, kind: Motion, i: number, w: number, h: number, first: boolean) {
  p.ph = rnd(0, 6.28); p.f = rnd(0.5, 1.2); p.t = 0; p.wait = 0; p.ci = (Math.random() * 3) | 0;
  switch (kind) {
    case "snow":
      p.bx = rnd(-10, w + 10); p.y = first ? rnd(0, h) : -6; p.vy = rnd(15, 40); p.s = rnd(1.2, 3.2); p.a = rnd(0.45, 0.9); p.amp = rnd(3, 10);
      break;
    case "leaves":
      p.bx = rnd(0, w); p.vx = rnd(-6, 14); p.vy = rnd(22, 42); p.s = rnd(8, 13); p.amp = rnd(14, 32); p.f = rnd(0.7, 1.4);
      p.rot = rnd(0, 6.28); p.spin = rnd(-1.2, 1.2); p.fl = rnd(1.2, 2.6); p.a = 0.85;
      if (first && i % 2 === 0) p.y = rnd(0, h); else { p.y = -30; p.wait = first ? rnd(0, 5) : rnd(1, 7); }
      break;
    case "blossoms":
      p.bx = rnd(0, w); p.vx = rnd(-4, 10); p.vy = rnd(16, 32); p.s = rnd(4, 8); p.amp = rnd(10, 24); p.f = rnd(0.7, 1.5);
      p.rot = rnd(0, 6.28); p.spin = rnd(-1.4, 1.4); p.fl = rnd(1.5, 3); p.a = rnd(0.55, 0.85); p.k = Math.random() < 0.45 ? 1 : 0;
      p.y = first ? rnd(0, h) : -14;
      break;
    case "bats":
      if (i === 0) { // the bat: waits, crosses once, waits again
        p.k = 3; p.wait = first ? rnd(2, 4) : rnd(8, 14); p.dur = rnd(6, 9); p.dir = Math.random() < 0.5 ? 1 : -1;
        p.y = rnd(h * 0.15, h * 0.5); p.s = rnd(12, 18); p.amp = rnd(30, 70); p.fl = rnd(9, 13);
      } else { // embers
        p.k = 4; p.bx = rnd(0, w); p.y = first ? rnd(0, h) : h + 4; p.vy = rnd(12, 30); p.s = rnd(1.5, 2.5); p.amp = rnd(4, 12); p.a = rnd(0.35, 0.7); p.f = rnd(0.8, 2);
      }
      break;
  }
}

function runAmbient(canvas: HTMLCanvasElement, kind: Motion): () => void {
  const c = canvas.getContext("2d");
  if (!c) return () => {};
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let w = window.innerWidth, h = window.innerHeight;
  const size = () => {
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  const col = tokenColors();
  const n = ambientCount(kind, w);
  const ps: P[] = Array.from({ length: n }, mkP);
  ps.forEach((p, i) => spawn(p, kind, i, w, h, true));
  let raf = 0, last = 0, t = 0, stopped = false;

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (last && now - last < 28) return; // ~30fps
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 30;
    last = now; t += dt;
    const fade = Math.min(1, t / 1.5);
    c.clearRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      const p = ps[i];
      if (p.wait > 0) { p.wait -= dt; if (p.wait > 0) continue; }
      switch (kind) {
        case "snow": {
          p.y += p.vy * dt; if (p.y > h + 4) spawn(p, kind, i, w, h, false);
          c.globalAlpha = p.a * fade; c.fillStyle = col[2];
          flake(c, p.bx + Math.sin(t * p.f + p.ph) * p.amp, p.y, p.s);
          break;
        }
        case "leaves": {
          p.y += p.vy * dt; p.bx += p.vx * dt; p.rot += p.spin * dt;
          if (p.y > h + 30) { spawn(p, kind, i, w, h, false); continue; }
          c.save(); c.translate(p.bx + Math.sin(t * p.f + p.ph) * p.amp, p.y); c.rotate(p.rot + Math.sin(t * p.f + p.ph) * 0.5);
          c.scale(1, 0.55 + 0.45 * Math.abs(Math.cos(t * p.fl + p.ph)));
          c.globalAlpha = p.a * fade; c.fillStyle = col[p.ci]; leaf(c, p.s); c.fill(); c.restore();
          break;
        }
        case "blossoms": {
          p.y += p.vy * dt; p.bx += p.vx * dt; p.rot += p.spin * dt;
          if (p.y > h + 16) { spawn(p, kind, i, w, h, false); continue; }
          c.save(); c.translate(p.bx + Math.sin(t * p.f + p.ph) * p.amp, p.y); c.rotate(p.rot);
          c.scale(1, 0.5 + 0.5 * Math.abs(Math.cos(t * p.fl + p.ph)));
          c.globalAlpha = p.a * fade; c.fillStyle = col[p.ci];
          if (p.k) blossom(c, p.s * 1.4, col[2]); else { petal(c, p.s); c.fill(); }
          c.restore();
          break;
        }
        case "bats": {
          if (p.k === 3) {
            p.t += dt; const q = p.t / p.dur;
            if (q >= 1) { spawn(p, kind, i, w, h, false); continue; }
            const x = p.dir > 0 ? -40 + (w + 80) * q : w + 40 - (w + 80) * q;
            c.save(); c.translate(x, p.y - Math.sin(q * Math.PI) * p.amp + Math.sin(p.t * 5) * 6); c.scale(p.dir, 1);
            c.globalAlpha = Math.min(1, q * 8, (1 - q) * 8) * 0.8 * fade;
            bat(c, p.s, Math.sin(p.t * p.fl) * 0.75); c.fillStyle = col[1]; c.fill();
            c.restore();
          } else {
            p.y -= p.vy * dt; if (p.y < -4) spawn(p, kind, i, w, h, false);
            const ex = p.bx + Math.sin(t * p.f + p.ph) * p.amp, ea = p.a * (0.6 + 0.4 * Math.sin(t * 4 + p.ph)) * fade;
            c.fillStyle = col[0];
            c.globalAlpha = ea * 0.22; flake(c, ex, p.y, p.s * 2.4); // soft glow, no shadowBlur
            c.globalAlpha = ea; flake(c, ex, p.y, p.s);
          }
          break;
        }
      }
    }
    c.globalAlpha = 1;
  };

  const onVis = () => {
    if (stopped) return;
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf) { last = 0; raf = requestAnimationFrame(tick); }
  };
  const onResize = () => size();
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("resize", onResize);
  if (!document.hidden) raf = requestAnimationFrame(tick);
  return () => {
    if (stopped) return;
    stopped = true; cancelAnimationFrame(raf);
    document.removeEventListener("visibilitychange", onVis); window.removeEventListener("resize", onResize);
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, canvas.width, canvas.height);
  };
}

const SUB: Record<string, string> = {
  snow: "Snow all day · tap to replay", leaves: "Falling leaves all day · tap to replay",
  blossoms: "Blossoms all day · tap to replay", bats: "Spooky all day · tap to replay",
};

export default function HolidayFx() {
  const { off } = useHolidayFx();
  const canvas = useRef<HTMLCanvasElement>(null);
  const ambCanvas = useRef<HTMLCanvasElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const ambRef = useRef<(() => void) | null>(null);
  const claimed = useRef<string | null>(null); // survives StrictMode's double effect
  const cardTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [hol, setHol] = useState<Holiday | null>(null);
  const [card, setCard] = useState<0 | 1 | 2>(0); // hidden / in / out

  const stopAmbient = useCallback(() => { ambRef.current?.(); ambRef.current = null; }, []);
  const startAmbient = useCallback((h: Holiday) => {
    stopAmbient();
    if (!h.allDay || reducedMotion()) return;
    const kind = h.allDay.ambient;
    const t = setTimeout(() => { if (ambCanvas.current) ambRef.current = runAmbient(ambCanvas.current, kind); }, 50);
    ambRef.current = () => clearTimeout(t);
  }, [stopAmbient]);

  const play = useCallback((h: Holiday, delay = 0) => {
    stopRef.current?.(); stopRef.current = null;
    stopAmbient();
    cardTimers.current.forEach(clearTimeout);
    setCard(1);
    cardTimers.current = [setTimeout(() => setCard(2), 4800 + delay), setTimeout(() => setCard(0), 5150 + delay)];
    if (reducedMotion() || document.hidden) return;
    const start = () => {
      if (canvas.current && !document.hidden) stopRef.current = run(canvas.current, h.motion, () => startAmbient(h));
    };
    let idle = 0;
    const t = setTimeout(() => {
      if ("requestIdleCallback" in window) idle = window.requestIdleCallback(start, { timeout: 600 });
      else start();
    }, delay);
    stopRef.current = () => { clearTimeout(t); if (idle) window.cancelIdleCallback?.(idle); };
  }, [startAmbient, stopAmbient]);

  useEffect(() => {
    const preview = !!previewHoliday();
    const h = currentHoliday();
    if (!h || (off && !preview)) { setHol(null); return; }
    document.documentElement.dataset.holiday = h.key;
    if (h.allDay) document.documentElement.dataset.holidayDecor = h.allDay.decor;
    setHol(h);
    const tag = `${h.key}:${preview ? "p" : "d"}`;
    if (claimed.current !== tag) claimed.current = preview || claimPlay(h) ? tag : `${tag}:no`;
    if (!claimed.current.endsWith(":no")) play(h, 400);
    else startAmbient(h); // intro already played today: straight to the ambient layer
    return () => {
      delete document.documentElement.dataset.holiday;
      delete document.documentElement.dataset.holidayDecor;
      stopRef.current?.(); stopRef.current = null; stopAmbient();
      cardTimers.current.forEach(clearTimeout);
    };
  }, [off, play, startAmbient, stopAmbient]);

  if (!hol) return null;
  return (
    <>
      <div className="holiday-hairline" aria-hidden />
      {/* z-20: above page cards, below the sticky header / tab bars (z-30/40), sheets and dialogs. */}
      {hol.allDay && <canvas ref={ambCanvas} className="fixed inset-0 w-full h-full pointer-events-none z-20" aria-hidden />}
      <canvas ref={canvas} className="fixed inset-0 w-full h-full pointer-events-none z-[94]" aria-hidden />
      <div aria-live="polite" className="fixed top-[calc(max(12px,env(safe-area-inset-top))+58px)] sm:top-[100px] left-1/2 -translate-x-1/2 z-[96] pointer-events-none max-w-[calc(100vw-32px)]">
        {card > 0 && (
          <button
            type="button"
            data-state={card === 1 ? "in" : "out"}
            onClick={() => play(hol)}
            aria-label={`${hol.greeting}. Replay animation`}
            className="holiday-card pointer-events-auto relative flex items-center gap-3 min-h-11 pl-2.5 pr-4 py-2 rounded-2xl bg-panel/90 backdrop-blur shadow-xl
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-hol-1)]"
          >
            <span className="holiday-badge flex items-center justify-center size-9 shrink-0 rounded-full text-lg leading-none" aria-hidden>{hol.emoji}</span>
            <span className="flex flex-col items-start text-left min-w-0">
              <span className="text-sm font-bold text-txt leading-tight truncate max-w-full">{hol.greeting}</span>
              <span className="text-[11px] text-dim leading-tight whitespace-nowrap">{hol.allDay ? SUB[hol.allDay.ambient] : "Tap to replay"}</span>
            </span>
          </button>
        )}
      </div>
    </>
  );
}
