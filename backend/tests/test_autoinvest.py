"""Auto-invest: schedule, apply (idempotent, roll-forward, pending), cost basis, delete. No network."""
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import autoinvest  # noqa: E402
import db  # noqa: E402
import market_data  # noqa: E402
import nw_backfill  # noqa: E402


@pytest.fixture
def tdb(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db")
    db.init_db()
    market_data.clear_cache()
    yield
    market_data.clear_cache()


def rule(**kw):
    base = {"symbol": "VOO", "kind": "stock", "amount": 100.0, "frequency": "monthly", "day": 1,
            "start_date": "2026-01-01", "end_date": None, "label": "Robinhood"}
    return {**base, **kw}


def weekdays(start: str, end: str, price=lambda d: 100.0) -> dict[str, float]:
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    out = {}
    while a <= b:
        if a.weekday() < 5:
            out[a.isoformat()] = float(price(a))
        a += timedelta(days=1)
    return out


def fetcher(closes, calls=None):
    def f(kind, sym, since, today):
        if calls is not None:
            calls.append((kind, sym))
        return {d: p for d, p in closes.get((kind, sym), {}).items() if d < today.isoformat()}
    return f


def holding(sym="VOO"):
    return next((h for h in db.list_holdings() if h["symbol"] == sym), None)


# ── schedule ─────────────────────────────────────────────

def test_monthly_31st_uses_last_day_of_short_months():
    ds = autoinvest.schedule_dates(rule(day=31, start_date="2026-01-15"), date(2026, 5, 1))
    assert [d.isoformat() for d in ds] == ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]
    leap = autoinvest.schedule_dates(rule(day=30, start_date="2028-02-01"), date(2028, 3, 1))
    assert [d.isoformat() for d in leap] == ["2028-02-29"]


def test_monthly_skips_day_before_start_and_respects_end():
    ds = autoinvest.schedule_dates(rule(day=1, start_date="2026-01-02", end_date="2026-04-01"), date(2026, 12, 1))
    assert [d.isoformat() for d in ds] == ["2026-02-01", "2026-03-01", "2026-04-01"]


def test_weekly_and_biweekly():
    # 2026-01-01 is a Thursday; first Monday on/after is 2026-01-05
    w = autoinvest.schedule_dates(rule(frequency="weekly", day=0), date(2026, 1, 20))
    assert [d.isoformat() for d in w] == ["2026-01-05", "2026-01-12", "2026-01-19"]
    b = autoinvest.schedule_dates(rule(frequency="biweekly", day=3), date(2026, 2, 1))
    assert [d.isoformat() for d in b] == ["2026-01-01", "2026-01-15", "2026-01-29"]


def test_next_date():
    assert autoinvest.next_date(rule(day=15), date(2026, 3, 16)) == date(2026, 4, 15)
    assert autoinvest.next_date(rule(end_date="2026-02-01"), date(2026, 3, 1)) is None


# ── prices / cost basis (pure) ───────────────────────────

def test_weekend_rolls_to_next_trading_day():
    closes = weekdays("2026-02-01", "2026-02-10", lambda d: d.day)
    # 2026-02-01 is a Sunday -> Monday 02-02
    assert autoinvest.trade_close(closes, date(2026, 2, 1)) == ("2026-02-02", 2.0)
    assert autoinvest.trade_close(closes, date(2026, 2, 3)) == ("2026-02-03", 3.0)
    assert autoinvest.trade_close({}, date(2026, 2, 1)) is None


def test_cost_basis_weighted_average_and_undo():
    c = autoinvest.add_cost(10, 50.0, 2, 200.0)  # 10 @ 50 + 2 @ 100
    assert c == pytest.approx(700 / 12)
    assert autoinvest.remove_cost(12, c, 2, 200.0) == pytest.approx(50.0)
    assert autoinvest.add_cost(0, None, 4, 100.0) == 25.0
    assert autoinvest.add_cost(5, None, 1, 10.0) is None  # unknown basis stays unknown


# ── apply ────────────────────────────────────────────────

