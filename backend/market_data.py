"""Free market data — CoinGecko (crypto) + yfinance (stocks).

No API keys. Everything is TTL-cached (same pattern as news.py) to stay well
inside CoinGecko's free rate limit and to avoid hammering Yahoo. Every fetch is
wrapped so a single upstream failure degrades to empty/None instead of 500ing
the whole screen.
"""

from __future__ import annotations

import time

import requests

import scoring

# ── tiny TTL cache (key → (stored_at, value)) ─────────────
_cache: dict[str, tuple[float, object]] = {}


def _get(key: str, ttl: float):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    return None


def _set(key: str, value):
    _cache[key] = (time.time(), value)


def clear_cache():
    _cache.clear()


# Stablecoins we never want in a "what's a good buy" screener.
STABLES = {
    "USDT", "USDC", "DAI", "BUSD", "TUSD", "USDP", "USDD", "FDUSD",
    "PYUSD", "GUSD", "FRAX", "LUSD", "USDE", "USDS", "EURT",
}

CG_BASE = "https://api.coingecko.com/api/v3"
UA = {"User-Agent": "Mozilla/5.0 (SwingTerminal)"}


# ── Crypto: CoinGecko ─────────────────────────────────────

def crypto_markets(limit: int = 15) -> list[dict]:
    """Top non-stablecoin coins by market cap, with sparkline + % changes + score."""
    cached = _get("cg_markets", 300)
    if cached is not None:
        return cached  # type: ignore[return-value]

    try:
        r = requests.get(
            f"{CG_BASE}/coins/markets",
            params={
                "vs_currency": "usd",
                "order": "market_cap_desc",
                "per_page": 40,
                "page": 1,
                "sparkline": "true",
                "price_change_percentage": "24h,7d,30d,1y",
            },
            headers=UA,
            timeout=15,
        )
        r.raise_for_status()
        raw = r.json()
    except Exception as e:
        print(f"[market_data] crypto_markets error: {e}")
        return _get("cg_markets_stale", 86400) or []  # last good, up to a day old

    coins: list[dict] = []
    for c in raw:
        sym = (c.get("symbol") or "").upper()
        if sym in STABLES:
            continue
        spark = (c.get("sparkline_in_7d") or {}).get("price") or []
        coins.append({
            "id": c.get("id"),
            "symbol": sym,
            "name": c.get("name"),
            "image": c.get("image"),
            "price": c.get("current_price"),
            "market_cap": c.get("market_cap"),
            "change_24h": c.get("price_change_percentage_24h_in_currency"),
            "change_7d": c.get("price_change_percentage_7d_in_currency"),
            "change_30d": c.get("price_change_percentage_30d_in_currency"),
            "change_1y": c.get("price_change_percentage_1y_in_currency"),
            "sparkline": [round(p, 4) for p in spark][-56:],  # ~last 7d hourly, trimmed
        })
        if len(coins) >= limit:
            break

    # Attach the long-term score using daily history (cached per coin).
    for coin in coins:
        hist = crypto_history(coin["id"])
        coin["score"] = scoring.long_term_score(hist) if hist else None

    _set("cg_markets", coins)
    _set("cg_markets_stale", coins)
    return coins


def crypto_history(coin_id: str) -> list[float]:
    """~1y of daily closes for one coin (for scoring). Cached 6h per coin."""
    key = f"cg_hist:{coin_id}"
    cached = _get(key, 6 * 3600)
    if cached is not None:
        return cached  # type: ignore[return-value]
    try:
        r = requests.get(
            f"{CG_BASE}/coins/{coin_id}/market_chart",
            params={"vs_currency": "usd", "days": 365, "interval": "daily"},
            headers=UA,
            timeout=15,
        )
        r.raise_for_status()
        closes = [p[1] for p in r.json().get("prices", [])]
    except Exception as e:
        print(f"[market_data] crypto_history {coin_id} error: {e}")
        closes = _get(f"{key}:stale", 86400) or []
    _set(key, closes)
    if closes:
        _set(f"{key}:stale", closes)
    return closes


