"""Exit Desk: how stretched each holding is over three horizons, plus the user's own
take-profit / stop rules and option time-decay math.

Nothing here says "sell". Each signal is a plain measurement (RSI, distance from a
moving average in units of the asset's own volatility, where it sits in its range,
funding rates…) mapped to a 0–100 "heat" scale, with the thresholds written down
next to it, so the reading can be checked rather than trusted.
"""

from __future__ import annotations

import math
import re
import statistics
from datetime import date, datetime, timezone

import requests

import charts
import db
import market_data
import scoring
from extras import _jget, _jset
from market_data import _get, _set

UA = {"User-Agent": "swing-terminal/1.0"}
OCC = re.compile(r"([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})")


def clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def label(h: float | None) -> str:
    if h is None:
        return "No data"
    return ("Washed out" if h < 15 else "Cold" if h < 30 else "Cool" if h < 45 else "Neutral" if h < 58
            else "Warm" if h < 70 else "Hot" if h < 82 else "Overheated")


# ── market backdrop ───────────────────────────────────────

def fear_greed() -> dict | None:
    hit = _get("fng", 3600)
    if hit is not None:
        return hit  # type: ignore[return-value]
    try:
        d = requests.get("https://api.alternative.me/fng/?limit=31", headers=UA, timeout=8).json()["data"]
        vals = [int(x["value"]) for x in d]
        out = {"value": vals[0], "label": d[0]["value_classification"],
               "week_ago": vals[7] if len(vals) > 7 else None, "month_avg": round(sum(vals) / len(vals))}
    except Exception as e:
        print(f"[exits] fear&greed error: {e}")
        out = None
    if out:
        _set("fng", out)
    return out


def funding(sym: str) -> dict | None:
    """OKX perpetual funding for a coin: current 8h rate and 7-day average (as % per 8h)."""
    key = f"funding:{sym}"
    hit = _get(key, 1800)
    if hit is not None:
        return hit or None  # type: ignore[return-value]
    out: dict | None = None
    try:
        r = requests.get("https://www.okx.com/api/v5/public/funding-rate-history",
                         params={"instId": f"{sym}-USDT-SWAP", "limit": 21}, headers=UA, timeout=8).json()
        rates = [float(x["realizedRate"] or x["fundingRate"]) * 100 for x in r.get("data") or []]
        if rates:
            out = {"current": round(rates[0], 4), "avg_7d": round(sum(rates) / len(rates), 4),
                   "annualized": round(sum(rates) / len(rates) * 3 * 365, 1)}
    except Exception as e:
        print(f"[exits] funding {sym} error: {e}")
    _set(key, out or {})
    return out


# ── per-asset heat ────────────────────────────────────────

def _daily(kind: str, sym: str) -> list[float]:
    if kind == "crypto":
        return [p for _, p in charts.series("crypto", sym, "1Y")]
    return market_data.stock_history(sym)


def _weekly_long(kind: str, sym: str) -> list[float]:
    s = charts.series(kind, sym, "5Y")
    if kind == "crypto":  # daily candles over 5y -> weekly closes
        s = s[6::7]
    return [p for _, p in s]


def _sig(name: str, value: str, heat: float | None, note: str) -> dict:
    return {"name": name, "value": value, "heat": round(heat, 1) if heat is not None else None, "note": note}


def _vol(closes: list[float]) -> float:
    """Daily stdev of the last 60 returns, floored."""
    rets = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes)) if closes[i - 1]]
    vol = statistics.pstdev(rets[-60:]) if len(rets) > 10 else 0.03
    return max(vol, 0.004)


def _z_vs(closes: list[float], price: float, vol: float, n: int):
    sma = scoring.sma(closes, n)
    if not sma:
        return None, None
    dev = price / sma - 1
    return dev, dev / (vol * math.sqrt(n))


