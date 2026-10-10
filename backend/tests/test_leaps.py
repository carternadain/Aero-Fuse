"""LEAP checker math: premium, breakeven, lognormal odds, payoff, default strike and expiry.
No network: the chain is a hand-made list of rows."""
import math
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import leaps  # noqa: E402

TODAY = date(2026, 10, 10)


def test_premium_prefers_mid_then_last():
    assert leaps.premium(10, 12, 9) == 11
    assert leaps.premium(0, 12, 9) == 9          # no bid: use last
    assert leaps.premium(12, 10, 9) == 9         # crossed quote: use last
    assert leaps.premium(float("nan"), None, 7.5) == 7.5
    assert leaps.premium(0, 0, 0) is None
    assert leaps.premium(None, None, None) is None


def test_breakeven_and_move():
    assert leaps.breakeven(200, 31.4) == pytest.approx(231.4)
    assert leaps.move_pct(200, 231.4) == pytest.approx(15.7)


def test_prob_above_matches_closed_form():
    # At-the-money-forward target with zero rate: ln term vanishes, d2 = -sigma*sqrt(T)/2.
    p = leaps.prob_above(100, 100, 0.4, 1.0, rate=0.0)
    assert p == pytest.approx(0.5 * (1 + math.erf(-0.2 / math.sqrt(2))), abs=1e-9)
    assert p < 0.5
    # Further target = lower odds; more vol widens the tails.
    assert leaps.prob_above(100, 150, 0.3, 1) < leaps.prob_above(100, 120, 0.3, 1)
    assert leaps.prob_above(100, 150, 0.6, 1) > leaps.prob_above(100, 150, 0.3, 1)
    assert leaps.prob_above(100, 100, 0, 1) is None
    assert leaps.prob_above(100, 100, 0.3, 0) is None


def test_delta_bounds():
    assert 0.5 < leaps.call_delta(100, 100, 0.3, 1.5) < 0.7
    assert leaps.call_delta(100, 60, 0.3, 1.5) > 0.9
    assert leaps.call_delta(100, 200, 0.3, 1.5) < 0.15


def test_implied_vol_round_trips():
    price = leaps.bs_call(100, 110, 0.35, 1.25)
    assert leaps.implied_vol(price, 100, 110, 1.25) == pytest.approx(0.35, abs=1e-3)
    assert leaps.implied_vol(0.0, 100, 110, 1.25) is None
    assert leaps.implied_vol(5, 100, 50, 1.0) is None   # below intrinsic


def test_payoff():
    assert leaps.payoff_at(150, 200, 30) == -3000      # max loss = premium paid
    assert leaps.payoff_at(230, 200, 30) == 0          # breakeven
    assert leaps.payoff_at(260, 200, 30) == 3000
    pts = leaps.payoff_points(200, 200, 30)
    prices = [p["price"] for p in pts]
    assert prices == sorted(prices)
    assert 200 in prices and 230 in prices             # kink and breakeven are exact points
    assert min(p["pl"] for p in pts) == -3000
    assert prices[-1] >= 230 * 1.25 - 0.01


def test_pick_expiry_furthest_and_leap_list():
    exps = ["2026-10-17", "2026-12-18", "2027-07-16", "2027-12-17", "2028-01-21", "2028-12-15"]
    assert leaps.pick_expiry(exps, TODAY) == "2028-12-15"
    assert leaps.leap_expiries(exps, TODAY) == ["2027-07-16", "2027-12-17", "2028-01-21", "2028-12-15"]
    short = ["2026-09-01", "2026-10-17", "2026-11-20", "2026-12-18", "2027-01-15"]
    assert leaps.pick_expiry(short, TODAY) == "2027-01-15"
    assert leaps.leap_expiries(short, TODAY) == ["2026-11-20", "2026-12-18", "2027-01-15"]
    assert leaps.pick_expiry(["2026-01-01"], TODAY) is None
    assert leaps.pick_expiry([], TODAY) is None


def test_strike_choices_snap_and_default_atm():
    ks = [150, 160, 170, 175, 180, 185, 190, 195, 200, 210, 220, 230, 240, 250]
    ch = leaps.strike_choices(ks, 197)
    assert [c["strike"] for c in ch] == [175, 195, 220, 240]
    assert [c["label"] for c in ch] == ["10% ITM", "ATM", "10% OTM", "20% OTM"]
    assert [c["default"] for c in ch] == [False, True, False, False]
    # Sparse chain: targets collapse onto the same strike and are deduped.
    sparse = leaps.strike_choices([100, 200], 150)
    assert len({c["strike"] for c in sparse}) == len(sparse)
    assert sum(c["default"] for c in sparse) == 1
    assert leaps.strike_choices([], 100) == []


def _row(k, bid, ask, last=0.0, iv=0.3, oi=100):
    return {"strike": k, "bid": bid, "ask": ask, "lastPrice": last, "impliedVolatility": iv, "openInterest": oi}


def test_summarize_builds_contracts():
    exps = ["2026-12-18", "2027-12-17", "2028-12-15"]
    rows = [_row(180, 52, 54), _row(200, 40, 42), _row(220, 30, 31, iv=0.00001),
            _row(240, 0, 0, last=22), _row(260, 0, 0, last=0)]
    out = leaps.summarize("AAPL", 200, exps, "2028-12-15", rows, TODAY)
    assert out["available"] and out["is_leap"]
    assert out["days"] == (date(2028, 12, 15) - TODAY).days
    assert [e["date"] for e in out["expiries"]] == ["2027-12-17", "2028-12-15"]
    by = {c["strike"]: c for c in out["contracts"]}
    atm = by[200]
    assert atm["default"] and atm["premium"] == 41 and atm["cost"] == 4100
    assert atm["breakeven"] == 241 and atm["move_pct"] == pytest.approx(20.5)
    assert 0 < atm["odds"] < 0.5 and atm["open_interest"] == 100
    assert by[220]["iv"] and 0.03 < by[220]["iv"] < 3   # junk IV replaced by backed-out IV
    assert by[240]["premium"] == 22                     # last price fallback


def test_summarize_no_quotes_is_unavailable():
    out = leaps.summarize("X", 50, ["2028-01-21"], "2028-01-21", [_row(50, 0, 0)], TODAY)
    assert out["available"] is False and out["contracts"] == []


def test_leap_check_fails_gracefully(monkeypatch):
    class Boom:
        def __init__(self, *_):
            raise RuntimeError("network blocked")
    import types
    monkeypatch.setitem(sys.modules, "yfinance", types.SimpleNamespace(Ticker=Boom))
    leaps._cache.clear()
    assert leaps.leap_check("zzzz") == {"available": False, "symbol": "ZZZZ"}
