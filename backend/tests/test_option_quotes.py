"""Option contracts with no price history are marked from the option chain, then from the last mark seen."""
import pandas as pd
import pytest

import market_data

OCC = "NFLX280121C00069000"


class Chain:
    def __init__(self, rows):
        self.calls = pd.DataFrame(rows, columns=["contractSymbol", "bid", "ask", "lastPrice"])
        self.puts = self.calls.iloc[0:0]


def fake_yf(fast, rows, asked):
    class Ticker:
        def __init__(self, sym):
            self.sym = sym

        @property
        def fast_info(self):
            if isinstance(fast, Exception):
                raise fast
            return fast

        def option_chain(self, expiry):
            asked.append((self.sym, expiry))
            if rows is None:
                raise ValueError("no chain")
            return Chain(rows)

    class YF:
        pass
    YF.Ticker = Ticker
    return YF


@pytest.fixture(autouse=True)
def clean():
    market_data.clear_cache()
    yield
    market_data.clear_cache()


def test_traded_contract_uses_its_own_quote(monkeypatch):
    asked = []
    monkeypatch.setattr(market_data, "_yf", lambda: fake_yf({"last_price": 12.5, "previous_close": 10.0}, [], asked))
    q = market_data.live_quote(OCC, "option")
    assert q == {"price": 12.5, "change_1d": 25.0}
    assert asked == []


def test_no_history_falls_back_to_chain_midpoint(monkeypatch):
    asked = []
    rows = [["NFLX280121C00070000", 1.0, 2.0, 1.5], [OCC, 40.0, 44.0, 39.0]]
    monkeypatch.setattr(market_data, "_yf", lambda: fake_yf({"last_price": None, "previous_close": None}, rows, asked))
    q = market_data.live_quote(OCC, "option")
    assert q == {"price": 42.0, "change_1d": None}
    assert asked == [("NFLX", "2028-01-21")]


def test_chain_without_a_two_sided_quote_uses_last_trade(monkeypatch):
    monkeypatch.setattr(market_data, "_yf", lambda: fake_yf(KeyError("last_price"), [[OCC, 0.0, float("nan"), 39.0]], []))
    assert market_data.live_quote(OCC, "option")["price"] == 39.0


def test_keeps_the_last_mark_when_nothing_answers(monkeypatch):
    monkeypatch.setattr(market_data, "_yf", lambda: fake_yf({"last_price": 12.5, "previous_close": 10.0}, [], []))
    market_data.live_quote(OCC, "option")
    market_data._cache.pop(f"live:option:{OCC}")  # the 3 minute cache expires
    monkeypatch.setattr(market_data, "_yf", lambda: fake_yf({"last_price": float("nan"), "previous_close": None}, None, []))
    assert market_data.live_quote(OCC, "option") == {"price": 12.5, "change_1d": None}


def test_unknown_contract_has_no_price(monkeypatch):
    monkeypatch.setattr(market_data, "_yf", lambda: fake_yf({"last_price": None, "previous_close": None}, [], []))
    assert market_data.live_quote(OCC, "option") == {"price": None, "change_1d": None}