def crypto_history_dated(coin_id: str) -> list[dict]:
    """~1y of daily {date, price} for charting. Cached 6h per coin."""
    key = f"cg_histd:{coin_id}"
    cached = _get(key, 6 * 3600)
    if cached is not None:
        return cached  # type: ignore[return-value]
    points: list[dict] = []
    try:
        from datetime import datetime, timezone
        r = requests.get(
            f"{CG_BASE}/coins/{coin_id}/market_chart",
            params={"vs_currency": "usd", "days": 365, "interval": "daily"},
            headers=UA,
            timeout=15,
        )
        r.raise_for_status()
        for ts_ms, price in r.json().get("prices", []):
            d = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
            points.append({"date": d, "price": round(price, 6)})
    except Exception as e:
        print(f"[market_data] crypto_history_dated {coin_id} error: {e}")
        points = _get(f"{key}:stale", 86400) or []
    _set(key, points)
    if points:
        _set(f"{key}:stale", points)
    return points


def stock_history_dated(ticker: str) -> list[dict]:
    """~2y of daily {date, price} for charting (extra history => mature 200DMA). Cached 6h."""
    key = f"yf_histd:{ticker}"
    cached = _get(key, 6 * 3600)
    if cached is not None:
        return cached  # type: ignore[return-value]
    yf = _yf()
    points: list[dict] = []
    if yf is not None:
        try:
            hist = yf.Ticker(ticker).history(period="2y")
            for idx, close in zip(hist.index, hist["Close"].tolist()):
                points.append({"date": idx.strftime("%Y-%m-%d"), "price": round(float(close), 4)})
        except Exception as e:
            print(f"[market_data] stock_history_dated {ticker} error: {e}")
            points = _get(f"{key}:stale", 86400) or []
    _set(key, points)
    if points:
        _set(f"{key}:stale", points)
    return points


def history_with_scores(kind: str, key_id: str) -> dict:
    """Dated price + point-in-time score series for the detail chart."""
    points = crypto_history_dated(key_id) if kind == "crypto" else stock_history_dated(key_id)
    prices = [p["price"] for p in points]
    scores = scoring.score_series(prices)
    rows = [{"date": p["date"], "price": p["price"], "score": s}
            for p, s in zip(points, scores)]
    # For stocks we pulled 2y so scores are mature; show the last ~year.
    if kind == "stock":
        rows = rows[-365:]
    return {"symbol": key_id, "kind": kind, "points": rows}


def crypto_categories(limit: int = 12, min_market_cap: float = 5e8) -> list[dict]:
    """Crypto narratives sorted by 24h market-cap move (real ones only)."""
    cached = _get("cg_cats", 900)
    if cached is not None:
        return cached  # type: ignore[return-value]
    try:
        r = requests.get(f"{CG_BASE}/coins/categories", headers=UA, timeout=15)
        r.raise_for_status()
        raw = r.json()
    except Exception as e:
        print(f"[market_data] crypto_categories error: {e}")
        return _get("cg_cats_stale", 86400) or []

    cats = []
    for c in raw:
        mc = c.get("market_cap") or 0
        change = c.get("market_cap_change_24h")
        if mc < min_market_cap or change is None:
            continue
        cats.append({
            "name": c.get("name"),
            "market_cap": mc,
            "change_24h": change,
            "volume_24h": c.get("volume_24h"),
            "top_coins": [t for t in (c.get("top_3_coins") or [])][:3],
        })
    cats.sort(key=lambda x: x["change_24h"], reverse=True)
    cats = cats[:limit]
    _set("cg_cats", cats)
    _set("cg_cats_stale", cats)
    return cats


# ── Market context (Fear & Greed, BTC dominance) ──────────

