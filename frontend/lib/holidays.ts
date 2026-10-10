"use client";

// Holiday easter eggs: which day is a holiday, and the per-device on/off switch.
// A convenience only (lives in this browser). Preview any holiday with ?holiday=<key>.

import { useSyncExternalStore } from "react";

export type Motion = "fireworks" | "hearts" | "coins" | "bats" | "leaves" | "snow";

export interface Holiday {
  key: string;
  name: string;
  greeting: string;
  emoji: string;
  motion: Motion;
}

export const HOLIDAYS: Holiday[] = [
  { key: "newyear", name: "New Year's Day", greeting: "Happy New Year", emoji: "🎆", motion: "fireworks" },
  { key: "valentine", name: "Valentine's Day", greeting: "Happy Valentine's Day", emoji: "💘", motion: "hearts" },
  { key: "stpatrick", name: "St. Patrick's Day", greeting: "Happy St. Patrick's Day", emoji: "🍀", motion: "coins" },
  { key: "july4", name: "Independence Day", greeting: "Happy Fourth of July", emoji: "🎇", motion: "fireworks" },
  { key: "halloween", name: "Halloween", greeting: "Happy Halloween", emoji: "🎃", motion: "bats" },
  { key: "thanksgiving", name: "Thanksgiving", greeting: "Happy Thanksgiving", emoji: "🦃", motion: "leaves" },
  { key: "christmas", name: "Christmas", greeting: "Merry Christmas", emoji: "🎄", motion: "snow" },
  { key: "nye", name: "New Year's Eve", greeting: "Last day of the year", emoji: "🥂", motion: "fireworks" },
];

const byKey = (k: string) => HOLIDAYS.find((h) => h.key === k) ?? null;

/** Fourth Thursday of November. */
function thanksgivingDay(year: number) {
  const firstDow = new Date(year, 10, 1).getDay(); // 0 = Sun
  const firstThu = 1 + ((4 - firstDow + 7) % 7);
  return firstThu + 21;
}

/** The holiday on a local calendar date, or null. */
export function holidayOn(d: Date): Holiday | null {
  const m = d.getMonth() + 1, day = d.getDate();
  if (m === 1 && day === 1) return byKey("newyear");
  if (m === 2 && day === 14) return byKey("valentine");
  if (m === 3 && day === 17) return byKey("stpatrick");
  if (m === 7 && day === 4) return byKey("july4");
  if (m === 10 && day === 31) return byKey("halloween");
  if (m === 11 && day === thanksgivingDay(d.getFullYear())) return byKey("thanksgiving");
  if (m === 12 && (day === 24 || day === 25)) return byKey("christmas");
  if (m === 12 && day === 31) return byKey("nye");
  return null;
}

/** ?holiday=<key> forces a preview (and always plays the motion). */
export function previewHoliday(): Holiday | null {
  if (typeof window === "undefined") return null;
  const k = new URLSearchParams(window.location.search).get("holiday");
  return k ? byKey(k) : null;
}

/** Today's holiday (preview wins), ignoring the on/off switch. */
export function currentHoliday(now = new Date()): Holiday | null {
  return previewHoliday() ?? holidayOn(now);
}

export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Per-device switch + "already played today" memory ──
interface FxPrefs { off: boolean; played: string | null }
const KEY = "holiday-fx-v1";
const DEFAULT: FxPrefs = { off: false, played: null };
let fx: FxPrefs = DEFAULT;
let loaded = false;
const subs = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try { fx = { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { /* */ }
}
function save(next: FxPrefs) {
  fx = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  subs.forEach((f) => f());
}

export function useHolidayFx(): FxPrefs {
  load();
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f); }; },
    () => fx,
    () => DEFAULT,
  );
}

export function setHolidayFxOff(off: boolean) { load(); save({ ...fx, off }); }

/** True the first time this holiday's motion is asked for today; records it. */
export function claimPlay(h: Holiday): boolean {
  load();
  const tag = `${h.key}:${localDay()}`;
  if (fx.played === tag) return false;
  save({ ...fx, played: tag });
  return true;
}
