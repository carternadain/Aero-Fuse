"""Estimated BTC liquidation heatmap (Coinglass-style) for Binance's BTCUSDT perpetual.

Exchanges don't publish where traders' liquidation prices sit, so every public
heatmap is a model. This one follows the usual approach:

  * When open interest rises during a candle, those new positions were opened
    near that candle's typical price. The taker buy/sell split decides how much
    of it is longs vs shorts.
  * Each new position gets a spread of leverage (5x … 100x), which puts its
    liquidation price a fixed distance below (longs) or above (shorts) entry.
  * Levels persist to the right until price trades through them (liquidated),
    and shrink proportionally when open interest falls (positions closed).

The model runs over twice the visible window so the left edge isn't empty.

Data is Binance BTCUSDT perp, the market Coinglass's default heatmap shows. Sources, in order:
  1. Binance's free public futures API (fapi.binance.com). It refuses US IPs (HTTP 451).
  2. Coinalyze's free API for the same Binance contract, when COINALYZE_API_KEY is set
     (free key at coinalyze.net). Works from the US.
  3. OKX's BTC-USDT perp as a last resort, flagged in the payload as a fallback.
"""

from __future__ import annotations

import os
import time

import requests

from market_data import _get, _set

UA = {"User-Agent": "swing-terminal/1.0"}
OKX = "https://www.okx.com/api/v5"
OKX_INST = "BTC-USDT-SWAP"
BINANCE = "https://fapi.binance.com"
COINALYZE = "https://api.coinalyze.net/v1"
COINALYZE_SYMBOL = "BTCUSDT_PERP.A"  # .A = Binance

# range -> (bar, bar seconds, visible bars, cache ttl)
RANGES = {
    "24h": ("5m", 300, 288, 120),
    "3d": ("15m", 900, 288, 300),
    "1w": ("30m", 1800, 336, 600),
}
COINALYZE_INTERVAL = {"5m": "5min", "15m": "15min", "30m": "30min"}
# share of new open interest at each leverage (rough retail perp mix)
LEVERAGE = [(5, 0.08), (10, 0.22), (20, 0.22), (25, 0.16), (50, 0.17), (100, 0.15)]
MMR = 0.004  # Binance BTCUSDT maintenance margin, lowest tier
BINS = 220
KERNEL = [(-2, 0.1), (-1, 0.22), (0, 0.36), (1, 0.22), (2, 0.1)]

# Each fetcher returns (candles, oi_by, taker_by):
#   candles  [[open_time_s, o, h, l, c], ...] oldest first
#   oi_by    {open_time_s: open interest in USD}
#   taker_by {open_time_s: (sell, buy)} taker volume


def _okx_pages(path: str, params: dict, cursor: str, need: int, per: int) -> list[list[str]]:
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


