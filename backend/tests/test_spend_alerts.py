import json
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db  # noqa: E402
import spend_alerts as sa  # noqa: E402

ACT3 = {"2026-07", "2026-08", "2026-09"}


def run(today, daily, active=ACT3):
    return sa.build_alerts(today, daily, set(active))


def food(r):
    return next((a for a in r["alerts"] if a["category"] == "food"), None)


def test_rent_on_day_one_does_not_flag_on_day_two():
    d = {m: {"rent": {1: 1500}} for m in ("2026-07", "2026-08", "2026-09", "2026-10")}
    assert run(date(2026, 10, 2), d)["alerts"] == []


def test_food_hot_mid_month_is_watch():
    d = {m: {"food": {d_: 10 for d_ in range(1, 29)}} for m in ACT3}  # 280/month, 90 by the 9th
    d["2026-10"] = {"food": {1: 100, 5: 80, 8: 90}}  # 270
    a = food(run(date(2026, 10, 9), d))
    assert a["level"] == "watch" and a["spent"] == 270 and a["typical_to_date"] == 90
    assert a["over_amount"] == 180 and a["over_pct"] == 200
    assert a["normal_month"] == 280


def test_past_whole_normal_month_is_high():
    d = {m: {"food": {15: 100}} for m in ACT3}
    d["2026-10"] = {"food": {2: 150}}
    assert food(run(date(2026, 10, 10), d))["level"] == "high"


def test_small_excess_not_flagged():
    d = {m: {"food": {1: 10}} for m in ACT3}
    d["2026-10"] = {"food": {1: 55}}  # 5.5x but only $45 over
    assert run(date(2026, 10, 5), d)["alerts"] == []


def test_needs_two_history_months():
    d = {"2026-09": {"food": {1: 10}}, "2026-10": {"food": {1: 500}}}
    r = run(date(2026, 10, 5), d, {"2026-09"})
    assert r["alerts"] == [] and r["history_months"] == 1
    # inactive months (no transactions at all) are skipped as history
    assert run(date(2026, 10, 5), d, {"2026-07", "2026-09"})["history_months"] == 2


def test_last_day_compares_full_months():
    # Feb 28 is the last day: the 31-day history months count in full, including day 30.
    d = {m: {"food": {30: 200}} for m in ("2025-11", "2025-12", "2026-01")}
    d["2026-02"] = {"food": {10: 100}}
    act = {"2025-11", "2025-12", "2026-01"}
    # 2025-11 has 30 days, others 31 -> all include day 30, typical 200; 100 not flagged
    assert run(date(2026, 2, 28), d, act)["alerts"] == []
    d["2026-02"] = {"food": {10: 260}}
    assert food(run(date(2026, 2, 28), d, act))["level"] == "high"
    # Not the last day: Feb 27 compares only through day 27, typical 0 -> flags, over_pct None
    r = food(run(date(2026, 2, 27), d, act))
    assert r["typical_to_date"] == 0 and r["over_pct"] is None


def test_refunds_do_not_go_negative():
    d = {m: {"food": {1: -80, 5: 20}} for m in ACT3}
    d["2026-10"] = {"food": {1: -500}}
    r = run(date(2026, 10, 9), d)
    assert r["alerts"] == []
    d["2026-10"] = {"food": {1: 400, 2: -100}}
    assert food(run(date(2026, 10, 9), d))["spent"] == 300


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db")
    db.init_db()
    return tmp_path


def _add(rows):
    with db.conn() as c:
        for dt, cat, amt in rows:
            c.execute("INSERT INTO transactions (date, category, amount, kind, note) VALUES (?,?,?,'expense','')",
                      (dt, cat, amt))


def test_notify_dedupe_and_escalation(env):
    _add([x for m in (7, 8, 9) for x in ((f"2026-{m:02d}-03", "food", 100), (f"2026-{m:02d}-20", "food", 200))] + [("2026-10-04", "food", 160)])
    sent = []
    send = lambda t, b, tag: sent.append((t, b, tag))
    assert sa.check_and_notify(date(2026, 10, 9), send) == 1
    assert sent[0][0] == "Food is running above normal" and sent[0][2] == "spend-food"
    assert "$160 so far this month. Usually about $100 by the 9th." == sent[0][1]
    assert sa.check_and_notify(date(2026, 10, 9), send) == 0
    _add([("2026-10-08", "food", 150)])  # 210 < normal 300 -> need more -> high
    assert sa.check_and_notify(date(2026, 10, 9), send) == 1
    assert "more than a usual whole month ($300)" in sent[1][1]
    assert sa.check_and_notify(date(2026, 10, 10), send) == 0
    # stale month keys get pruned
    db.set_setting(sa.SENT_KEY, json.dumps(["2026-09:food:high", "2026-10:food:high"]))
    sa.check_and_notify(date(2026, 10, 10), send)
    assert json.loads(db.get_setting(sa.SENT_KEY)) == ["2026-10:food:high"]
