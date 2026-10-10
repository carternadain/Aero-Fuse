"""Watchlist stars, price alerts + web push, goals, dividend income, "why it's on the
list", and compare-mode series.

Everything user-owned here (stars, alerts, goals, push subscriptions, VAPID keys) is
stored as JSON in the settings table, so it lives in the server DB alongside the rest
of the private data and never in the repo.
"""

from __future__ import annotations

import base64
import json
import statistics
import time
import uuid
from datetime import datetime, timedelta, timezone

import charts
import db
import market_data
import scoring
import universe

# ── JSON settings helpers ─────────────────────────────────


def _jget(key: str, default):
    raw = db.get_setting(key)
    if not raw:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def _jset(key: str, value) -> None:
    db.set_setting(key, json.dumps(value))


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Kind lookup (crypto vs stock) ─────────────────────────

COMMON_CRYPTO = {"BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "DOT", "LTC", "BCH", "SHIB",
                 "SUI", "HBAR", "XLM", "TON", "TRX", "UNI", "AAVE", "NEAR", "APT", "PEPE", "ARB", "OP",
                 "ATOM", "FIL", "ICP", "INJ", "RENDER", "SEI", "TAO", "ONDO", "HYPE", "XMR", "ETC"}


def guess_kind(sym: str, holdings: list[dict] | None = None) -> str:
    sym = sym.upper()
    for h in holdings or []:
        if h["symbol"].upper() == sym and h["kind"] in ("crypto", "stock"):
            return h["kind"]
    if sym in COMMON_CRYPTO or universe.coin(sym):
        return "crypto"
    try:
        if any(c["symbol"].upper() == sym for c in market_data.crypto_markets(15)):
            return "crypto"
    except Exception:
        pass
    return "stock"


def name_for(sym: str) -> tuple[str | None, str | None]:
    """(name, sector) from the coin registry or the Swing Ideas universe, if it's in there."""
    for sector, names in universe.SECTORS.items():
        for s, n in names:
            if s == sym:
                return n, sector
    c = universe.coin(sym)
    return (c["name"], "Crypto") if c else (None, None)


# ── Starred watchlist ─────────────────────────────────────


def starred() -> list[dict]:
    return _jget("starred", [])


def star(symbol: str, kind: str) -> list[dict]:
    rows = starred()
    sym = symbol.upper()
    if not any(r["symbol"] == sym and r["kind"] == kind for r in rows):
        q = market_data.live_quote(sym, kind)
        rows.append({"symbol": sym, "kind": kind, "added_at": _now(), "added_price": q.get("price")})
        _jset("starred", rows)
    return rows


def unstar(symbol: str, kind: str) -> list[dict]:
    rows = [r for r in starred() if not (r["symbol"] == symbol.upper() and r["kind"] == kind)]
    _jset("starred", rows)
    return rows


def starred_view() -> list[dict]:
    """Stars with live price, day move, move since starred and a 1D sparkline."""
    out = []
    for r in starred():
        q = market_data.live_quote(r["symbol"], r["kind"])
        s = charts.series(r["kind"], r["symbol"], "1D")
        price = q.get("price")
        since = (price / r["added_price"] - 1) * 100 if price and r.get("added_price") else None
        name, sector = name_for(r["symbol"])
        out.append({**r, "price": price, "change_1d": q.get("change_1d"), "name": name, "sector": sector,
                    "since_pct": round(since, 2) if since is not None else None,
                    "spark": [round(p, 6) for _, p in charts._downsample(s, 40)]})
    return out


# ── Web push (VAPID) ──────────────────────────────────────


def _vapid():
    """The server's VAPID key pair, created on first use and kept in the DB."""
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid

    pem = db.get_setting("vapid_private_pem")
    if pem:
        v = Vapid.from_pem(pem.encode())
    else:
        v = Vapid()
        v.generate_keys()
        db.set_setting("vapid_private_pem", v.private_pem().decode())
    raw = v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return v, base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def push_public_key() -> str:
    return _vapid()[1]


def push_subscribe(sub: dict, origin: str | None) -> int:
    subs = [s for s in _jget("push_subs", []) if s.get("endpoint") != sub.get("endpoint")]
    subs.append({**sub, "added_at": _now()})
    _jset("push_subs", subs)
    if origin:
        db.set_setting("push_origin", origin)
    return len(subs)


