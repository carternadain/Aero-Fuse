"use client";

// Per-device view preferences: Simple/Pro mode, which Home cards and Invest/News panels show.
// These are conveniences only (they live in this browser), never data.

import { useSyncExternalStore } from "react";

export type Mode = "simple" | "pro";
interface Prefs {
  mode: Mode;
  collapsed: string[]; // legacy: sections used to fold; kept so old saved prefs still parse
  home: Record<string, boolean>;
  panels: Record<string, boolean>; // explicit on/off for Invest/News panels (beats the Simple/Pro default)
  botTools: boolean;
}

const KEY = "view-prefs-v1";
const DEFAULT: Prefs = { mode: "simple", collapsed: [], home: {}, panels: {}, botTools: false };

let prefs: Prefs = DEFAULT;
let loaded = false;
const revealed = new Set<string>(); // pro sections opened via search/links this session
let lastRevealed: string | null = null; // most recent reveal() id, so grouped panes can switch to it
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

/** Trading-bot tools (the Bot tab) are off unless switched on. */
export function setBotTools(on: boolean) { load(); save({ ...prefs, botTools: on }); }
export function getBotTools(): boolean { load(); return prefs.botTools; }

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
  lastRevealed = id;
  save({ ...prefs, collapsed: prefs.collapsed.filter((x) => x !== id) });
}

export function getLastRevealed() { return lastRevealed; }

/** Home cards: an explicit on/off from Customize beats the Simple/Pro default. */
export function setHomeCard(id: string, on: boolean | null) {
  load();
  const home = { ...prefs.home };
  if (on === null) delete home[id]; else home[id] = on;
  save({ ...prefs, home });
}

/** Invest/News panels: an explicit on/off from Settings beats the Simple/Pro default. */
export function setPanel(id: string, on: boolean | null) {
  load();
  const panels = { ...prefs.panels };
  if (on === null) delete panels[id]; else panels[id] = on;
  save({ ...prefs, panels });
}

/**
 * Should a panel/section show? Settings' explicit choice first, then the Simple/Pro default
 * (`pro` items are hidden in Simple). Search and links always reveal it for the session.
 */
export function isShown(id: string, pro: boolean, p: Prefs & { revealed: Set<string> }): boolean {
  if (p.revealed.has(id)) return true;
  if (id in (p.panels ?? {})) return p.panels[id];
  return !(pro && p.mode === "simple");
}
