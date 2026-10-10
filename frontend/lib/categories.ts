// Budget categories shared by the budget tracker and the statement importer.
// Keep in sync with EXPENSE_CATEGORIES in backend/importer.py.

export const EXPENSE_CATS = ["rent", "food", "transport", "subscriptions", "fun", "trading_fees", "health", "shopping", "other"];
export const ALL_CATS = [...EXPENSE_CATS, "income"];

export const catLabel = (c: string) => c.replace("_", " ");
export const kindFor = (category: string): "income" | "expense" => (category === "income" ? "income" : "expense");

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