def push_unsubscribe(endpoint: str) -> int:
    subs = [s for s in _jget("push_subs", []) if s.get("endpoint") != endpoint]
    _jset("push_subs", subs)
    return len(subs)


def push_count() -> int:
    return len(_jget("push_subs", []))


def send_push(title: str, body: str, url: str = "/", tag: str | None = None) -> int:
    """Send to every subscribed device. Drops subscriptions the push service says are gone."""
    subs = _jget("push_subs", [])
    if not subs:
        return 0
    from pywebpush import WebPushException, webpush

    v, _ = _vapid()
    contact = db.get_setting("push_origin") or "https://localhost"
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag or title})
    keep, sent = [], 0
    for s in subs:
        info = {"endpoint": s["endpoint"], "keys": s.get("keys", {})}
        try:
            webpush(subscription_info=info, data=payload, vapid_private_key=v,
                    vapid_claims={"sub": contact}, ttl=3600, timeout=10)
            sent += 1
            keep.append(s)
        except WebPushException as e:
            code = getattr(e.response, "status_code", None)
            if code not in (404, 410):  # anything else may be temporary
                keep.append(s)
            print(f"[push] send failed ({code}): {e}")
        except Exception as e:
            keep.append(s)
            print(f"[push] send error: {e}")
    if len(keep) != len(subs):
        _jset("push_subs", keep)
    return sent


# ── Price alerts ──────────────────────────────────────────


def alerts() -> list[dict]:
    return _jget("alerts", [])


def add_alert(symbol: str, kind: str, op: str, price: float, note: str = "") -> dict:
    rows = alerts()
    q = market_data.live_quote(symbol.upper(), kind)
    a = {"id": uuid.uuid4().hex[:10], "symbol": symbol.upper(), "kind": kind, "op": op, "price": price,
         "note": note, "created_at": _now(), "created_price": q.get("price"),
         "triggered_at": None, "triggered_price": None}
    rows.append(a)
    _jset("alerts", rows)
    return a


def remove_alert(alert_id: str) -> bool:
    rows = alerts()
    keep = [a for a in rows if a["id"] != alert_id]
    _jset("alerts", keep)
    return len(keep) != len(rows)


def alerts_view() -> list[dict]:
    out = []
    for a in alerts():
        q = market_data.live_quote(a["symbol"], a["kind"]) if not a["triggered_at"] else {}
        p = q.get("price")
        dist = (a["price"] / p - 1) * 100 if p else None
        out.append({**a, "current": p, "distance_pct": round(dist, 2) if dist is not None else None})
    out.sort(key=lambda a: (a["triggered_at"] is not None, a["triggered_at"] or "", a["symbol"]))
    return out


def _fmt(p: float) -> str:
    return f"${p:,.2f}" if p >= 1 else f"${p:.6g}"


def check_alerts(notify_extra=None) -> list[dict]:
    """Fire every active alert whose price has been crossed. One-shot: fired alerts stay as history."""
    rows = alerts()
    fired = []
    for a in rows:
        if a["triggered_at"]:
            continue
        p = market_data.live_quote(a["symbol"], a["kind"]).get("price")
        if p is None:
            continue
        if (a["op"] == "above" and p >= a["price"]) or (a["op"] == "below" and p <= a["price"]):
            a["triggered_at"], a["triggered_price"] = _now(), p
            fired.append(a)
    if fired:
        _jset("alerts", rows)
        for a in fired:
            title = f"{a['symbol']} {'is above' if a['op'] == 'above' else 'is below'} {_fmt(a['price'])}"
            body = f"Now {_fmt(a['triggered_price'])}" + (f" · {a['note']}" if a.get("note") else "")
            send_push(title, body, url="/#home", tag=f"alert-{a['id']}")
            if notify_extra:
                notify_extra(f"🔔 *{title}*\n{body}")
    return fired


# ── Goals ─────────────────────────────────────────────────


def goals() -> list[dict]:
    return _jget("goals", [])


def save_goal(g: dict) -> list[dict]:
    rows = [r for r in goals() if r["id"] != g.get("id")]
    g = {**g, "id": g.get("id") or uuid.uuid4().hex[:10]}
    rows.append(g)
    rows.sort(key=lambda r: r.get("date") or "9999")
    _jset("goals", rows)
    return rows


