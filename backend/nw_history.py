"""Net worth history: backfill snapshots (and their bucket split) from daily DB backups.

Logic only; routes live in main.py. Idempotent: a second run changes nothing.
"""
import re
import sqlite3

import backup
import db

_DATE_RE = re.compile(r"terminal-(\d{4}-\d{2}-\d{2})\.db$")
_BUCKET_COLS = ("investments", "cash", "property")


def history() -> list[dict]:
    return db.list_snapshots()


def _rows(c: sqlite3.Connection, sql: str) -> list[dict]:
    try:
        return [dict(r) for r in c.execute(sql)]
    except sqlite3.Error:
        return []  # old backup missing a table/column


def _holding_value(holdings, d, price_at):
    """Total holdings value on day d, or None if any crypto/stock price is unavailable."""
    total = 0.0
    for h in holdings:
        qty = h.get("qty") or 0
        if h.get("kind") == "option":
            total += qty * h["cost_basis"] * 100 if h.get("cost_basis") else 0
            continue
        p = price_at(h.get("kind") or "crypto", h["symbol"], d)
        if p is None:
            return None
        total += qty * p
    return total


def _copy_snapshots(src, live) -> int:
    n = 0
    have = {r["date"] for r in live.execute("SELECT date FROM networth_snapshots")}
    cols = {r["name"] for r in src.execute("PRAGMA table_info(networth_snapshots)")}
    if not {"date", "assets", "liabilities", "net_worth"} <= cols:
        return 0
    sel = ", ".join(c if c in cols else f"NULL AS {c}" for c in _BUCKET_COLS)
    for r in src.execute(f"SELECT date, assets, liabilities, net_worth, {sel} FROM networth_snapshots"):
        if r["date"] in have:
            continue
        live.execute(
            "INSERT INTO networth_snapshots (date, assets, liabilities, net_worth, investments, cash, property, source) "
            "VALUES (?,?,?,?,?,?,?,'backup')",
            (r["date"], r["assets"], r["liabilities"], r["net_worth"], r["investments"], r["cash"], r["property"]))
        have.add(r["date"])
        n += 1
    return n


def _rebuild(src, live, d, price_at) -> str | None:
    """Returns 'rebuilt', 'enriched' or None."""
    row = live.execute("SELECT investments FROM networth_snapshots WHERE date=?", (d,)).fetchone()
    if row is not None and row["investments"] is not None:
        return None
    accounts = _rows(src, "SELECT name, category, kind, balance FROM accounts")
    holdings = _rows(src, "SELECT symbol, kind, qty, cost_basis FROM holdings")
    if not accounts and not holdings:
        return None
    hv = _holding_value(holdings, d, price_at)
    if hv is None:
        return None
    b = db._buckets(accounts, hv)
    if row is not None:
        live.execute("UPDATE networth_snapshots SET investments=?, cash=?, property=? WHERE date=?",
                     (b["investments"], b["cash"], b["property"], d))
        return "enriched"
    live.execute(
        "INSERT INTO networth_snapshots (date, assets, liabilities, net_worth, investments, cash, property, source) "
        "VALUES (?,?,?,?,?,?,?,'rebuilt')",
        (d, b["assets"], b["liabilities"], b["net_worth"], b["investments"], b["cash"], b["property"]))
    return "rebuilt"


def backfill(price_at) -> dict:
    out = {"backups": 0, "copied": 0, "rebuilt": 0, "enriched": 0}
    # oldest first so a day's own backup is rebuilt before later ones are considered
    for b in sorted(backup.list_backups(), key=lambda b: b["name"]):
        m = _DATE_RE.match(b["name"])
        if not m:
            continue
        path = backup.BACKUP_DIR / b["name"]
        try:
            src = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            src.row_factory = sqlite3.Row
            try:
                with db.conn() as live:
                    out["copied"] += _copy_snapshots(src, live)
                    res = _rebuild(src, live, m.group(1), price_at)
                    if res:
                        out[res] += 1
            finally:
                src.close()
            out["backups"] += 1
        except Exception as e:  # noqa: BLE001 - one bad file must not stop the rest
            print(f"[nw_history] skipped {b['name']}: {e}")
    return out