def test_apply_creates_holding_and_is_idempotent(tdb):
    closes = {("stock", "VOO"): weekdays("2025-12-01", "2026-04-30", lambda d: 100 if d.month < 3 else 200)}
    rid = autoinvest.create_rule(rule(start_date="2026-01-01"))
    f = fetcher(closes)
    out = autoinvest.apply(today=date(2026, 4, 10), fetch=f)
    # Jan 1 (holiday-free in mock, Thu) / Feb 1 (Sun->Mon 2nd) / Mar 1 (Sun->2nd) / Apr 1
    assert out == {"filled": 4, "pending": 0}
    h = holding()
    assert h["qty"] == pytest.approx(1 + 1 + 0.5 + 0.5)
    assert h["cost_basis"] == pytest.approx(400 / 3)
    assert h["label"] == "Robinhood"
    assert autoinvest.apply(today=date(2026, 4, 10), fetch=f) == {"filled": 0, "pending": 0}
    assert holding()["qty"] == pytest.approx(3)
    r = autoinvest.get_rule(rid, today=date(2026, 4, 10))
    assert r["buys"] == 4 and r["invested"] == 400 and r["next_date"] == "2026-05-01"
    assert r["fills"][0]["trade_date"] == "2026-04-01"
    feb = next(x for x in r["fills"] if x["sched_date"] == "2026-02-01")
    assert feb["trade_date"] == "2026-02-02"


def test_adds_to_existing_holding_with_weighted_cost(tdb):
    db.create_holding({"symbol": "VOO", "kind": "stock", "qty": 10, "cost_basis": 50, "label": "robinhood"})
    autoinvest.create_rule(rule(start_date="2026-03-01", end_date="2026-03-31"))
    autoinvest.apply(today=date(2026, 4, 1), fetch=fetcher({("stock", "VOO"): weekdays("2026-03-01", "2026-03-31")}))
    assert len(db.list_holdings()) == 1  # label match ignores case
    h = holding()
    assert h["qty"] == pytest.approx(11) and h["cost_basis"] == pytest.approx(600 / 11)


def test_missing_price_stays_pending_then_fills(tdb):
    autoinvest.create_rule(rule(start_date="2026-03-01"))
    out = autoinvest.apply(today=date(2026, 3, 10), fetch=fetcher({}))
    assert out == {"filled": 0, "pending": 1} and holding() is None
    out = autoinvest.apply(today=date(2026, 3, 10), fetch=lambda *a: (_ for _ in ()).throw(RuntimeError("down")))
    assert out["pending"] == 1 and holding() is None
    out = autoinvest.apply(today=date(2026, 3, 10),
                           fetch=fetcher({("stock", "VOO"): weekdays("2026-03-01", "2026-03-09")}))
    assert out == {"filled": 1, "pending": 0} and holding()["qty"] == pytest.approx(1)


def test_todays_buy_waits_for_the_close(tdb):
    autoinvest.create_rule(rule(start_date="2026-03-02", day=2))
    closes = {("stock", "VOO"): weekdays("2026-03-01", "2026-03-31")}
    assert autoinvest.apply(today=date(2026, 3, 2), fetch=fetcher(closes))["pending"] == 1
    assert autoinvest.apply(today=date(2026, 3, 3), fetch=fetcher(closes))["filled"] == 1


def test_crypto_buys_daily_close(tdb):
    autoinvest.create_rule(rule(symbol="BTC", kind="crypto", frequency="weekly", day=6,
                                start_date="2026-03-01", amount=50))
    closes = {("crypto", "BTC"): {"2026-03-01": 50_000.0, "2026-03-08": 25_000.0}}
    out = autoinvest.apply(today=date(2026, 3, 9), fetch=fetcher(closes))
    assert out["filled"] == 2
    assert holding("BTC")["qty"] == pytest.approx(0.001 + 0.002)


def test_add_past_false_records_without_adding(tdb):
    rid = autoinvest.create_rule(rule(start_date="2026-01-01"), add_past=False, today=date(2026, 3, 15))
    closes = {("stock", "VOO"): weekdays("2026-01-01", "2026-04-30")}
    autoinvest.apply(today=date(2026, 4, 10), fetch=fetcher(closes))
    assert holding()["qty"] == pytest.approx(1)  # only April's buy was added
    assert autoinvest.get_rule(rid, today=date(2026, 4, 10))["buys"] == 4
    assert len(autoinvest.ledger()) == 4  # history still knows all four


def test_pause_skips_days_while_paused(tdb):
    rid = autoinvest.create_rule(rule(start_date="2026-01-01"))
    closes = {("stock", "VOO"): weekdays("2026-01-01", "2026-06-30")}
    f = fetcher(closes)
    autoinvest.apply(today=date(2026, 1, 10), fetch=f)
    autoinvest.update_rule(rid, {"paused": True}, today=date(2026, 1, 10))
    assert autoinvest.apply(today=date(2026, 3, 10), fetch=f)["filled"] == 0
    autoinvest.update_rule(rid, {"paused": False}, today=date(2026, 3, 10))
    assert autoinvest.apply(today=date(2026, 4, 10), fetch=f)["filled"] == 1  # April only
    assert holding()["qty"] == pytest.approx(2)


