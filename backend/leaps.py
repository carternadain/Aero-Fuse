"""LEAP checker: long-dated call options from free yfinance option chains.

The pure math (premium, breakeven, odds, payoff, default strike and expiry) has no I/O
and is unit-tested in tests/test_leaps.py. `leap_check` wraps it with a yfinance fetch,
a 15-minute cache and graceful failure ({"available": False}).

Model limits, stated in the UI: odds use a lognormal (Black-Scholes) model with the
option's own implied volatility and a flat interest rate. That prices European options
and ignores the IV smile, dividends and early exercise, so it is an estimate.
"""
from __future__ import annotations

import math
import threading
import time
from datetime import date

RATE = 0.04                # flat risk-free rate used in the lognormal model
LEAP_MIN_DAYS = 270        # ~9 months: shorter isn't really a LEAP
CONTRACT = 100             # shares per US equity option
CACHE_TTL = 15 * 60
FAIL_TTL = 2 * 60          # retry a failed fetch sooner
# Chip targets as strike / spot: ~10% in the money, at the money, 10% and 20% out.
STRIKE_TARGETS: list[tuple[str, float]] = [("10% ITM", 0.9), ("ATM", 1.0), ("10% OTM", 1.1), ("20% OTM", 1.2)]


# ── pure math ──────────────────────────────────────────────

def _ncdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def premium(bid, ask, last) -> float | None:
    """Mid of bid/ask when both are quoted and sane, else the last trade, else None."""
    b, a, l = _num(bid), _num(ask), _num(last)
    if b is not None and a is not None and b > 0 and a >= b:
        return round((b + a) / 2, 4)
    if l is not None and l > 0:
        return l
    return None


def breakeven(strike: float, prem: float) -> float:
    """Price the stock must be above at expiry for a long call to break even."""
    return strike + prem


def move_pct(spot: float, target: float) -> float:
    return (target / spot - 1.0) * 100.0


def prob_above(spot: float, target: float, iv: float, years: float, rate: float = RATE) -> float | None:
    """Lognormal odds that price finishes above `target` (N(d2), risk-neutral drift)."""
    if spot <= 0 or target <= 0 or iv is None or iv <= 0 or years <= 0:
        return None
    s = iv * math.sqrt(years)
    d2 = (math.log(spot / target) + (rate - 0.5 * iv * iv) * years) / s
    return _ncdf(d2)


def call_delta(spot: float, strike: float, iv: float, years: float, rate: float = RATE) -> float | None:
    if spot <= 0 or strike <= 0 or iv is None or iv <= 0 or years <= 0:
        return None
    s = iv * math.sqrt(years)
    return _ncdf((math.log(spot / strike) + (rate + 0.5 * iv * iv) * years) / s)


def bs_call(spot: float, strike: float, iv: float, years: float, rate: float = RATE) -> float:
    s = iv * math.sqrt(years)
    d1 = (math.log(spot / strike) + (rate + 0.5 * iv * iv) * years) / s
    return spot * _ncdf(d1) - strike * math.exp(-rate * years) * _ncdf(d1 - s)


def implied_vol(price: float, spot: float, strike: float, years: float, rate: float = RATE) -> float | None:
    """Back out IV from a call price by bisection; None if the price is outside model bounds."""
    if price is None or price <= 0 or spot <= 0 or strike <= 0 or years <= 0:
        return None
    lo, hi = 0.01, 5.0
    intrinsic = max(0.0, spot - strike * math.exp(-rate * years))
    if price <= intrinsic or price >= spot or bs_call(spot, strike, hi, years, rate) < price:
        return None
    for _ in range(80):
        mid = (lo + hi) / 2
        if bs_call(spot, strike, mid, years, rate) > price:
            hi = mid
        else:
            lo = mid
    return round((lo + hi) / 2, 4)


def payoff_at(price: float, strike: float, prem: float) -> float:
    """Profit or loss per contract at expiry for one long call."""
    return (max(price - strike, 0.0) - prem) * CONTRACT


def payoff_points(spot: float, strike: float, prem: float, n: int = 61) -> list[dict]:
    """Payoff line at expiry from ~45% below spot to past breakeven, kinked exactly at the strike."""
    be = breakeven(strike, prem)
    lo = min(spot * 0.55, strike * 0.8)
    hi = max(spot * 1.6, be * 1.25)
    xs = {lo + (hi - lo) * i / (n - 1) for i in range(n)} | {strike, be}
    return [{"price": round(x, 2), "pl": round(payoff_at(x, strike, prem), 2)} for x in sorted(xs)]


def pick_expiry(expiries: list[str], today: date) -> str | None:
    """Default expiry: the furthest one listed. LEAP chains end years out, so that's the most time."""
    valid = sorted(e for e in expiries if _days(e, today) > 0)
    return valid[-1] if valid else None


def leap_expiries(expiries: list[str], today: date, min_days: int = LEAP_MIN_DAYS, fallback: int = 3) -> list[str]:
    """Expiries worth offering: everything at least ~9 months out, else the furthest few."""
    valid = sorted(e for e in expiries if _days(e, today) > 0)
    long_ = [e for e in valid if _days(e, today) >= min_days]
    return long_ if long_ else valid[-fallback:]


