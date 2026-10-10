import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import budget  # noqa: E402
import db  # noqa: E402

TODAY = date(2026, 10, 9)
CATS = ["food", "rent", "fun"]


def cat(p, name):
    return next(c for c in p["categories"] if c["category"] == name)


def mk(spending=None, active=(), targets=None, month="2026-10", today=TODAY, lump=None):
    return budget.build_plan(month, today, spending or {}, set(active), targets or {}, CATS, lump)


def test_pace_and_projection_mid_month():
    p = mk({"2026-10": {"food": 90}}, targets={"food": 310})
    assert (p["days_in_month"], p["days_elapsed"], p["days_left"]) == (31, 9, 23)
    c = cat(p, "food")
    assert c["pace"] == 90.0          # 310 * 9 / 31
    assert c["projected"] == 310.0    # 90 * 31 / 9
    assert c["left"] == 220.0 and c["pct"] == 29.0
    assert p["totals"]["projected"] == 310.0


def test_no_projection_in_first_week_without_history():
    p = mk({"2026-10": {"food": 50}}, targets={"food": 100}, today=date(2026, 10, 2))
    assert cat(p, "food")["projected"] is None
    assert p["totals"]["projected"] is None


def test_past_month():
    p = mk({"2026-09": {"food": 400}}, targets={"food": 300}, month="2026-09")
    assert p["days_left"] == 0 and p["days_elapsed"] == 30 and not p["is_current"]
    c = cat(p, "food")
    assert c["pace"] is None and c["projected"] is None and c["status"] == "over"
    assert p["totals"]["daily_allowance"] is None


def test_future_month():
    p = mk(month="2026-11", targets={"food": 100})
    assert p["is_future"] and p["days_elapsed"] == 0 and p["days_left"] == 30
    assert cat(p, "food")["status"] == "ok"


def test_avg_3m_skips_inactive_months():
    sp = {"2026-09": {"food": 100}, "2026-07": {"food": 50}}
    # August has no data at all: not counted. June is out of range.
    p = mk(sp, active={"2026-09", "2026-07"})
    assert p["history_months"] == 2
    assert cat(p, "food")["avg_3m"] == 75.0
    assert cat(p, "rent")["avg_3m"] == 0.0 and cat(p, "rent")["suggested"] is None
    assert cat(p, "food")["last_month"] == 100.0
    assert mk()["categories"][0]["avg_3m"] is None


def test_suggested_rounds_up_to_10():
    p = mk({"2026-09": {"food": 101, "fun": 100}}, active={"2026-09"})
    assert cat(p, "food")["suggested"] == 110.0
    assert cat(p, "fun")["suggested"] == 100.0


def test_status():
    p = mk({"2026-10": {"food": 20, "rent": 500, "fun": 200, "other": 5}},
           targets={"food": 310, "rent": 400, "fun": 600})
    assert cat(p, "food")["status"] == "ok"    # proj 68.9 < 310
    assert cat(p, "rent")["status"] == "over"
    assert cat(p, "fun")["status"] == "watch"  # proj 688 > 600
    assert cat(p, "other")["status"] == "none"
    # Within 10% of the target counts as close to the limit.
    q = mk({"2026-10": {"food": 280}}, targets={"food": 310}, today=date(2026, 10, 2))
    assert cat(q, "food")["status"] == "watch"


def test_lump_sum_with_history_not_extrapolated():
    # Rent paid on the 1st shouldn't project to 10x the target.
    p = mk({"2026-10": {"rent": 1500, "food": 100}, "2026-09": {"rent": 1500, "food": 600}},
           active={"2026-09"}, targets={"rent": 1800, "food": 700}, today=date(2026, 10, 3))
    assert cat(p, "rent")["projected"] == 1500.0 and cat(p, "rent")["status"] == "ok"
    assert cat(p, "food")["projected"] == 600.0
    p2 = mk({"2026-10": {"food": 650}, "2026-09": {"food": 600}}, active={"2026-09"},
            targets={"food": 700}, today=date(2026, 10, 3))
    assert cat(p2, "food")["projected"] == 650.0


def test_zero_target():
    ok = mk(targets={"fun": 0})
    assert cat(ok, "fun")["status"] == "ok" and cat(ok, "fun")["pct"] is None
    bad = mk({"2026-10": {"fun": 1}}, targets={"fun": 0})
    assert cat(bad, "fun")["status"] == "over"


def test_income_excluded_and_sort():
    p = mk({"2026-10": {"income": 999, "food": 10, "zzz": 30}}, targets={"rent": 800, "food": 100, "income": 5})
    names = [c["category"] for c in p["categories"]]
    assert "income" not in names
    assert names[:2] == ["rent", "food"] and names[2] == "zzz"
    assert p["totals"]["spent"] == 40.0 and p["totals"]["spent_targeted"] == 10.0


def test_daily_allowance():
    p = mk({"2026-10": {"food": 100}}, targets={"food": 330})
    assert p["totals"]["left"] == 230.0
    assert p["totals"]["daily_allowance"] == 10.0  # 230 / 23
    over = mk({"2026-10": {"food": 400}}, targets={"food": 330})
    assert over["totals"]["daily_allowance"] == 0.0


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db")
    db.init_db()
    with db.conn() as c:
        for d, k, cat_, a in [("2026-10-03", "expense", "food", 40), ("2026-10-04", "income", "income", 900),
                              ("2026-09-10", "expense", "food", 100), ("2026-07-01", "income", "income", 5)]:
            c.execute("INSERT INTO transactions (date, category, amount, kind, note) VALUES (?,?,?,?,'')",
                      (d, cat_, a, k))
    return tmp_path


def test_plan_via_db(env):
    db.set_budget("food", 200)
    assert db.active_months(["2026-10", "2026-08", "2026-07"]) == {"2026-10", "2026-07"}
    p = budget.plan("2026-10", TODAY)
    f = cat(p, "food")
    assert f["spent"] == 40.0 and f["last_month"] == 100.0 and f["target"] == 200.0
    assert p["history_months"] == 2 and f["avg_3m"] == 50.0


def test_bulk_endpoint(env):
    from fastapi import HTTPException
    import main
    r = main.put_budgets_bulk(main.BudgetBulkIn(targets=[
        {"category": "food", "monthly_limit": 100}, {"category": "rent", "monthly_limit": 5}]))
    assert r == {"saved": 2, "removed": 0}
    r = main.put_budgets_bulk(main.BudgetBulkIn(targets=[
        {"category": "food", "monthly_limit": None}, {"category": "rent", "monthly_limit": -1}]))
    assert r == {"saved": 0, "removed": 2} and db.get_budgets() == {}
    with pytest.raises(HTTPException):
        main.put_budgets_bulk(main.BudgetBulkIn(targets=[{"category": "income", "monthly_limit": 1}]))
    with pytest.raises(HTTPException):
        main.put_budget(main.BudgetIn(category="food", monthly_limit=-1))


def test_monthly_bills_and_moved_statements_not_extrapolated():
    p = mk({"2026-10": {"rent": 1500, "food": 300}})
    assert cat(p, "rent")["projected"] == 1500.0           # a bill paid once, no history
    assert cat(p, "food")["projected"] == round(300 * 31 / 9, 2)
    p = mk({"2026-10": {"food": 300}}, lump={"food": 210})  # a September statement counted in October
    assert cat(p, "food")["projected"] == round(210 + 90 * 31 / 9, 2)
