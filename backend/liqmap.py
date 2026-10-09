"""Estimated BTC liquidation heatmap (Coinglass-style), built from free OKX data.

Exchanges don't publish where traders' liquidation prices sit, so every public
heatmap is a model. This one follows the usual approach:

  * When open interest rises during a candle, those new positions were opened
    near that candle's typical price. The taker buy/sell ratio splits them into
    longs and shorts.
  * Each new position gets a spread of leverage (5x … 100x), which puts its
    liquidation price a fixed distance below (longs) or above (shorts) entry.
  * Levels persist to the right until price trades through them (liquidated),
    and shrink proportionally when open interest falls (positions closed).

The model runs over twice the visible window so the left edge isn't empty.
Binance and Bybit block US IPs, so OKX's BTC-USDT perpetual is the source.
"""

from __future__ import annotations

import time

import requests

from market_data import _get, _set

OKX = "https://www.okx.com/api/v5"
INST = "BTC-USDT-SWAP"
UA = {"User-Agent": "swing-terminal/1.0"}

# range -> (okx bar/period, bar seconds, visible bars, cache ttl)
RANGES = {
    "24h": ("5m", 300, 288, 120),
    "3d": ("15m", 900, 288, 300),
    "1w": ("30m", 1800, 336, 600),
}
# share of new open interest at each leverage (rough retail perp mix)
LEVERAGE = [(5, 0.08), (10, 0.22), (20, 0.22), (25, 0.16), (50, 0.17), (100, 0.15)]
MMR = 0.005  # maintenance margin
BINS = 220
KERNEL = [(-2, 0.1), (-1, 0.22), (0, 0.36), (1, 0.22), (2, 0.1)]


def _pages(path: str, params: dict, cursor: str, need: int, per: int) -> list[list[str]]:
    """OKX returns newest first; walk backwards with `cursor` (after/end) until `need` rows."""
    out: list[list[str]] = []
    last = None
    for _ in range(12):
        p = dict(params, limit=per)
        if last:
            p[cursor] = last
        r = requests.get(f"{OKX}{path}", params=p, headers=UA, timeout=10)
        r.raise_for_status()
        rows = r.json().get("data") or []
        if not rows:
            break
        out.extend(rows)
        last = rows[-1][0]
        if len(out) >= need:
            break
        time.sleep(0.12)  # stay well under OKX's public rate limits
    return out


