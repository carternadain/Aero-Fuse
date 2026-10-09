"""Recurring charge / subscription / paycheck detector.

Pure functions only (no FastAPI, no database) so they are easy to unit test.
Feed it transaction dicts (date, amount, kind, category, merchant, note) and a
"today" date; it returns the series it finds, what they cost per month, and
what is coming up.
"""

import re
from collections import Counter
from datetime import date, datetime, timedelta
from statistics import median

import importer

# cadence -> (days in a period, jitter tolerance in days, months per period or None, charges per month)
CADENCES = {
    "weekly":    (7,      2,   None, 52 / 12),
    "biweekly":  (14,     3,   None, 26 / 12),
    "monthly":   (30.4,   4.6, 1,    1.0),
    "quarterly": (91,     7,   3,    1 / 3),
    "yearly":    (365,    10,  12,   1 / 12),
}

MIN_HIKE_USD = 0.50
MIN_HIKE_PCT = 0.03
AMOUNT_BAND = 0.20          # amounts within 20% of the median count as "similar"
UPCOMING_DAYS = 45
SOON_DAYS = 30
STALE_PERIODS = 2.5         # drop series silent for this many periods


def _d(s: str) -> date | None:
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.year * 12 + d.month - 1 + n, 12)
    m += 1
    leap = y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)
    last = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return date(y, m, min(d.day, last))


def step(d: date, cadence: str, times: int = 1) -> date:
    days, _tol, months, _per = CADENCES[cadence]
    if months:
        return add_months(d, months * times)
    return d + timedelta(days=days * times)


def merchant_of(tx: dict) -> str:
    m = (tx.get("merchant") or "").strip()
    if not m:
        note = (tx.get("note") or "").strip()
        m = importer.clean_merchant(note) if note else ""
    return re.sub(r"\s+", " ", m).strip()


def _pick_cadence(median_gap: float) -> str | None:
    for name, (days, tol, _m, _p) in CADENCES.items():
        if abs(median_gap - days) <= tol:
            return name
    return None


def _nearest_cadence(median_gap: float) -> str:
    return min(CADENCES, key=lambda n: abs(median_gap - CADENCES[n][0]) / CADENCES[n][0])


def _fits(gap: int, cadence: str) -> str | None:
    days, tol, _m, _p = CADENCES[cadence]
    if abs(gap - days) <= tol:
        return "ok"
    if abs(gap - 2 * days) <= tol + 3:
        return "missed"
    return None


def _analyze(occ: list[tuple[date, float]], relaxed: bool) -> tuple[str, bool] | None:
    """Return (cadence, strict_ok) if these occurrences look like a regular series."""
    if len(occ) < 2:
        return None
    gaps = [(b[0] - a[0]).days for a, b in zip(occ, occ[1:])]
    cadence = _pick_cadence(median(gaps))
    if cadence is None:
        return _nearest_cadence(median(gaps)) if relaxed else None
    fits = [_fits(g, cadence) for g in gaps]
    if None in fits and sum(1 for f in fits if f is None) > len(gaps) * 0.25:
        return cadence if relaxed else None
    if fits.count("missed") > 1 and len(gaps) < 6:
        return cadence if relaxed else None
    amounts = [a for _d_, a in occ]
    med = median(amounts)
    similar = sum(1 for a in amounts if abs(a - med) <= AMOUNT_BAND * med)
    if similar < max(2, round(len(amounts) * 0.8)) or abs(amounts[-1] - med) > AMOUNT_BAND * med:
        return cadence if relaxed else None
    n = len(occ)
    if n < 3:
        # two hits are only enough for slow cadences with an (almost) identical amount
        if cadence not in ("quarterly", "yearly") or abs(amounts[0] - amounts[1]) > 0.01 * max(amounts):
            return cadence if relaxed else None
    return cadence


