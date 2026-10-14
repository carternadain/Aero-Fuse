"""Liquidation heatmap: Binance/Coinalyze parsing, source fallback, and the model on fake data.
No network: fetchers are swapped for hand-made data."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import liqmap  # noqa: E402
import market_data  # noqa: E402

STEP = 300


def test_parse_binance_keys_oi_to_the_candle_it_closes():
    klines = [
        [1_000_000, "100", "110", "95", "105", "10", 0, "0", 0, "7", "0", "0"],
        [1_300_000, "105", "108", "101", "102", "4", 0, "0", 0, "1", "0", "0"],
    ]
    oi = [{"timestamp": 1_300_000, "sumOpenInterestValue": "5000"},
          {"timestamp": 1_600_000, "sumOpenInterestValue": "5200"}]
    c, oi_by, tk = liqmap.parse_binance(klines, oi, STEP)
    assert c[0] == [1000, 100.0, 110.0, 95.0, 105.0]
    assert oi_by == {1000: 5000.0, 1300: 5200.0}  # snapshot at 1300 is the close of the 1000 candle
    assert tk[1000] == (3.0, 7.0)                   # (sell, buy)
    assert tk[1300] == (3.0, 1.0)


def test_parse_coinalyze():
    ohlcv = [{"symbol": "BTCUSDT_PERP.A", "history": [
        {"t": 2000, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10, "bv": 6},
        {"t": 1700, "o": 1, "h": 2, "l": 0.5, "c": 1.2, "v": 0, "bv": 0},
    ]}]
    oi = [{"symbol": "BTCUSDT_PERP.A", "history": [{"t": 2000, "o": 9, "h": 9, "l": 9, "c": 9.5}]}]
    c, oi_by, tk = liqmap.parse_coinalyze(ohlcv, oi)
    assert [x[0] for x in c] == [1700, 2000]  # sorted oldest first
    assert oi_by == {2000: 9.5}
    assert tk == {2000: (4.0, 6.0)}
    assert liqmap.parse_coinalyze([], []) == ([], {}, {})


def _fake(n=120, start=100_000.0):
    """Gently rising price with steadily growing open interest; buyers dominate."""
    candles, oi_by, tk = [], {}, {}
    for i in range(n):
        t = 1_000_000 + i * STEP
        p = start + i * 20
        candles.append([t, p, p + 60, p - 60, p + 10])
        if i < n - 1:  # last candle still forming, no OI yet
            oi_by[t] = 1e9 + i * 1e6
        tk[t] = (40.0, 60.0)
    return candles, oi_by, tk


@pytest.fixture(autouse=True)
def _clear():
    market_data.clear_cache()
    yield
    market_data.clear_cache()


def _with_sources(monkeypatch, *sources):
    monkeypatch.setattr(liqmap, "SOURCES", list(sources))


def test_falls_back_when_binance_refuses(monkeypatch):
    def blocked(*_):
        raise RuntimeError("451 Client Error")
    data = _fake()
    _with_sources(monkeypatch, ("Binance BTCUSDT perpetual", blocked), ("OKX BTC-USDT perpetual", lambda *_: data))
    out = liqmap.heatmap("24h")
    assert out["source"] == "OKX BTC-USDT perpetual"
    assert out["fallback"] is True


def test_binance_model_output(monkeypatch):
    data = _fake()
    _with_sources(monkeypatch, ("Binance BTCUSDT perpetual", lambda *_: data))
    out = liqmap.heatmap("24h")
    assert out["source"] == "Binance BTCUSDT perpetual" and out["fallback"] is False
    assert len(out["times"]) == len(out["matrix"]) == len(data[0])  # forming candle kept
    assert out["price"] == data[0][-1][4]
    assert max(max(col) for col in out["matrix"]) == 1000
    # rising market with buyers in control: long liquidations below price outweigh shorts above
    assert out["below"] and out["above"]
    assert out["below"][0]["usd"] > out["above"][0]["usd"]
    assert all(c["price"] < out["price"] for c in out["below"])
    assert all(c["price"] > out["price"] for c in out["above"])


def test_all_sources_down_returns_error(monkeypatch):
    def down(*_):
        raise RuntimeError("down")
    _with_sources(monkeypatch, ("Binance BTCUSDT perpetual", down), ("OKX BTC-USDT perpetual", down))
    out = liqmap.heatmap("24h")
    assert out["error"] and out["matrix"] == []
