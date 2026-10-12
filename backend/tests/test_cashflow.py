"""Cash: schedule dates, idempotent posting, manual transactions, auto-invest charges, buy logging,
snooze, plan import and goals by account. No network."""
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import autoinvest  # noqa: E402
import cashflow  # noqa: E402
import db  # noqa: E402
import market_data  # noqa: E402

D0 = date(2026, 1, 1)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db")
    db.init_db()
    market_data.clear_cache()
    monkeypatch.setattr(market_data, "live_quote", lambda sym, kind: {"price": 50.0, "change_1d": 0.0})
    monkeypatch.setattr(autoinvest, "safe_apply", lambda **kw: {"filled": 0, "pending": 0})
    import main
    yield TestClient(main.app)
    market_data.clear_cache()


def acct(name, balance=0.0, kind="asset", category="cash", rate=None):
    return db.create_account({"name": name, "balance": balance, "kind": kind, "category": category,
                              "rate": rate})["id"]


def bal(i):
    return next(a["balance"] for a in db.list_accounts() if a["id"] == i)


def item(**kw):
    base = {"name": "Thing", "type": "bill", "amount": 100, "frequency": "monthly", "day": 6,
            "start_date": "2026-01-01", "category": "rent"}
    return {**base, **kw}


def iso(*ds):
    return [d.isoformat() for d in ds]


def occ(frequency, start, a, b, **kw):
    it = {"frequency": frequency, "start_date": start, "end_date": None, **kw}
    return iso(*cashflow.occurrences(it, date.fromisoformat(a), date.fromisoformat(b)))


# ── schedule ─────────────────────────────────────────────

def test_semimonthly_and_clamp():
    assert occ("semimonthly", "2026-01-01", "2026-01-01", "2026-02-28", day=1, day2=15) == [
        "2026-01-01", "2026-01-15", "2026-02-01", "2026-02-15"]
    assert occ("semimonthly", "2026-02-01", "2026-02-01", "2026-03-31", day=15, day2=31) == [
        "2026-02-15", "2026-02-28", "2026-03-15", "2026-03-31"]


def test_biweekly_anchors_on_start_date():
    assert occ("biweekly", "2026-01-02", "2026-01-01", "2026-02-13") == ["2026-01-02", "2026-01-16", "2026-01-30",
                                                                      "2026-02-13"]
    # a window starting later keeps the same 14-day rhythm
    assert occ("biweekly", "2026-01-02", "2026-01-20", "2026-02-13") == ["2026-01-30", "2026-02-13"]


def test_weekly():
    assert occ("weekly", "2026-01-01", "2026-01-01", "2026-01-20", day=0) == ["2026-01-05", "2026-01-12",
                                                                           "2026-01-19"]


