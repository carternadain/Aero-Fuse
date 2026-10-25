"""Made-up data for the demo login (see demo.py), so Aero can be shown without real money.

The demo person: about $130k net worth, a paycheck every other Friday, a Roth and a 401(k),
a car loan, a mix of index funds, a few stocks and some crypto. Nothing here is real.

rebuild() wipes demo.db and seeds it fresh; the backend calls it on every demo sign-in.
Seeding makes no network calls, so sign-in stays quick; live prices load as usual after.

Run:   python seed_demo.py            rebuild demo.db
       python seed_demo.py --main     seed the real terminal.db instead (local dev only:
                                      a fresh checkout with an empty database)
"""

from __future__ import annotations

import random
import sys
import threading
from datetime import date, timedelta

import db
import demo

_lock = threading.Lock()

HOLDINGS = [  # symbol, kind, qty, cost basis (total $)
    ("VOO", "stock", 42, 18_400), ("AAPL", "stock", 25, 4_100), ("NVDA", "stock", 40, 3_900),
    ("SOFI", "stock", 300, 2_700), ("BTC", "crypto", 0.12, 7_200), ("ETH", "crypto", 1.8, 4_600),
    ("SOL", "crypto", 20, 2_500),
]
HOLDINGS_EST = 70_000  # rough value of the above, for the made-up history only

ACCOUNTS = [  # name, category, kind, balance, APR
    ("Checking", "cash", "asset", 4_850, None),
    ("High-yield savings", "cash", "asset", 12_300, None),
    ("Roth IRA", "retirement", "asset", 23_400, None),
    ("401(k)", "retirement", "asset", 31_800, None),
    ("Brokerage cash", "brokerage", "asset", 150, None),  # weekly deposit not invested yet
    ("Credit card", "credit_card", "liability", 1_120, 24.9),
    ("Car loan", "loan", "liability", 9_600, 6.4),
]

# category, merchant, typical amount, times a month
SPENDING = [
    ("food", "Trader Joe's", 74, 3), ("food", "Chipotle", 14, 4), ("food", "Starbucks", 7, 5),
    ("food", "DoorDash", 32, 2), ("transport", "Shell", 48, 3), ("transport", "Uber", 21, 1),
    ("fun", "AMC Theatres", 28, 1), ("fun", "Topgolf", 55, 1), ("shopping", "Amazon", 38, 3),
    ("shopping", "Target", 52, 1), ("health", "Planet Fitness", 25, 1),
]
SUBSCRIPTIONS = [("Spotify", 11.99, 3), ("Netflix", 15.49, 9), ("iCloud", 2.99, 14)]
BUDGETS = {"food": 600, "transport": 220, "fun": 200, "shopping": 300, "subscriptions": 60, "health": 60}


def _rebuild_db() -> None:
    for suffix in ("", "-wal", "-shm", "-journal"):
        p = db.DEMO_DB_PATH.with_name(db.DEMO_DB_PATH.name + suffix)
        if p.exists():
            p.unlink()
    import taxes
    db.init_db()
    taxes.init()


def rebuild(today: date | None = None) -> None:
    """Fresh demo.db with the made-up data. Safe to call while the app is serving."""
    with _lock:
        tok = demo.active.set(True)
        try:
            _rebuild_db()
            seed(today)
        finally:
            demo.active.reset(tok)


def _paydays(start: date, today: date) -> list[date]:
    d = start
    out = []
    while d <= today:
        out.append(d)
        d += timedelta(days=14)
    return out


