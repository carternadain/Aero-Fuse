"""Risk zones: where each holding sits on a 0-100 RISK scale (0 = deep value / accumulate,
100 = most stretched / sell), over three horizons: long (macro, default), mid and short.

short / mid are exactly the Exit Desk numbers (exits.horizon_signals), replayed point-in-time.
long (stocks) is a self-relative percentile of how far price is above its 200-day and 200-week trend.
long (crypto) blends that trend read with the ~4-year cycle: distance from the all-time high, months
since the last Bitcoin halving and, for altcoins, strength vs BTC (see compute_rows).
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
    return charts._coinbase(sym, 86400, CRYPTO_SPAN) or charts.crypto_daily_fallback(sym, CRYPTO_SPAN // 86400)


def _shrink(pct: float, n_prior: int) -> float:
    """Pull a young base's percentile toward 50 (it swings 0<->100 while few prior values exist)."""
    return 50 + (pct - 50) * min(1.0, n_prior / SHRINK_N)


# ── crypto long term: where it sits in the ~4-year cycle ──────────────────────────────
# A stock's long-term read asks "how stretched is price versus its own trend". For crypto that
# misreads a coin that is up hard off a deep low: it ranks as stretched against its own short
# history even when it is a fraction of its prior high and early in the cycle. So crypto blends
# the trend read with cycle measures, all from free daily closes:
#   - from all-time high: how much of the last cycle's high has been won back,
#   - halving clock: months since the last Bitcoin halving. Past tops came 12-18 months after a
#     halving (Dec 2013, Dec 2017, Nov 2021, Oct 2025) and bottoms 26-32 months after,
#   - altcoins only: strength vs BTC (an alt running far ahead of BTC is late-cycle behaviour).
HALVINGS = ("2012-11-28", "2016-07-09", "2020-05-11", "2024-04-20", "2028-04-15")
CYCLE_MONTHS = 47.5
# (months since halving, heat). Peak ~17 months after; trough ~30 months after.
CYCLE_CURVE = ((0, 35), (6, 38), (12, 72), (17, 100), (20, 90), (24, 55), (28, 20),
               (31, 8), (36, 15), (42, 28), (CYCLE_MONTHS, 35))
ATH_FLOOR = 0.20         # at 20% of its high (-80%) the ATH read is 0; at the high it is 100
STRETCH_MIN = 0.3        # far below its high, trend/vs-BTC stretch counts this fraction of itself
ATH_MIN_DAYS = 365       # the high needs about a year of history behind it to mean something
W_MAJOR = {"trend": 0.35, "ath": 0.20, "cycle": 0.45}
W_ALT = {"trend": 0.25, "btc": 0.15, "ath": 0.20, "cycle": 0.40}
MAJORS = {"BTC", "ETH"}
_HALV_ORD = [datetime.fromisoformat(d).date().toordinal() for d in HALVINGS]


def months_since_halving(date_str: str) -> float | None:
    """Months (30.44-day) since the most recent halving on or before date_str."""
    o = datetime.fromisoformat(date_str[:10]).date().toordinal()
    prev = [h for h in _HALV_ORD if h <= o]
    if not prev:
        return None
    return (o - prev[-1]) / 30.44


def cycle_heat(months: float | None) -> float | None:
    """0-100 from the halving clock: 100 where past cycle tops landed, ~8 where bottoms did."""
    if months is None:
        return None
    m = months % CYCLE_MONTHS
    for (x0, y0), (x1, y1) in zip(CYCLE_CURVE, CYCLE_CURVE[1:]):
        if x0 <= m <= x1:
            return y0 + (y1 - y0) * (m - x0) / (x1 - x0)
    return float(CYCLE_CURVE[-1][1])


def ath_heat(price: float, ath: float) -> float:
    """100 at the all-time high, 0 at -80% or lower, log-scaled (-62% reads 40)."""
    frac = min(1.0, price / ath) if ath > 0 else 1.0
    return max(0.0, min(100.0, 100 * (1 - math.log(1 / frac) / math.log(1 / ATH_FLOOR))))


def damp_stretch(heat: float | None, ath_h: float | None) -> float | None:
    """A sharp rally off a deep low ranks as 'stretched' against a coin's own trend, but a coin
    far below its high has room before that stretch means a top. So the part of the trend /
    vs-BTC heat above 50 is scaled by how close price is to its high (never below STRETCH_MIN).
    Readings under 50 are left alone, so real bottoms still read cold."""
    if heat is None or ath_h is None or heat <= 50:
        return heat
    return 50 + (heat - 50) * max(STRETCH_MIN, ath_h / 100)