def delete_goal(goal_id: str) -> list[dict]:
    rows = [r for r in goals() if r["id"] != goal_id]
    _jset("goals", rows)
    return rows


def goal_progress(g: dict, current: float, monthly: float, growth: float = 0.07) -> dict:
    """Arithmetic only: where the plan's pace lands by the goal date, with and without growth."""
    target = float(g["target"])
    today = datetime.now(timezone.utc).date()
    try:
        due = datetime.strptime(g["date"], "%Y-%m-%d").date()
    except (KeyError, ValueError, TypeError):
        due = None
    months = max(0.0, (due - today).days / 30.44) if due else None
    r = growth / 12
    def fv(m: float, rate: float) -> float:
        if rate == 0:
            return current + monthly * m
        return current * (1 + rate) ** m + monthly * (((1 + rate) ** m - 1) / rate)
    flat_at = fv(months, 0) if months is not None else None
    grow_at = fv(months, r) if months is not None else None
    need = None
    if months and months > 0:  # monthly needed with no growth assumed
        need = max(0.0, (target - current) / months)
    # months until target at plan pace + growth (cap at 100 years)
    eta = None
    if current >= target:
        eta = 0
    elif monthly > 0 or current > 0:
        m = 0
        while m < 1200 and fv(m, r) < target:
            m += 1
        eta = m if m < 1200 else None
    return {
        **g, "current": round(current, 2), "pct": round(min(100.0, current / target * 100), 1) if target else 0,
        "months_left": round(months, 1) if months is not None else None,
        "at_date_flat": round(flat_at, 2) if flat_at is not None else None,
        "at_date_growth": round(grow_at, 2) if grow_at is not None else None,
        "monthly_needed": round(need, 2) if need is not None else None,
        "eta_months": eta,
        "eta_date": (today + timedelta(days=eta * 30.44)).isoformat() if eta is not None else None,
        "on_pace": (grow_at >= target) if grow_at is not None else None,
        "assumed_growth": growth,
    }


# ── Dividend income ───────────────────────────────────────


def dividends(sym: str) -> list[tuple[str, float]]:
    """(ex-date, per-share amount) for roughly the last 2 years. Cached 24h."""
    key = f"divs:{sym}"
    hit = market_data._get(key, 86_400)
    if hit is not None:
        return hit  # type: ignore[return-value]
    yf = market_data._yf()
    out: list[tuple[str, float]] = []
    if yf is not None:
        try:
            s = yf.Ticker(sym).dividends
            cutoff = datetime.now(timezone.utc) - timedelta(days=730)
            for idx, amt in s.items():
                d = idx.to_pydatetime()
                if d.tzinfo is None:
                    d = d.replace(tzinfo=timezone.utc)
                if d >= cutoff and amt > 0:
                    out.append((d.date().isoformat(), float(amt)))
        except Exception as e:
            print(f"[income] dividends {sym} error: {e}")
            out = market_data._get(f"{key}:stale", 7 * 86_400) or []  # type: ignore[assignment]
    market_data._set(key, out)
    if out:
        market_data._set(f"{key}:stale", out)
    return out


