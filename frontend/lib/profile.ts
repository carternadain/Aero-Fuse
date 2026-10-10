"use client";

// Your age, shared by the FIRE calculator, Money Lab and the tax-advantaged checks.
// The server keeps a birth year (not an age) so it stays right as the years pass,
// and every device sees the same value.

import { useSyncExternalStore } from "react";
import { api } from "./api";

const DEFAULT_BIRTH_YEAR = 1996;
const thisYear = () => new Date().getFullYear();

let age = thisYear() - DEFAULT_BIRTH_YEAR;
let fetched = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();

function emit(next: number) {
  age = next;
  subs.forEach((f) => f());
}

function subscribe(f: () => void) {
  subs.add(f);
  if (!fetched) {
    fetched = true;
    api.get<{ age: number }>("/api/settings").then((r) => emit(r.age)).catch(() => {});
  }
  return () => { subs.delete(f); };
}

export function useAge(): number {
  return useSyncExternalStore(subscribe, () => age, () => age);
}

/** Update your age everywhere now; saved as a birth year once the slider settles. */
export function setAge(next: number) {
  emit(next);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api.put("/api/settings", { birth_year: thisYear() - next }).catch(() => {});
  }, 600);
}
