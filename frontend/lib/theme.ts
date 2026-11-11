"use client";

// Appearance: Dark (default), Light, or Match device. Like the gain/loss palette this is a
// per-browser convenience stored in localStorage; the inline script in app/layout.tsx applies
// it before first paint and follows the device when set to "auto".

export type ThemePref = "dark" | "light" | "auto";
const KEY = "theme";
const BG = { dark: "#221f1a", light: "#f5f1e9" } as const; // keep in step with --color-bg

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "auto") return v;
  } catch { /* private mode */ }
  return "dark";
}

function resolve(pref: ThemePref): "dark" | "light" {
  if (pref !== "auto") return pref;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function paint(pref: ThemePref) {
  const el = document.documentElement;
  const t = resolve(pref);
  el.dataset.theme = t;
  el.dataset.themePref = pref;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BG[t]);
  window.dispatchEvent(new Event("themechange")); // canvases redraw with the new tokens
}

export function setThemePref(pref: ThemePref) {
  try { localStorage.setItem(KEY, pref); } catch { /* private mode */ }
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!still && doc.startViewTransition) doc.startViewTransition(() => paint(pref));
  else paint(pref);
}