def income(holdings: list[dict]) -> dict:
    """Trailing-12-month dividends × shares held now, projected forward on the same schedule."""
    today = datetime.now(timezone.utc).date()
    year_ago = (today - timedelta(days=365)).isoformat()
    by_sym: dict[str, dict] = {}
    for h in holdings:
        if h["kind"] != "stock" or not h.get("qty"):
            continue
        r = by_sym.setdefault(h["symbol"], {"symbol": h["symbol"], "qty": 0.0, "value": 0.0, "accounts": set(),
                                            "note": h.get("note") or ""})
        r["qty"] += h["qty"]
        r["value"] += h.get("value") or 0
        r["accounts"].add(h.get("label") or "")
    months = [(today.replace(day=1) + timedelta(days=32 * i)).replace(day=1) for i in range(12)]
    month_keys = [m.strftime("%Y-%m") for m in months]
    by_month = {k: 0.0 for k in month_keys}
    rows = []
    for sym, r in by_sym.items():
        divs = dividends(sym)
        last12 = [(d, a) for d, a in divs if d >= year_ago]
        if not last12:
            continue
        per_share = sum(a for _, a in last12)
        freq = len(last12)
        annual = per_share * r["qty"]
        last_date = datetime.strptime(last12[-1][0], "%Y-%m-%d").date()
        step = 365 / max(1, freq)
        nxt = None
        k = 1
        while True:  # project forward on the same cadence
            d = last_date + timedelta(days=round(step * k))
            k += 1
            if d <= today:
                continue
            if d.strftime("%Y-%m") not in by_month:
                break
            nxt = nxt or d
            by_month[d.strftime("%Y-%m")] += last12[-1][1] * r["qty"]
        rows.append({
            "symbol": sym, "qty": round(r["qty"], 4), "annual": round(annual, 2),
            "yield_pct": round(annual / r["value"] * 100, 2) if r["value"] else None,
            "per_share": round(per_share, 4), "freq": freq, "last_ex": last12[-1][0],
            "next_est": nxt.isoformat() if nxt else None, "note": r["note"],
            "accounts": sorted(a for a in r["accounts"] if a),
        })
    rows.sort(key=lambda x: x["annual"], reverse=True)
    total = sum(x["annual"] for x in rows)
    return {"annual": round(total, 2), "monthly_avg": round(total / 12, 2), "holdings": rows,
            "by_month": [{"month": k, "amount": round(v, 2)} for k, v in by_month.items()]}


# ── "Why it's on the list" ───────────────────────────────


def _closes(kind: str, sym: str) -> list[float]:
    if kind == "crypto":
        return [p for _, p in charts.series("crypto", sym, "1Y")]
    return market_data.stock_history(sym)


