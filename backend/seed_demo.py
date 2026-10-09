"""Seed the terminal with realistic demo data so the dashboard isn't empty.

Run:   python seed_demo.py          (from the backend/ directory)
Reset: delete terminal.db and restart the backend — everything starts fresh.
"""

from datetime import datetime, timedelta, timezone

import db


def days_ago(n: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=n)).strftime("%Y-%m-%d")


def main():
    db.init_db()

    # ── Trades: 5 closed (4W/1L = 80% win rate), 1 open runner ──
    closed = [
        # (asset, dir, entry, sl, tp1, tp2, source, sweep, exit, partial)
        ("SOL", "long", 128.40, 124.10, 135.36, 139.66, "both", True, 139.66, (50, 135.36, "TP1")),
        ("SOL", "long", 141.20, 137.80, 146.70, 150.10, "both", True, 146.70, None),
        ("BTC", "long", 61200, 59800, 63465, 64866, "neurowave", True, 63465, None),
        ("SOL", "short", 152.60, 156.10, 146.94, 143.44, "both", True, 146.94, (50, 146.94, "TP1")),
        ("SOL", "long", 134.10, 131.00, 139.12, 142.22, "kryptonite", False, 131.00, None),  # the loss
    ]
    for i, (asset, d, entry, sl, tp1, tp2, src, sweep, exit_p, part) in enumerate(closed):
        t = db.create_trade({
            "asset": asset, "direction": d, "entry": entry, "sl": sl, "tp1": tp1, "tp2": tp2,
            "tp3": None, "signal_source": src, "liquidity_sweep": sweep, "htf_aligned": True,
            "notes": "demo trade",
        })
        if part:
            db.add_partial(t["id"], *part)
        db.close_trade(t["id"], exit_p, "demo")
    db.create_trade({
        "asset": "SOL", "direction": "long", "entry": 144.80, "sl": 140.20,
        "tp1": 152.24, "tp2": 156.84, "tp3": 161.45, "signal_source": "both",
        "liquidity_sweep": True, "htf_aligned": True, "notes": "demo — open runner after sweep of weekly low",
    })

    # ── Signals: a confluence pair + a skipped single ──
    db.log_signal({"symbol": "SOL", "direction": "buy", "price": "144.80",
                   "indicator": "neurowave", "conviction": "high", "timeframe": "4h"})
    db.log_signal({"symbol": "SOL", "direction": "buy", "price": "145.10",
                   "indicator": "kryptonite", "conviction": "high", "timeframe": "4h"})
    s = db.log_signal({"symbol": "BTC", "direction": "sell", "price": "63100",
                       "indicator": "kryptonite", "conviction": "low", "timeframe": "1h"})
    db.update_signal(s["id"], {"taken": 0, "skip_reason": "no confluence"})

    # ── Key levels ──
    for asset, price, label, kind in [
        ("SOL", 140.20, "weekly low — sweep zone", "liquidity"),
        ("SOL", 152.20, "1.618 ext from May leg", "fib"),
        ("SOL", 160.00, "psych level + Aug high", "resistance"),
        ("BTC", 60000, "psych level, heavy stops below", "liquidity"),
        ("BTC", 65500, "range high", "resistance"),
    ]:
        db.create_level({"asset": asset, "price": price, "label": label, "kind": kind})

    # ── Portfolio: crypto swing + the LEAPs ──
    db.create_position({"asset": "SOL", "kind": "crypto", "qty": 85, "entry": 128.40, "notes": "demo"})
    db.create_position({"asset": "SOFI", "kind": "leap", "qty": 10, "entry": 4.20, "current": 6.80,
                        "strike": 15, "expiry": "2027-01-15", "notes": "demo"})
    db.create_position({"asset": "RDW", "kind": "leap", "qty": 15, "entry": 2.10, "current": 3.45,
                        "strike": 10, "expiry": "2027-06-18", "notes": "demo"})
    db.create_position({"asset": "MSFT", "kind": "leap", "qty": 2, "entry": 38.50, "current": 52.30,
                        "strike": 500, "expiry": "2027-12-17", "notes": "demo"})

    # ── Net worth: accounts + 12 weeks of snapshot history ──
    db.create_account({"name": "Toobit", "category": "crypto", "kind": "asset", "balance": 14250})
    db.create_account({"name": "Brokerage (LEAPs)", "category": "brokerage", "kind": "asset", "balance": 21870})
    db.create_account({"name": "Checking", "category": "cash", "kind": "asset", "balance": 6400})
    db.create_account({"name": "Roth IRA", "category": "retirement", "kind": "asset", "balance": 18900})
    db.create_account({"name": "Credit card", "category": "credit_card", "kind": "liability", "balance": 1240})
    base = 48000
    with db.conn() as c:
        for w in range(12, -1, -1):
            growth = (12 - w) * 1050 + (250 if w % 3 == 0 else -180)
            assets = base + growth + 1240
            cash, prop = 6400, 0
            inv = assets - cash - prop
            c.execute(
                """INSERT INTO networth_snapshots (date, assets, liabilities, net_worth,
                                                   investments, cash, property, source)
                   VALUES (?,?,?,?,?,?,?,'live') ON CONFLICT(date) DO NOTHING""",
                (days_ago(w * 7), assets, 1240, assets - 1240, inv, cash, prop),
            )
    db.take_snapshot()

    # ── Budget: this month's transactions + limits ──
    txs = [
        (2, "income", 5200, "income", "paycheck"),
        (16, "income", 5200, "income", "paycheck"),
        (1, "rent", 1450, "expense", ""),
        (3, "food", 86.40, "expense", "groceries"),
        (5, "subscriptions", 14.99, "expense", "tradingview"),
        (6, "food", 42.75, "expense", ""),
        (8, "transport", 55.00, "expense", "gas"),
        (9, "fun", 68.00, "expense", "golf"),
        (11, "food", 91.20, "expense", "groceries"),
        (12, "trading_fees", 23.60, "expense", "toobit fees"),
        (14, "subscriptions", 22.00, "expense", "claude api"),
        (15, "food", 38.10, "expense", ""),
    ]
    today = datetime.now(timezone.utc)
    for day, cat, amt, kind, note in txs:
        date = today.replace(day=min(day, today.day)).strftime("%Y-%m-%d")
        db.create_transaction({"date": date, "category": cat, "amount": amt, "kind": kind, "note": note})
    for cat, limit in [("food", 450), ("fun", 200), ("subscriptions", 60), ("transport", 150)]:
        db.set_budget(cat, limit)

    print("Demo data seeded. Delete backend/terminal.db (with the backend stopped) to start fresh.")


if __name__ == "__main__":
    main()
