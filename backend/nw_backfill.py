"""Estimated net worth before the first recorded snapshot.

Today's holdings are priced at each past day's close; everything
else (cash, manual accounts, debts, options) is held flat so the estimate meets the
first real snapshot exactly. Quantities come from today's holdings minus any auto-invest
buys made after that day (the fills ledger), so recurring buys show up as growth instead of
being assumed held all along; with no fills, today's qty is used for every day. Real snapshots always win: estimates only cover days
before the first one. Rows carry source='estimate'.

Prices: Yahoo daily closes via yfinance (stocks/ETFs, and crypto as "SYM-USD"), with
Coinbase daily candles as the crypto fallback. Everything is cached, and any price
that can't be fetched just shortens (or drops) the estimate instead of erroring.
"""

from __future__ import annotations

import contextvars
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

import charts
from market_data import _get, _set

YEARS = 10           # how far back we look
COVER = 0.9          # start once holdings worth ≥90% of today's live value have prices
DAILY_DAYS = 400     # keep daily rows this close to the first snapshot, weekly before
SERIES_TTL = 12 * 3600
MISS_TTL = 15 * 60   # a failed fetch is retried after this, not on every request
RESULT_TTL = 6 * 3600

Closes = dict[str, float]  # "YYYY-MM-DD" -> close
_lock = threading.Lock()