def crypto_context() -> dict:
    """Crypto-wide regime: Fear & Greed (alternative.me) + BTC dominance / total mcap (CoinGecko)."""
    cached = _get("crypto_context", 600)
    if cached is not None:
        return cached  # type: ignore[return-value]

    out: dict = {"fng_value": None, "fng_label": None, "btc_dominance": None,
                 "total_mcap": None, "mcap_change_24h": None}
    try:
        r = requests.get("https://api.alternative.me/fng/", timeout=10)
        r.raise_for_status()
        d = r.json()["data"][0]
        out["fng_value"] = int(d["value"])
        out["fng_label"] = d["value_classification"]
    except Exception as e:
        print(f"[market_data] fear&greed error: {e}")
    try:
        r = requests.get(f"{CG_BASE}/global", headers=UA, timeout=10)
        r.raise_for_status()
        g = r.json()["data"]
        out["btc_dominance"] = round(g["market_cap_percentage"].get("btc", 0), 1)
        out["eth_dominance"] = round(g["market_cap_percentage"].get("eth", 0), 1)
        out["total_mcap"] = g["total_market_cap"].get("usd")
        out["mcap_change_24h"] = round(g.get("market_cap_change_percentage_24h_usd", 0), 2)
    except Exception as e:
        print(f"[market_data] global error: {e}")

    # Simple alt-strength read: lower BTC dominance + green market = alts leading.
    dom = out.get("btc_dominance")
    if dom is not None:
        out["alt_read"] = "Alts leading" if dom < 50 else "BTC leading" if dom > 58 else "Mixed"
    _set("crypto_context", out)
    return out


# ── Stocks: yfinance ──────────────────────────────────────

def _yf():
    """Import yfinance lazily so the rest of the app runs even if it's missing."""
    try:
        import yfinance as yf
        return yf
    except Exception as e:
        print(f"[market_data] yfinance unavailable: {e}")
        return None


def stock_history(ticker: str) -> list[float]:
    """~1y of daily closes for a stock (for scoring). Cached 6h."""
    key = f"yf_hist:{ticker}"
    cached = _get(key, 6 * 3600)
    if cached is not None:
        return cached  # type: ignore[return-value]
    yf = _yf()
    closes: list[float] = []
    if yf is not None:
        try:
            hist = yf.Ticker(ticker).history(period="1y")
            closes = [float(x) for x in hist["Close"].dropna().tolist()]
        except Exception as e:
            print(f"[market_data] stock_history {ticker} error: {e}")
            closes = _get(f"{key}:stale", 86400) or []
    _set(key, closes)
    if closes:
        _set(f"{key}:stale", closes)
    return closes


def prefetch_stock_histories(tickers: list[str]) -> None:
    """Warm the stock_history cache for many tickers with one batched yfinance call."""
    missing = [t for t in tickers if _get(f"yf_hist:{t}", 6 * 3600) is None]
    yf = _yf()
    if not missing or yf is None:
        return
    try:
        df = yf.download(missing, period="1y", group_by="ticker", threads=True,
                         progress=False, auto_adjust=True)
    except Exception as e:
        print(f"[market_data] bulk download error: {e}")
        return
    for t in missing:
        try:
            closes = [float(x) for x in df[t]["Close"].dropna().tolist()]
        except Exception:
            continue  # leave uncached; stock_history() will retry it individually
        if closes:
            _set(f"yf_hist:{t}", closes)
            _set(f"yf_hist:{t}:stale", closes)


def _pct(closes: list[float], days: int) -> float | None:
    if len(closes) <= days or not closes[-days - 1]:
        return None
    return round((closes[-1] / closes[-days - 1] - 1) * 100, 2)


def stock_momentum(ticker: str) -> dict:
    """1D / 1W / 1M / 3M % change + distance from the 52-week high."""
    closes = stock_history(ticker)
    if not closes:
        return {"chg_1d": None, "chg_1w": None, "chg_1m": None, "chg_3m": None, "off_high": None}
    hi = max(closes)
    return {
        "chg_1d": _pct(closes, 1), "chg_1w": _pct(closes, 5),
        "chg_1m": _pct(closes, 21), "chg_3m": _pct(closes, 63),
        "off_high": round((closes[-1] / hi - 1) * 100, 2) if hi else None,
    }


def stock_score(ticker: str) -> dict | None:
    """Long-term score for a single stock."""
    closes = stock_history(ticker)
    score = scoring.long_term_score(closes) if closes else None
    if score is None:
        return {"symbol": ticker, "price": closes[-1] if closes else None, "score": None}
    return {"symbol": ticker, "price": round(closes[-1], 2), "score": score}