def horizon_signals(kind: str, closes: list[float], price: float) -> dict:
    """Pure short / mid signal math. `closes` must already end with `price`. No I/O, no funding."""
    vol = _vol(closes)
    short, mid = [], []

    def z_vs(n: int):
        return _z_vs(closes, price, vol, n)

    r = scoring.rsi(closes, 14)
    if r is not None:
        short.append(_sig("RSI (14-day)", f"{r:.0f}", clamp((r - 30) / 50 * 100),
                          "Above 70 is the classic overbought line; under 30 oversold."))
    dev, z = z_vs(20)
    if z is not None:
        short.append(_sig("vs 20-day average", f"{dev * 100:+.1f}% ({z:+.1f}σ)", clamp(50 + z * 28),
                          "How far price has run from its 1-month average, in units of its own volatility."))
    if len(closes) >= 20:
        win = closes[-20:]
        m, sd = statistics.mean(win), statistics.pstdev(win)
        if sd:
            pb = (price - (m - 2 * sd)) / (4 * sd)
            short.append(_sig("Bollinger %B", f"{pb * 100:.0f}%", clamp(pb * 100),
                              "100% = at the upper band (2σ above the 20-day mean), 0% = lower band."))
    if len(closes) > 8:
        c7 = price / closes[-8] - 1
        z7 = c7 / (vol * math.sqrt(7))
        short.append(_sig("7-day move", f"{c7 * 100:+.1f}% ({z7:+.1f}σ)", clamp(50 + z7 * 22),
                          "A move several σ above normal for one week tends to cool off or consolidate."))

    dev, z = z_vs(50)
    if z is not None:
        mid.append(_sig("vs 50-day average", f"{dev * 100:+.1f}% ({z:+.1f}σ)", clamp(50 + z * 26),
                        "Distance from the ~2.5-month trend line, volatility-adjusted."))
    weekly = closes[::-1][::7][::-1] if kind == "crypto" else closes[::-1][::5][::-1]
    wr = scoring.rsi(weekly, 14)
    if wr is not None:
        mid.append(_sig("Weekly RSI (14-week)", f"{wr:.0f}", clamp((wr - 35) / 45 * 100),
                        "Slower RSI: readings above ~75 have marked stretched multi-month runs."))
    n3 = 90 if kind == "crypto" else 63
    if len(closes) > n3:
        c3 = price / closes[-n3 - 1] - 1
        z3 = c3 / (vol * math.sqrt(n3))
        mid.append(_sig("3-month move", f"{c3 * 100:+.0f}% ({z3:+.1f}σ)", clamp(50 + z3 * 20),
                        "Quarter-long gain relative to how much this asset normally moves."))
    return {"short": short, "mid": mid}


def asset_heat(kind: str, sym: str, price: float | None = None) -> dict:
    key = f"heat:{kind}:{sym}"
    hit = _get(key, 2400)  # inputs are daily/weekly bars; the screeners warmer refreshes every 15 min
    if hit is not None:
        return hit  # type: ignore[return-value]
    closes = _daily(kind, sym)
    if price is None:
        price = market_data.live_quote(sym, kind).get("price") or (closes[-1] if closes else None)
    if len(closes) < 30 or not price:
        return {"short": None, "mid": None, "long": None, "overall": None, "signals": {"short": [], "mid": [], "long": []}}
    closes = closes[:-1] + [price]
    vol = _vol(closes)
    per = 365 if kind == "crypto" else 252
    hs = horizon_signals(kind, closes, price)
    short, mid, long_ = hs["short"], hs["mid"], []

    sma200 = scoring.sma(closes, 200)
    if sma200:
        mm = price / sma200
        if sym == "BTC":
            h = clamp((mm - 0.8) / (2.4 - 0.8) * 100)
            note = "Mayer multiple. Historically BTC under 0.8 was deep value and above 2.4 marked cycle tops."
        else:
            _, z = _z_vs(closes, price, vol, 200)
            h = clamp(50 + (z or 0) * 22)
            note = "Price ÷ 200-day average. Far above it = extended long-term trend."
        long_.append(_sig("vs 200-day average", f"{mm:.2f}×", h, note))
    window = closes[-per:]
    hi, lo = max(window), min(window)
    if hi > lo:
        pos = (price - lo) / (hi - lo)
        long_.append(_sig("52-week range", f"{pos * 100:.0f}% of range", pos * 100,
                          f"Low {lo:,.2f} → high {hi:,.2f}. Near 100% = trading at the top of its year."))
    wk = _weekly_long(kind, sym)
    if len(wk) >= 200:
        w200 = sum(wk[-200:]) / 200
        ratio = price / w200
        long_.append(_sig("vs 200-week average", f"{ratio:.2f}×",
                          clamp((ratio - 1) / (3.5 - 1) * 100) if kind == "crypto" else clamp((ratio - 1) / (2.2 - 1) * 100),
                          "Multi-year trend line. BTC has historically bottomed near 1.0× and topped far above it."))
    elif len(wk) > 20:
        ath = max(wk + [price])
        off = price / ath - 1
        long_.append(_sig("vs 5-year high", f"{off * 100:+.0f}%", clamp(100 + off * 150),
                          "At or near a multi-year high = more upside already priced in."))

    if kind == "crypto":
        f = funding(sym)
        if f:
            short.append(_sig("Perp funding (8h)", f"{f['current']:+.4f}%", clamp(50 + f["avg_7d"] / 0.03 * 40),
                              f"7-day avg {f['avg_7d']:+.4f}% (~{f['annualized']:+.0f}%/yr). High positive funding = "
                              "longs paying up, crowded leverage. Negative = shorts crowded."))

    def avg(xs):
        v = [x["heat"] for x in xs if x["heat"] is not None]
        return round(sum(v) / len(v), 1) if v else None

    s, m, l = avg(short), avg(mid), avg(long_)
    parts = [(s, 0.3), (m, 0.35), (l, 0.35)]
    tw = sum(w for v, w in parts if v is not None)
    overall = round(sum(v * w for v, w in parts if v is not None) / tw, 1) if tw else None
    out = {"short": s, "mid": m, "long": l, "overall": overall,
           "labels": {"short": label(s), "mid": label(m), "long": label(l), "overall": label(overall)},
           "daily_vol_pct": round(vol * 100, 2), "signals": {"short": short, "mid": mid, "long": long_}}
    _set(key, out)
    return out


