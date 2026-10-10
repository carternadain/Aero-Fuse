"""Crypto long-term (cycle-aware) risk: pure math on synthetic price paths. No network."""

import math
import random
from datetime import date, timedelta

import pytest

import charts
import universe
import zones


def _path(anchors: list[tuple[str, float]], seed: int = 3, noise: float = 0.015):
    """Daily (dates, closes) log-interpolated between anchors, with small seeded AR(1) noise."""
    rng = random.Random(seed)
    pts = [(date.fromisoformat(d), p) for d, p in anchors]
    dates, closes, z = [], [], 0.0
    for (a, pa), (b, pb) in zip(pts, pts[1:]):
        n = (b - a).days
        for k in range(n):
            z = 0.8 * z + rng.gauss(0, noise)
            base = math.exp(math.log(pa) + (math.log(pb) - math.log(pa)) * k / n)
            dates.append((a + timedelta(days=k)).isoformat())
            closes.append(base * math.exp(z if k else 0))
    dates.append(pts[-1][0].isoformat())
    closes.append(pts[-1][1])
    return dates, closes


# Four synthetic BTC-like cycles: tops ~17 months after each halving, bottoms ~30 months after,
# each top a smaller multiple of the last (diminishing returns), as in 2013-2025.
CYCLES = [
    ("2014-01-01", 800), ("2015-01-14", 180), ("2016-07-09", 650), ("2017-12-10", 18000),
    ("2018-12-10", 3300), ("2020-05-11", 9000), ("2021-11-01", 66000), ("2022-11-20", 16000),
    ("2024-04-20", 64000), ("2025-09-25", 120000), ("2026-10-10", 45000),
]
TOPS = ["2017-12-10", "2021-11-01", "2025-09-25"]
BOTTOMS = ["2018-12-10", "2022-11-20"]


@pytest.fixture(scope="module")
def btc_rows():
    d, c = _path(CYCLES)
    return {r["date"]: r for r in zones.compute_rows("crypto", "BTC", d, c, short_mid=False)}


def test_halving_clock():
    assert zones.months_since_halving("2012-01-01") is None
    assert zones.months_since_halving("2024-04-20") == 0
    assert 29 < zones.months_since_halving("2026-10-10") < 31
    heat = {m: zones.cycle_heat(m) for m in range(0, 48)}
    assert max(heat, key=heat.get) == 17          # past tops: ~17 months after a halving
    assert min(heat, key=heat.get) in (30, 31)    # past bottoms: ~30 months after
    assert zones.cycle_heat(17 + zones.CYCLE_MONTHS) == pytest.approx(zones.cycle_heat(17))


def test_ath_heat_scale():
    assert zones.ath_heat(100, 100) == 100
    assert zones.ath_heat(20, 100) == 0          # -80% or lower reads 0
    assert zones.ath_heat(38, 100) == pytest.approx(40, abs=1)
    assert zones.damp_stretch(90, 100) == 90     # at its high, stretch counts in full
    assert zones.damp_stretch(90, 40) == 66      # far below it, only part of it does
    assert zones.damp_stretch(10, 0) == 10       # cold readings are never pulled up
    assert zones.vs_btc_heat(0) == 50
    assert zones.vs_btc_heat(math.log(2)) == 100


def test_btc_tops_read_hot_and_bottoms_cold(btc_rows):
    for d in TOPS:
        assert btc_rows[d]["long"] >= 80, (d, btc_rows[d]["long"])
    for d in BOTTOMS:
        assert btc_rows[d]["long"] <= 25, (d, btc_rows[d]["long"])


def test_btc_later_top_not_missed_by_cycle_read(btc_rows):
    # Diminishing-return tops rank lower against BTC's own trend history; the cycle read still flags them.
    last_top = btc_rows[TOPS[-1]]
    assert last_top["trend"] < last_top["long"]
    assert zones.read_line("crypto", "long", last_top["long"], last_top["ath_pct"], last_top["months"]).startswith("late in the cycle")


