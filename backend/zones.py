"""Risk zones: where each holding sits on a 0-100 RISK scale (0 = deep value / accumulate,
100 = most stretched / sell), over three horizons: long (macro, default), mid and short.

short / mid are exactly the Exit Desk numbers (exits.horizon_signals), replayed point-in-time.
long is a self-relative percentile of how far price is above its 200-day and 200-week trend.
main.py passes in valued_holdings() and gather_scored_assets() so there is no import cycle.
"""

from __future__ import annotations

import math
import time
from bisect import bisect_left, insort
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import charts
import exits

BUY_MAX = 30.0   # risk < BUY_MAX is the buy zone
SELL_MIN = 70.0  # risk >= SELL_MIN is the sell zone; in between is hold
BUCKETS = 180              # downsample buckets (averaged) for long ranges
SHRINK_N = 730             # prior values at which the long percentile is fully trusted
RANGE_DAYS = {"1Y": 365, "3Y": 3 * 365, "5Y": 5 * 365, "MAX": None}
HORIZONS = ("long", "mid", "short")
CACHE_TTL = 6 * 3600       # fetched series + its point-in-time risk values
HEAT_WINDOW = 400          # trailing closes fed to exits.horizon_signals for each day
SHORT_MID_DAYS = 6 * 365   # short/mid are only replayed for the most recent ~6 years (cost)
MIN_PRIOR = 365            # prior observations needed before a percentile is defined
MIN_WEEKLY_HISTORY = 1400  # days of history before the 200-week measure exists
CRYPTO_SPAN = 12 * 365 * 86400

_cache: dict[str, tuple[float, list[dict]]] = {}


def zone_for(risk: float | None) -> str | None:
    """Bucket a 0-100 risk reading into buy / hold / sell."""
    if risk is None:
        return None
    return "buy" if risk < BUY_MAX else "sell" if risk >= SELL_MIN else "hold"


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
        out.append({"kind": kind, "symbol": sym, "qty": a["qty"], "value": a["value"], "price": a["price"], "basis": basis})
    return out


def _fetch(kind: str, sym: str):
    if kind == "stock":
        return charts._yahoo(sym, "max", "1d") or charts._yahoo(sym, "10y", "1d")
    return charts._coinbase(sym, 86400, CRYPTO_SPAN)


def _shrink(pct: float, n_prior: int) -> float:
    """Pull a young base's percentile toward 50 (it swings 0<->100 while few prior values exist)."""
    return 50 + (pct - 50) * min(1.0, n_prior / SHRINK_N)


