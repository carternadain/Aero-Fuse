"""Estimated net worth backfill: mocked prices only, no network."""
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import market_data  # noqa: E402
import nw_backfill  # noqa: E402


@pytest.fixture(autouse=True)
def clean_cache():
    market_data.clear_cache()
    yield
    market_data.clear_cache()


def days(end: str, n: int, price) -> dict[str, float]:
    """n daily closes ending on `end`; price(i) with i=0 the oldest."""
    e = date.fromisoformat(end)
    return {(e - timedelta(days=n - 1 - i)).isoformat(): float(price(i)) for i in range(n)}


ANCHOR = {"date": "2026-10-01", "net_worth": 1500.0, "liabilities": 200.0, "cash": 300.0, "property": 0.0}
BTC = {"kind": "crypto", "symbol": "BTC", "qty": 2, "multiplier": 1, "value": 220.0}
SPY = {"kind": "stock", "symbol": "SPY", "qty": 1, "multiplier": 1, "value": 1000.0}


def test_prices_times_qty_meet_first_snapshot():
    closes = {("crypto", "BTC"): days("2026-10-01", 30, lambda i: 100 + i)}  # 100 .. 129
    rows = nw_backfill.estimate([BTC], ANCHOR, closes)
    assert len(rows) == 29 and all(r["source"] == "estimate" for r in rows)
    assert rows[-1]["date"] == "2026-09-30" and rows[0]["date"] == "2026-09-02"
    # anchor holdings = 2*129 = 258 -> offset 1242; oldest day = 2*100 + 1242
    assert rows[0]["net_worth"] == 1442.0
    assert rows[-1]["net_worth"] == 2 * 128 + 1242
    # cash/debts flat at the anchor; investments absorb the move
    assert rows[0]["cash"] == 300 and rows[0]["liabilities"] == 200
    assert rows[0]["investments"] == 1442 + 200 - 300
    assert rows[0]["assets"] == 1642


def test_never_overlaps_real_snapshots():
    closes = {("crypto", "BTC"): days("2026-10-10", 40, lambda i: 100)}
    rows = nw_backfill.estimate([BTC], ANCHOR, closes)
    assert rows and max(r["date"] for r in rows) < ANCHOR["date"]


def test_weekends_carry_last_close():
    # stock closes only on weekdays; the estimate still has every calendar day
    full = days("2026-10-01", 14, lambda i: 10 + i)
    weekdays = {d: p for d, p in full.items() if date.fromisoformat(d).weekday() < 5}
    rows = nw_backfill.estimate([SPY], ANCHOR, {("stock", "SPY"): weekdays})
    by = {r["date"]: r["net_worth"] for r in rows}
    sat, fri = "2026-09-26", "2026-09-25"
    assert by[sat] == by[fri]


def test_small_holding_without_history_is_held_flat():
    closes = {("stock", "SPY"): days("2026-10-01", 10, lambda i: 100 + i)}
    rows = nw_backfill.estimate([SPY, BTC], ANCHOR, closes)
    # SPY is 1000/1220 = 82% of live value, under the 90% bar: no estimate
    assert rows == []
    tiny = {**BTC, "value": 50.0}
    rows = nw_backfill.estimate([SPY, tiny], ANCHOR, closes)
    assert len(rows) == 9
    # tiny held flat, so day-to-day moves come from SPY alone
    assert rows[1]["net_worth"] - rows[0]["net_worth"] == pytest.approx(1.0)


def test_start_waits_for_coverage():
    closes = {
        ("stock", "SPY"): days("2026-10-01", 100, lambda i: 100),
        ("crypto", "BTC"): days("2026-10-01", 20, lambda i: 110),  # BTC is the big one here
    }
    big = {**BTC, "value": 5000.0}
    rows = nw_backfill.estimate([SPY, big], ANCHOR, closes)
    assert rows[0]["date"] == (date(2026, 10, 1) - timedelta(days=19)).isoformat()


def test_no_prices_no_rows():
    assert nw_backfill.estimate([BTC], ANCHOR, {}) == []
    assert nw_backfill.estimate([], ANCHOR, {("crypto", "BTC"): {"2026-01-01": 1.0}}) == []


def test_options_and_missing_split():
    opt = {"kind": "option", "symbol": "X", "qty": 1, "multiplier": 100, "value": 50.0}
    anchor = {"date": "2026-10-01", "net_worth": 1000.0, "liabilities": 0.0, "cash": None, "property": None}
    rows = nw_backfill.estimate([BTC, opt], anchor, {("crypto", "BTC"): days("2026-10-01", 3, lambda i: 100)})
    assert [r["net_worth"] for r in rows] == [1000.0, 1000.0]
    assert rows[0]["investments"] is None and rows[0]["cash"] is None


def test_old_history_thins_to_weekly():
    closes = {("crypto", "BTC"): days("2026-10-01", 900, lambda i: 100)}
    rows = nw_backfill.estimate([BTC], ANCHOR, closes)
    end = date(2026, 10, 1)
    old = [r for r in rows if (end - date.fromisoformat(r["date"])).days > nw_backfill.DAILY_DAYS]
    recent = [r for r in rows if (end - date.fromisoformat(r["date"])).days <= nw_backfill.DAILY_DAYS]
    assert old and all(date.fromisoformat(r["date"]).weekday() == 0 for r in old)
    assert len(recent) == nw_backfill.DAILY_DAYS


def test_build_caches_and_survives_fetch_errors():
    calls = []

    def fetch(kind, sym):
        calls.append(sym)
        return days("2026-10-01", 5, lambda i: 100)

    snaps = [ANCHOR]
    a = nw_backfill.build([BTC], snaps, {}, fetch=fetch)
    b = nw_backfill.build([BTC], snaps, {}, fetch=fetch)
    assert a == b and len(a) == 4 and calls == ["BTC"]  # second call served from cache

    def boom(kind, sym):
        return {}
    assert nw_backfill.build([SPY], snaps, {}, fetch=boom) == []


def test_build_without_snapshots_anchors_today():
    today = date.today().isoformat()
    cur = {"net_worth": 900.0, "liabilities": 0.0, "cash": 0.0, "property": 0.0}
    rows = nw_backfill.build([BTC], [], cur, fetch=lambda k, s: days(today, 3, lambda i: 100))
    assert len(rows) == 2 and rows[-1]["net_worth"] == 900.0


def test_daily_closes_handles_network_failure(monkeypatch):
    def fail(*a, **k):
        raise RuntimeError("offline")
    monkeypatch.setattr(nw_backfill.charts, "_yahoo", fail)
    monkeypatch.setattr(nw_backfill.charts, "_coinbase", fail)
    assert nw_backfill.daily_closes("crypto", "BTC") == {}
    # the miss is remembered: no refetch storm
    monkeypatch.setattr(nw_backfill.charts, "_yahoo", lambda *a: pytest.fail("refetched"))
    assert nw_backfill.daily_closes("crypto", "BTC") == {}


def test_daily_closes_crypto_uses_usd_pair(monkeypatch):
    seen = []

    def yahoo(sym, period, interval):
        seen.append((sym, interval))
        return [(1759276800.0, 60000.0)]  # 2025-10-01 00:00 UTC
    monkeypatch.setattr(nw_backfill.charts, "_yahoo", yahoo)
    assert nw_backfill.daily_closes("crypto", "BTC") == {"2025-10-01": 60000.0}
    assert seen == [("BTC-USD", "1d")]