def _build(key: str, kind: str, occ: list[tuple[date, float]], rows: list[dict],
           cadence: str, today: date) -> dict | None:
    last_date, latest = occ[-1]
    period = CADENCES[cadence][0]
    days_since = (today - last_date).days
    if days_since > period * STALE_PERIODS + 10:
        return None
    next_date = step(last_date, cadence)
    overdue = (today - next_date).days
    status = "maybe_cancelled" if overdue > period / 2 + 3 else "active"
    per_month = CADENCES[cadence][3]
    monthly = round(latest * per_month, 2)

    prev = occ[-2][1] if len(occ) >= 2 else None
    price_change = None
    if prev is not None and kind == "expense" and days_since <= period * 2 + 10:
        delta = round(latest - prev, 2)
        stable_before = len(occ) < 3 or abs(prev - occ[-3][1]) <= 0.01 * max(prev, 0.01) + 0.01
        if abs(delta) >= MIN_HIKE_USD and abs(delta) >= MIN_HIKE_PCT * prev and stable_before:
            price_change = {"from": round(prev, 2), "to": round(latest, 2), "delta": delta,
                            "pct": round(delta / prev * 100, 1)}

    names = Counter(merchant_of(r) for r in rows if merchant_of(r))
    recent = merchant_of(rows[-1])
    cats = Counter(r.get("category") for r in rows if r.get("category"))
    return {
        "merchant": recent or names.most_common(1)[0][0],
        "category": cats.most_common(1)[0][0] if cats else "other",
        "kind": kind,
        "cadence": cadence,
        "amount": round(latest, 2),
        "previous_amount": round(prev, 2) if prev is not None else None,
        "last_date": last_date.isoformat(),
        "next_date": next_date.isoformat(),
        "occurrences": len(occ),
        "monthly_cost": monthly,
        "annual_cost": round(monthly * 12, 2),
        "price_change": price_change,
        "status": status,
        "override": None,
    }


def _project(item: dict, start: date, end: date) -> list[date]:
    """Predicted charge dates for an active series inside [start, end]."""
    out = []
    d = _d(item["next_date"])
    k = 1
    last = _d(item["last_date"])
    while d and d <= end and k < 400:
        if d >= start:
            out.append(d)
        k += 1
        d = step(last, item["cadence"], k)
    return out


def detect(transactions: list[dict], today: date | str, overrides: dict[str, str] | None = None) -> dict:
    if isinstance(today, str):
        today = _d(today) or date.today()
    ov = {k.lower(): v for k, v in (overrides or {}).items()}

    groups: dict[tuple[str, str], list[dict]] = {}
    for tx in transactions:
        d = _d(tx.get("date", ""))
        amt = tx.get("amount")
        m = merchant_of(tx)
        if not d or d > today or not m or not isinstance(amt, (int, float)) or amt <= 0:
            continue
        kind = "income" if tx.get("kind") == "income" else "expense"
        groups.setdefault((m.upper(), kind), []).append({**tx, "_d": d})

    items = []
    for (key, kind), rows in groups.items():
        confirmed = ov.get(key.lower()) == "confirmed"
        if len(rows) < 2 and not confirmed:
            continue
        rows.sort(key=lambda r: (r["_d"], r.get("id", 0)))
        merged: list[dict] = []          # one entry per day (split charges add up)
        for r in rows:
            if merged and merged[-1]["_d"] == r["_d"]:
                merged[-1] = {**merged[-1], "amount": merged[-1]["amount"] + r["amount"]}
            else:
                merged.append(dict(r))
        occ = [(r["_d"], float(r["amount"])) for r in merged]
        cadence = _analyze(occ, relaxed=False)
        if cadence is None and confirmed:
            cadence = _analyze(occ, relaxed=True)
        if cadence is None:
            continue
        item = _build(key, kind, occ, merged, cadence, today)
        if item is None and confirmed:
            continue
        if item:
            item["override"] = ov.get(item["merchant"].lower()) or ov.get(key.lower())
            items.append(item)

    items.sort(key=lambda i: (i["kind"] == "income", i["status"] != "active", -i["monthly_cost"], i["merchant"]))

    live = [i for i in items if i["override"] != "ignored"]
    bills = [i for i in live if i["kind"] == "expense" and i["status"] == "active"]
    pay = [i for i in live if i["kind"] == "income" and i["status"] == "active"]

    upcoming = []
    for i in live:
        if i["status"] != "active":
            continue
        for d in _project(i, today, today + timedelta(days=UPCOMING_DAYS)):
            upcoming.append({"date": d.isoformat(), "merchant": i["merchant"], "amount": i["amount"],
                             "kind": i["kind"], "cadence": i["cadence"]})
    upcoming.sort(key=lambda u: (u["date"], u["kind"] == "income", u["merchant"]))
    soon_end = (today + timedelta(days=SOON_DAYS)).isoformat()
    soon = [u for u in upcoming if u["kind"] == "expense" and u["date"] <= soon_end]

    hikes = [{"merchant": i["merchant"], **i["price_change"]} for i in bills if i["price_change"]]
    monthly = round(sum(i["monthly_cost"] for i in bills), 2)
    return {
        "items": items,
        "totals": {
            "monthly": monthly,
            "annual": round(monthly * 12, 2),
            "count": len(bills),
            "income_monthly": round(sum(i["monthly_cost"] for i in pay), 2),
            "upcoming_count": len(soon),
            "upcoming_total": round(sum(u["amount"] for u in soon), 2),
        },
        "upcoming": upcoming,
        "price_hikes": hikes,
    }
