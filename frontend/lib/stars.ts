"use client";

// Starred tickers: one shared list so every ☆ button and the watchlist stay in sync.

import { useSyncExternalStore } from "react";
import { api } from "./api";
import type { Kind } from "./bus";

export interface StarItem {
  symbol: string;
  kind: Kind;
  added_at: string;
  added_price: number | null;
  price: number | null;
  change_1d: number | null;
  since_pct: number | null;
  name: string | null;
  sector: string | null;
  spark: number[];
}

let items: StarItem[] = [];
let loaded = false;
let started = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

export async function refreshStars() {
  try {
    items = (await api.get<{ items: StarItem[] }>("/api/starred")).items;
    loaded = true;
    notify();
  } catch { /* offline */ }
}

function subscribe(f: () => void) {
  subs.add(f);
  if (!started) {
    started = true;
    refreshStars();
    setInterval(() => { if (subs.size) refreshStars(); }, 60_000);
  }
  return () => { subs.delete(f); };
}

let snap = { items, loaded };
function getSnap() {
  if (snap.items !== items || snap.loaded !== loaded) snap = { items, loaded };
  return snap;
}
const server = { items: [] as StarItem[], loaded: false };

export function useStars() {
  return useSyncExternalStore(subscribe, getSnap, () => server);
}

export function isStarred(symbol: string, kind?: Kind) {
  return items.some((i) => i.symbol === symbol.toUpperCase() && (!kind || i.kind === kind));
}

export async function toggleStar(symbol: string, kind?: Kind): Promise<boolean> {
  const sym = symbol.toUpperCase();
  const existing = items.find((i) => i.symbol === sym && (!kind || i.kind === kind));
  if (existing) {
    items = items.filter((i) => i !== existing);
    notify();
    await api.del(`/api/starred/${existing.kind}/${encodeURIComponent(sym)}`).catch(() => {});
    return false;
  }
  // optimistic placeholder until the server returns the priced row
  items = [...items, { symbol: sym, kind: kind ?? "stock", added_at: new Date().toISOString(), added_price: null,
                       price: null, change_1d: null, since_pct: null, name: null, sector: null, spark: [] }];
  notify();
  try {
    items = (await api.post<{ items: StarItem[] }>("/api/starred", { symbol: sym, kind })).items;
    notify();
  } catch { await refreshStars(); }
  return true;
}