def test_edit_future_keeps_past_and_all_rewrites(tdb):
    rid = autoinvest.create_rule(rule(start_date="2026-01-01"))
    closes = {("stock", "VOO"): weekdays("2026-01-01", "2026-06-30")}
    f = fetcher(closes)
    autoinvest.apply(today=date(2026, 3, 10), fetch=f)
    assert holding()["qty"] == pytest.approx(3)
    autoinvest.update_rule(rid, {"amount": 200.0, "day": 15}, apply_to="future", today=date(2026, 3, 10), fetch=f)
    autoinvest.apply(today=date(2026, 4, 20), fetch=f)
    assert holding()["qty"] == pytest.approx(3 + 2 + 2)  # Mar 15 + Apr 15 at $200; old buys stay
    autoinvest.update_rule(rid, {"amount": 50.0}, apply_to="all", today=date(2026, 4, 20), fetch=f)
    autoinvest.apply(today=date(2026, 4, 20), fetch=f)
    # replayed: day 15 from Jan 15 -> Jan..Apr = 4 buys at $50
    assert holding()["qty"] == pytest.approx(2)


def test_delete_keep_or_remove_shares(tdb):
    db.create_holding({"symbol": "VOO", "kind": "stock", "qty": 10, "cost_basis": 50, "label": "Robinhood"})
    closes = {("stock", "VOO"): weekdays("2026-01-01", "2026-06-30")}
    a = autoinvest.create_rule(rule(start_date="2026-01-01"))
    autoinvest.apply(today=date(2026, 3, 10), fetch=fetcher(closes))
    assert holding()["qty"] == pytest.approx(13)
    assert autoinvest.delete_rule(a, keep_shares=False)
    h = holding()
    assert h["qty"] == pytest.approx(10) and h["cost_basis"] == pytest.approx(50)
    b = autoinvest.create_rule(rule(start_date="2026-01-01"))
    autoinvest.apply(today=date(2026, 3, 10), fetch=fetcher(closes))
    autoinvest.delete_rule(b, keep_shares=True)
    assert holding()["qty"] == pytest.approx(13)
    assert len(autoinvest.ledger()) == 3 and autoinvest.list_rules() == []


def test_remove_shares_deletes_holding_it_created(tdb):
    rid = autoinvest.create_rule(rule(symbol="QQQ", start_date="2026-01-01"))
    autoinvest.apply(today=date(2026, 2, 10), fetch=fetcher({("stock", "QQQ"): weekdays("2026-01-01", "2026-02-28")}))
    assert holding("QQQ")
    autoinvest.delete_rule(rid, keep_shares=False)
    assert holding("QQQ") is None


# ── net worth history uses the ledger ────────────────────

def test_backfill_subtracts_shares_bought_after_each_day():
    closes = {("stock", "VOO"): {f"2026-03-{d:02d}": 100.0 for d in range(1, 11)}}
    h = {"kind": "stock", "symbol": "VOO", "qty": 3, "multiplier": 1, "value": 300.0, "label": "Robinhood"}
    anchor = {"date": "2026-03-10", "net_worth": 300.0, "liabilities": 0.0, "cash": 0.0, "property": 0.0}
    fills = [{"kind": "stock", "symbol": "VOO", "label": "Robinhood", "date": "2026-03-03", "qty": 1},
             {"kind": "stock", "symbol": "VOO", "label": "Robinhood", "date": "2026-03-06", "qty": 1}]
    by = {r["date"]: r["net_worth"] for r in nw_backfill.estimate([h], anchor, closes, fills)}
    assert by["2026-03-02"] == 100.0  # before both buys: 1 share
    assert by["2026-03-03"] == 200.0  # bought that day
    assert by["2026-03-06"] == 300.0
    # no fills: today's qty all along (old behavior)
    flat = nw_backfill.estimate([h], anchor, closes)
    assert all(r["net_worth"] == 300.0 for r in flat)


def test_qty_on():
    buys = [("2026-03-03", 1.0), ("2026-03-06", 1.0)]
    assert nw_backfill.qty_on(3, buys, "2026-03-01") == 1
    assert nw_backfill.qty_on(3, buys, "2026-03-03") == 2
    assert nw_backfill.qty_on(1, buys, "2026-03-01") == 0  # never negative (qty edited down by hand)
