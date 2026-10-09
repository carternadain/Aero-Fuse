"use client";

// One shared, polled copy of holdings + accounts. Home renders several views of
// the same data (chart, heatmap, donut, cards, list); they all read from here
// instead of each fetching /api/holdings on their own timer.

import { useSyncExternalStore } from "react";
import { api } from "./api";
import type { LiveHolding } from "@/components/AssetDetail";

export interface Account { id: number; name: string; category: string; kind: "asset" | "liability"; balance: number; updated_at: string }
export interface Totals { assets: number; liabilities: number; net_worth: number }
export interface LiveState {
  holdings: LiveHolding[];
  accounts: Account[];
  totals: Totals | null;
  loaded: boolean;
  updatedAt: number;
}

let state: LiveState = { holdings: [], accounts: [], totals: null, loaded: false, updatedAt: 0 };
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;

const POLL = 60_000;

export function refreshLive(): Promise<void> {
  if (inflight) return inflight;
  inflight = Promise.all([
    api.get<{ holdings: LiveHolding[] }>("/api/holdings").catch(() => null),
    api.get<{ accounts: Account[]; totals: Totals }>("/api/accounts").catch(() => null),
  ]).then(([h, a]) => {
    state = {
      holdings: h?.holdings ?? state.holdings,
      accounts: a?.accounts ?? state.accounts,
      totals: a?.totals ?? state.totals,
      loaded: true,
      updatedAt: Date.now(),
    };
    subs.forEach((f) => f());
  }).finally(() => { inflight = null; });
  return inflight;
}

function subscribe(f: () => void) {
  subs.add(f);
  if (!timer) {
    if (Date.now() - state.updatedAt > 5_000) refreshLive();
    timer = setInterval(refreshLive, POLL);
  }
  return () => {
    subs.delete(f);
    if (!subs.size && timer) { clearInterval(timer); timer = null; }
  };
}

const empty = state;
export function useLive(): LiveState {
  return useSyncExternalStore(subscribe, () => state, () => empty);
}

// Account sections, shared by the list, the donut and the cards.
export type Section = "retirement" | "investing" | "crypto" | "cash" | "debt";

export function sectionForLabel(label: string): Section {
  if (/roth|ira|401|403|retire/i.test(label)) return "retirement";
  if (/crypto|coinbase|toobit|kraken|binance/i.test(label)) return "crypto";
  return "investing";
}

export function sectionForAccount(a: Account): Section {
  if (a.kind === "liability") return "debt";
  return a.category === "retirement" ? "retirement" : a.category === "crypto" ? "crypto"
    : a.category === "cash" ? "cash" : "investing";
}

export const accountAnchor = (name: string) => `acct-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