def risk_series(kind: str, sym: str) -> list[dict]:
    """Daily rows for the whole available history, cached for CACHE_TTL.

    Row: {date, price, short, mid, long, r1, p1, r2, p2}. Every value at day i uses only data up
    to day i. short/mid = average heat of exits' short/mid signals on closes[i-399:i+1].
    long = mean of expanding-window percentiles of ln(price / 200-day SMA) (r1/p1) and
    ln(price / 200-week SMA) (r2/p2, once >= 1400 days exist). Failures return [] and aren't cached.
    """
    key = f"{kind}:{sym}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    try:
        raw = _fetch(kind, sym)
    except Exception:
        return []
    days: dict[str, float] = {}
    for t, p in raw or []:
        if p and p > 0:
            days[datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d")] = float(p)
    dates = sorted(days)
    closes = [days[d] for d in dates]
    n = len(closes)
    if n == 0:
        return []
    step = 7 if kind == "crypto" else 5  # daily closes per weekly close
    wk_span = step * 199
    # Percentile against the asset's own past: 100 = the most stretched this asset has ever been
    # vs its trend, 0 = the deepest discount. Fixed thresholds (e.g. "Mayer > 2.4") pin every
    # later cycle top at 100 because each bull run stretches less than the last; ranking against
    # history instead lets diminishing-return tops land around 80-90 and keeps 100 for new extremes.
    hist1: list[float] = []
    hist2: list[float] = []
    rows: list[dict] = []
    csum = [0.0]
    for c in closes:
        csum.append(csum[-1] + c)
    first_sm = max(0, n - SHORT_MID_DAYS)
    for i in range(n):
        price = closes[i]
        row = {"date": dates[i], "price": price, "short": None, "mid": None, "long": None,
               "r1": None, "p1": None, "r2": None, "p2": None}
        pcts = []
        if i >= 199:
            m1 = math.log(price / ((csum[i + 1] - csum[i - 199]) / 200))
            if len(hist1) >= MIN_PRIOR:
                row["p1"] = _shrink(bisect_left(hist1, m1) / len(hist1) * 100, len(hist1))
                pcts.append(row["p1"])
            row["r1"] = math.exp(m1)
            insort(hist1, m1)
        if n and i + 1 >= MIN_WEEKLY_HISTORY and i >= wk_span:
            m2 = math.log(price / (sum(closes[i - wk_span: i + 1: step]) / 200))
            if len(hist2) >= MIN_PRIOR:
                row["p2"] = _shrink(bisect_left(hist2, m2) / len(hist2) * 100, len(hist2))
                pcts.append(row["p2"])
            row["r2"] = math.exp(m2)
            insort(hist2, m2)
        if pcts:
            row["long"] = round(sum(pcts) / len(pcts), 1)
        if i >= first_sm:
            hs = exits.horizon_signals(kind, closes[max(0, i - HEAT_WINDOW + 1): i + 1], price)
            for h in ("short", "mid"):
                v = [s["heat"] for s in hs[h] if s["heat"] is not None]
                if v:
                    row[h] = round(sum(v) / len(v), 1)
        rows.append(row)
    _cache[key] = (time.time(), rows)
    return rows


def build_zones(valued: dict, assets: list[dict]) -> dict:
    """Held assets with latest risk per horizon, plus a watchlist of scored assets not held."""
    held = _aggregate(valued.get("holdings", []))

    def latest(h: dict):
        try:
            rows = risk_series(h["kind"], h["symbol"])
            if not rows:
                return None
            last = rows[-1]
            return {k: (round(last[k]) if last[k] is not None else None) for k in HORIZONS}
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        risks = list(pool.map(latest, held))
    total = valued.get("value") or sum(h["value"] for h in held)
    rows = []
    for h, rk in zip(held, risks):
        price, basis = h["price"], h["basis"]
        rows.append({
            "kind": h["kind"], "symbol": h["symbol"], "value": round(h["value"], 2),
            "weight_pct": round(h["value"] / total * 100, 1) if total else 0.0,
            "gain_pct": round((price / basis - 1) * 100, 2) if price is not None and basis else None,
            "price": price, "risk": rk, "qty": h["qty"], "cost_basis": basis,
        })
    rows.sort(key=lambda r: r["value"], reverse=True)
    held_keys = {(r["kind"], r["symbol"]) for r in rows}
    watch = [{"kind": a["kind"], "symbol": str(a["symbol"]).upper()}
             for a in assets if (a["kind"], str(a["symbol"]).upper()) not in held_keys]
    watch.sort(key=lambda w: (w["symbol"], w["kind"]))
    return {"holdings": rows, "watch": watch}


def _downsample(rows: list[dict], buckets: int = BUCKETS) -> list[dict]:
    """Average into equal buckets so long ranges draw a calm line instead of daily zig-zags.
    Each bucket becomes its last day's date/price with the mean risk; the final day stays exact."""
    if len(rows) <= buckets:
        return rows
    out = []
    size = len(rows) / buckets
    for b in range(buckets):
        chunk = rows[int(b * size):int((b + 1) * size)]
        if not chunk:
            continue
        vals = [r["risk"] for r in chunk if r["risk"] is not None]
        out.append({**chunk[-1], "risk": round(sum(vals) / len(vals), 1) if vals else None})
    out[-1] = rows[-1]
    return out


def _ordinal(x: float) -> str:
    k = int(round(x))
    suf = "th" if 10 <= k % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(k % 10, "th")
    return f"{k}{suf}"


def _signals(kind: str, horizon: str, rows: list[dict]) -> list[dict]:
    """What drives the latest reading for this horizon."""
    last = rows[-1]
    if horizon == "long":
        out = []
        if last["r1"] is not None and last["p1"] is not None:
            out.append({"name": "vs 200-day average", "value": f"{last['r1']:.2f}× · {_ordinal(last['p1'])} pct",
                        "note": "Price ÷ its 200-day average. The percentile ranks this against every earlier day for this asset."})
        if last["r2"] is not None and last["p2"] is not None:
            out.append({"name": "vs 200-week average", "value": f"{last['r2']:.2f}× · {_ordinal(last['p2'])} pct",
                        "note": "Price ÷ its 200-week average, the multi-year trend. Ranked against this asset's own past."})
        return out
    closes = [r["price"] for r in rows[-HEAT_WINDOW:]]
    hs = exits.horizon_signals(kind, closes, closes[-1])
    return [{"name": s["name"], "value": s["value"], "note": s["note"]} for s in hs[horizon]]


def _odds(kind: str, horizon: str, rows: list[dict]) -> dict:
    """Of past days with a similar risk (+-5 of today's), how often was price higher 3 months / 1 year later."""
    now = rows[-1][horizon]
    out = {"m3": None, "y1": None, "n": 0}
    if now is None:
        return out
    h3, h1 = (90, 365) if kind == "crypto" else (63, 252)
    last = len(rows) - 1
    res = {}
    for key, h in (("m3", h3), ("y1", h1)):
        up = n = 0
        for i in range(last - h + 1):  # only days that have h days of future data
            r = rows[i][horizon]
            if r is not None and abs(r - now) <= 5:
                n += 1
                up += rows[i + h]["price"] > rows[i]["price"]
        res[key] = (n, round(up / n * 100) if n >= 20 else None)
    out["m3"], out["y1"], out["n"] = res["m3"][1], res["y1"][1], res["y1"][0]
    return out


def zone_chart(kind: str, symbol: str, rng: str = "1Y", horizon: str = "long") -> dict:
    """Price + point-in-time risk for one asset over 1Y/3Y/5Y/MAX; stats use the full daily slice."""
    sym = symbol.upper()
    out: dict = {"symbol": sym, "kind": kind, "range": rng, "horizon": horizon, "points": [],
                 "now": None, "odds": None, "peak": None, "trough": None, "zone_share": None, "signals": []}
    all_rows = risk_series(kind, sym)
    if not all_rows:
        return out
    rows = all_rows
    days = RANGE_DAYS.get(rng)
    if days is not None:
        cutoff = (datetime.fromisoformat(rows[-1]["date"]) - timedelta(days=days)).strftime("%Y-%m-%d")
        rows = [r for r in rows if r["date"] >= cutoff]
    first = next((i for i, r in enumerate(rows) if r[horizon] is not None), None)
    if first is None:
        return out
    rows = rows[first:]  # no leading null-risk run: the zone gradient needs risk at the left edge
    pts = [{"date": r["date"], "price": r["price"], "risk": r[horizon]} for r in rows]
    scored = [p for p in pts if p["risk"] is not None]
    last = pts[-1]
    out["now"] = {"risk": last["risk"], "label": exits.label(last["risk"]), "price": last["price"], "date": last["date"]}
    if scored:
        zs = [zone_for(p["risk"]) for p in scored]
        out["zone_share"] = {z: round(zs.count(z) / len(zs) * 100, 1) for z in ("buy", "hold", "sell")}
    out["points"] = _downsample(pts)
    drawn = [p for p in out["points"] if p["risk"] is not None]
    if drawn:  # peak/trough come from the drawn line so the marker sits on it
        out["peak"] = dict(max(drawn, key=lambda p: p["risk"]))
        out["trough"] = dict(min(drawn, key=lambda p: p["risk"]))
    out["odds"] = _odds(kind, horizon, all_rows)
    out["signals"] = _signals(kind, horizon, all_rows)
    return out