def test_monthly_31st_clamps():
    assert occ("monthly", "2026-01-15", "2026-01-01", "2026-05-01", day=31) == [
        "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]


def test_every_n_months_and_once_and_end():
    assert occ("every_n_months", "2026-01-10", "2026-01-01", "2026-12-31", day=10, interval=3) == [
        "2026-01-10", "2026-04-10", "2026-07-10", "2026-10-10"]
    assert occ("once", "2026-03-04", "2026-01-01", "2026-12-31") == ["2026-03-04"]
    assert occ("once", "2026-03-04", "2026-03-05", "2026-12-31") == []
    assert occ("monthly", "2026-01-01", "2026-01-01", "2026-12-31", day=1, end_date="2026-03-01") == [
        "2026-01-01", "2026-02-01", "2026-03-01"]


def test_payoff():
    p = cashflow.payoff(1000, 12, 100, date(2026, 10, 12))
    assert p and p["months"] == 11 and p["date"] == "2027-09"
    assert cashflow.payoff(1000, 24, 10, date(2026, 10, 12)) is None  # doesn't cover interest


# ── sync ─────────────────────────────────────────────────

def plan_accounts():
    return {"cash": acct("Checking", 1000), "card": acct("Card", 1000, "liability", "credit_card", 12),
            "sav": acct("Savings", 0), "bro": acct("Robinhood cash", 0, category="brokerage")}


def test_sync_posts_every_type_once(client):
    a = plan_accounts()
    cashflow.setup(a["cash"], None, None, D0)
    cashflow.create_item(item(name="Paycheck", type="income", amount=500, day=5, category=None), D0)
    cashflow.create_item(item(name="Rent", amount=100, day=6), D0)
    cashflow.create_item(item(name="Card payment", type="debt", amount=200, day=7, account_id=a["card"],
                              category=None), D0)
    cashflow.create_item(item(name="Rainy day", type="save", amount=50, day=8, account_id=a["sav"],
                              category=None), D0)
    cashflow.create_item(item(name="Brokerage", type="invest", amount=25, day=9, account_id=a["bro"],
                              category=None), D0)
    assert cashflow.sync(date(2026, 1, 10))["posted"] == 5
    assert bal(a["cash"]) == 1000 + 500 - 100 - 200 - 50 - 25
    assert bal(a["card"]) == 810          # 200 payment, 10 of it interest (12% / 12 of 1000)
    assert bal(a["sav"]) == 50 and bal(a["bro"]) == 25
    with db.conn() as c:
        move = c.execute("SELECT * FROM cash_moves WHERE kind='debt'").fetchone()
        assert (move["principal"], move["interest"]) == (190, 10)
        txs = c.execute("SELECT kind, amount, cash_applied, category FROM transactions ORDER BY kind").fetchall()
        assert [(t["kind"], t["amount"], t["cash_applied"]) for t in txs] == [
            ("expense", 100, -100), ("income", 500, 500)]
    before = [a2["balance"] for a2 in db.list_accounts()]
    assert cashflow.sync(date(2026, 1, 10))["posted"] == 0
    assert [a2["balance"] for a2 in db.list_accounts()] == before
    assert cashflow.sync(date(2026, 2, 10))["posted"] == 5


def test_no_backpost_for_new_items_and_setup_floor(client):
    a = plan_accounts()
    cashflow.setup(a["cash"], None, None, D0)
    cashflow.create_item(item(name="Old rent", day=3, start_date="2025-01-01"), D0)  # created today, old start
    cashflow.sync(date(2026, 3, 5))
    with db.conn() as c:
        dates = [r["date"] for r in c.execute("SELECT date FROM cash_moves ORDER BY date")]
    assert dates == ["2026-01-03", "2026-02-03", "2026-03-03"]


def test_sync_without_cash_account_does_nothing(client):
    a = plan_accounts()
    cashflow.create_item(item(), D0)
    assert cashflow.sync(date(2026, 3, 5))["posted"] == 0
    assert bal(a["cash"]) == 1000
    assert cashflow.build(date(2026, 3, 5))["cash"] is None


def test_paid_off_debt_stops_charging(client):
    a = plan_accounts()
    paid = acct("Old card", 0, "liability", "credit_card", 10)
    cashflow.setup(a["cash"], None, None, D0)
    cashflow.create_item(item(name="Old card", type="debt", amount=50, day=7, account_id=paid, category=None), D0)
    cashflow.sync(date(2026, 1, 10))
    assert bal(a["cash"]) == 1000
    b = cashflow.build(date(2026, 1, 10))
    assert b["upcoming"] == [] and b["month"]["debt"] == 0
    assert b["items"][0]["payoff"] is None and b["items"][0]["next_date"] is None


def test_payload_shape(client):
    a = plan_accounts()
    cashflow.setup(a["cash"], None, None, D0)
    cashflow.create_item(item(name="Paycheck", type="income", amount=1000, frequency="semimonthly", day=1, day2=15,
                              category=None), D0)
    cashflow.create_item(item(name="Rent", amount=400, day=20), D0)
    b = cashflow.payload(date(2026, 1, 10))
    assert b["cash"]["balance"] == 2000 and b["month"]["income"] == 2000 and b["month"]["left"] == 1600
    assert [u["date"] for u in b["upcoming"]][:2] == ["2026-01-15", "2026-01-20"]
    assert b["month_end"] == 2000 + 1000 - 400
    assert b["recent"][0]["kind"] == "income"
    assert {"id", "name", "category", "kind", "balance", "rate"} <= set(b["accounts"][0])


def test_validation(client):
    a = plan_accounts()
    for bad in (item(amount=0), item(category=None), item(type="debt", account_id=a["cash"]),
                item(type="save", account_id=a["card"], category=None), item(frequency="daily")):
        r = client.post("/api/cash/items", json=bad)
        assert r.status_code == 400 and isinstance(r.json()["detail"], str)


# ── manual transactions ──────────────────────────────────

def test_manual_transactions_adjust_cash_and_reverse(client):
    a = plan_accounts()
    client.put("/api/cash/setup", json={"account_id": a["cash"]})
    today = date.today().isoformat()
    t = client.post("/api/transactions", json={"category": "food", "amount": 20, "date": today}).json()
    assert bal(a["cash"]) == 980
    client.patch(f"/api/transactions/{t['id']}", json={"amount": 30})
    assert bal(a["cash"]) == 970
    client.delete(f"/api/transactions/{t['id']}")
    assert bal(a["cash"]) == 1000
    r = client.post("/api/transactions", json={"category": "food", "amount": 15, "refund": True, "date": today}).json()
    assert bal(a["cash"]) == 1015
    inc = client.post("/api/transactions", json={"category": "income", "kind": "income", "amount": 60,
                                                 "date": today}).json()
    assert bal(a["cash"]) == 1075
    n = client.post("/api/transactions/bulk", json={"action": "delete", "ids": [r["id"], inc["id"]]}).json()
    assert n["deleted"] == 2 and bal(a["cash"]) == 1000
    # older than the setup day: not applied
    client.post("/api/transactions", json={"category": "food", "amount": 9, "date": "2020-01-01"})
    assert bal(a["cash"]) == 1000


def test_statement_import_does_not_touch_cash(client):
    a = plan_accounts()
    client.put("/api/cash/setup", json={"account_id": a["cash"]})
    row = {"date": date.today().isoformat(), "merchant": "Shop", "description": "Shop", "amount": 40,
           "kind": "expense", "category": "food", "hash": "h1"}
    client.post("/api/import/commit", json={"rows": [row]})
    assert bal(a["cash"]) == 1000


def test_deleting_a_posted_paycheck_reverses_and_is_not_reposted(client):
    a = plan_accounts()
    cashflow.setup(a["cash"], None, None, D0)
    cashflow.create_item(item(name="Paycheck", type="income", amount=500, day=5, category=None), D0)
    cashflow.sync(date(2026, 1, 10))
    tx = db.list_transactions()[0]
    assert cashflow.delete_transaction(tx["id"])
    assert bal(a["cash"]) == 1000
    cashflow.sync(date(2026, 1, 11))
    assert bal(a["cash"]) == 1000 and db.list_transactions() == []


# ── auto-invest ──────────────────────────────────────────

def test_autoinvest_fill_charged_once_and_reversed(client):
    a = plan_accounts()
    cashflow.setup(a["cash"], None, None)
    t = date.today()
    rid = autoinvest.create_rule({"symbol": "VOO", "kind": "stock", "amount": 100.0, "frequency": "monthly",
                                  "day": t.day, "start_date": t.isoformat(), "label": "Roth IRA",
                                  "cash_account_id": a["cash"]}, add_past=False, today=t)
    closes = {"stock": {t.isoformat(): 100.0}}
    autoinvest.apply(today=t + timedelta(days=1), fetch=lambda k, s, since, today: closes[k])
    cashflow.sync(t)
    assert bal(a["cash"]) == 900
    cashflow.sync(t)
    assert bal(a["cash"]) == 900
    assert cashflow.build(t)["recent"][0]["kind"] == "autoinvest"
    autoinvest.delete_rule(rid, keep_shares=False)  # the fill disappears
    cashflow.sync(t)
    assert bal(a["cash"]) == 1000


def test_autoinvest_api_sets_cash_from(client):
    a = plan_accounts()
    t = date.today().isoformat()
    r = client.post("/api/autoinvest", json={"symbol": "VOO", "amount": 100, "frequency": "monthly", "day": 1,
                                             "start_date": t, "add_past": False}).json()
    assert r["cash_account_id"] is None
    r = client.patch(f"/api/autoinvest/{r['id']}", json={"cash_account_id": a["cash"]}).json()
    assert r["cash_account_id"] == a["cash"] and r["cash_from"] == t
    r = client.patch(f"/api/autoinvest/{r['id']}", json={"cash_account_id": None}).json()
    assert r["cash_account_id"] is None


# ── logging a buy ────────────────────────────────────────

def test_invest_adds_shares_and_undo_reverses(client):
    a = plan_accounts()
    db.update_account(a["bro"], {"balance": 150})
    r = client.post("/api/cash/invest", json={"account_id": a["bro"], "symbol": "voo", "kind": "stock",
                                              "amount": 150, "price": 50}).json()
    assert r["logged"]["qty"] == 3 and bal(a["bro"]) == 0
    h = next(h for h in db.list_holdings() if h["symbol"] == "VOO")
    assert h["qty"] == 3 and h["label"] == "Robinhood" and h["cost_basis"] == 50
    # price defaults to the market quote (stubbed at 50)
    client.post("/api/cash/invest", json={"account_id": a["bro"], "symbol": "VOO", "kind": "stock", "amount": 100})
    assert next(h for h in db.list_holdings() if h["symbol"] == "VOO")["qty"] == 5
    mid = r["logged"]["move_id"]
    out = client.delete(f"/api/cash/moves/{mid}").json()
    assert out["setup"] and next(h for h in db.list_holdings() if h["symbol"] == "VOO")["qty"] == 2
    assert bal(a["bro"]) == -100 + 150


def test_invest_without_price_is_a_friendly_error(client, monkeypatch):
    a = plan_accounts()
    monkeypatch.setattr(market_data, "live_quote", lambda sym, kind: {"price": None})
    r = client.post("/api/cash/invest", json={"account_id": a["bro"], "symbol": "ZZZ", "amount": 10})
    assert r.status_code == 400 and "Couldn't get a price for ZZZ" in r.json()["detail"]


def test_manual_move_balance_and_undo(client):
    a = plan_accounts()
    p = client.post("/api/cash/move", json={"from_account_id": a["cash"], "to_account_id": a["sav"],
                                            "amount": 75}).json()
    assert bal(a["cash"]) == 925 and bal(a["sav"]) == 75
    client.post("/api/cash/balance", json={"account_id": a["cash"], "balance": 900})
    assert bal(a["cash"]) == 900
    mids = [r["move_id"] for r in p["recent"]]
    client.delete(f"/api/cash/moves/{mids[0]}")
    assert bal(a["cash"]) == 975 and bal(a["sav"]) == 0


def test_scheduled_move_cannot_be_undone(client):
    a = plan_accounts()
    cashflow.setup(a["cash"], None, None, D0)
    cashflow.create_item(item(name="Rent", day=6), D0)
    cashflow.sync(date(2026, 1, 10))
    with db.conn() as c:
        mid = c.execute("SELECT id FROM cash_moves").fetchone()["id"]
    r = client.delete(f"/api/cash/moves/{mid}")
    assert r.status_code == 400 and bal(a["cash"]) == 900


# ── snooze ───────────────────────────────────────────────

def test_snooze_hides_until_next_deposit(client):
    a = plan_accounts()
    db.update_account(a["bro"], {"balance": 150})
    cashflow.setup(a["cash"], None, None, D0)
    cashflow.create_item(item(name="Weekly", type="invest", amount=150, frequency="weekly", day=3,
                              account_id=a["bro"], category=None), D0)
    cashflow.sync(date(2026, 1, 8))
    row = cashflow.build(date(2026, 1, 8))["to_invest"][0]
    assert row["account_id"] == a["bro"] and row["snoozed"] is False and row["last_deposit"] == "2026-01-08"
    cashflow.snooze(a["bro"], date(2026, 1, 8))
    assert cashflow.build(date(2026, 1, 9))["to_invest"][0]["snoozed"] is True
    cashflow.sync(date(2026, 1, 15))
    assert cashflow.build(date(2026, 1, 15))["to_invest"][0]["snoozed"] is False


# ── plan import ──────────────────────────────────────────

def test_plan_template_is_fake_and_import_is_idempotent(client):
    plan = client.get("/api/cash/plan-template").json()
    assert plan["version"] == 1 and any(i["name"] == "Main job" and i["amount"] == 1000 for i in plan["items"])
    pre = client.post("/api/cash/import/preview", json={"plan": plan}).json()
    assert pre["errors"] == [] and {r["status"] for r in pre["rows"]} == {"new"}
    out = client.post("/api/cash/import", json={"plan": plan, "skip": ["goals:rainy"]}).json()
    assert out["created"]["accounts"] == 4 and out["created"]["items"] == 6 and out["created"]["autoinvest"] == 1
    assert out["created"]["goals"] == 0 and out["created"]["budgets"] == 1
    assert out["cash"]["cash"]["name"] == "Example Checking"
    assert len(client.get("/api/autoinvest").json()) == 1
    assert client.get("/api/autoinvest").json()[0]["cash_account_id"] == out["cash"]["setup"]["account_id"]
    pre2 = client.post("/api/cash/import/preview", json={"plan": plan}).json()
    by = {r["key"]: r["status"] for r in pre2["rows"]}
    # Cash moved on since the plan was written (today's paycheck, ...): its balance shows as an update
    assert by["goals:rainy"] == "new"
    assert all(s == "exists" for k, s in by.items() if k not in ("goals:rainy", "accounts:checking"))
    again = client.post("/api/cash/import", json={"plan": plan, "skip": ["goals:rainy", "accounts:checking"]}).json()
    assert all(v == 0 for v in again["created"].values()) and all(v == 0 for v in again["updated"].values())
    assert len(db.list_accounts()) == 4 and len(client.get("/api/autoinvest").json()) == 1


def test_import_updates_balance_budget_and_keeps_existing_cash_setup(client):
    a = plan_accounts()
    client.put("/api/cash/setup", json={"account_id": a["sav"]})
    db.set_budget("food", 100)
    plan = {"version": 1, "accounts": [{"key": "c", "name": "checking", "category": "cash", "kind": "asset",
                                        "balance": 1234}], "cash_account": "c",
            "budgets": [{"key": "food", "category": "food", "limit": 250}]}
    rows = client.post("/api/cash/import/preview", json={"plan": plan}).json()["rows"]
    assert {r["key"]: r["status"] for r in rows} == {"accounts:c": "update", "cash:account": "exists",
                                                     "budgets:food": "update"}
    out = client.post("/api/cash/import", json={"plan": plan}).json()
    assert bal(a["cash"]) == 1234 and db.get_budgets()["food"] == 250
    assert out["cash"]["setup"]["account_id"] == a["sav"]  # existing setup is not overridden


def test_import_reports_bad_rows(client):
    plan = {"version": 1, "accounts": [], "items": [{"key": "x", "name": "Rent", "type": "bill", "amount": 5,
                                                     "frequency": "monthly", "day": 1, "start_date": "2026-01-01"}]}
    pre = client.post("/api/cash/import/preview", json={"plan": plan}).json()
    assert pre["rows"] == [] and len(pre["errors"]) == 1
    assert client.post("/api/cash/import", json={"plan": plan}).status_code == 400


# ── goals by account ─────────────────────────────────────

def test_goal_by_account_uses_balance_and_save_pace(client):
    a = plan_accounts()
    db.update_account(a["sav"], {"balance": 750})
    cashflow.setup(a["cash"], None, None, D0)
    cashflow.create_item(item(name="Rainy day", type="save", amount=50, frequency="biweekly", day=None,
                              account_id=a["sav"], category=None, start_date="2030-01-01"), D0)
    goals = client.post("/api/goals", json={"name": "Emergency", "target": 1500, "account_id": a["sav"]}).json()["goals"]
    g = goals[0]
    assert g["account_id"] == a["sav"] and g["current"] == 750 and g["pct"] == 50.0
    assert cashflow.account_monthly(a["sav"]) == round(50 * 26 / 12, 2)
    client.post("/api/goals", json={"name": "NW", "target": 10})
    assert {x["name"]: x["account_id"] for x in client.get("/api/goals").json()["goals"]} == {
        "Emergency": a["sav"], "NW": None}
    assert client.post("/api/goals", json={"name": "Bad", "target": 5, "account_id": 999}).status_code == 400
