import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import backup  # noqa: E402
import db  # noqa: E402
import nw_history  # noqa: E402


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db")
    monkeypatch.setattr(backup, "BACKUP_DIR", tmp_path / "backups")
    db.init_db()
    for name, cat, kind, bal in [
        ("Chk", "cash", "asset", 1000), ("Brk", "brokerage", "asset", 2000),
        ("Roth", "retirement", "asset", 3000), ("Coin", "crypto", "asset", 500),
        ("House", "real_estate", "asset", 10000), ("Misc", "weird", "asset", 100),
        ("Card", "credit_card", "liability", 400),
    ]:
        db.create_account({"name": name, "category": cat, "kind": kind, "balance": bal})
    return tmp_path


def make_backup(date):
    return backup.snapshot_to(backup.BACKUP_DIR / f"terminal-{date}.db")


def stub(kind, sym, d):
    return {"BTC": 100.0, "RDW": 10.0}.get(sym)


def row(date):
    with db.conn() as c:
        r = c.execute("SELECT * FROM networth_snapshots WHERE date=?", (date,)).fetchone()
        return dict(r) if r else None


def test_snapshot_buckets(env):
    s = db.take_snapshot(250)
    assert s["investments"] == 5750 and s["cash"] == 1000 and s["property"] == 10100
    assert s["liabilities"] == 400 and s["net_worth"] == 16450
    r = row(s["date"])
    assert r["investments"] == 5750 and r["source"] == "live"
    assert db.networth_totals(250)["net_worth"] == 16450


def test_copy_missing_snapshot(env):
    with db.conn() as c:
        c.execute("INSERT INTO networth_snapshots (date, assets, liabilities, net_worth) VALUES ('2026-01-01',5,1,4)")
    make_backup("2026-02-01")
    with db.conn() as c:
        c.execute("DELETE FROM networth_snapshots")
    out = nw_history.backfill(stub)
    assert out["copied"] == 1
    r = row("2026-01-01")
    assert r["net_worth"] == 4 and r["source"] == "backup" and r["investments"] is None


def test_rebuild_missing_date(env):
    db.create_holding({"symbol": "BTC", "kind": "crypto", "qty": 2})
    db.create_holding({"symbol": "OPT", "kind": "option", "qty": 1, "cost_basis": 3})
    make_backup("2026-02-01")
    out = nw_history.backfill(stub)
    assert out["rebuilt"] == 1
    r = row("2026-02-01")
    # holdings = 2*100 + 1*3*100 = 500
    assert r["investments"] == 6000 and r["source"] == "rebuilt"
    assert r["net_worth"] == 6000 + 1000 + 10100 - 400


def test_enrich_keeps_net_worth(env):
    with db.conn() as c:
        c.execute("INSERT INTO networth_snapshots (date, assets, liabilities, net_worth) VALUES ('2026-02-01',999,9,990)")
    make_backup("2026-02-01")
    out = nw_history.backfill(stub)
    assert out["enriched"] == 1 and out["rebuilt"] == 0
    r = row("2026-02-01")
    assert r["net_worth"] == 990 and r["assets"] == 999
    assert r["investments"] == 5500 and r["cash"] == 1000 and r["property"] == 10100


def test_skip_when_price_missing(env):
    db.create_holding({"symbol": "NOPE", "kind": "stock", "qty": 1})
    make_backup("2026-02-01")
    out = nw_history.backfill(stub)
    assert out["rebuilt"] == 0 and row("2026-02-01") is None


def test_idempotent(env):
    db.create_holding({"symbol": "BTC", "kind": "crypto", "qty": 1})
    with db.conn() as c:
        c.execute("INSERT INTO networth_snapshots (date, assets, liabilities, net_worth) VALUES ('2026-01-01',5,1,4)")
    make_backup("2026-02-01")
    make_backup("2026-02-02")
    nw_history.backfill(stub)
    before = nw_history.history()
    out = nw_history.backfill(stub)
    assert (out["copied"], out["rebuilt"], out["enriched"]) == (0, 0, 0)
    assert nw_history.history() == before


def test_bad_backup_tolerated(env):
    backup.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    (backup.BACKUP_DIR / "terminal-2026-01-01.db").write_bytes(b"garbage")
    sqlite3.connect(backup.BACKUP_DIR / "terminal-2026-01-02.db").close()  # empty db, no tables
    make_backup("2026-02-01")
    out = nw_history.backfill(stub)
    assert out["rebuilt"] == 1
