"""Credit-card lag: count a statement in the month it is paid (budget_month), plus bulk
move/delete by month or import batch and the manual add / edit endpoints."""
import sys
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import budget  # noqa: E402
import db  # noqa: E402
import spend_alerts  # noqa: E402


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db")
    db.init_db()
    import main
    return TestClient(main.app)


def row(d, amount, merchant="Shop", category="food", h=None):
    return {"date": d, "merchant": merchant, "description": merchant, "amount": amount,
            "kind": "expense", "category": category, "hash": h}


def summary(c, month):
    return c.get(f"/api/budget/summary?month={month}").json()


def test_import_counts_in_chosen_month(client):
    r = client.post("/api/import/commit", json={
        "rows": [row("2026-09-03", 40, h="a"), row("2026-09-20", 60, h="b"), row("2026-10-01", 5, h="c")],
        "budget_month": "2026-10"}).json()
    assert r["inserted"] == 3 and r["batch"]
    sep, oct_ = summary(client, "2026-09"), summary(client, "2026-10")
    assert sep["expenses"] == 0 and sep["transactions"] == []
    assert oct_["expenses"] == 105
    # the purchase date is kept; the month it counts in is reported separately
    dates = {t["date"]: t for t in oct_["transactions"]}
    assert dates["2026-09-03"]["month"] == "2026-10" and dates["2026-09-03"]["budget_month"] == "2026-10"
    # a row already in the target month stores no override
    assert dates["2026-10-01"]["budget_month"] is None
    # budget plan, history and alerts all follow the budget month
    assert db.spending_by_month(["2026-09", "2026-10"]) == {"2026-10": {"food": 105.0}}
    assert db.active_months(["2026-09", "2026-10"]) == {"2026-10"}
    assert budget.plan("2026-10", date(2026, 10, 10))["totals"]["spent"] == 105.0
    daily = db.spending_by_day(["2026-10"])["2026-10"]["food"]
    assert daily == {1: 105.0}   # moved rows land on the 1st (with the real Oct 1 row)
    assert spend_alerts.alerts(date(2026, 10, 10))["month"] == "2026-10"


def test_move_and_delete_batch_and_month(client):
    b = client.post("/api/import/commit", json={"rows": [row("2026-09-03", 40, h="a"),
                                                         row("2026-09-04", 10, h="b")]}).json()["batch"]
    client.post("/api/transactions", json={"category": "food", "amount": 7, "date": "2026-09-10"})
    r = client.post("/api/transactions/bulk", json={"action": "move", "batch": b, "budget_month": "2026-10"})
    assert r.json() == {"moved": 2}
    assert summary(client, "2026-09")["expenses"] == 7
    assert summary(client, "2026-10")["expenses"] == 50
    # back to their own dates
    client.post("/api/transactions/bulk", json={"action": "move", "batch": b, "budget_month": None})
    assert summary(client, "2026-09")["expenses"] == 57
    # delete one month only
    client.post("/api/transactions", json={"category": "food", "amount": 3, "date": "2026-10-02"})
    assert client.post("/api/transactions/bulk", json={"action": "delete", "month": "2026-09"}).json() == {"deleted": 3}
    assert summary(client, "2026-09")["count"] == 0 and summary(client, "2026-10")["count"] == 1
    # bad requests
    assert client.post("/api/transactions/bulk", json={"action": "delete"}).status_code == 400
    assert client.post("/api/transactions/bulk", json={"action": "nuke", "month": "2026-10"}).status_code == 400
    assert client.post("/api/transactions/bulk", json={"action": "move", "month": "Oct"}).status_code == 400


def test_delete_by_ids(client):
    ids = [client.post("/api/transactions", json={"category": "food", "amount": a, "date": "2026-10-02"}).json()["id"]
           for a in (1, 2, 3)]
    assert client.post("/api/transactions/bulk", json={"action": "delete", "ids": ids[:2]}).json() == {"deleted": 2}
    assert [t["id"] for t in summary(client, "2026-10")["transactions"]] == [ids[2]]


