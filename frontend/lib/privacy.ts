// "Hide balances" mode: masks dollar amounts and holding sizes app-wide.
// Formatting helpers read this flag at render time; toggling it fires an event
// that the page listens for to re-render everything at once.

import { useSyncExternalStore } from "react";

const KEY = "hide-balances";
export const MASK = "$•••••";
let hidden = false;

try { hidden = localStorage.getItem(KEY) === "1"; } catch { /* SSR / private mode */ }

export function isHidden(): boolean {
  return hidden;
}

export function setHidden(v: boolean): void {
  hidden = v;
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private mode */ }
  window.dispatchEvent(new Event("privacy"));
}

const subscribe = (cb: () => void) => {
  window.addEventListener("privacy", cb);
  return () => window.removeEventListener("privacy", cb);
};

/** The flag as React state, so a component re-renders the moment it flips. */
export function usePrivacy(): boolean {
  return useSyncExternalStore(subscribe, () => hidden, () => false);
}

/** Quantity of a holding: hidden too, since shares × price reveals the balance. */
export function fmtQty(n: number, digits = 6): string {
  return hidden ? "•••" : n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** Dollars with cents ($63,971.88), masked when balances are hidden. */
export function fmtCents(n: number): string {
  if (hidden) return MASK;
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "−" : ""}$${s}`;
}
