"""1Y/ALL net worth chart: auto-invest buys shrink a holding's qty before each buy date."""
import time
from datetime import datetime, timedelta, timezone

import charts


def _flat_price(monkeypatch, price=10.0):
    now = time.time()
    pts = [(now - d * 86_400, price) for d in range(400, -1, -1)]
    monkeypatch.setattr(charts, "series", lambda kind, sym, rng: pts)


H = [{"id": 1, "kind": "stock", "symbol": "VOO", "label": "Robinhood", "qty": 10.0, "price": 10.0, "value": 100.0}]


def test_no_fills_holds_qty_flat(monkeypatch):
    _flat_price(monkeypatch)
    out = charts.portfolio_chart(H, "1Y")
    assert out["points"][0]["p"] == 100.0 and out["points"][-1]["p"] == 100.0


def test_fills_reduce_qty_before_buy_date(monkeypatch):
    _flat_price(monkeypatch)
    buy_day = (datetime.now(timezone.utc) - timedelta(days=100)).date().isoformat()
    fills = [{"kind": "stock", "symbol": "VOO", "label": "Robinhood", "date": buy_day, "qty": 4.0}]
    out = charts.portfolio_chart(H, "1Y", fills=fills)
    assert out["points"][0]["p"] == 60.0      # a year ago: 6 shares
    assert out["points"][-1]["p"] == 100.0    # today: all 10
    assert out["change"] == 40.0


def test_unmatched_fill_is_ignored(monkeypatch):
    _flat_price(monkeypatch)
    fills = [{"kind": "crypto", "symbol": "BTC", "label": "", "date": "2026-01-01", "qty": 1.0}]
    out = charts.portfolio_chart(H, "1Y", fills=fills)
    assert out["points"][0]["p"] == 100.0
