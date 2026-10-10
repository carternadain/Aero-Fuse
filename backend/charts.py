"""Price-history series for the Robinhood-style Home: per-asset charts, a combined
portfolio chart, and 1-day sparklines.

Crypto: Coinbase Exchange candles (real-time, 5-minute resolution at 1D).
Stocks/ETFs: Yahoo via yfinance (near real-time intraday bars in market hours).
Options: no free intraday history, so they're held flat at their current mark.

Everything is TTL-cached through market_data's cache, so the background warmer
keeps the short ranges fresh.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import contextvars
import requests

import market_data
from market_data import _get, _set

CB = "https://api.exchange.coinbase.com"
UA = {"User-Agent": "swing-terminal/1.0"}

# range -> (coinbase granularity s, span s, yfinance period, yfinance interval, cache ttl s, grid step s)
RANGES: dict[str, tuple[int, int, str, str, int, int]] = {
    "LIVE": (60, 3_600, "1d", "1m", 90, 60),          # last hour, 1-minute bars
    "1D": (300, 86_400, "1d", "5m", 300, 300),
    "1W": (3_600, 7 * 86_400, "5d", "15m", 1_800, 3_600),
    "1M": (21_600, 30 * 86_400, "1mo", "60m", 3_600, 21_600),
    "3M": (86_400, 90 * 86_400, "3mo", "1d", 21_600, 86_400),
    "1Y": (86_400, 365 * 86_400, "1y", "1d", 21_600, 86_400),
    "5Y": (86_400, 5 * 365 * 86_400, "5y", "1wk", 21_600, 7 * 86_400),
}

Series = list[tuple[float, float]]  # (unix seconds, price), ascending


def _downsample(s: Series, n: int) -> Series:
    if len(s) <= n:
        return s
    step = len(s) / n
    out = [s[int(i * step)] for i in range(n)]
    out[-1] = s[-1]
    return out


def _coinbase(sym: str, gran: int, span: int) -> Series:
    end = int(time.time())
    start = end - span
    pts: dict[int, float] = {}
    chunk = gran * 300  # Coinbase returns at most 300 candles per request
    t = start
    while t < end:
        t2 = min(end, t + chunk)
        params = {"granularity": gran,
                  "start": datetime.fromtimestamp(t, timezone.utc).isoformat(),
                  "end": datetime.fromtimestamp(t2, timezone.utc).isoformat()}
        r = requests.get(f"{CB}/products/{sym}-USD/candles", params=params, headers=UA, timeout=12)
        if r.status_code == 429:  # public rate limit, so back off once
            time.sleep(1.5)
            r = requests.get(f"{CB}/products/{sym}-USD/candles", params=params, headers=UA, timeout=12)
        if not r.ok:
            break
        for c in r.json():  # [time, low, high, open, close, volume]
            pts[int(c[0])] = float(c[4])
        t = t2
    return sorted(pts.items())


def _yahoo(sym: str, period: str, interval: str) -> Series:
    yf = market_data._yf()
    if yf is None:
        return []
    hist = yf.Ticker(sym).history(period=period, interval=interval, prepost=False)
    return [(ts.timestamp(), float(p)) for ts, p in hist["Close"].dropna().items()]


def crypto_daily_fallback(sym: str, span_days: int) -> Series:
    """Daily closes for a coin Coinbase doesn't list (e.g. NIGHT): Yahoo, then CoinGecko.

    CoinGecko's free tier only serves about a year of history, so Yahoo goes first for depth.
    """
    import universe  # local import keeps this module's import graph unchanged
    c = universe.coin(sym) or {}
    ysym = c["yahoo"] if c else f"{sym.upper()}-USD"
    if ysym:
        period = "max" if span_days > 1825 else "5y" if span_days > 730 else "2y" if span_days > 365 else "1y"
        try:
            s = _yahoo(ysym, period, "1d")
            cutoff = time.time() - span_days * 86_400
            s = [pt for pt in s if pt[0] >= cutoff]
            if len(s) >= 30:
                return s
        except Exception as e:
            print(f"[charts] yahoo fallback {ysym} error: {e}")
    cg = c.get("id")
    if cg:
        try:
            r = requests.get(f"{market_data.CG_BASE}/coins/{cg}/market_chart",
                             params={"vs_currency": "usd", "days": min(365, span_days), "interval": "daily"},
                             headers=UA, timeout=15)
            if r.ok:
                return [(ms / 1000, float(p)) for ms, p in r.json().get("prices", []) if p]
        except Exception as e:
            print(f"[charts] coingecko fallback {cg} error: {e}")
    return []


def series(kind: str, sym: str, rng: str) -> Series:
    """Cached price series for one asset."""
    if rng not in RANGES or kind == "option":
        return []
    gran, span, period, interval, ttl, _ = RANGES[rng]
    key = f"chart:{kind}:{sym}:{rng}"
    hit = _get(key, ttl)
    if hit is not None:
        return hit  # type: ignore[return-value]
    try:
        s = _coinbase(sym, gran, span) if kind == "crypto" else _yahoo(sym, period, interval)
        if kind == "crypto" and not s and gran >= 86_400:  # not on Coinbase: daily bars elsewhere
            s = crypto_daily_fallback(sym, span // 86_400)
        if rng == "LIVE":  # Yahoo returns the whole session at 1m; keep the last hour
            cutoff = time.time() - span
            s = [pt for pt in s if pt[0] >= cutoff]
    except Exception as e:
        print(f"[charts] {kind} {sym} {rng} error: {e}")
        s = _get(f"{key}:stale", 86_400) or []  # type: ignore[assignment]
    if s:
        _set(key, s)
        _set(f"{key}:stale", s)
    return s


def asset_chart(kind: str, sym: str, rng: str) -> dict:
    s = series(kind, sym, rng)
    q = market_data.live_quote(sym, kind)
    pts = _downsample(s, 240)
    if q.get("price") is not None and pts:
        pts = pts + [(time.time(), q["price"])]  # end on the live quote
    base = pts[0][1] if pts else None
    if rng == "1D" and q.get("price") and q.get("change_1d") is not None:
        base = q["price"] / (1 + q["change_1d"] / 100)  # vs previous close / 24h open
    last = pts[-1][1] if pts else q.get("price")
    return {
        "symbol": sym, "kind": kind, "range": rng,
        "points": [{"t": int(t), "p": round(p, 6)} for t, p in pts],
        "baseline": round(base, 6) if base else None,
        "change": round(last - base, 6) if last and base else None,
        "change_pct": round((last / base - 1) * 100, 2) if last and base else None,
    }


def _ffill(s: Series, grid: list[float]) -> list[float | None]:
    out: list[float | None] = []
    i, last = 0, (s[0][1] if s else None)  # back-fill before the first point
    for g in grid:
        while i < len(s) and s[i][0] <= g:
            last = s[i][1]
            i += 1
        out.append(last)
    return out


def portfolio_chart(holdings: list[dict], rng: str, offset: float = 0.0) -> dict:
    """Sum of qty × price over time for every live holding (options held flat).

    `offset` adds a constant (manual account balances minus debts) so the same
    curve can be drawn as total net worth.
    """
    if rng not in RANGES:
        return {"range": rng, "points": []}
    _, span, *_rest, step = RANGES[rng]
    live = [h for h in holdings if h["kind"] in ("crypto", "stock") and h.get("value") is not None]
    flat = offset + sum(h["value"] or 0 for h in holdings if h not in live)
    ctxs = [contextvars.copy_context() for _ in live]  # keep the warmer's TTL factor in workers
    with ThreadPoolExecutor(max_workers=8) as pool:
        all_s = list(pool.map(lambda p: p[0].run(series, p[1]["kind"], p[1]["symbol"], rng), zip(ctxs, live)))

    now = time.time()
    grid = [now - span + i * step for i in range(int(span // step) + 1)]
    total = [flat] * len(grid)
    for h, s in zip(live, all_s):
        mult = h.get("multiplier", 1)
        vals = _ffill(s, grid) if s else [h["price"]] * len(grid)
        for i, v in enumerate(vals):
            total[i] += h["qty"] * mult * (v if v is not None else h["price"])
    current = flat + sum(h["value"] for h in live)
    pts = [(t, v) for t, v in zip(grid, total)] + [(now, current)]
    base = pts[0][1]
    return {
        "range": rng,
        "points": [{"t": int(t), "p": round(v, 2)} for t, v in pts],
        "baseline": round(base, 2),
        "change": round(current - base, 2),
        "change_pct": round((current / base - 1) * 100, 2) if base else None,
    }


def sparks(holdings: list[dict]) -> dict[int, list[float]]:
    """~48-point 1D sparkline per live holding id."""
    live = [h for h in holdings if h["kind"] in ("crypto", "stock")]
    ctxs = [contextvars.copy_context() for _ in live]
    with ThreadPoolExecutor(max_workers=8) as pool:
        all_s = list(pool.map(lambda p: p[0].run(series, p[1]["kind"], p[1]["symbol"], "1D"), zip(ctxs, live)))
    return {h["id"]: [round(p, 6) for _, p in _downsample(s, 48)] for h, s in zip(live, all_s) if s}
