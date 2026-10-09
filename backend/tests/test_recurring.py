import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db  # noqa: E402
import recurring  # noqa: E402

TODAY = date(2026, 10, 9)


def tx(d, merchant, amount, kind="expense", category="subscriptions", note=""):
    return {"date": d.isoformat(), "merchant": merchant, "amount": amount, "kind": kind,
            "category": category, "note": note}


def monthly(merchant, amounts, last=date(2026, 9, 28), **kw):
    n = len(amounts)
    return [tx(recurring.add_months(last, -(n - 1 - i)), merchant, a, **kw) for i, a in enumerate(amounts)]


def item(res, name):
    return next(i for i in res["items"] if i["merchant"] == name)


def test_monthly_with_price_hike():
    txs = monthly("Netflix", [15.49] * 5 + [17.49])
    res = recurring.detect(txs, TODAY)
    n = item(res, "Netflix")
    assert n["cadence"] == "monthly" and n["status"] == "active"
    assert n["amount"] == 17.49 and n["previous_amount"] == 15.49
    assert n["price_change"]["delta"] == 2.0
    assert n["next_date"] == "2026-10-28"
    assert n["monthly_cost"] == 17.49 and n["annual_cost"] == pytest.approx(209.88)
    assert res["price_hikes"] == [{"merchant": "Netflix", "from": 15.49, "to": 17.49, "delta": 2.0, "pct": 12.9}]
    assert res["totals"]["count"] == 1 and res["totals"]["monthly"] == 17.49
    assert res["totals"]["upcoming_count"] == 1
    assert res["upcoming"][0]["date"] == "2026-10-28"


def test_small_change_is_not_a_hike():
    res = recurring.detect(monthly("Spotify", [10.99, 10.99, 11.20]), TODAY)
    assert item(res, "Spotify")["price_change"] is None


def test_monthly_jitter_and_missed_month():
    last = date(2026, 9, 30)
    days = [last - timedelta(days=d) for d in (0, 30, 62, 124, 154)]  # one month skipped
    res = recurring.detect([tx(d, "Gym", 40.0) for d in days], TODAY)
    assert item(res, "Gym")["cadence"] == "monthly"


def test_weekly():
    txs = [tx(date(2026, 10, 7) - timedelta(days=7 * i), "Meal Kit", 59.0, category="food") for i in range(6)]
    res = recurring.detect(txs, TODAY)
    w = item(res, "Meal Kit")
    assert w["cadence"] == "weekly" and w["next_date"] == "2026-10-14"
    assert w["monthly_cost"] == pytest.approx(59 * 52 / 12, abs=0.01)
    assert len([u for u in res["upcoming"] if u["merchant"] == "Meal Kit"]) == 6  # 45 days of Wednesdays


def test_yearly_needs_exact_amounts():
    two = [tx(date(2025, 11, 2), "Amazon Prime", 139.0), tx(date(2024, 11, 2), "Amazon Prime", 139.0)]
    res = recurring.detect(two, TODAY)
    y = item(res, "Amazon Prime")
    assert y["cadence"] == "yearly" and y["next_date"] == "2026-11-02"
    assert y["monthly_cost"] == pytest.approx(11.58, abs=0.01)
    differ = [tx(date(2025, 11, 2), "Gizmo", 139.0), tx(date(2024, 11, 2), "Gizmo", 120.0)]
    assert recurring.detect(differ, TODAY)["items"] == []


def test_two_monthly_hits_are_not_enough():
    assert recurring.detect(monthly("Hulu", [9.99, 9.99]), TODAY)["items"] == []


def test_irregular_grocery_not_detected():
    days = [1, 4, 11, 13, 22, 29, 41, 44, 58, 63, 80, 87]
    amts = [82.1, 31.4, 140.9, 22.0, 95.5, 57.3, 18.2, 120.0, 64.4, 33.3, 150.2, 45.0]
    txs = [tx(date(2026, 8, 1) + timedelta(days=d), "Whole Foods", a, category="food") for d, a in zip(days, amts)]
    assert recurring.detect(txs, TODAY)["items"] == []