def _fetch_okx(bar: str, step: int, n: int) -> tuple[list, dict, dict]:
    candles = _okx_pages("/market/history-candles", {"instId": OKX_INST, "bar": bar}, "after", n, 300)
    oi = _okx_pages("/rubik/stat/contracts/open-interest-history", {"instId": OKX_INST, "period": bar}, "end", n, 100)
    try:
        taker = _okx_pages("/rubik/stat/taker-volume-contract", {"instId": OKX_INST, "period": bar, "unit": "2"}, "end", n, 100)
    except Exception as e:  # nice to have; without it new OI splits 50/50
        print(f"[liqmap] okx taker volume error: {e}")
        taker = []
    c = sorted(([int(r[0]) // 1000, float(r[1]), float(r[2]), float(r[3]), float(r[4])] for r in candles), key=lambda x: x[0])
    oi_by = {int(r[0]) // 1000: float(r[3]) for r in oi}  # oiUsd
    tk_by = {int(r[0]) // 1000: (float(r[1]), float(r[2])) for r in taker}  # (sell, buy)
    return c, oi_by, tk_by


def parse_binance(klines: list, oi_rows: list, step: int) -> tuple[list, dict, dict]:
    """Klines carry taker buy volume (field 9), so no separate taker call is needed.
    openInterestHist rows are snapshots at `timestamp`; the one at t+step is the open
    interest at the close of the candle that opened at t, so it's keyed to t."""
    c, tk_by = [], {}
    for k in klines:
        t = int(k[0]) // 1000
        c.append([t, float(k[1]), float(k[2]), float(k[3]), float(k[4])])
        vol, buy = float(k[5]), float(k[9])
        tk_by[t] = (max(0.0, vol - buy), buy)
    oi_by = {int(r["timestamp"]) // 1000 - step: float(r["sumOpenInterestValue"]) for r in oi_rows}
    c.sort(key=lambda x: x[0])
    return c, oi_by, tk_by


def _fetch_binance(bar: str, step: int, n: int) -> tuple[list, dict, dict]:
    def get(path: str, params: dict):
        r = requests.get(f"{BINANCE}{path}", params=params, headers=UA, timeout=10)
        r.raise_for_status()
        return r.json()

    klines = get("/fapi/v1/klines", {"symbol": "BTCUSDT", "interval": bar, "limit": min(1500, n)})
    oi: list[dict] = []
    end = None
    for _ in range(6):  # max 500 rows per call, oldest first; page backwards with endTime
        p = {"symbol": "BTCUSDT", "period": bar, "limit": 500}
        if end:
            p["endTime"] = end
        rows = get("/futures/data/openInterestHist", p)
        if not rows:
            break
        oi = rows + oi
        end = int(rows[0]["timestamp"]) - 1
        if len(oi) >= n or len(rows) < 500:
            break
        time.sleep(0.1)
    return parse_binance(klines, oi, step)


def parse_coinalyze(ohlcv: list, oi: list) -> tuple[list, dict, dict]:
    """Coinalyze bars are keyed by open time; an OI bar's `c` is open interest at its close.
    `bv` is taker buy volume, `v` total volume."""
    def hist(rows: list) -> list:
        return (rows[0].get("history") or []) if rows else []

    c, tk_by = [], {}
    for b in hist(ohlcv):
        t = int(b["t"])
        c.append([t, float(b["o"]), float(b["h"]), float(b["l"]), float(b["c"])])
        v, bv = float(b.get("v") or 0), float(b.get("bv") or 0)
        if v > 0:
            tk_by[t] = (max(0.0, v - bv), bv)
    oi_by = {int(b["t"]): float(b["c"]) for b in hist(oi)}
    c.sort(key=lambda x: x[0])
    return c, oi_by, tk_by


def _fetch_coinalyze(bar: str, step: int, n: int) -> tuple[list, dict, dict]:
    key = os.getenv("COINALYZE_API_KEY", "").strip()
    if not key:
        raise RuntimeError("COINALYZE_API_KEY not set")
    now = int(time.time())
    base = {"symbols": COINALYZE_SYMBOL, "interval": COINALYZE_INTERVAL[bar], "from": now - n * step, "to": now}

    def get(path: str, extra: dict | None = None):
        r = requests.get(f"{COINALYZE}{path}", params={**base, **(extra or {})},
                         headers={**UA, "api_key": key}, timeout=10)
        r.raise_for_status()
        return r.json()

    return parse_coinalyze(get("/ohlcv-history"), get("/open-interest-history", {"convert_to_usd": "true"}))


SOURCES = [
    ("Binance BTCUSDT perpetual", _fetch_binance),
    ("Binance BTCUSDT perpetual (via Coinalyze)", _fetch_coinalyze),
    ("OKX BTC-USDT perpetual", _fetch_okx),
]


def _fetch(bar: str, step: int, n: int) -> tuple[str, list, dict, dict]:
    """First source that answers with usable data wins."""
    errors = []
    for name, fn in SOURCES:
        try:
            c, oi_by, tk_by = fn(bar, step, n)
            if sum(1 for x in c if x[0] in oi_by) >= 10:
                return name, c, oi_by, tk_by
            errors.append(f"{name}: too little data")
        except Exception as e:
            errors.append(f"{name}: {e}")
    raise RuntimeError("; ".join(errors))


def heatmap(rng: str = "24h") -> dict:
    if rng not in RANGES:
        raise ValueError(rng)
    bar, step, visible, ttl = RANGES[rng]
    key = f"liqmap:{rng}"
    hit = _get(key, ttl)
    if hit is not None:
        return hit  # type: ignore[return-value]

    try:
        source, candles, oi_by, tk_by = _fetch(bar, step, visible * 2)
    except Exception as e:
        print(f"[liqmap] fetch error: {e}")
        stale = _get(f"{key}:stale", 6 * 3600)
        if stale is not None:
            return stale  # type: ignore[return-value]
        return {"range": rng, "error": "Couldn't reach the exchange right now", "times": [], "candles": [], "matrix": []}
    # drop leading candles from before the open-interest history starts; a candle with no
    # OI yet (the one still forming) just adds nothing new
    first_oi = min(oi_by)
    candles = [c for c in candles if c[0] >= first_oi]

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
        cur = oi_by.get(t)
        if cur is None:
            cur = prev_oi
        elif prev_oi:
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
        "range": rng, "source": source, "fallback": not source.startswith("Binance"), "bar": bar, "step": step,
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