def stock_quote(ticker: str) -> dict:
    """Price + analyst context for the earnings projection. Cached 1h."""
    key = f"yf_quote:{ticker}"
    cached = _get(key, 3600)
    if cached is not None:
        return cached  # type: ignore[return-value]
    yf = _yf()
    out = {"symbol": ticker, "price": None, "target_mean": None, "recommendation": None}
    if yf is not None:
        try:
            info = yf.Ticker(ticker).info
            out["price"] = info.get("currentPrice") or info.get("regularMarketPrice")
            out["target_mean"] = info.get("targetMeanPrice")
            out["recommendation"] = info.get("recommendationKey")
        except Exception as e:
            print(f"[market_data] stock_quote {ticker} error: {e}")
    _set(key, out)
    return out


def stock_earnings(ticker: str) -> dict | None:
    """Next earnings date + a simple analyst-derived projection. Cached 12h."""
    key = f"yf_earn:{ticker}"
    cached = _get(key, 12 * 3600)
    if cached is not None:
        return cached  # type: ignore[return-value]

    yf = _yf()
    next_date = None
    if yf is not None:
        try:
            from datetime import datetime, timezone
            today = datetime.now(timezone.utc).date()
            df = yf.Ticker(ticker).get_earnings_dates(limit=12)
            if df is not None and not df.empty:
                # Index is a DatetimeIndex of earnings dates. Pick the soonest one
                # that's today or later; fall back to the most recent past date.
                dates = sorted(d.date() for d in df.index.to_pydatetime())
                upcoming = [d for d in dates if d >= today]
                pick = upcoming[0] if upcoming else (dates[-1] if dates else None)
                next_date = str(pick) if pick else None
        except Exception as e:
            print(f"[market_data] stock_earnings {ticker} error: {e}")

    quote = stock_quote(ticker)
    projection, bias = _project(quote)
    out = {
        "symbol": ticker,
        "next_earnings": next_date,
        "price": quote.get("price"),
        "target_mean": quote.get("target_mean"),
        "recommendation": quote.get("recommendation"),
        "bias": bias,
        "projection": projection,
    }
    _set(key, out)
    return out


def spot_price(symbol: str) -> float | None:
    """Best-effort current price for any signal symbol (crypto via Coinbase, else stock).

    Cached 60s. Tries Coinbase spot on the base ticker first (handles SOLUSD/SOL/BTCUSDT),
    then falls back to a Yahoo stock quote.
    """
    key = f"spot:{symbol}"
    cached = _get(key, 60)
    if cached is not None:
        return cached  # type: ignore[return-value]

    base = symbol.upper()
    for suffix in ("USDT", "USDC", "USD", "PERP", "-PERP"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
            break

    price = None
    try:
        r = requests.get(f"https://api.coinbase.com/v2/prices/{base}-USD/spot", headers=UA, timeout=8)
        if r.ok:
            price = float(r.json()["data"]["amount"])
    except Exception:
        price = None

    if price is None:  # stock fallback
        q = stock_quote(symbol.upper())
        price = q.get("price")

    if price is not None:
        _set(key, price)
    return price


def _project(quote: dict) -> tuple[str, str]:
    """Bullish/bearish lean from analyst target vs price (no AI needed)."""
    price = quote.get("price")
    target = quote.get("target_mean")
    rec = (quote.get("recommendation") or "").replace("_", " ")
    if price and target:
        upside = (target - price) / price * 100
        if upside >= 8:
            return (f"Analysts target ${target:.0f} (+{upside:.0f}% upside){' · ' + rec if rec else ''}", "bullish")
        if upside <= -8:
            return (f"Analysts target ${target:.0f} ({upside:.0f}% downside){' · ' + rec if rec else ''}", "bearish")
        return (f"Analysts target ${target:.0f} ({upside:+.0f}%){' · ' + rec if rec else ''}", "neutral")
    if rec:
        bias = "bullish" if "buy" in rec else "bearish" if "sell" in rec else "neutral"
        return (f"Analyst consensus: {rec}", bias)
    return ("No analyst data available", "neutral")
