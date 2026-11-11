"""Candlestick bars, the position overlay (average cost + buy markers) and the benchmark series."""
import time

import charts


def test_bucket_ohlc_merges_open_high_low_close():
    bars = [(float(i), 10.0 + i, 20.0 + i, 5.0 - i, 11.0 + i) for i in range(10)]
    out = charts.bucket_ohlc(bars, 3)  # 10 bars -> chunks of 4, 4, 2
    assert len(out) == 3
    t, o, h, lo, c = out[0]
    assert (t, o, h, lo, c) == (0.0, 10.0, 23.0, 2.0, 14.0)
    assert out[-1] == (8.0, 18.0, 29.0, -4.0, 20.0)


def test_bucket_ohlc_leaves_short_series_alone():
    bars = [(1.0, 1.0, 2.0, 0.5, 1.5)]
    assert charts.bucket_ohlc(bars, 72) == bars


def test_overlay_average_cost_is_weighted_and_skips_lots_without_cost():
    lots = [{"qty": 10, "cost_basis": 100.0}, {"qty": 30, "cost_basis": 200.0}, {"qty": 99, "cost_basis": None}]
    assert charts.position_overlay(0, lots, [])["avg_cost"] == 175.0


def test_overlay_no_cost_basis_gives_none():
    assert charts.position_overlay(0, [{"qty": 5, "cost_basis": None}], [])["avg_cost"] is None


def test_overlay_keeps_only_priced_buys_inside_the_range():
    now = time.time()
    day = lambda ago: time.strftime("%Y-%m-%d", time.gmtime(now - ago * 86_400))
    buys = [
        {"date": day(400), "qty": 1.0, "price": 50.0, "amount": 50.0},   # before the range
        {"date": day(20), "qty": 2.0, "price": 60.0, "amount": 120.0},
        {"date": day(5), "qty": 1.0, "price": None, "amount": 70.0},     # no price: can't be placed
        {"date": "not-a-date", "qty": 1.0, "price": 10.0, "amount": 10.0},
    ]
    out = charts.position_overlay(now - 30 * 86_400, [], buys)["buys"]
    assert [b["price"] for b in out] == [60.0]
    assert out[0]["qty"] == 2.0 and out[0]["amount"] == 120.0


def test_asset_chart_adds_candles_and_overlay_only_when_asked(monkeypatch):
    now = time.time()
    monkeypatch.setattr(charts, "series", lambda kind, sym, rng: [(now - 86_400, 10.0), (now, 12.0)])
    monkeypatch.setattr(charts, "ohlc", lambda kind, sym, rng: [(now - 86_400, 10.0, 13.0, 9.0, 12.0)])
    monkeypatch.setattr(charts.market_data, "live_quote", lambda sym, kind: {"price": 12.0, "change_1d": None})
    plain = charts.asset_chart("stock", "VOO", "1M")
    assert "candles" not in plain and "avg_cost" not in plain
    full = charts.asset_chart("stock", "VOO", "1M", candles=True, lots=[{"qty": 2, "cost_basis": 11.0}], buys=[])
    assert full["candles"] == [{"t": int(now - 86_400), "o": 10.0, "h": 13.0, "l": 9.0, "c": 12.0}]
    assert full["avg_cost"] == 11.0 and full["buys"] == []


def test_benchmark_picks_a_range_that_covers_the_window(monkeypatch):
    seen = []
    monkeypatch.setattr(charts, "series", lambda kind, sym, rng: seen.append((kind, sym, rng)) or [(1.0, 500.0)])
    assert charts.benchmark(30) == [{"t": 1, "p": 500.0}]
    charts.benchmark(200); charts.benchmark(1000)
    assert seen == [("stock", "SPY", "3M"), ("stock", "SPY", "1Y"), ("stock", "SPY", "5Y")]