# ── options ───────────────────────────────────────────────

def option_math(occ: str, premium: float | None, qty: float, cost_basis: float | None) -> dict | None:
    m = OCC.fullmatch(occ.upper())
    if not m:
        return None
    root, yy, mm, dd, cp, k = m.groups()
    strike = int(k) / 1000
    expiry = date(2000 + int(yy), int(mm), int(dd))
    dte = (expiry - datetime.now(timezone.utc).date()).days
    s = market_data.live_quote(root, "stock").get("price")
    call = cp == "C"
    out = {"underlying": root, "underlying_price": s, "strike": strike, "right": "call" if call else "put",
           "expiry": expiry.isoformat(), "dte": dte}
    if s is None or premium is None:
        return out
    intrinsic = max(0.0, s - strike) if call else max(0.0, strike - s)
    extrinsic = max(0.0, premium - intrinsic)
    be = strike + premium if call else strike - premium
    # time value of an option shrinks roughly with sqrt(time left), so it melts faster near expiry
    fade30 = extrinsic * (1 - math.sqrt(max(0, dte - 30) / dte)) if dte > 0 else extrinsic
    out.update({
        "moneyness_pct": round((s / strike - 1) * 100 if call else (strike / s - 1) * 100, 2),
        "itm": intrinsic > 0, "intrinsic": round(intrinsic * 100 * qty, 2), "time_value": round(extrinsic * 100 * qty, 2),
        "time_value_share": round(extrinsic / premium * 100, 1) if premium else None,
        "fade_30d": round(fade30 * 100 * qty, 2),
        "breakeven": round(be, 2), "to_breakeven_pct": round((be / s - 1) * 100, 2),
        "per_day_now": round(extrinsic / (2 * max(dte, 1)) * 100 * qty, 2),  # d/dt of c·sqrt(t) at t=dte
    })
    return out


# ── rules ─────────────────────────────────────────────────
# rules[key] = {"tp": [{"pct": 50, "trim": 25}, …], "stop": -30, "trail": 20, "heat": 80}

def rules() -> dict:
    return _jget("exit_rules", {})


def set_rule(key: str, rule: dict | None) -> dict:
    r = rules()
    if rule:
        r[key] = rule
    else:
        r.pop(key, None)
    _jset("exit_rules", r)
    return r


