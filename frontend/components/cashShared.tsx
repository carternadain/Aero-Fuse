"use client";

// Shared bits for the Cash page: payload types (see the API contract), money and schedule
// formatting, and the small form controls its sheets use.

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { haptic } from "@/lib/bus";
import { errorText } from "@/lib/categories";
import { isHidden, MASK } from "@/lib/privacy";

export type ItemType = "income" | "bill" | "debt" | "save" | "invest";
export type Frequency = "weekly" | "biweekly" | "semimonthly" | "monthly" | "every_n_months" | "once";

export interface CashAccount {
  id: number; name: string; category: string; kind: "asset" | "liability" | string; balance: number; rate: number | null;
}
export interface CashItem {
  id: number; name: string; type: ItemType; amount: number; frequency: Frequency; interval: number | null;
  day: number | null; day2: number | null; start_date: string; end_date: string | null;
  category: string | null; account_id: number | null; varies: boolean | number; paused: boolean | number;
  note: string | null; monthly: number; next_date: string | null;
  account_name: string | null; account_balance: number | null;
  payoff: { months: number; date: string } | null;
}
export interface ToInvest { account_id: number; name: string; balance: number; last_deposit: string | null; snoozed: boolean }
export interface Upcoming { date: string; item_id: number; name: string; type: ItemType; amount: number; signed: number }
export interface RecentRow {
  id: number | string; date: string; kind: string; name: string; amount: number; signed: number;
  move_id: number | null; tx_id: number | null; symbol: string | null; qty: number | null;
}
export interface AutoRule { rule_id: number; symbol: string; amount: number; frequency: string; monthly: number; cash_account_id: number }
export interface CashPayload {
  setup: { account_id: number | null; since: string | null };
  cash: { id: number; name: string; balance: number } | null;
  accounts: CashAccount[];
  to_invest: ToInvest[];
  upcoming: Upcoming[];
  month: { income: number; bills: number; debt: number; save: number; invest: number; autoinvest: number; spending: number; left: number };
  month_end: number | null;
  items: CashItem[];
  autoinvest: AutoRule[];
  recent: RecentRow[];
}

// ── formatting ──

/** $1,575 or $12.40; minus sign is a real minus. Masked when balances are hidden. */
export function money(n: number, opts: { cents?: boolean } = {}): string {
  if (isHidden()) return MASK;
  const whole = !opts.cents && Math.abs(n - Math.round(n)) < 0.005;
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  return `${n < 0 ? "−" : ""}$${s}`;
}
export const signedMoney = (n: number) => (isHidden() ? MASK : `${n > 0 ? "+" : ""}${money(n)}`);

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const weekdayLong = (i: number) => WEEKDAYS[i] ?? "Monday";
export const weekdayShort = (i: number) => (WEEKDAYS[i] ?? "Mon").slice(0, 3);

export const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
};
export const parseDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);
/** JS getDay (Sun=0) -> Mon=0 */
export const weekdayIdx = (iso: string) => (parseDay(iso).getDay() + 6) % 7;
/** "Thu, Oct 15" */
export const upcomingDate = (iso: string) =>
  parseDay(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export function scheduleText(it: Pick<CashItem, "frequency" | "day" | "day2" | "interval" | "start_date">): string {
  const day = it.day ?? 1;
  switch (it.frequency) {
    case "weekly": return `Weekly on ${weekdayShort(day)}`;
    case "biweekly": return `Every other ${weekdayLong(day)}`;
    case "semimonthly": return `${ordinal(day)} and ${ordinal(it.day2 ?? 15)}`;
    case "monthly": return `Monthly on the ${ordinal(day)}`;
    case "every_n_months": return (it.interval ?? 1) <= 1 ? `Monthly on the ${ordinal(day)}` : `Every ${it.interval} months`;
    case "once": return `Once, ${parseDay(it.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }
}

export const apiError = (e: unknown) => errorText(e, "Couldn't save that. Check your connection and try again.");

// ── controls ──

export function Seg<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="seg flex rounded-[10px] border border-edge2 bg-bg p-0.5">
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v}
                onClick={() => { if (value !== v) haptic(); onChange(v); }}
                className={`flex-1 min-h-10 px-1 rounded-lg text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-cyan ${
                  value === v ? "bg-panel2 text-txt shadow-sm" : "text-dim hover:text-txt"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ label, sub, checked, onChange }: { label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => { haptic(); onChange(!checked); }}
            className="w-full min-h-12 flex items-center gap-3 text-left rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan">
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] text-txt">{label}</span>
        {sub && <span className="block text-[12px] text-dim leading-snug">{sub}</span>}
      </span>
      <span aria-hidden className={`relative w-[46px] h-7 rounded-full shrink-0 transition-colors ${checked ? "bg-up" : "bg-edge2"}`}>
        <span className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-txt shadow transition-transform motion-reduce:transition-none ${checked ? "translate-x-[18px]" : ""}`} />
      </span>
    </button>
  );
}

export function FieldError({ id, msg }: { id?: string; msg?: string | null }) {
  return msg ? <p id={id} role="alert" className="text-[13px] leading-snug text-down">{msg}</p> : null;
}

/** Bottom sheet on phones, centered card on desktop. */
export function Sheet({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const id = useRef(`sheet-${Math.random().toString(36).slice(2, 8)}`).current;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, []);
  return (
    <div className="fixed inset-0 z-[85] bg-black/60 flex items-end sm:items-center justify-center"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={id}
           className={`bg-panel w-full ${wide ? "sm:max-w-lg" : "sm:max-w-md"} max-h-[92dvh] rounded-t-2xl sm:rounded-2xl border border-edge overflow-y-auto overscroll-contain
                       pb-[max(16px,env(safe-area-inset-bottom))] tab-enter`}>
        <div className="sticky top-0 z-10 bg-panel/95 backdrop-blur flex items-center px-4 pt-3 pb-2">
          <h2 id={id} className="flex-1 text-[17px] font-bold text-txt">{title}</h2>
          <button type="button" className="size-10 -mr-2 flex items-center justify-center rounded-full text-dim hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-cyan"
                  onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