def vs_btc_heat(ratio_dev: float) -> float:
    """ln(alt/BTC ÷ its 200-day average): doubling vs that trend reads 100, halving reads 0."""
    return max(0.0, min(100.0, 50 + 50 * ratio_dev / math.log(2)))


def compute_rows(kind: str, sym: str, dates: list[str], closes: list[float],
                 btc: dict[str, float] | None = None, short_mid: bool = True) -> list[dict]:
    """Point-in-time risk rows for one asset's daily closes. Pure: no I/O.

    Row: {date, price, short, mid, long, r1, p1, r2, p2}; crypto rows add
    {trend, ath, ath_pct, months, cyc, ath_h, btc_dev, btc_h}. Every value at day i uses only data
    up to day i. short/mid = average heat of exits' short/mid signals on closes[i-399:i+1].
    trend = mean of expanding-window percentiles of ln(price / 200-day SMA) (r1/p1) and
    ln(price / 200-week SMA) (r2/p2, once >= 1400 days exist). Stocks: long = trend.
    Crypto: long = weighted blend of trend, all-time-high distance, halving clock and (alts)
    strength vs BTC; the weights renormalise over whichever parts exist that day.
    """
    n = len(closes)
    if n == 0:
        return []
    crypto = kind == "crypto"
    major = sym.upper() in MAJORS
    weights = W_MAJOR if (major or not btc) else W_ALT
    step = 7 if crypto else 5  # daily closes per weekly close
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
    first_sm = max(0, n - SHORT_MID_DAYS) if short_mid else n
    ath = 0.0
    rwin: list[float] = []
    rsum = 0.0
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
        if i + 1 >= MIN_WEEKLY_HISTORY and i >= wk_span:
            m2 = math.log(price / (sum(closes[i - wk_span: i + 1: step]) / 200))
            if len(hist2) >= MIN_PRIOR:
                row["p2"] = _shrink(bisect_left(hist2, m2) / len(hist2) * 100, len(hist2))
                pcts.append(row["p2"])
            row["r2"] = math.exp(m2)
            insort(hist2, m2)
        trend = sum(pcts) / len(pcts) if pcts else None
        if not crypto:
            row["long"] = round(trend, 1) if trend is not None else None
        else:
            ath = max(ath, price)
            row["ath"] = ath
            row["ath_pct"] = (price / ath - 1) * 100
            row["months"] = months_since_halving(dates[i])
            row["cyc"] = cycle_heat(row["months"])
            row["trend"] = trend
            ath_h = ath_heat(price, ath)
            row["ath_h"] = ath_h if i + 1 >= ATH_MIN_DAYS else None
            row["btc_dev"] = row["btc_h"] = None
            if btc and not major:
                b = btc.get(dates[i])
                if b:
                    rwin.append(price / b)
                    rsum += rwin[-1]
                    if len(rwin) > 200:
                        rsum -= rwin.pop(0)
                    if len(rwin) == 200:
                        row["btc_dev"] = math.log(rwin[-1] / (rsum / 200))
                        row["btc_h"] = vs_btc_heat(row["btc_dev"])
            parts = {"trend": damp_stretch(trend, ath_h), "ath": row["ath_h"], "cycle": row["cyc"],
                     "btc": damp_stretch(row["btc_h"], ath_h)}
            have = {k: v for k, v in parts.items() if v is not None and k in weights}
            # Needs a read of the asset itself; the halving clock alone isn't one.
            if "trend" in have or "ath" in have:
                tw = sum(weights[k] for k in have)
                row["long"] = round(sum(v * weights[k] for k, v in have.items()) / tw, 1)
        if i >= first_sm:
            hs = exits.horizon_signals(kind, closes[max(0, i - HEAT_WINDOW + 1): i + 1], price)
            for h in ("short", "mid"):
                v = [s["heat"] for s in hs[h] if s["heat"] is not None]
                if v:
                    row[h] = round(sum(v) / len(v), 1)
        rows.append(row)
    return rows


