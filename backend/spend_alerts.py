"""'Spending above normal' alerts: this month so far vs. the same day-of-month in recent months.

Comparing to-date (not full-month) totals means rent paid on the 1st never flags on the 2nd.
build_alerts is pure; alerts() fetches from the db; check_and_notify() dedupes pushes.
"""
import calendar
import json
from datetime import date

import db
from budget import HISTORY, _prev_months

MIN_RATIO = 1.25
MIN_EXCESS = 50.0
SENT_KEY = "spend_alerts_sent"


def _dim(month: str) -> int:
    return calendar.monthrange(int(month[:4]), int(month[5:7]))[1]


def _upto(days: dict, cutoff: int) -> float:
    return max(0.0, sum(v for d, v in days.items() if d <= cutoff))


def build_alerts(today: date, daily: dict, active: set[str]) -> dict:
    month = today.strftime("%Y-%m")
    dim = _dim(month)
    hist = [p for p in _prev_months(month, HISTORY) if p in active]
    out = {"month": month, "day": today.day, "days_in_month": dim,
           "history_months": len(hist), "alerts": []}
    if len(hist) < 2:
        return out
    last_day = today.day == dim
    cats = set(daily.get(month, {}))
    for p in hist:
        cats |= set(daily.get(p, {}))
    cats.discard("income")
    rows = []
    for cat in cats:
        spent = _upto(daily.get(month, {}).get(cat, {}), today.day)
        typ = normal = 0.0
        for p in hist:
            days = daily.get(p, {}).get(cat, {})
            plen = _dim(p)
            typ += _upto(days, plen if last_day else min(today.day, plen))
            normal += _upto(days, plen)
        typ /= len(hist)
        normal /= len(hist)
        if spent >= typ * MIN_RATIO and spent - typ >= MIN_EXCESS:
            rows.append({
                "category": cat, "spent": round(spent, 2), "typical_to_date": round(typ, 2),
                "normal_month": round(normal, 2), "over_amount": round(spent - typ, 2),
                "over_pct": round((spent / typ - 1) * 100, 2) if typ else None,
                "level": "high" if spent > normal else "watch",
            })
    rows.sort(key=lambda r: (-r["over_amount"], r["category"]))
    out["alerts"] = rows
    return out


def alerts(today: date | None = None) -> dict:
    today = today or date.today()
    month = today.strftime("%Y-%m")
    months = [month] + _prev_months(month, HISTORY)
    return build_alerts(today, db.spending_by_day(months), db.active_months(months))


def _ord(n: int) -> str:
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def _money(x: float) -> str:
    return f"${x:,.0f}"


def check_and_notify(today: date, send) -> int:
    """Send each (month, category, level) at most once. Returns how many were sent."""
    res = alerts(today)
    try:
        sent = list(json.loads(db.get_setting(SENT_KEY) or "[]"))
    except ValueError:
        sent = []
    sent = [k for k in sent if k.startswith(res["month"] + ":")]
    n = 0
    for a in res["alerts"]:
        key = f"{res['month']}:{a['category']}:{a['level']}"
        if key in sent:
            continue
        label = a["category"].replace("_", " ").title()
        title = f"{label} is running above normal"
        if a["level"] == "high":
            body = f"{_money(a['spent'])} so far, more than a usual whole month ({_money(a['normal_month'])})."
        else:
            body = (f"{_money(a['spent'])} so far this month. "
                    f"Usually about {_money(a['typical_to_date'])} by the {_ord(res['day'])}.")
        send(title, body, f"spend-{a['category']}")
        sent.append(key)
        n += 1
    db.set_setting(SENT_KEY, json.dumps(sent))
    return n
