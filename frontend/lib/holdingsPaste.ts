// Turns pasted brokerage positions into {symbol, qty, cost} rows.
// Accepts a table with a header row (CSV or copied from a web page), or plain lines such as
// "AAPL 25 150.20" or "AAPL,25,150.20". The preview shows what was understood before anything is saved.

export interface PastedRow { symbol: string; qty: number; cost: number | null }

const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const SYM_HEAD = /^(symbol|ticker|security|instrument|asset|coin)$/;
const QTY_HEAD = /^(quantity|qty|shares|units|amount|balance|holdings?)$/;
const COST_HEAD = /(average cost|avg\.? cost|avg\.? price|average price|cost basis per share|cost per share|cost\/share|unit cost|purchase price)/;

const num = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, "");
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  const n = parseFloat(t);
  return isFinite(n) ? n : null;
};

function cells(line: string): string[] {
  if (line.includes("\t")) return line.split("\t");
  // Words separated by spaces: commas inside a number are thousands separators there.
  if (/\S\s+\S/.test(line.trim()) && !/,\s*[A-Za-z$]|[A-Za-z]\s*,/.test(line)) return line.trim().split(/\s+/);
  return line.split(/[,;]/);
}

export function parsePositions(text: string): PastedRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const head = cells(lines[0]).map((c) => c.trim().toLowerCase().replace(/^"|"$/g, ""));
  const si = head.findIndex((h) => SYM_HEAD.test(h));
  const qi = head.findIndex((h) => QTY_HEAD.test(h));
  const ci = head.findIndex((h) => COST_HEAD.test(h));
  const out = new Map<string, PastedRow>();
  const put = (symbol: string, qty: number | null, cost: number | null) => {
    const s = symbol.trim().replace(/^"|"$/g, "").toUpperCase();
    if (!SYMBOL.test(s) || qty == null || qty < 0) return;
    const prev = out.get(s);
    if (prev) { // the same symbol twice (two lots): add them up, weighting the cost
      const total = prev.qty + qty;
      const cst = prev.cost != null && cost != null && total > 0 ? (prev.qty * prev.cost + qty * cost) / total : prev.cost ?? cost;
      out.set(s, { symbol: s, qty: total, cost: cst });
    } else out.set(s, { symbol: s, qty, cost: cost != null && cost > 0 ? cost : null });
  };

  if (si >= 0 && qi >= 0) {
    for (const line of lines.slice(1)) {
      const c = cells(line);
      put(c[si] ?? "", num(c[qi] ?? ""), ci >= 0 ? num(c[ci] ?? "") : null);
    }
    return [...out.values()];
  }
  for (const line of lines) {
    const c = cells(line).map((x) => x.trim()).filter(Boolean);
    const sym = c.find((x) => SYMBOL.test(x.replace(/^"|"$/g, "").toUpperCase()) && num(x) == null);
    if (!sym) continue;
    const nums = c.filter((x) => x !== sym).map(num).filter((n): n is number => n != null);
    put(sym, nums[0] ?? null, nums[1] ?? null);
  }
  return [...out.values()];
}

/** Weighted average cost after buying `shares` at `price`. */
export function costAfterBuy(qty: number, cost: number | null, shares: number, price: number): number | null {
  if (qty <= 0) return price;
  if (cost == null) return null; // unknown before, so still unknown
  return (qty * cost + shares * price) / (qty + shares);
}