def why(kind: str, sym: str) -> dict:
    sym = sym.upper()
    closes = _closes(kind, sym)
    q = market_data.live_quote(sym, kind)
    price = q.get("price") or (closes[-1] if closes else None)
    name, sector = name_for(sym)
    sc = scoring.long_term_score(closes) if closes else None
    sma50 = scoring.sma(closes, 50)
    sma200 = scoring.sma(closes, 200)
    hi = max(closes[-365:]) if closes else None
    lo = min(closes[-365:]) if closes else None
    pct = lambda d: market_data._pct(closes, d)  # noqa: E731
    vol = None
    if len(closes) > 31:
        rets = [closes[i] / closes[i - 1] - 1 for i in range(len(closes) - 30, len(closes)) if closes[i - 1]]
        if len(rets) > 5:
            vol = statistics.pstdev(rets) * 100  # typical daily move, %
    earn = market_data.stock_earnings(sym) if kind == "stock" else None
    levels = [lv for lv in db.list_levels() if lv["asset"].upper().replace("USDT", "").replace("USD", "") == sym]

    reasons: list[dict] = []
    if sc:
        reasons.append({"tone": "up" if sc["score"] >= 60 else "down" if sc["score"] < 40 else "flat",
                        "text": f"1-year buy score {sc['score']:.0f}/100 ({sc['label']}); higher means a better entry. It blends "
                                f"RSI, distance from the 200-day average and where price sits in its 52-week range."})
        if sc.get("rsi") is not None:
            r = sc["rsi"]
            if r <= 30:
                reasons.append({"tone": "up", "text": f"RSI {r:.0f}: oversold territory, it's sold off hard recently."})
            elif r >= 70:
                reasons.append({"tone": "down", "text": f"RSI {r:.0f}: overbought, it's run up fast recently."})
            else:
                reasons.append({"tone": "flat", "text": f"RSI {r:.0f}: neither stretched nor washed out."})
    if price and sma200:
        d = (price / sma200 - 1) * 100
        reasons.append({"tone": "up" if d >= 0 else "down",
                        "text": f"{abs(d):.0f}% {'above' if d >= 0 else 'below'} its 200-day average "
                                f"({'long-term uptrend' if d >= 0 else 'long-term downtrend'})."})
    if sma50 and sma200:
        reasons.append({"tone": "up" if sma50 >= sma200 else "down",
                        "text": "50-day average is above the 200-day (golden-cross side)." if sma50 >= sma200
                        else "50-day average is below the 200-day (death-cross side)."})
    if price and hi:
        off = (price / hi - 1) * 100
        if off > -3:
            reasons.append({"tone": "up", "text": "Trading at or near its 52-week high."})
        else:
            reasons.append({"tone": "flat", "text": f"{abs(off):.0f}% below its 52-week high of {_fmt(hi)}."})
    m1 = pct(21)
    if m1 is not None and abs(m1) >= 10:
        reasons.append({"tone": "up" if m1 > 0 else "down", "text": f"Moved {m1:+.0f}% over the past month."})
    if vol is not None:
        reasons.append({"tone": "flat", "text": f"Typical daily move lately: about ±{vol:.1f}%."})
    days_to_earn = None
    if earn and earn.get("next_earnings"):
        try:
            days_to_earn = (datetime.strptime(earn["next_earnings"], "%Y-%m-%d").date() - datetime.now(timezone.utc).date()).days
        except ValueError:
            days_to_earn = None
        if days_to_earn is not None and 0 <= days_to_earn <= 21:
            reasons.append({"tone": "flat", "text": f"Earnings in {days_to_earn} day{'s' if days_to_earn != 1 else ''}. "
                                                    "Option premiums usually rise into the report and drop after it."})
    if earn and earn.get("projection") and earn.get("target_mean"):
        reasons.append({"tone": "up" if earn.get("bias") == "bullish" else "down" if earn.get("bias") == "bearish" else "flat",
                        "text": earn["projection"] + "."})
    for lv in levels:
        if price:
            d = (lv["price"] / price - 1) * 100
            reasons.append({"tone": "flat", "text": f"Your {lv['kind']} level {_fmt(lv['price'])}"
                                                    f"{' (' + lv['label'] + ')' if lv.get('label') else ''} is {abs(d):.1f}% "
                                                    f"{'above' if d > 0 else 'below'}."})

    return {
        "symbol": sym, "kind": kind, "name": name, "sector": sector, "price": price, "change_1d": q.get("change_1d"),
        "score": sc["score"] if sc else None, "label": sc["label"] if sc else None,
        "rsi": sc.get("rsi") if sc else None, "trend": sc.get("trend") if sc else None,
        "sma50": round(sma50, 4) if sma50 else None, "sma200": round(sma200, 4) if sma200 else None,
        "high_52w": hi, "low_52w": lo,
        "chg_1w": pct(5 if kind == "stock" else 7), "chg_1m": pct(21 if kind == "stock" else 30),
        "chg_3m": pct(63 if kind == "stock" else 90),
        "daily_vol_pct": round(vol, 2) if vol is not None else None,
        "next_earnings": earn.get("next_earnings") if earn else None, "days_to_earnings": days_to_earn,
        "target_mean": earn.get("target_mean") if earn else None,
        "levels": levels, "reasons": reasons,
    }


# ── Compare mode ──────────────────────────────────────────


def compare(items: list[tuple[str, str]], rng: str) -> dict:
    """Several assets on one time grid, each as % change from the start of the range."""
    if rng not in charts.RANGES:
        return {"range": rng, "points": [], "symbols": []}
    _, span, *_rest, step = charts.RANGES[rng]
    now = time.time()
    grid = [now - span + i * step for i in range(int(span // step) + 1)] + [now]
    syms, cols = [], []
    for sym, kind in items:
        s = charts.series(kind, sym, rng)
        q = market_data.live_quote(sym, kind)
        if q.get("price") is not None:
            s = s + [(now, q["price"])]
        if len(s) < 2:
            continue
        vals = charts._ffill(s, grid)
        base = next((v for v in vals if v), None)
        if not base:
            continue
        cols.append([round((v / base - 1) * 100, 3) if v else None for v in vals])
        syms.append({"symbol": sym, "kind": kind, "change_pct": round((vals[-1] / base - 1) * 100, 2)})
    # Stocks don't trade overnight/weekends: drop grid rows where nothing moved for anyone.
    pts = []
    prev = None
    for i, t in enumerate(grid):
        row = tuple(c[i] for c in cols)
        if row == prev and i != len(grid) - 1:
            continue
        prev = row
        pts.append({"t": int(t), **{syms[j]["symbol"]: row[j] for j in range(len(cols))}})
    return {"range": rng, "symbols": syms, "points": pts}