def test_regular_dates_but_wild_amounts_not_detected():
    amts = [12.0, 87.0, 45.0, 210.0, 9.0]
    txs = [tx(recurring.add_months(date(2026, 9, 3), -i), "Electric Co", a) for i, a in enumerate(amts)]
    assert recurring.detect(txs, TODAY)["items"] == []


def test_overdue_is_maybe_cancelled():
    res = recurring.detect(monthly("Old App", [4.99] * 5, last=date(2026, 8, 20)), TODAY)
    o = item(res, "Old App")
    assert o["status"] == "maybe_cancelled"
    assert res["totals"]["count"] == 0 and res["totals"]["monthly"] == 0
    assert res["upcoming"] == []


def test_long_dead_series_is_dropped():
    assert recurring.detect(monthly("Ancient", [5.0] * 5, last=date(2026, 1, 5)), TODAY)["items"] == []


def test_biweekly_paycheck_is_income():
    txs = [tx(date(2026, 10, 2) - timedelta(days=14 * i), "Acme Payroll", 2500.0, kind="income", category="income")
           for i in range(8)]
    res = recurring.detect(txs, TODAY)
    p = item(res, "Acme Payroll")
    assert p["kind"] == "income" and p["cadence"] == "biweekly" and p["next_date"] == "2026-10-16"
    assert res["totals"]["count"] == 0                      # not a bill
    assert res["totals"]["income_monthly"] == pytest.approx(2500 * 26 / 12, abs=0.01)
    assert all(u["kind"] == "income" for u in res["upcoming"])
    assert res["totals"]["upcoming_count"] == 0


def test_falls_back_to_note():
    txs = [tx(recurring.add_months(date(2026, 9, 15), -i), "", 9.99, note="NETFLIX.COM 800-555-1234") for i in range(4)]
    res = recurring.detect(txs, TODAY)
    assert len(res["items"]) == 1 and res["items"][0]["cadence"] == "monthly"


def test_overrides_ignore_and_confirm():
    txs = monthly("Netflix", [15.49] * 4)
    res = recurring.detect(txs, TODAY, {"NETFLIX": "ignored"})
    n = item(res, "Netflix")
    assert n["override"] == "ignored"
    assert res["totals"]["count"] == 0 and res["upcoming"] == [] and res["price_hikes"] == []
    # two monthly hits wouldn't pass, but a confirmed series stays
    res = recurring.detect(monthly("Hulu", [9.99, 9.99]), TODAY, {"hulu": "confirmed"})
    assert item(res, "Hulu")["override"] == "confirmed"
    assert res["totals"]["count"] == 1


def test_future_and_bad_rows_ignored():
    txs = monthly("Netflix", [15.49] * 4) + [tx(date(2027, 1, 1), "Netflix", 99.0),
                                              {"date": "bad", "amount": 1, "merchant": "X"},
                                              tx(date(2026, 9, 1), "Refund", -5.0)]
    assert item(recurring.detect(txs, TODAY), "Netflix")["amount"] == 15.49


# ── temp database ─────────────────────────────────────────

@pytest.fixture
def tmpdb(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db")
    db.init_db()
    return db


def test_db_roundtrip(tmpdb):
    today = date.today()
    for i in range(5):
        tmpdb.create_transaction({"date": recurring.add_months(today - timedelta(days=5), -i).isoformat(),
                                  "category": "subscriptions", "amount": 12.99, "kind": "expense",
                                  "merchant": "Dropbox"})
    rows = tmpdb.list_transactions_since(400)
    assert len(rows) == 5
    res = recurring.detect(rows, today, tmpdb.get_recurring_overrides())
    assert item(res, "Dropbox")["override"] is None

    tmpdb.set_recurring_override("Dropbox", "ignored")
    assert tmpdb.get_recurring_overrides() == {"Dropbox": "ignored"}
    tmpdb.set_recurring_override("DROPBOX", "confirmed")      # case-insensitive key, replaced in place
    assert tmpdb.get_recurring_overrides() == {"Dropbox": "confirmed"}
    tmpdb.set_recurring_override("dropbox", None)
    assert tmpdb.get_recurring_overrides() == {}
    with pytest.raises(Exception):
        tmpdb.set_recurring_override("X", "bogus")
