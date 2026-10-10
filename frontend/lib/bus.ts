// Tiny app-wide event bus, so any component can jump somewhere, open a ticker,
// or pop a toast without threading callbacks through the whole tree.

export type Kind = "crypto" | "stock";
export interface NavTarget { tab: string; sub?: string; anchor?: string }
export interface TickerTarget { symbol: string; kind?: Kind; cgId?: string }

function emit<T>(name: string, detail: T) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on<T>(name: string, fn: (d: T) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<T>).detail);
  window.addEventListener(name, h);
  return () => window.removeEventListener(name, h);
}

/** Switch tab (and Markets sub-tab), then scroll to an element id if given. */
export const navigate = (t: NavTarget) => emit("app:nav", t);
/** Open the ticker sheet: live chart, why-it's-listed, star and alert. */
export const openTicker = (t: TickerTarget) => emit("app:ticker", t);
export const toast = (msg: string) => emit("app:toast", msg);
export const openSearch = () => emit("app:search", null);
export const openAlerts = (prefill?: { symbol: string; kind?: Kind; price?: number }) => emit("app:alerts", prefill ?? null);
export const openReport = (month?: string) => emit("app:report", month ?? null);

/** Transactions were added, removed, re-filed or imported: panels built on them should reload. */
export const budgetChanged = () => emit("app:budget", null);
export const onBudgetChanged = (fn: () => void) => on<null>("app:budget", fn);

/** Light tap on Android (iOS Safari doesn't expose vibration). */
export function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
}

export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  // Panels above it may still be loading and changing height, which can cut a smooth
  // scroll short; land it for sure once things settle.
  setTimeout(() => {
    const top = el.getBoundingClientRect().top;
    if (top > 140 || top < 0) el.scrollIntoView({ block: "start" });
  }, 900);
  return true;
}