def seed(today: date | None = None) -> None:
    """Fill whatever database db.path() points at. Expects it empty."""
    import cashflow
    import extras

    today = today or date.today()
    rnd = random.Random(7)  # same demo every time

    for sym, kind, qty, cost in HOLDINGS:
        db.create_holding({"symbol": sym, "kind": kind, "qty": qty, "cost_basis": cost, "label": "", "note": ""})
    acc = {}
    for name, cat, kind, bal, rate in ACCOUNTS:
        acc[name] = db.create_account({"name": name, "category": cat, "kind": kind, "balance": bal, "rate": rate})["id"]

    # A year of weekly net worth: steady saving plus market wiggle, ending near today's totals.
    b = db.networth_breakdown(HOLDINGS_EST)
    with db.conn() as c:
        for w in range(52, 0, -1):
            f = 1 - w * 0.0058 + rnd.uniform(-0.012, 0.012)
            inv, cash, liab = b["investments"] * f, b["cash"] * (1 - w * 0.004), b["liabilities"] * (1 + w * 0.006)
            c.execute(
                """INSERT INTO networth_snapshots (date, assets, liabilities, net_worth,
                                                   investments, cash, property, source)
                   VALUES (?,?,?,?,?,?,0,'live') ON CONFLICT(date) DO NOTHING""",
                ((today - timedelta(weeks=w)).isoformat(), round(inv + cash, 2), round(liab, 2),
                 round(inv + cash - liab, 2), round(inv, 2), round(cash, 2)),
            )
    db.take_snapshot(HOLDINGS_EST)

    # Three months of spending: this month so far and the two before.
    first = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    first = (first - timedelta(days=1)).replace(day=1)
    friday = first + timedelta(days=(4 - first.weekday()) % 7)
    for d in _paydays(friday, today):
        db.create_transaction({"date": d.isoformat(), "category": "income", "amount": 2_450,
                               "kind": "income", "merchant": "Acme Corp payroll"})
    m = first
    while m <= today:
        last = (m.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        end = min(last, today)

        def tx(day: int, cat: str, merchant: str, amt: float) -> None:
            d = m.replace(day=min(day, last.day))
            if d <= end:
                db.create_transaction({"date": d.isoformat(), "category": cat, "amount": round(amt, 2),
                                       "kind": "expense", "merchant": merchant})

        tx(1, "rent", "Maple Court Apartments", 1_650)
        for name, amt, day in SUBSCRIPTIONS:
            tx(day, "subscriptions", name, amt)
        for cat, merchant, amt, times in SPENDING:
            for _ in range(times):
                tx(rnd.randint(1, last.day), cat, merchant, amt * rnd.uniform(0.7, 1.35))
        m = last + timedelta(days=1)
    for cat, limit in BUDGETS.items():
        db.set_budget(cat, limit)

    # Cash: checking updates itself from these.
    cashflow.setup(acc["Checking"], None, 4_850, today)
    start = (today - timedelta(days=90)).isoformat()
    for item in [
        {"name": "Paycheck", "type": "income", "amount": 2_450, "frequency": "biweekly", "day": 4},
        {"name": "Rent", "type": "bill", "amount": 1_650, "frequency": "monthly", "day": 1, "category": "rent"},
        {"name": "Phone", "type": "bill", "amount": 65, "frequency": "monthly", "day": 18, "category": "subscriptions"},
        {"name": "Car insurance", "type": "bill", "amount": 128, "frequency": "monthly", "day": 22, "category": "transport"},
        {"name": "Car loan", "type": "debt", "amount": 385, "frequency": "monthly", "day": 10, "account_id": acc["Car loan"]},
        {"name": "Savings", "type": "save", "amount": 400, "frequency": "monthly", "day": 2, "account_id": acc["High-yield savings"]},
        {"name": "Brokerage deposit", "type": "invest", "amount": 150, "frequency": "weekly", "day": 4,
         "account_id": acc["Brokerage cash"]},
    ]:
        cashflow.create_item({"start_date": start, **item}, today)

    import autoinvest
    autoinvest.create_rule({"symbol": "VOO", "kind": "stock", "amount": 50, "frequency": "weekly", "day": 0,
                            "start_date": today.isoformat(), "label": "Weekly VOO"}, add_past=False, today=today)

    extras.save_goal({"name": "Emergency fund", "target": 20_000, "metric": "cash"})
    extras.save_goal({"name": "$250k net worth", "target": 250_000, "metric": "net_worth",
                      "date": f"{today.year + 4}-12-31"})
    extras._jset("starred", [{"symbol": s, "kind": k, "added_at": db.utcnow(), "added_price": None}
                             for s, k in [("TSLA", "stock"), ("AMZN", "stock"), ("LINK", "crypto")]])


if __name__ == "__main__":
    if sys.argv[1:] == ["--main"]:
        db.init_db()
        seed()
        print(f"Demo data seeded into {db.DB_PATH}.")
    else:
        rebuild()
        print(f"Fresh demo data in {db.DEMO_DB_PATH}.")