def strike_choices(strikes: list[float], spot: float) -> list[dict]:
    """Snap each target (10% ITM, ATM, 10%/20% OTM) to the nearest listed strike, deduped.

    The default is the ATM chip: the listed strike closest to spot.
    """
    ks = sorted({float(k) for k in strikes if k and k > 0})
    if not ks or spot <= 0:
        return []
    out: list[dict] = []
    seen: set[float] = set()
    for label, f in STRIKE_TARGETS:
        k = min(ks, key=lambda x: (abs(x - spot * f), x))
        if k in seen:
            continue
        seen.add(k)
        out.append({"strike": k, "label": label, "default": label == "ATM"})
    if not any(c["default"] for c in out):
        out[0]["default"] = True
    return out


def _days(expiry: str, today: date) -> int:
    try:
        return (date.fromisoformat(expiry) - today).days
    except ValueError:
        return -1


def build_contract(row: dict, spot: float, years: float) -> dict | None:
    """One strike's numbers from a chain row (strike, bid, ask, lastPrice, impliedVolatility, openInterest)."""
    k = _num(row.get("strike"))
    p = premium(row.get("bid"), row.get("ask"), row.get("lastPrice"))
    if k is None or p is None:
        return None
    iv = _num(row.get("impliedVolatility"))
    # yfinance IVs on thin LEAP quotes are often junk (0.00001 or 3+); back it out of the premium instead.
    if iv is None or iv < 0.03 or iv > 3:
        iv = implied_vol(p, spot, k, years)
    be = breakeven(k, p)
    oi = _num(row.get("openInterest"))
    return {
        "strike": k,
        "bid": _num(row.get("bid")),
        "ask": _num(row.get("ask")),
        "premium": round(p, 2),
        "cost": round(p * CONTRACT, 2),
        "breakeven": round(be, 2),
        "move_pct": round(move_pct(spot, be), 2),
        "iv": round(iv, 4) if iv else None,
        "odds": round(prob_above(spot, be, iv, years), 4) if iv else None,
        "delta": round(call_delta(spot, k, iv, years), 3) if iv else None,
        "open_interest": int(oi) if oi is not None else None,
        "payoff": payoff_points(spot, k, p),
    }


def summarize(symbol: str, spot: float, expiries: list[str], expiry: str, rows: list[dict], today: date) -> dict:
    """Assemble the response from a fetched chain. Pure, so it's testable without network."""
    days = _days(expiry, today)
    years = max(days, 1) / 365.0
    by_strike = {float(r["strike"]): r for r in rows if _num(r.get("strike"))}
    quoted = [k for k, r in by_strike.items() if premium(r.get("bid"), r.get("ask"), r.get("lastPrice")) is not None]
    choices = strike_choices(quoted, spot)
    contracts = []
    for c in choices:
        built = build_contract(by_strike[c["strike"]], spot, years)
        if built:
            contracts.append({**built, "label": c["label"], "default": c["default"]})
    if contracts and not any(c["default"] for c in contracts):
        contracts[0]["default"] = True
    return {
        "available": bool(contracts),
        "symbol": symbol,
        "spot": round(spot, 2),
        "expiries": [{"date": e, "days": _days(e, today)} for e in leap_expiries(expiries, today)],
        "expiry": expiry,
        "days": days,
        "is_leap": days >= LEAP_MIN_DAYS,
        "rate": RATE,
        "contracts": contracts,
    }


# ── fetch + cache ──────────────────────────────────────────

_cache: dict[str, tuple[float, float, dict]] = {}   # key -> (stored_at, ttl, value)
_lock = threading.Lock()


def _cached(key: str):
    with _lock:
        hit = _cache.get(key)
    if hit and time.time() - hit[0] < hit[1]:
        return hit[2]
    return None


def _store(key: str, value: dict, ttl: float):
    with _lock:
        _cache[key] = (time.time(), ttl, value)


def _spot(tk) -> float | None:
    try:
        p = _num(tk.fast_info["lastPrice"])
        if p and p > 0:
            return p
    except Exception:
        pass
    try:
        hist = tk.history(period="5d")
        if len(hist):
            return float(hist["Close"].iloc[-1])
    except Exception:
        pass
    return None


def leap_check(symbol: str, expiry: str | None = None, today: date | None = None) -> dict:
    sym = symbol.upper().strip()
    key = f"{sym}:{expiry or ''}"
    hit = _cached(key)
    if hit is not None:
        return hit
    today = today or date.today()
    unavailable = {"available": False, "symbol": sym}
    try:
        import yfinance as yf
        tk = yf.Ticker(sym)
        expiries = list(tk.options or [])
        spot = _spot(tk)
        exp = expiry if expiry in expiries else pick_expiry(expiries, today)
        if not expiries or not spot or not exp:
            _store(key, unavailable, FAIL_TTL)
            return unavailable
        calls = tk.option_chain(exp).calls
        rows = calls[["strike", "bid", "ask", "lastPrice", "impliedVolatility", "openInterest"]].to_dict("records")
        out = summarize(sym, spot, expiries, exp, rows, today)
    except Exception:
        _store(key, unavailable, FAIL_TTL)
        return unavailable
    _store(key, out, CACHE_TTL if out["available"] else FAIL_TTL)
    return out