def test_manual_add_income_refund_and_validation(client):
    inc = client.post("/api/transactions", json={"kind": "income", "category": "food", "amount": 1850,
                                                 "merchant": "Paycheck", "date": "2026-10-01"}).json()
    assert inc["category"] == "income" and inc["amount"] == 1850 and inc["merchant"] == "Paycheck"
    ref = client.post("/api/transactions", json={"kind": "expense", "category": "shopping", "amount": 20,
                                                 "refund": True, "merchant": "Target", "date": "2026-10-02"}).json()
    assert ref["amount"] == -20
    client.post("/api/transactions", json={"category": "shopping", "amount": 50, "date": "2026-10-03"})
    s = summary(client, "2026-10")
    assert s["income"] == 1850 and s["expenses"] == 30
    assert s["recent_income"][0]["name"] == "Paycheck" and s["recent_income"][0]["amount"] == 1850
    for bad in ({"category": "food", "amount": 0}, {"category": "food", "amount": 5, "date": "10/02"},
                {"category": "income", "amount": 5}, {"category": "nope", "amount": 5}):
        assert client.post("/api/transactions", json=bad).status_code == 400, bad


def test_manual_add_defaults_to_local_today(client):
    t = client.post("/api/transactions", json={"category": "food", "amount": 4}).json()
    from datetime import datetime
    assert t["date"] == datetime.now().strftime("%Y-%m-%d")


def test_patch_date_amount_and_budget_month(client):
    t = client.post("/api/transactions", json={"category": "food", "amount": 12, "date": "2026-09-28"}).json()
    r = client.patch(f"/api/transactions/{t['id']}", json={"budget_month": "2026-10", "amount": 15})
    tx = r.json()["transaction"]
    assert tx["budget_month"] == "2026-10" and tx["amount"] == 15 and tx["month"] == "2026-10"
    tx = client.patch(f"/api/transactions/{t['id']}", json={"budget_month": None}).json()["transaction"]
    assert tx["budget_month"] is None and tx["month"] == "2026-09"
    tx = client.patch(f"/api/transactions/{t['id']}", json={"date": "2026-10-04", "category": "fun"}).json()["transaction"]
    assert (tx["date"], tx["category"]) == ("2026-10-04", "fun")
    # a refund keeps its negative sign when its amount is edited
    ref = client.post("/api/transactions", json={"category": "fun", "amount": 5, "refund": True}).json()
    assert client.patch(f"/api/transactions/{ref['id']}", json={"amount": 8}).json()["transaction"]["amount"] == -8
    assert client.patch(f"/api/transactions/{t['id']}", json={"date": "tomorrow"}).status_code == 400
    assert client.patch("/api/transactions/99999", json={"amount": 1}).status_code == 404


def test_preview_auto_flips_card_csv(client):
    csv = "Date,Description,Amount\n09/02/2026,TRADER JOES,64.18\n09/03/2026,BLUE BOTTLE,6.50\n" \
          "09/25/2026,PAYMENT - THANK YOU,-500.00\n"
    j = client.post("/api/import/preview", json={"filename": "rh.csv", "content": csv}).json()
    assert j["flip_sign"] is True
    assert [(r["kind"], r["transfer"]) for r in j["rows"]] == [("expense", False), ("expense", False), ("income", True)]
    j = client.post("/api/import/preview", json={"filename": "rh.csv", "content": csv, "flip_sign": False}).json()
    assert j["flip_sign"] is False and j["rows"][0]["kind"] == "income"
    txt = "09/14 STARBUCKS $5.45\n09/15 LYFT $9.00\n"
    j = client.post("/api/import/preview", json={"filename": "s.txt", "content": txt, "today": "2026-10-10"}).json()
    assert [r["date"] for r in j["rows"]] == ["2026-09-14", "2026-09-15"] and j["flip_sign"] is True
