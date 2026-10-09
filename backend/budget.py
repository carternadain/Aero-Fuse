"""Monthly budget plan: per-category targets vs. spending, pace and history.

build_plan is pure; plan() fetches from the db and calls it.
"""
import calendar
import math
from datetime import date

import db
import importer

HISTORY = 3


def _prev_months(month: str, n: int) -> list[str]:
    y, m = int(month[:4]), int(month[5:7])
    out = []
    for _ in range(n):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        out.append(f"{y:04d}-{m:02d}")
    return out  # newest first


def _r(x):
    return None if x is None else round(x, 2)


def _project(spent: float, avg: float | None, elapsed: int, dim: int) -> float | None:
    """Where a category likely ends the month.

    Straight-line extrapolation wildly overshoots lump sums like rent paid on the 1st,
    so with history we assume the month ends at the usual total, or at what's already
    gone out if that's more. Without history, extrapolate once a week has passed.
    """
    if avg is not None:
        return max(spent, avg)
    if elapsed >= 7:
        return spent * dim / elapsed
    return None


def build_plan(month: str, today: date, spending: dict[str, dict[str, float]],
               active: set[str], targets: dict[str, float], categories: list[str]) -> dict:
    y, m = int(month[:4]), int(month[5:7])
    dim = calendar.monthrange(y, m)[1]
    this = today.strftime("%Y-%m")
    is_current, is_future = month == this, month > this
    if is_current:
        elapsed, left_days = today.day, dim - today.day + 1
    elif is_future:
        elapsed, left_days = 0, dim
    else:
        elapsed, left_days = dim, 0

    prev = _prev_months(month, HISTORY)
    hist = [p for p in prev if p in active]
    spent_now = {k: v for k, v in spending.get(month, {}).items() if k != "income"}
    last = spending.get(prev[0], {})

    names = (set(categories) | set(targets) | set(spent_now)) - {"income"}
    rows = []
    for cat in names:
        target = targets.get(cat)
        spent = spent_now.get(cat, 0.0)
        pace = proj = None
        avg = (sum(spending.get(p, {}).get(cat, 0.0) for p in hist) / len(hist)) if hist else None
        if is_current:
            if target is not None:
                pace = target * elapsed / dim
            proj = _project(spent, avg, elapsed, dim)
        suggested = math.ceil(round(avg, 6) / 10) * 10 if avg else None
        if target is None:
            status = "none"
        elif spent > target:
            status = "over"
        elif is_current and ((target > 0 and spent >= target * 0.9) or (proj is not None and proj > target)):
            status = "watch"
        else:
            status = "ok"
        rows.append({
            "category": cat,
            "target": _r(target),
            "spent": _r(spent),
            "left": _r(target - spent) if target is not None else None,
            "pct": round(spent / target * 100, 1) if target else None,
            "pace": _r(pace),
            "projected": _r(proj),
            "avg_3m": _r(avg),
            "last_month": _r(last.get(cat, 0.0)),
            "suggested": float(suggested) if suggested else None,
            "status": status,
        })
    # Targeted first (biggest target first), then untargeted by spend, then name.
    rows.sort(key=lambda r: (r["target"] is None, -(r["target"] or 0),
                             -r["spent"] if r["target"] is None else 0, r["category"]))

    total_target = sum(targets.values())
    spent_targeted = sum(spent_now.get(c, 0.0) for c in targets if c != "income")
    left = total_target - spent_targeted
    projs = [r["projected"] for r in rows if r["projected"] is not None] if is_current else []
    return {
        "month": month, "is_current": is_current, "is_future": is_future,
        "days_in_month": dim, "days_elapsed": elapsed, "days_left": left_days,
        "history_months": len(hist),
        "totals": {
            "target": _r(total_target),
            "spent": _r(sum(spent_now.values())),
            "spent_targeted": _r(spent_targeted),
            "left": _r(left),
            "projected": _r(sum(projs)) if projs else None,
            "daily_allowance": _r(max(0, left) / left_days) if is_current else None,
        },
        "categories": rows,
    }


def plan(month: str, today: date | None = None) -> dict:
    today = today or date.today()
    months = [month] + _prev_months(month, HISTORY)
    return build_plan(month, today, db.spending_by_month(months), db.active_months(months),
                      db.get_budgets(), importer.EXPENSE_CATEGORIES)