def _fetch(bar: str, n: int) -> tuple[list, dict, dict]:
    candles = _pages("/market/history-candles", {"instId": INST, "bar": bar}, "after", n, 300)
    oi = _pages("/rubik/stat/contracts/open-interest-history", {"instId": INST, "period": bar}, "end", n, 100)
    try:
        taker = _pages("/rubik/stat/taker-volume-contract", {"instId": INST, "period": bar, "unit": "2"}, "end", n, 100)
    except Exception as e:  # nice to have; without it new OI splits 50/50
        print(f"[liqmap] taker volume error: {e}")
        taker = []
    c = sorted(([int(r[0]) // 1000, float(r[1]), float(r[2]), float(r[3]), float(r[4])] for r in candles), key=lambda x: x[0])
    oi_by = {int(r[0]) // 1000: float(r[3]) for r in oi}  # oiUsd
    tk_by = {int(r[0]) // 1000: (float(r[1]), float(r[2])) for r in taker}  # (sell, buy)
    return c, oi_by, tk_by


def heatmap(rng: str = "24h") -> dict:
    if rng not in RANGES:
        raise ValueError(rng)
    bar, step, visible, ttl = RANGES[rng]
    key = f"liqmap:{rng}"
    hit = _get(key, ttl)
    if hit is not None:
        return hit  # type: ignore[return-value]

    try:
        candles, oi_by, tk_by = _fetch(bar, visible * 2)
    except Exception as e:
        print(f"[liqmap] fetch error: {e}")
        stale = _get(f"{key}:stale", 6 * 3600)
        if stale is not None:
            return stale  # type: ignore[return-value]
        return {"range": rng, "error": "Couldn't reach OKX right now", "times": [], "candles": [], "matrix": []}
    candles = [c for c in candles if c[0] in oi_by]
    if len(candles) < 10:
        return {"range": rng, "error": "Not enough data yet", "times": [], "candles": [], "matrix": []}

    shown = candles[-visible:]
    lo_px = min(c[3] for c in shown)
    hi_px = max(c[2] for c in shown)
    pad = (hi_px - lo_px) * 0.35 + hi_px * 0.012
    lo, hi = lo_px - pad, hi_px + pad
    width = (hi - lo) / BINS

    def bin_of(p: float) -> int | None:
        i = int((p - lo) / width)
        return i if 0 <= i < BINS else None

    longs = [0.0] * BINS   # USD of longs liquidating at each price bin
    shorts = [0.0] * BINS
    prices = [lo + (i + 0.5) * width for i in range(BINS)]
    start_vis = len(candles) - len(shown)
    cols: list[list[float]] = []
    liq_long_usd: list[float] = []
    liq_short_usd: list[float] = []
    prev_oi = None

    for idx, (t, o, h, l, c) in enumerate(candles):
        # 1) price swept through levels this candle -> those positions are gone
        ll = ls = 0.0
        for i, px in enumerate(prices):
            if longs[i] and px >= l:
                ll += longs[i]; longs[i] = 0.0
            if shorts[i] and px <= h:
                ls += shorts[i]; shorts[i] = 0.0
        # 2) open-interest change: add new positions, or shrink existing ones
        cur = oi_by[t]
        if prev_oi:
            d = cur - prev_oi
            if d > 0:
                sell, buy = tk_by.get(t, (1.0, 1.0))
                long_share = buy / (buy + sell) if buy + sell > 0 else 0.5
                entry = (h + l + c) / 3
                for lev, w in LEVERAGE:
                    amt = d * w
                    bl = bin_of(entry * (1 - 1 / lev + MMR))
                    bs = bin_of(entry * (1 + 1 / lev - MMR))
                    # real leverage isn't exactly 10x/25x…: smear each level over neighbouring bins
                    for off, k in KERNEL:
                        if bl is not None and 0 <= bl + off < BINS:
                            longs[bl + off] += amt * long_share * k
                        if bs is not None and 0 <= bs + off < BINS:
                            shorts[bs + off] += amt * (1 - long_share) * k
            elif d < 0:
                k = max(0.0, cur / prev_oi)
                longs = [v * k for v in longs]
                shorts = [v * k for v in shorts]
        prev_oi = cur
        if idx >= start_vis:
            cols.append([a + b for a, b in zip(longs, shorts)])
            liq_long_usd.append(ll)
            liq_short_usd.append(ls)

    peak = max((max(col) for col in cols), default=0.0) or 1.0
    # quantize to 0..1000 to keep the payload small (≈60k cells)
    matrix = [[round(v / peak * 1000) for v in col] for col in cols]

    last = cols[-1]
    price = shown[-1][4]
    def clusters(above: bool) -> list[dict]:
        rows = [(prices[i], last[i]) for i in range(BINS) if (prices[i] > price) == above and last[i] > 0]
        rows.sort(key=lambda r: r[1], reverse=True)
        picked: list[tuple[float, float]] = []
        for p, v in rows:  # skip neighbours of a level we already listed
            if all(abs(p - q) > width * 3 for q, _ in picked):
                picked.append((p, v))
            if len(picked) == 3:
                break
        return [{"price": round(p, 1), "usd": round(v), "dist_pct": round((p / price - 1) * 100, 2)} for p, v in picked]

    out = {
        "range": rng, "source": "OKX BTC-USDT perpetual", "bar": bar, "step": step,
        "times": [c[0] for c in shown],
        "candles": [[c[1], c[2], c[3], c[4]] for c in shown],
        "price_lo": round(lo, 2), "price_hi": round(hi, 2), "bins": BINS,
        "peak_usd": round(peak), "matrix": matrix,
        "liq_long": [round(v) for v in liq_long_usd], "liq_short": [round(v) for v in liq_short_usd],
        "price": price, "above": clusters(True), "below": clusters(False),
        "updated": int(time.time()),
    }
    _set(key, out)
    _set(f"{key}:stale", out)
    return out
