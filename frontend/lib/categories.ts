// Budget categories shared by the budget tracker and the statement importer.
// Keep in sync with EXPENSE_CATEGORIES in backend/importer.py.

export const EXPENSE_CATS = ["rent", "food", "transport", "subscriptions", "fun", "trading_fees", "health", "shopping", "other"];
export const ALL_CATS = [...EXPENSE_CATS, "income"];

/** "trading_fees" -> "Trading fees" (sentence case, like every other label in the app). */
export const catLabel = (c: string) => {
  const s = c.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const kindFor = (category: string): "income" | "expense" => (category === "income" ? "income" : "expense");

// ── Months and local dates (YYYY-MM / YYYY-MM-DD, always the browser's own day) ──

const pad = (n: number) => String(n).padStart(2, "0");
export const ymOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const curMonth = () => ymOf(new Date());
export const localToday = () => {
  const d = new Date();
  return `${ymOf(d)}-${pad(d.getDate())}`;
};

export function monthShift(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return ymOf(new Date(y, m - 1 + delta, 1));
}

/** "Oct 2026"; with `long`, "October 2026"; with `bare`, "Oct" (or "October"). */
export function monthLabel(month: string, opts: { long?: boolean; bare?: boolean } = {}): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: opts.long ? "long" : "short", ...(opts.bare ? {} : { year: "numeric" }),
  });
}

/** "Sep 14", or "Sep 14, 2025" when it isn't this year. Parsed as a local date. */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  const sameYear = y === new Date().getFullYear();
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** The default day for something added while looking at `month`: today in the current
 *  month, else the last day of a past month (or the 1st of a future one). */
export function defaultDayFor(month: string): string {
  const now = curMonth();
  if (month === now) return localToday();
  const [y, m] = month.split("-").map(Number);
  if (month > now) return `${month}-01`;
  return `${month}-${pad(new Date(y, m, 0).getDate())}`;
}

/** Pull a readable message out of the "401: {detail: ...}" errors thrown by lib/api. */
export function errorText(e: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw = e instanceof Error ? e.message : "";
  const i = raw.indexOf("{");
  if (i >= 0) {
    try {
      const d = JSON.parse(raw.slice(i)).detail;
      if (typeof d === "string") return d;
    } catch { /* fall through */ }
  }
  return fallback;
}