def _to_days(s: list[tuple[float, float]]) -> Closes:
    return {datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d"): float(p) for t, p in s if p and p > 0}


def daily_closes(kind: str, sym: str) -> Closes:
    """Up to YEARS of daily closes for one asset; {} when nothing can be fetched."""
    key = f"nwbf:{kind}:{sym}"
    hit = _get(key, SERIES_TTL)
    if hit is not None:
        return hit  # type: ignore[return-value]
    if _get(f"{key}:miss", MISS_TTL):
        return _get(f"{key}:stale", 7 * 86_400) or {}  # type: ignore[return-value]
    out: Closes = {}
    try:
        if kind == "crypto":
            out = _to_days(charts._yahoo(f"{sym}-USD", f"{YEARS}y", "1d"))
            if not out:
                out = _to_days(charts._coinbase(sym, 86_400, 5 * 365 * 86_400))
        elif kind == "stock":
            out = _to_days(charts._yahoo(sym, f"{YEARS}y", "1d"))
    except Exception as e:  # noqa: BLE001 - network/parse errors just mean no estimate
        print(f"[nw_backfill] {kind} {sym} error: {e}")
        out = {}
    if out:
        _set(key, out)
        _set(f"{key}:stale", out)
        return out
    _set(f"{key}:miss", True)
    return _get(f"{key}:stale", 7 * 86_400) or {}  # type: ignore[return-value]


def _days(a: date, b: date) -> list[date]:
    return [a + timedelta(days=i) for i in range((b - a).days + 1)]


def _fills_by_holding(live: list[dict], fills: list[dict] | None) -> list[list[tuple[str, float]]]:
    """Pure. For each live holding, the (date, qty) buys that went into it, oldest first.
    A fill matches the holding with the same kind, symbol and label, else the first one with
    the same kind and symbol (the label was edited by hand)."""
    out: list[list[tuple[str, float]]] = [[] for _ in live]
    for f in fills or []:
        key = (f.get("kind"), (f.get("symbol") or "").upper())
        lab = (f.get("label") or "").strip().lower()
        idx = [i for i, h in enumerate(live) if (h.get("kind"), (h.get("symbol") or "").upper()) == key]
        if not idx:
            continue
        exact = [i for i in idx if (live[i].get("label") or "").strip().lower() == lab]
        out[(exact or idx)[0]].append((f["date"], float(f.get("qty") or 0)))
    for x in out:
        x.sort()
    return out


def qty_on(qty: float, buys: list[tuple[str, float]], day: str) -> float:
    """Pure. Units held at the close of `day`: today's qty minus buys dated after it."""
    return max(0.0, qty - sum(q for d, q in buys if d > day))


def _qty_series(qty: float, buys: list[tuple[str, float]], grid: list[date]) -> list[float]:
    """qty_on for every day of an ascending grid in one pass."""
    later = sum(q for _, q in buys)  # bought after the day being looked at
    j, out = 0, []
    for d in grid:
        k = d.isoformat()
        while j < len(buys) and buys[j][0] <= k:
            later -= buys[j][1]
            j += 1
        out.append(max(0.0, qty - later))
    return out


def estimate(holdings: list[dict], anchor: dict, closes: dict[tuple[str, str], Closes],
             fills: list[dict] | None = None) -> list[dict]:
    """Pure. Estimated rows for every day before anchor['date'] (oldest first).

    holdings: valued holdings (kind, symbol, qty, multiplier, value).
    anchor: the earliest real point {date, net_worth, liabilities, cash?, property?}.
    closes: (kind, symbol) -> daily closes.
    fills: auto-invest buys {kind, symbol, label, date, qty}; units bought after a day are
      not counted on that day.
    """
    live = [h for h in holdings if h.get("kind") in ("crypto", "stock") and h.get("qty") and (h.get("value") or 0) > 0]
    if not live:
        return []
    flat = sum(h.get("value") or 0 for h in holdings if h not in live)
    end = date.fromisoformat(anchor["date"])
    floor = end - timedelta(days=YEARS * 365)

    # Where each holding's price history starts; holdings with none count as "never".
    firsts = []
    for h in live:
        c = closes.get((h["kind"], h["symbol"])) or {}
        ds = sorted(d for d in c if d <= anchor["date"])
        firsts.append(date.fromisoformat(ds[0]) if ds else None)
    total = sum(h["value"] for h in live)
    covered, start = 0.0, None
    for f, h in sorted(((f, h) for f, h in zip(firsts, live) if f), key=lambda x: x[0]):
        covered += h["value"]
        if covered >= COVER * total - 1e-9:
            start = f
            break
    if start is None:
        return []
    start = max(start, floor)
    if start >= end:
        return []

    grid = _days(start, end)
    hv = [flat] * len(grid)
    buys = _fills_by_holding(live, fills)
    for h, f, b in zip(live, firsts, buys):
        c = closes.get((h["kind"], h["symbol"])) or {}
        qtys = _qty_series(h["qty"], b, grid)
        if f is None:  # no history at all (a small holding): held flat at today's price
            unit = h["value"] / h["qty"]
            for i in range(len(grid)):
                hv[i] += qtys[i] * unit
            continue
        mult = h.get("multiplier") or 1
        last = c[f.isoformat()]  # before its history starts, hold its first close
        for i, d in enumerate(grid):
            last = c.get(d.isoformat(), last)
            hv[i] += qtys[i] * mult * last

    offset = anchor["net_worth"] - hv[-1]  # meet the first real snapshot exactly
    liab = anchor.get("liabilities") or 0.0
    cash, prop = anchor.get("cash"), anchor.get("property")
    split = cash is not None and prop is not None
    rows = []
    for i, d in enumerate(grid[:-1]):
        if (end - d).days > DAILY_DAYS and d.weekday() != 0:
            continue  # weekly (Mondays) further back keeps the payload small
        nw = hv[i] + offset
        rows.append({
            "date": d.isoformat(), "assets": round(nw + liab, 2), "liabilities": round(liab, 2),
            "net_worth": round(nw, 2),
            "investments": round(nw + liab - cash - prop, 2) if split else None,
            "cash": round(cash, 2) if split else None, "property": round(prop, 2) if split else None,
            "source": "estimate",
        })
    return rows


def build(holdings: list[dict], snaps: list[dict], current: dict, fetch=daily_closes,
          fills: list[dict] | None = None) -> list[dict]:
    """Cached estimate for the days before the first snapshot (or before today if none)."""
    if snaps:
        anchor = snaps[0]
    else:
        anchor = {"date": datetime.now(timezone.utc).strftime("%Y-%m-%d"), **current}
    live = [h for h in holdings if h.get("kind") in ("crypto", "stock") and h.get("qty") and (h.get("value") or 0) > 0]
    if not live:
        return []
    sig = (anchor["date"], round(anchor["net_worth"], 2),
           tuple(sorted((h["kind"], h["symbol"], float(h["qty"])) for h in live)),
           tuple(sorted((f["kind"], f["symbol"], f.get("label") or "", f["date"], float(f["qty"]))
                        for f in fills or [])))
    key = f"nwbf:result:{hash(sig)}"
    hit = _get(key, RESULT_TTL)
    if hit is not None:
        return hit  # type: ignore[return-value]
    if _get(f"{key}:empty", MISS_TTL):
        return []
    with _lock:  # one computation at a time; the second caller reads the cache
        hit = _get(key, RESULT_TTL)
        if hit is not None:
            return hit  # type: ignore[return-value]
        syms = sorted({(h["kind"], h["symbol"]) for h in live})
        ctxs = [contextvars.copy_context() for _ in syms]
        with ThreadPoolExecutor(max_workers=8) as pool:
            got = list(pool.map(lambda p: p[0].run(fetch, *p[1]), zip(ctxs, syms)))
        rows = estimate(holdings, anchor, dict(zip(syms, got)), fills)
        # an empty result (prices down) is cached briefly so we retry soon, not every request
        if rows:
            _set(key, rows)
        else:
            _set(f"{key}:empty", True)
        return rows
