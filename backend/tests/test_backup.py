import json
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import backup  # noqa: E402
import db  # noqa: E402


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db")
    monkeypatch.setattr(backup, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(backup, "BACKUP_KEEP", 3)
    db.init_db()
    with db.conn() as c:
        c.execute("INSERT INTO transactions (date, category, amount, kind, note) VALUES ('2026-03-05','Food',12.5,'expense','a, b')")
        c.execute("INSERT INTO transactions (date, category, amount, kind, note) VALUES ('2026-04-01','Pay',100,'income','')")
    return tmp_path


def test_json_shape(env):
    d = backup.export_json()
    assert "exported_at" in d and "transactions" in d["tables"]
    assert not any(t.startswith("sqlite_") for t in d["tables"])
    assert len(d["tables"]["transactions"]) == 2
    json.dumps(d)


def test_csv_and_month(env):
    assert backup.export_transactions_csv().count("\n") == 3
    m = backup.export_transactions_csv("2026-03")
    assert "Food" in m and "Pay" not in m
    with pytest.raises(ValueError):
        backup.export_transactions_csv("bad")


def test_backup_created_and_valid(env):
    b = backup.run_backup()
    p = backup.BACKUP_DIR / b["name"]
    assert p.exists() and b["size"] > 0
    assert sqlite3.connect(p).execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 2
    assert backup.status()["last"]["name"] == b["name"]
    assert not list(backup.BACKUP_DIR.glob("*.tmp"))


def test_prune(env):
    backup.BACKUP_DIR.mkdir()
    for d in range(1, 7):
        (backup.BACKUP_DIR / f"terminal-2026-01-0{d}.db").write_bytes(b"x")
    (backup.BACKUP_DIR / "notes.txt").write_text("keep me")
    backup.prune()
    names = [b["name"] for b in backup.list_backups()]
    assert names == ["terminal-2026-01-06.db", "terminal-2026-01-05.db", "terminal-2026-01-04.db"]
    assert (backup.BACKUP_DIR / "notes.txt").exists()


def test_temp_snapshot(env):
    p = backup.temp_snapshot()
    try:
        assert sqlite3.connect(p).execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 2
    finally:
        p.unlink()