def evaluate(rule: dict, gain_pct: float | None, from_high_pct: float | None, heat: float | None) -> list[dict]:
    hits = []
    for t in sorted(rule.get("tp") or [], key=lambda t: t["pct"]):
        if gain_pct is not None and gain_pct >= t["pct"]:
            hits.append({"id": f"tp{t['pct']}", "tone": "up",
                         "text": f"Take-profit +{t['pct']:g}% reached" + (f" · your plan: trim {t['trim']:g}%" if t.get("trim") else "")})
    st = rule.get("stop")
    if st is not None and gain_pct is not None and gain_pct <= st:
        hits.append({"id": "stop", "tone": "down", "text": f"Stop {st:g}% hit (now {gain_pct:+.1f}%)"})
    tr = rule.get("trail")
    if tr and from_high_pct is not None and from_high_pct <= -tr:
        hits.append({"id": "trail", "tone": "down", "text": f"Trailing stop: {abs(from_high_pct):.0f}% off its 3-month high (rule {tr:g}%)"})
    hh = rule.get("heat")
    if hh and heat is not None and heat >= hh:
        hits.append({"id": "heat", "tone": "amber", "text": f"Heat {heat:.0f} ≥ your {hh:g} line"})
    return hits


def desk(holdings: list[dict]) -> dict:
    """Every position (same symbol across accounts combined) with heat, gain, options math, rules."""
    groups: dict[str, dict] = {}
    for h in holdings:
        if not h.get("value"):
            continue
        k = f"{h['kind']}:{h['symbol']}"
        g = groups.setdefault(k, {"key": k, "kind": h["kind"], "symbol": h["symbol"], "display": h.get("display", h["symbol"]),
                                  "qty": 0.0, "value": 0.0, "cost": 0.0, "cost_known": True, "price": h.get("price"),
                                  "change_1d": h.get("change_1d"), "note": h.get("note") or "", "accounts": []})
        g["qty"] += h["qty"]
        g["value"] += h["value"]
        if h.get("cost_basis"):
            g["cost"] += h["qty"] * h["cost_basis"] * h.get("multiplier", 1)
        else:
            g["cost_known"] = False
        g["accounts"].append(h.get("label") or "")
    total = sum(g["value"] for g in groups.values()) or 1
    rs = rules()
    rows = []
    for k, g in groups.items():
        if g["note"]:
            continue  # 401(k) proxy funds: not something you trade out of
        gain = (g["value"] / g["cost"] - 1) * 100 if g["cost_known"] and g["cost"] else None
        heat_kind, heat_sym = g["kind"], g["symbol"]
        opt = None
        if g["kind"] == "option":
            cb = (g["cost"] / (g["qty"] * 100)) if g["cost_known"] and g["qty"] else None
            opt = option_math(g["symbol"], g["price"], g["qty"], cb)
            if not opt:
                continue
            heat_kind, heat_sym = "stock", opt["underlying"]
        heat = asset_heat(heat_kind, heat_sym)
        closes = _daily(heat_kind, heat_sym)[-(90 if heat_kind == "crypto" else 63):]
        ref_price = opt["underlying_price"] if opt else g["price"]
        from_high = (ref_price / max(closes) - 1) * 100 if closes and ref_price else None
        rule = rs.get(k)
        rows.append({**g, "accounts": sorted(set(a for a in g["accounts"] if a)),
                     "gain_pct": round(gain, 2) if gain is not None else None,
                     "gain_usd": round(g["value"] - g["cost"], 2) if gain is not None else None,
                     "weight_pct": round(g["value"] / total * 100, 1), "heat": heat, "option": opt,
                     "from_high_pct": round(from_high, 1) if from_high is not None else None,
                     "rule": rule, "hits": evaluate(rule, gain, from_high, heat["overall"]) if rule else []})
    rows.sort(key=lambda r: (r["heat"]["overall"] is None, -(r["heat"]["overall"] or 0)))
    btc = asset_heat("crypto", "BTC")
    return {"rows": rows, "backdrop": {
        "fear_greed": fear_greed(), "btc_funding": funding("BTC"),
        "btc_heat": {"overall": btc["overall"], "label": btc.get("labels", {}).get("overall")},
        "btc_mayer": next((s["value"] for s in btc["signals"]["long"] if s["name"] == "vs 200-day average"), None),
        "spy_heat": asset_heat("stock", "SPY").get("overall"),
    }}


def check_rules(holdings: list[dict], notify) -> int:
    """Push each newly hit rule once; it can fire again after the condition clears."""
    fired = set(_jget("exit_fired", []))
    now_hits = set()
    sent = 0
    for r in desk(holdings)["rows"]:
        for h in r["hits"]:
            hid = f"{r['key']}:{h['id']}"
            now_hits.add(hid)
            if hid not in fired:
                notify(f"{r['display']}: {h['text']}", "Exit Desk rule — open the app to review", hid)
                sent += 1
    _jset("exit_fired", sorted(now_hits))
    return sent