def test_alt_far_below_high_early_in_cycle_has_room_to_run(btc_rows):
    btc = {d: r["price"] for d, r in btc_rows.items()}
    # ONDO-like alt: listed 2021, peaks with the 2021 top, bleeds 90%, then rips +150% in two
    # months ending 6 months after the 2024 halving, still ~62% below its old high.
    d, c = _path([("2021-01-01", 0.30), ("2021-11-01", 2.00), ("2022-11-20", 0.30),
                  ("2024-03-01", 0.40), ("2024-08-20", 0.30), ("2024-10-20", 0.76)], seed=5, noise=0.02)
    rows = zones.compute_rows("crypto", "ONDO", d, c, btc=btc)
    last = rows[-1]
    assert last["ath_pct"] == pytest.approx(-62, abs=1)
    assert last["short"] >= 58          # short term can still say hot
    assert last["long"] < 58, last      # ...but the long term isn't overheated
    text = zones.reads("crypto", last)["long"]["text"]
    assert text == "room to run (62% below its high)"
    # Without the cycle inputs (the old model) the same day ranks as stretched.
    assert last["trend"] > last["long"] + 15


def test_alt_uses_btc_strength_when_available(btc_rows):
    btc = {d: r["price"] for d, r in btc_rows.items()}
    d, c = _path([("2020-01-01", 1.0), ("2021-01-01", 3.0), ("2021-11-01", 20.0)], seed=9)
    rows = zones.compute_rows("crypto", "ALT", d, c, btc=btc)
    assert rows[-1]["btc_h"] is not None and rows[-1]["btc_h"] > 50
    assert zones.compute_rows("crypto", "ALT", d, c)[-1]["btc_h"] is None


def test_stocks_unchanged():
    d, c = _path([("2015-01-01", 100), ("2020-01-01", 300), ("2022-01-01", 200)], seed=1)
    for r in zones.compute_rows("stock", "SPY", d, c, short_mid=False):
        pcts = [p for p in (r["p1"], r["p2"]) if p is not None]
        assert r["long"] == (round(sum(pcts) / len(pcts), 1) if pcts else None)
        assert "ath_pct" not in r
    assert zones.read_line("stock", "long", 90) == "very stretched"
    assert zones.read_line("stock", "short", 75) == "hot"


def test_read_lines():
    assert zones.read_line("crypto", "short", 72) == "hot"
    assert zones.read_line("crypto", "long", None) is None
    assert zones.read_line("crypto", "long", 20, -78, 30) == "cheap (78% below its high)"
    assert zones.read_line("crypto", "long", 90, -1, 18) == "late in the cycle (at its high)"
    assert zones.read_line("crypto", "long", 75, -5, 7) == "stretched, early in the cycle"
    assert zones.read_line("crypto", "long", 45, -20, 30) == "mid-cycle (20% below its high)"


def test_risk_series_no_network(monkeypatch):
    d, c = _path(CYCLES[-5:])
    import time as _t
    from datetime import datetime
    raw = [(datetime.fromisoformat(x).timestamp() + 43200, p) for x, p in zip(d, c)]
    calls = []

    def fake_fetch(kind, sym):
        calls.append(sym)
        return raw

    monkeypatch.setattr(zones, "_fetch", fake_fetch)
    monkeypatch.setattr(zones, "_cache", {})
    rows = zones.risk_series("crypto", "night")
    assert rows and rows[-1]["long"] is not None
    assert set(calls) == {"NIGHT", "BTC"}       # an alt pulls BTC for the vs-BTC read
    assert zones.risk_series("crypto", "NIGHT") is rows  # cached
    _ = _t


def test_night_registered():
    c = universe.coin("night")
    assert c == {"symbol": "NIGHT", "name": "Midnight", "id": "midnight-3", "yahoo": "NIGHT-USD"}
    assert len({s for s, *_ in universe.COINS}) == len(universe.COINS)


def test_crypto_fallback_history_without_coinbase(monkeypatch):
    monkeypatch.setattr(charts, "_yahoo", lambda sym, period, interval: [(1e9 + i * 86400, 1.0) for i in range(40)] if sym == "NIGHT-USD" else [])
    import time as _t
    monkeypatch.setattr(_t, "time", lambda: 1e9 + 40 * 86400)
    assert len(charts.crypto_daily_fallback("NIGHT", 365)) == 40
