"""Buy & Sell Zones: where each holding sits on the long-term score, and what to do about it.

No new indicators. Every number is scoring.long_term_score / scoring.score_series
(high = accumulate, low = overbought); this module only buckets and aggregates them.
main.py passes in valued_holdings() and gather_scored_assets() so there is no import cycle.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import charts
import market_data
import scoring

# Zone bands. Match scoring._label: Buy zone >= 60, Neutral >= 40, below that is overbought.
BUY_MIN = 60.0
SELL_MAX = 40.0  # score < SELL_MAX is the sell zone
MAX_ACCUMULATE = 3
MAX_SELL = 2
MAX_POINTS = 320
SCORE_WINDOW = 400
RANGE_DAYS = {"1Y": 365, "3Y": 3 * 365, "5Y": 5 * 365, "MAX": None}
CACHE_TTL = 6 * 3600  # long daily series + its point-in-time scores

_cache: dict[str, tuple[float, list[dict]]] = {}


def zone_for(score: float | None) -> str | None:
    """Bucket a 0-100 score into buy / hold / sell."""
    if score is None:
        return None
    return "buy" if score >= BUY_MIN else "sell" if score < SELL_MAX else "hold"


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


def _history(kind: str, sym: str) -> list[dict]:
    """Daily [{date, price, score}] for the whole available history, cached for CACHE_TTL.

    The score at day i is computed over a bounded trailing window (closes[i-399 : i+1]) so the
    cost is linear, not quadratic. 400 days covers long_term_score's 200-day average and its
    last-365 52-week range exactly, and RSI14 (Wilder smoothing) converges well within it, so
    this matches scoring over the full history.
    """
    key = f"{kind}:{sym}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    try:
        if kind == "stock":
            raw = charts._yahoo(sym, "10y", "1d")
        else:
            raw = charts._coinbase(sym, 86400, 10 * 365 * 86400)
    except Exception:
        return []  # not cached, so the next request retries
    days: dict[str, float] = {}
    for t, p in raw:
        days[datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d")] = float(p)
    dates = sorted(days)
    closes = [days[d] for d in dates]
    rows = []
    for i, d in enumerate(dates):
        sc = scoring.long_term_score(closes[max(0, i - SCORE_WINDOW + 1): i + 1])
        rows.append({"date": d, "price": closes[i], "score": sc["score"] if sc else None})
    if rows:
        _cache[key] = (time.time(), rows)
    return rows


def _downsample(rows: list[dict], keep: list[dict], n: int) -> list[dict]:
    """Evenly pick <= n rows, always including the `keep` rows (first, last, high, low)."""
    if len(rows) <= n:
        return rows
    must = {r["date"] for r in keep}
    free = n - len(must)
    step = len(rows) / max(free, 1)
    picked = {rows[min(int(i * step), len(rows) - 1)]["date"] for i in range(free)}
    chosen = must | picked
    out = [r for r in rows if r["date"] in chosen]
    while len(out) > n:  # collisions with `must` can overshoot by a few; drop non-required
        for j in range(1, len(out) - 1):
            if out[j]["date"] not in must:
                del out[j]
                break
        else:
            break
    return out


def zone_chart(kind: str, symbol: str, rng: str = "1Y") -> dict:
    """Price + point-in-time score for one asset over 1Y/3Y/5Y/MAX; stats use the full daily slice."""
    sym = symbol.upper()
    out: dict = {"symbol": sym, "kind": kind, "range": rng, "points": [], "high": None,
                 "low": None, "change_pct": None, "zone_share": None}
    rows = _history(kind, sym)
    if not rows:
        return out
    days = RANGE_DAYS.get(rng)
    if days is not None:
        cutoff = (datetime.fromisoformat(rows[-1]["date"]) - timedelta(days=days)).strftime("%Y-%m-%d")
        rows = [r for r in rows if r["date"] >= cutoff]
    if not rows:
        return out
    hi = max(rows, key=lambda r: r["price"])
    lo = min(rows, key=lambda r: r["price"])
    out["high"] = {"date": hi["date"], "price": hi["price"]}
    out["low"] = {"date": lo["date"], "price": lo["price"]}
    first = rows[0]["price"]
    out["change_pct"] = round((rows[-1]["price"] / first - 1) * 100, 2) if first else None
    zs = [zone_for(r["score"]) for r in rows if r["score"] is not None]
    if zs:
        out["zone_share"] = {z: round(zs.count(z) / len(zs) * 100, 1) for z in ("buy", "hold", "sell")}
    out["points"] = _downsample(rows, [rows[0], rows[-1], hi, lo], MAX_POINTS)
    return out
