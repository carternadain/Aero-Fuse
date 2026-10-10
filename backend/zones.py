"""Buy & Sell Zones: where each holding sits on the long-term score, and what to do about it.

No new indicators. Every number is scoring.long_term_score / scoring.score_series
(high = accumulate, low = overbought); this module only buckets and aggregates them.
main.py passes in valued_holdings() and gather_scored_assets() so there is no import cycle.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import charts
import market_data
import scoring

# Zone bands. Match scoring._label: Buy zone >= 60, Neutral >= 40, below that is overbought.
BUY_MIN = 60.0
SELL_MAX = 40.0  # score < SELL_MAX is the sell zone
MAX_ACCUMULATE = 3
MAX_SELL = 2
CHART_DAYS = 365
CRYPTO_FALLBACK_DAYS = 730  # warm-up so the first charted day already has a mature score
CACHE_TTL = 30 * 60  # score_series is quadratic, so keep results for 30 minutes

_cache: dict[str, tuple[float, dict]] = {}


def zone_for(score: float | None) -> str | None:
    """Bucket a 0-100 score into buy / hold / sell."""
    if score is None:
        return None
    return "buy" if score >= BUY_MIN else "sell" if score < SELL_MAX else "hold"


def _coin_id(symbol: str) -> str | None:
    """CoinGecko id for a ticker among the top coins, if listed."""
    for c in market_data.crypto_markets(40):
        if str(c.get("symbol", "")).upper() == symbol:
            return c.get("id")
    return None


def _aggregate(rows: list[dict]) -> list[dict]:
    """Merge the same kind+symbol across accounts; qty-weighted cost basis. Skips options/empty."""
    agg: dict[tuple[str, str], dict] = {}
    for h in rows:
        if h.get("kind") not in ("stock", "crypto") or not h.get("value"):
            continue
        a = agg.setdefault((h["kind"], str(h["symbol"]).upper()),
                           {"qty": 0.0, "value": 0.0, "cost": 0.0, "cost_qty": 0.0, "price": None})
        qty = h.get("qty") or 0.0
        a["qty"] += qty
        a["value"] += h["value"]
        a["price"] = h.get("price") if h.get("price") is not None else a["price"]
        if h.get("cost_basis"):
            a["cost"] += qty * h["cost_basis"]
            a["cost_qty"] += qty
    out = []
    for (kind, sym), a in agg.items():
        basis = a["cost"] / a["cost_qty"] if a["cost_qty"] else None
        out.append({"kind": kind, "symbol": sym, "value": a["value"], "price": a["price"], "basis": basis})
    return out


def _score_block(kind: str, symbol: str) -> dict | None:
    """Full long_term_score dict for one asset, or None on any failure."""
    try:
        if kind == "stock":
            return (market_data.stock_score(symbol) or {}).get("score")
        for c in market_data.crypto_markets(40):
            if str(c.get("symbol", "")).upper() == symbol and c.get("score"):
                return c["score"]
        closes = [p for _, p in charts.series("crypto", symbol, "1Y")]
        return scoring.long_term_score(closes) if closes else None
    except Exception:
        return None


def build_zones(valued: dict, assets: list[dict]) -> dict:
    """Held assets with their score + zone, action lists, and a watchlist of what isn't held."""
    held = _aggregate(valued.get("holdings", []))
    with ThreadPoolExecutor(max_workers=8) as pool:
        blocks = list(pool.map(lambda h: _score_block(h["kind"], h["symbol"]), held))
    total = valued.get("value") or sum(h["value"] for h in held)
    rows = []
    for h, sc in zip(held, blocks):
        score = sc["score"] if sc else None
        price, basis = h["price"], h["basis"]
        rows.append({
            "kind": h["kind"], "symbol": h["symbol"], "value": round(h["value"], 2),
            "weight_pct": round(h["value"] / total * 100, 1) if total else 0.0,
            "gain_pct": round((price / basis - 1) * 100, 2) if price is not None and basis else None,
            "price": price, "score": sc, "zone": zone_for(score),
        })
    rows.sort(key=lambda r: r["value"], reverse=True)
    scored = [r for r in rows if r["score"] is not None]
    buys = sorted((r for r in scored if r["score"]["score"] >= BUY_MIN), key=lambda r: -r["score"]["score"])
    sells = sorted((r for r in scored if r["score"]["score"] < SELL_MAX), key=lambda r: r["score"]["score"])
    held_keys = {(r["kind"], r["symbol"]) for r in rows}
    watch = [{"kind": a["kind"], "symbol": str(a["symbol"]).upper(), "price": a.get("price"),
              "score": a.get("score"), "label": a.get("label")}
             for a in assets if (a["kind"], str(a["symbol"]).upper()) not in held_keys]
    watch.sort(key=lambda w: w["symbol"])
    return {
        "holdings": rows,
        "accumulate": [r["symbol"] for r in buys[:MAX_ACCUMULATE]],
        "sell": [r["symbol"] for r in sells[:MAX_SELL]],
        "watch": watch,
    }


def zone_chart(kind: str, symbol: str) -> dict:
    """~1y of price + point-in-time score for one asset. Cached for CACHE_TTL."""
    sym = symbol.upper()
    key = f"{kind}:{sym}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    if kind == "stock":
        data = market_data.history_with_scores("stock", sym)
    else:
        coin = _coin_id(sym)
        if coin:
            data = market_data.history_with_scores("crypto", coin)
        else:
            pts = charts.series("crypto", sym, "5Y")[-CRYPTO_FALLBACK_DAYS:]
            scores = scoring.score_series([p for _, p in pts])
            data = {"points": [
                {"date": datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d"),
                 "price": p, "score": s} for (t, p), s in zip(pts, scores)]}
    out = {"symbol": sym, "kind": kind, "points": data["points"][-CHART_DAYS:]}
    _cache[key] = (time.time(), out)
    return out
