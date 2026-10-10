"""Backup and export: JSON/CSV exports, consistent DB copies, daily automatic backups.

Logic only; routes live in main.py. Uses sqlite3's online backup API so copies are
consistent even while the app is writing.
"""
import csv
import io
import os
import re
import sqlite3
import tempfile
import threading
import time
from datetime import date, datetime, timezone
from pathlib import Path

import db

BACKUP_DIR = Path(os.getenv("BACKUP_DIR") or (Path(__file__).parent / "backups"))
BACKUP_KEEP = max(1, int(os.getenv("BACKUP_KEEP") or 14))
_NAME_RE = re.compile(r"^terminal-\d{4}-\d{2}-\d{2}\.db$")
_lock = threading.Lock()


def _today() -> str:
    return date.today().isoformat()


def _open_ro() -> sqlite3.Connection:
    c = sqlite3.connect(db.DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def _tables(c: sqlite3.Connection) -> list[str]:
    rows = c.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return [r["name"] for r in rows]


def export_json() -> dict:
    c = _open_ro()
    try:
        tables = {}
        for t in _tables(c):
            tables[t] = [dict(r) for r in c.execute(f'SELECT * FROM "{t}"')]
    finally:
        c.close()
    return {"exported_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "tables": tables}


def export_transactions_csv(month: str | None = None) -> str:
    if month is not None and not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValueError("month must be YYYY-MM")
    c = _open_ro()
    try:
        if month:
            # budget month, so a card statement moved to the month it's paid exports with that month
            cur = c.execute("SELECT * FROM transactions WHERE COALESCE(NULLIF(budget_month, ''), substr(date,1,7))=? "
                            "ORDER BY date, id", (month,))
        else:
            cur = c.execute("SELECT * FROM transactions ORDER BY date, id")
        cols = [d[0] for d in cur.description]
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(cols)
        for r in cur:
            w.writerow(list(r))
    finally:
        c.close()
    return out.getvalue()


def snapshot_to(dest: Path) -> Path:
    """Consistent copy of the live DB into dest via Connection.backup()."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    src = sqlite3.connect(db.DB_PATH)
    dst = sqlite3.connect(dest)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    return dest


def temp_snapshot() -> Path:
    fd, name = tempfile.mkstemp(prefix="aero-fuse-", suffix=".db")
    os.close(fd)
    return snapshot_to(Path(name))


def list_backups() -> list[dict]:
    if not BACKUP_DIR.is_dir():
        return []
    out = []
    for p in BACKUP_DIR.iterdir():
        if _NAME_RE.match(p.name):
            st = p.stat()
            out.append({
                "name": p.name,
                "size": st.st_size,
                "created": datetime.fromtimestamp(st.st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            })
    return sorted(out, key=lambda b: b["name"], reverse=True)


def prune(keep: int | None = None) -> list[str]:
    keep = BACKUP_KEEP if keep is None else keep
    removed = []
    for b in list_backups()[keep:]:
        try:
            (BACKUP_DIR / b["name"]).unlink()
            removed.append(b["name"])
        except OSError as e:
            print(f"[backup] could not remove {b['name']}: {e}")
    return removed


def run_backup() -> dict:
    """Write today's backup (overwrites a same-day one), then prune. Returns its listing row."""
    with _lock:
        name = f"terminal-{_today()}.db"
        final = BACKUP_DIR / name
        tmp = BACKUP_DIR / (name + ".tmp")
        try:
            snapshot_to(tmp)
            os.replace(tmp, final)
        finally:
            tmp.unlink(missing_ok=True)
        prune()
    return next(b for b in list_backups() if b["name"] == name)


def status() -> dict:
    bs = list_backups()
    return {"dir": str(BACKUP_DIR), "keep": BACKUP_KEEP, "backups": bs, "last": bs[0] if bs else None}


def has_today() -> bool:
    return (BACKUP_DIR / f"terminal-{_today()}.db").exists()


def backup_loop():
    """Daemon: shortly after startup, then hourly, back up if today's is missing. Never raises."""
    time.sleep(20)
    while True:
        try:
            if not has_today():
                b = run_backup()
                print(f"[backup] wrote {b['name']} ({b['size']} bytes)")
        except Exception as e:  # noqa: BLE001 - must never kill the thread
            print(f"[backup] failed: {e}")
        time.sleep(3600)
