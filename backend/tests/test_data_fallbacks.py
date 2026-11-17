"""Funds with no intraday bars fall back to daily; CoinGecko 429s trigger a shared cooldown."""
import time

import pandas as pd
import pytest

import charts
import market_data


class FakeTicker:
    calls: list[tuple[str, str, str]] = []

    def __init__(self, sym):
        self.sym = sym

    def history(self, period, interval, prepost=False):
        FakeTicker.calls.append((self.sym, period, interval))
        if self.sym == "VTTSX" and interval != "1d":
            raise KeyError("tradingPeriods")
        if self.sym == "EARLY" and interval != "1d":
            return pd.DataFrame({"Open": [], "High": [], "Low": [], "Close": []})
        idx = pd.date_range(end=pd.Timestamp.now(tz="UTC"), periods=5, freq="D")
        return pd.DataFrame({"Open": [1.0] * 5, "High": [2.0] * 5, "Low": [0.5] * 5, "Close": [1.5] * 5}, index=idx)


class FakeYF:
    Ticker = FakeTicker


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    FakeTicker.calls = []
    charts._daily_only.clear()
    market_data.clear_cache()
    monkeypatch.setattr(market_data, "_yf", lambda: FakeYF)
    monkeypatch.setattr(market_data, "_cg_cooldown_until", 0.0)


def test_fund_without_intraday_bars_gets_daily_series():
    s = charts.series("stock", "VTTSX", "1D")
    assert len(s) == 5
    assert FakeTicker.calls == [("VTTSX", "1d", "5m"), ("VTTSX", "1mo", "1d")]


def test_fund_is_remembered_and_live_keeps_its_points():
    charts.series("stock", "VTTSX", "1D")
    FakeTicker.calls = []
    assert len(charts.series("stock", "VTTSX", "LIVE")) == 5  # not trimmed to the last hour
    assert len(charts.ohlc("stock", "VTTSX", "1W")) == 5
    assert all(interval == "1d" for _, _, interval in FakeTicker.calls)


def test_empty_intraday_does_not_mark_a_stock_daily_only():
    assert charts.series("stock", "EARLY", "1D") == []
    assert "EARLY" not in charts._daily_only


class Resp:
    def __init__(self, status, body=None):
        self.status_code, self._body, self.ok = status, body, status == 200

    def raise_for_status(self):
        if not self.ok:
            raise RuntimeError(self.status_code)

    def json(self):
        return self._body


def test_coingecko_429_backs_off_for_every_coin(monkeypatch):
    hits = []

    def get(url, **kw):
        hits.append(url)
        return Resp(429)

    monkeypatch.setattr(market_data.requests, "get", get)
    monkeypatch.setattr(market_data, "_coinbase_daily", lambda sym: [(1.0, 10.0), (2.0, 11.0)])
    assert market_data.crypto_history("bitcoin", "BTC") == [10.0, 11.0]
    assert market_data.crypto_history("ethereum", "ETH") == [10.0, 11.0]
    assert market_data.crypto_history_dated("solana", "SOL")[0]["price"] == 10.0
    assert len(hits) == 1  # one 429, then the cooldown skipped CoinGecko


def test_history_and_dated_share_one_fetch(monkeypatch):
    hits = []

    def get(url, **kw):
        hits.append(url)
        return Resp(200, {"prices": [[1_700_000_000_000, 5.0], [1_700_086_400_000, 6.0]]})

    monkeypatch.setattr(market_data.requests, "get", get)
    assert market_data.crypto_history("bitcoin", "BTC") == [5.0, 6.0]
    assert market_data.crypto_history_dated("bitcoin", "BTC") == [
        {"date": "2023-11-14", "price": 5.0}, {"date": "2023-11-15", "price": 6.0}]
    assert len(hits) == 1


def test_cooldown_expires(monkeypatch):
    monkeypatch.setattr(market_data, "_cg_cooldown_until", time.time() - 1)
    monkeypatch.setattr(market_data.requests, "get", lambda url, **kw: Resp(200, {"prices": [[1000, 2.0]]}))
    assert market_data.crypto_history("bitcoin") == [2.0]