def _daily_map(raw) -> dict[str, float]:
    days: dict[str, float] = {}
    for t, p in raw or []:
        if p and p > 0:
            days[datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d")] = float(p)
    return days


def risk_series(kind: str, sym: str) -> list[dict]:
    """Daily risk rows for the whole available history (see compute_rows), cached for CACHE_TTL.
    Failures return [] and aren't cached."""
    sym = sym.upper()
    key = f"{kind}:{sym}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    try:
        raw = _fetch(kind, sym)
    except Exception:
        return []
    days = _daily_map(raw)
    dates = sorted(days)
    if not dates:
        return []
    btc = None
    if kind == "crypto" and sym not in MAJORS:
        try:
            btc = {r["date"]: r["price"] for r in risk_series("crypto", "BTC")} or None
        except Exception:
            btc = None
    rows = compute_rows(kind, sym, dates, [days[d] for d in dates], btc)
    _cache[key] = (time.time(), rows)
    return rows


LONG_WORDS_STOCK = {"Washed out": "washed out", "Cold": "cheap", "Cool": "on the cheap side", "Neutral": "fair",
                    "Warm": "warm", "Hot": "stretched", "Overheated": "very stretched"}


def read_line(kind: str, horizon: str, risk: float | None, ath_pct: float | None = None,
              months: float | None = None) -> str | None:
    """A few plain words for one horizon, e.g. 'hot' or 'room to run (62% below its high)'."""
    if risk is None:
        return None
    if horizon != "long":
        return exits.label(risk).lower()
    if kind != "crypto":
        return LONG_WORDS_STOCK[exits.label(risk)]
    below = ath_pct is not None and ath_pct <= -10
    tail = (f" ({abs(ath_pct):.0f}% below its high)" if below
            else " (at its high)" if ath_pct is not None and ath_pct > -3 else "")
    # The year after a halving (and the run-up just before one) is when breakouts are normal.
    early = months is not None and not (12 <= months % CYCLE_MONTHS < CYCLE_MONTHS - 4)
    if risk >= SELL_MIN:
        word = "stretched, early in the cycle" if early else "late in the cycle"
    elif risk >= 58:
        word = "warm" if early else "getting late"
    elif risk >= BUY_MAX:
        word = "room to run" if below and ath_pct <= -30 else "mid-cycle"
    else:
        word = "cheap"
    return word + tail


def reads(kind: str, last: dict) -> dict:
    """{horizon: {risk, text}} for the latest row."""
    return {h: {"risk": round(last[h]) if last.get(h) is not None else None,
                "text": read_line(kind, h, last.get(h), last.get("ath_pct"), last.get("months"))}
            for h in HORIZONS}


def build_zones(valued: dict, assets: list[dict]) -> dict:
    """Held assets with latest risk per horizon, plus a watchlist of scored assets not held."""
    held = _aggregate(valued.get("holdings", []))

    def latest(h: dict):
        try:
            rows = risk_series(h["kind"], h["symbol"])
            if not rows:
                return None
            last = rows[-1]
            rd = reads(h["kind"], last)
            return {"risk": {k: rd[k]["risk"] for k in HORIZONS}, "read": {k: rd[k]["text"] for k in HORIZONS},
                    "ath_pct": round(last["ath_pct"], 1) if last.get("ath_pct") is not None else None}
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        risks = list(pool.map(latest, held))
    total = valued.get("value") or sum(h["value"] for h in held)
    rows = []
    for h, lt in zip(held, risks):
        price, basis = h["price"], h["basis"]
        lt = lt or {}
        rows.append({
            "kind": h["kind"], "symbol": h["symbol"], "value": round(h["value"], 2),
            "weight_pct": round(h["value"] / total * 100, 1) if total else 0.0,
            "gain_pct": round((price / basis - 1) * 100, 2) if price is not None and basis else None,
            "price": price, "risk": lt.get("risk"), "read": lt.get("read"), "from_ath_pct": lt.get("ath_pct"),
            "qty": h["qty"], "cost_basis": basis,
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
        if kind == "crypto":
            if last.get("ath_pct") is not None:
                a = last["ath"]
                hi = f"{a:,.0f}" if a >= 1000 else f"{a:.2f}" if a >= 1 else f"{a:.4g}"
                out.append({"name": "From all-time high", "value": f"{last['ath_pct']:+.0f}% · high ${hi}",
                            "note": "How much of its high it has won back. Crypto often returns to, and passes, the last cycle's high."})
            if last.get("months") is not None:
                out.append({"name": "Halving cycle", "value": f"Month {last['months'] % CYCLE_MONTHS:.0f} of ~48",
                            "note": "Months since the last Bitcoin halving. Past tops came 12-18 months after one; bottoms 26-32."})
            if last.get("btc_dev") is not None:
                out.append({"name": "vs Bitcoin", "value": f"{(math.exp(last['btc_dev']) - 1) * 100:+.0f}% vs 200-day",
                            "note": "Price in BTC vs its 200-day average. Alts racing far ahead of BTC is late-cycle behaviour."})
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
    # Reads for every horizon, even when this one has no reading yet (young coins, long term).
    out["reads"] = reads(kind, all_rows[-1])
    out["from_ath_pct"] = round(all_rows[-1]["ath_pct"], 1) if all_rows[-1].get("ath_pct") is not None else None
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
