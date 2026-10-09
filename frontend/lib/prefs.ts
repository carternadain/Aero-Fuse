"use client";

// Per-device view preferences: Simple/Pro mode, folded sections, which Home cards show.
// These are conveniences only (they live in this browser), never data.

import { useSyncExternalStore } from "react";

export type Mode = "simple" | "pro";
interface Prefs { mode: Mode; collapsed: string[]; home: Record<string, boolean> }

const KEY = "view-prefs-v1";
const DEFAULT: Prefs = { mode: "simple", collapsed: [], home: {} };

let prefs: Prefs = DEFAULT;
let loaded = false;
const revealed = new Set<string>(); // pro sections opened via search/links this session
const subs = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try { prefs = { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { /* */ }
}
function save(next: Prefs) {
  prefs = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* */ }
  subs.forEach((f) => f());
}

export function usePrefs(): Prefs & { revealed: Set<string> } {
  load();
  const p = useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f); }; },
    () => prefs,
    () => DEFAULT,
  );
  return { ...p, revealed };
}

export function setMode(mode: Mode) { load(); save({ ...prefs, mode }); }
export function getMode(): Mode { load(); return prefs.mode; }

export function toggleCollapsed(id: string) {
  load();
  const c = new Set(prefs.collapsed);
  if (c.has(id)) c.delete(id); else c.add(id);
  save({ ...prefs, collapsed: [...c] });
}

/** Make a section visible and open (used when search or a link jumps to it). */
export function reveal(id: string) {
  load();
  revealed.add(id);
  save({ ...prefs, collapsed: prefs.collapsed.filter((x) => x !== id) });
}

/** Home cards: an explicit on/off from Customize beats the Simple/Pro default. */
export function setHomeCard(id: string, on: boolean | null) {
  load();
  const home = { ...prefs.home };
  if (on === null) delete home[id]; else home[id] = on;
  save({ ...prefs, home });
}
