"""SQLite persistence layer for the trading terminal.

Structured so the future Toobit bot can write trades/signals through the same
API the frontend uses — nothing here assumes a human is on the other end.
"""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent / "terminal.db"


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@contextmanager
def conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init_db():
    with conn() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                asset TEXT NOT NULL,
                direction TEXT NOT NULL CHECK (direction IN ('long','short')),
                entry REAL NOT NULL,
                sl REAL NOT NULL,
                tp1 REAL,
                tp2 REAL,
                tp3 REAL,
                risk_pct REAL DEFAULT 1.0,
                signal_source TEXT DEFAULT 'manual',   -- neurowave | kryptonite | both | manual
                liquidity_sweep INTEGER DEFAULT 0,
                htf_aligned INTEGER DEFAULT 0,
                status TEXT DEFAULT 'open',            -- open | partial | closed
                outcome TEXT,                          -- win | loss | breakeven
                exit_price REAL,
                pnl_pct REAL,
                rr REAL,
                notes TEXT DEFAULT '',
                opened_at TEXT NOT NULL,
                closed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS partials (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
                pct REAL NOT NULL,                     -- % of position closed (e.g. 50)
                price REAL NOT NULL,
                level TEXT DEFAULT '',                 -- TP1 / TP2 / TP3 / manual
                closed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS signals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                asset TEXT NOT NULL,
                indicator TEXT NOT NULL,               -- neurowave | kryptonite
                conviction TEXT DEFAULT 'unknown',     -- high | low
                direction TEXT NOT NULL,               -- buy | sell
                timeframe TEXT DEFAULT '',
                price REAL,
                taken INTEGER DEFAULT 0,
                skip_reason TEXT DEFAULT '',
                trade_id INTEGER REFERENCES trades(id) ON DELETE SET NULL,
                outcome TEXT DEFAULT '',               -- win | loss | '' (if taken)
                raw TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS levels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                asset TEXT NOT NULL,
                price REAL NOT NULL,
                label TEXT DEFAULT '',
                kind TEXT DEFAULT 'liquidity',         -- liquidity | support | resistance | fib
                active INTEGER DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT DEFAULT 'cash',      -- cash | brokerage | crypto | retirement | real_estate | vehicle | other | credit_card | loan | mortgage
                kind TEXT DEFAULT 'asset' CHECK (kind IN ('asset','liability')),
                balance REAL NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS networth_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL UNIQUE,         -- YYYY-MM-DD (one per day, upserted)
                assets REAL NOT NULL,
                liabilities REAL NOT NULL,
                net_worth REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,                -- YYYY-MM-DD
                category TEXT NOT NULL,
                amount REAL NOT NULL,
                kind TEXT DEFAULT 'expense' CHECK (kind IN ('income','expense')),
                note TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS budgets (
                category TEXT PRIMARY KEY,
                monthly_limit REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS positions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                asset TEXT NOT NULL,
                kind TEXT DEFAULT 'crypto',            -- crypto | leap
                qty REAL NOT NULL,
                entry REAL NOT NULL,                   -- per-unit cost (per contract for LEAPs)
                current REAL,                          -- manually updated mark (auto for crypto)
                strike REAL,                           -- LEAPs only
                expiry TEXT,                           -- LEAPs only, e.g. 2027-12-17
                notes TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS sim_trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                signal_id INTEGER REFERENCES signals(id) ON DELETE SET NULL,
                asset TEXT NOT NULL,
                direction TEXT NOT NULL,               -- long | short
                entry REAL NOT NULL,
                sl REAL NOT NULL,
                tp1 REAL NOT NULL,
                status TEXT DEFAULT 'open',            -- open | closed
                exit_price REAL,
                outcome TEXT,                          -- win | loss
                pnl_pct REAL,
                r_multiple REAL,
                opened_at TEXT NOT NULL,
                closed_at TEXT
            );
            """
        )
    migrate()


def migrate():
    """Additive, idempotent schema upgrades for existing terminal.db files."""
    with conn() as c:
        cols = {r["name"] for r in c.execute("PRAGMA table_info(signals)").fetchall()}
        # Claude verdict stored alongside each signal (the edge test).
        adds = {
            "ai_take": "INTEGER",            # 1 take / 0 skip / NULL not-yet-evaluated
            "ai_score": "INTEGER",           # confluence_score 0-10
            "ai_confidence": "TEXT",         # high | medium | low
            "ai_reasons": "TEXT DEFAULT ''", # json array
            "ai_warnings": "TEXT DEFAULT ''",# json array
        }
        for name, decl in adds.items():
            if name not in cols:
                c.execute(f"ALTER TABLE signals ADD COLUMN {name} {decl}")


def row_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


# ── Trades ────────────────────────────────────────────────

def compute_rr(direction: str, entry: float, sl: float, tp1: float | None) -> float | None:
    if not tp1:
        return None
    risk = abs(entry - sl)
    if risk == 0:
        return None
    reward = (tp1 - entry) if direction == "long" else (entry - tp1)
    return round(reward / risk, 2)


def create_trade(data: dict) -> dict:
    rr = compute_rr(data["direction"], data["entry"], data["sl"], data.get("tp1"))
    with conn() as c:
        cur = c.execute(
            """INSERT INTO trades (asset, direction, entry, sl, tp1, tp2, tp3, risk_pct,
                   signal_source, liquidity_sweep, htf_aligned, rr, notes, opened_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                data["asset"].upper(), data["direction"], data["entry"], data["sl"],
                data.get("tp1"), data.get("tp2"), data.get("tp3"),
                data.get("risk_pct", 1.0), data.get("signal_source", "manual"),
                int(bool(data.get("liquidity_sweep"))), int(bool(data.get("htf_aligned"))),
                rr, data.get("notes", ""), utcnow(),
            ),
        )
        trade_id = cur.lastrowid
        if data.get("signal_id"):
            c.execute("UPDATE signals SET taken=1, trade_id=? WHERE id=?", (trade_id, data["signal_id"]))
        row = c.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone()
        return row_to_dict(row)


def list_trades(filters: dict | None = None) -> list[dict]:
    q = "SELECT * FROM trades"
    clauses, params = [], []
    f = filters or {}
    if f.get("asset"):
        clauses.append("asset = ?"); params.append(f["asset"].upper())
    if f.get("status"):
        clauses.append("status = ?"); params.append(f["status"])
    if f.get("outcome"):
        clauses.append("outcome = ?"); params.append(f["outcome"])
    if f.get("signal_source"):
        clauses.append("signal_source = ?"); params.append(f["signal_source"])
    if clauses:
        q += " WHERE " + " AND ".join(clauses)
    q += " ORDER BY opened_at DESC"
    with conn() as c:
        trades = [row_to_dict(r) for r in c.execute(q, params).fetchall()]
        for t in trades:
            t["partials"] = [
                row_to_dict(r) for r in
                c.execute("SELECT * FROM partials WHERE trade_id=? ORDER BY closed_at", (t["id"],)).fetchall()
            ]
        return trades


def add_partial(trade_id: int, pct: float, price: float, level: str = "") -> dict | None:
    with conn() as c:
        t = c.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone()
        if not t or t["status"] == "closed":
            return None
        c.execute(
            "INSERT INTO partials (trade_id, pct, price, level, closed_at) VALUES (?,?,?,?,?)",
            (trade_id, pct, price, level, utcnow()),
        )
        c.execute("UPDATE trades SET status='partial' WHERE id=?", (trade_id,))
        row = c.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone()
        return row_to_dict(row)


def close_trade(trade_id: int, exit_price: float, notes: str = "") -> dict | None:
    with conn() as c:
        t = c.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone()
        if not t or t["status"] == "closed":
            return None
        partials = c.execute("SELECT * FROM partials WHERE trade_id=?", (trade_id,)).fetchall()

        # Weighted average exit across partials + the final close of the remainder.
        closed_pct = sum(p["pct"] for p in partials)
        remainder = max(0.0, 100.0 - closed_pct)
        weighted_exit = sum(p["pct"] * p["price"] for p in partials) + remainder * exit_price
        avg_exit = weighted_exit / 100.0

        entry = t["entry"]
        sign = 1 if t["direction"] == "long" else -1
        pnl_pct = round(sign * (avg_exit - entry) / entry * 100, 3)
        outcome = "win" if pnl_pct > 0.05 else ("loss" if pnl_pct < -0.05 else "breakeven")

        new_notes = (t["notes"] + " | " + notes).strip(" |") if notes else t["notes"]
        c.execute(
            """UPDATE trades SET status='closed', exit_price=?, pnl_pct=?, outcome=?,
               closed_at=?, notes=? WHERE id=?""",
            (exit_price, pnl_pct, outcome, utcnow(), new_notes, trade_id),
        )
        c.execute("UPDATE signals SET outcome=? WHERE trade_id=?", (outcome, trade_id))
        row = c.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone()
        return row_to_dict(row)


def delete_trade(trade_id: int) -> bool:
    with conn() as c:
        cur = c.execute("DELETE FROM trades WHERE id=?", (trade_id,))
        return cur.rowcount > 0


def trade_stats() -> dict:
    trades = list_trades()
    closed = [t for t in trades if t["status"] == "closed"]
    wins = [t for t in closed if t["outcome"] == "win"]
    losses = [t for t in closed if t["outcome"] == "loss"]
    total_pnl = round(sum(t["pnl_pct"] or 0 for t in closed), 2)
    rrs = [t["rr"] for t in closed if t["rr"]]

    def bucket(key):
        out = {}
        for t in closed:
            k = t.get(key) or "unknown"
            b = out.setdefault(k, {"wins": 0, "losses": 0, "pnl": 0.0})
            if t["outcome"] == "win":
                b["wins"] += 1
            elif t["outcome"] == "loss":
                b["losses"] += 1
            b["pnl"] = round(b["pnl"] + (t["pnl_pct"] or 0), 2)
        return out

    best = max(closed, key=lambda t: t["pnl_pct"] or 0, default=None)
    worst = min(closed, key=lambda t: t["pnl_pct"] or 0, default=None)
    return {
        "total_trades": len(trades),
        "open_trades": len([t for t in trades if t["status"] in ("open", "partial")]),
        "closed": len(closed),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(len(wins) / len(closed) * 100, 1) if closed else 0,
        "total_pnl_pct": total_pnl,
        "avg_rr": round(sum(rrs) / len(rrs), 2) if rrs else 0,
        "best_trade": row_summary(best),
        "worst_trade": row_summary(worst),
        "by_source": bucket("signal_source"),
    }


def row_summary(t: dict | None) -> dict | None:
    if not t:
        return None
    return {"id": t["id"], "asset": t["asset"], "pnl_pct": t["pnl_pct"], "direction": t["direction"]}


def _r_multiple(t: dict) -> float | None:
    """Trade result expressed in R (initial-risk units): pnl% ÷ stop-distance%."""
    if t.get("pnl_pct") is None or not t.get("entry") or not t.get("sl"):
        return None
    risk_pct_of_price = abs(t["entry"] - t["sl"]) / t["entry"] * 100
    if risk_pct_of_price == 0:
        return None
    return t["pnl_pct"] / risk_pct_of_price


def analytics() -> dict:
    """Edge metrics from closed trades: expectancy, R-multiples, profit factor, and
    win-rate breakdowns by signal source, asset, and entry hour."""
    closed = [t for t in list_trades() if t["status"] == "closed" and t["outcome"] in ("win", "loss", "breakeven")]
    rows = [(t, _r_multiple(t)) for t in closed]
    rows = [(t, r) for t, r in rows if r is not None]

    wins = [r for t, r in rows if t["outcome"] == "win"]
    losses = [r for t, r in rows if t["outcome"] == "loss"]
    rmults = [r for _, r in rows]

    gross_win = sum(t["pnl_pct"] for t, _ in rows if (t["pnl_pct"] or 0) > 0)
    gross_loss = abs(sum(t["pnl_pct"] for t, _ in rows if (t["pnl_pct"] or 0) < 0))

    def bucket(key_fn):
        out: dict[str, dict] = {}
        for t, r in rows:
            k = key_fn(t) or "?"
            b = out.setdefault(k, {"trades": 0, "wins": 0, "sum_r": 0.0})
            b["trades"] += 1
            b["wins"] += 1 if t["outcome"] == "win" else 0
            b["sum_r"] += r
        return [
            {"key": k, "trades": v["trades"],
             "win_rate": round(v["wins"] / v["trades"] * 100, 1),
             "expectancy_r": round(v["sum_r"] / v["trades"], 2)}
            for k, v in sorted(out.items(), key=lambda kv: kv[1]["sum_r"], reverse=True)
        ]

    n = len(rows)
    return {
        "sample": n,
        "expectancy_r": round(sum(rmults) / n, 2) if n else 0,
        "avg_win_r": round(sum(wins) / len(wins), 2) if wins else 0,
        "avg_loss_r": round(sum(losses) / len(losses), 2) if losses else 0,
        "profit_factor": round(gross_win / gross_loss, 2) if gross_loss else None,
        "best_r": round(max(rmults), 2) if rmults else 0,
        "worst_r": round(min(rmults), 2) if rmults else 0,
        "total_r": round(sum(rmults), 2),
        "by_source": bucket(lambda t: t.get("signal_source")),
        "by_asset": bucket(lambda t: t.get("asset")),
        "by_hour": bucket(lambda t: (t.get("opened_at") or "")[11:13] + ":00"),
    }


# ── Signals ───────────────────────────────────────────────

def log_signal(data: dict) -> dict:
    with conn() as c:
        cur = c.execute(
            """INSERT INTO signals (ts, asset, indicator, conviction, direction, timeframe, price, raw)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                utcnow(), data.get("symbol", data.get("asset", "UNKNOWN")).upper(),
                data.get("indicator", "unknown").lower(), data.get("conviction", "unknown").lower(),
                data.get("direction", "unknown").lower(), data.get("timeframe", ""),
                float(data["price"]) if data.get("price") else None,
                json.dumps(data),
            ),
        )
        row = c.execute("SELECT * FROM signals WHERE id=?", (cur.lastrowid,)).fetchone()
        return row_to_dict(row)


def list_signals(limit: int = 200) -> list[dict]:
    with conn() as c:
        rows = [row_to_dict(r) for r in
                c.execute("SELECT * FROM signals ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()]
    for s in rows:
        for f in ("ai_reasons", "ai_warnings"):
            if isinstance(s.get(f), str) and s[f]:
                try:
                    s[f] = json.loads(s[f])
                except (json.JSONDecodeError, TypeError):
                    s[f] = []
            elif not s.get(f):
                s[f] = []
    return rows


def update_signal(signal_id: int, fields: dict) -> dict | None:
    allowed = {"taken", "skip_reason", "outcome", "trade_id"}
    sets, params = [], []
    for k, v in fields.items():
        if k in allowed:
            sets.append(f"{k}=?")
            params.append(int(v) if k == "taken" else v)
    if not sets:
        return None
    params.append(signal_id)
    with conn() as c:
        c.execute(f"UPDATE signals SET {', '.join(sets)} WHERE id=?", params)
        row = c.execute("SELECT * FROM signals WHERE id=?", (signal_id,)).fetchone()
        return row_to_dict(row) if row else None


def recent_confluence(asset: str, direction: str, window_minutes: int = 90) -> list[dict]:
    """Signals on the same asset+direction from the last N minutes (confluence check)."""
    with conn() as c:
        rows = c.execute(
            """SELECT * FROM signals WHERE asset=? AND direction=?
               AND ts >= datetime('now', ?) ORDER BY ts DESC""",
            (asset.upper(), direction.lower(), f"-{window_minutes} minutes"),
        ).fetchall()
        return [row_to_dict(r) for r in rows]


def set_signal_ai_verdict(signal_id: int, verdict: dict) -> None:
    """Store the Claude evaluate_signal result on a signal row (the edge test)."""
    with conn() as c:
        c.execute(
            """UPDATE signals SET ai_take=?, ai_score=?, ai_confidence=?,
               ai_reasons=?, ai_warnings=? WHERE id=?""",
            (
                int(bool(verdict.get("take_trade"))),
                verdict.get("confluence_score"),
                verdict.get("confidence"),
                json.dumps(verdict.get("reasons", [])),
                json.dumps(verdict.get("warnings", [])),
                signal_id,
            ),
        )


def edge_report() -> dict:
    """Win rate of taken trades split by what the AI said — the headline 'is this an edge' number.

    Compares outcomes of signals the AI approved (ai_take=1) vs skipped (ai_take=0),
    among signals that were actually taken and have a known win/loss outcome.
    """
    with conn() as c:
        rows = c.execute(
            "SELECT ai_take, outcome FROM signals WHERE taken=1 AND outcome IN ('win','loss')"
        ).fetchall()

    def tally(predicate):
        wins = sum(1 for r in rows if predicate(r) and r["outcome"] == "win")
        losses = sum(1 for r in rows if predicate(r) and r["outcome"] == "loss")
        total = wins + losses
        return {
            "wins": wins,
            "losses": losses,
            "total": total,
            "win_rate": round(wins / total * 100, 1) if total else None,
        }

    return {
        "ai_take": tally(lambda r: r["ai_take"] == 1),
        "ai_skip": tally(lambda r: r["ai_take"] == 0),
        "all_taken": tally(lambda r: True),
        "evaluated": sum(1 for r in rows if r["ai_take"] is not None),
    }


# ── Levels ────────────────────────────────────────────────

def create_level(data: dict) -> dict:
    with conn() as c:
        cur = c.execute(
            "INSERT INTO levels (asset, price, label, kind, created_at) VALUES (?,?,?,?,?)",
            (data["asset"].upper(), data["price"], data.get("label", ""),
             data.get("kind", "liquidity"), utcnow()),
        )
        row = c.execute("SELECT * FROM levels WHERE id=?", (cur.lastrowid,)).fetchone()
        return row_to_dict(row)


def list_levels() -> list[dict]:
    with conn() as c:
        return [row_to_dict(r) for r in
                c.execute("SELECT * FROM levels WHERE active=1 ORDER BY asset, price DESC").fetchall()]


def delete_level(level_id: int) -> bool:
    with conn() as c:
        cur = c.execute("UPDATE levels SET active=0 WHERE id=?", (level_id,))
        return cur.rowcount > 0


# ── Positions ─────────────────────────────────────────────

def create_position(data: dict) -> dict:
    with conn() as c:
        cur = c.execute(
            """INSERT INTO positions (asset, kind, qty, entry, current, strike, expiry, notes)
               VALUES (?,?,?,?,?,?,?,?)""",
            (data["asset"].upper(), data.get("kind", "crypto"), data["qty"], data["entry"],
             data.get("current"), data.get("strike"), data.get("expiry"), data.get("notes", "")),
        )
        row = c.execute("SELECT * FROM positions WHERE id=?", (cur.lastrowid,)).fetchone()
        return row_to_dict(row)


def list_positions() -> list[dict]:
    with conn() as c:
        return [row_to_dict(r) for r in c.execute("SELECT * FROM positions ORDER BY kind, asset").fetchall()]


def update_position(pos_id: int, fields: dict) -> dict | None:
    allowed = {"qty", "entry", "current", "strike", "expiry", "notes"}
    sets, params = [], []
    for k, v in fields.items():
        if k in allowed:
            sets.append(f"{k}=?"); params.append(v)
    if not sets:
        return None
    params.append(pos_id)
    with conn() as c:
        c.execute(f"UPDATE positions SET {', '.join(sets)} WHERE id=?", params)
        row = c.execute("SELECT * FROM positions WHERE id=?", (pos_id,)).fetchone()
        return row_to_dict(row) if row else None


def delete_position(pos_id: int) -> bool:
    with conn() as c:
        cur = c.execute("DELETE FROM positions WHERE id=?", (pos_id,))
        return cur.rowcount > 0


# ── Net worth: accounts + snapshots ───────────────────────

def create_account(data: dict) -> dict:
    with conn() as c:
        cur = c.execute(
            "INSERT INTO accounts (name, category, kind, balance, updated_at) VALUES (?,?,?,?,?)",
            (data["name"], data.get("category", "cash"), data.get("kind", "asset"),
             data.get("balance", 0), utcnow()),
        )
        row = c.execute("SELECT * FROM accounts WHERE id=?", (cur.lastrowid,)).fetchone()
        return row_to_dict(row)


def list_accounts() -> list[dict]:
    with conn() as c:
        return [row_to_dict(r) for r in
                c.execute("SELECT * FROM accounts ORDER BY kind, category, name").fetchall()]


def update_account(acc_id: int, fields: dict) -> dict | None:
    allowed = {"name", "category", "kind", "balance"}
    sets, params = [], []
    for k, v in fields.items():
        if k in allowed:
            sets.append(f"{k}=?"); params.append(v)
    if not sets:
        return None
    sets.append("updated_at=?"); params.append(utcnow())
    params.append(acc_id)
    with conn() as c:
        c.execute(f"UPDATE accounts SET {', '.join(sets)} WHERE id=?", params)
        row = c.execute("SELECT * FROM accounts WHERE id=?", (acc_id,)).fetchone()
        return row_to_dict(row) if row else None


def delete_account(acc_id: int) -> bool:
    with conn() as c:
        cur = c.execute("DELETE FROM accounts WHERE id=?", (acc_id,))
        return cur.rowcount > 0


def networth_totals() -> dict:
    accounts = list_accounts()
    assets = sum(a["balance"] for a in accounts if a["kind"] == "asset")
    liabilities = sum(a["balance"] for a in accounts if a["kind"] == "liability")
    return {"assets": round(assets, 2), "liabilities": round(liabilities, 2),
            "net_worth": round(assets - liabilities, 2)}


def take_snapshot() -> dict:
    """Record today's totals (upsert — re-snapshotting the same day overwrites)."""
    totals = networth_totals()
    today = utcnow()[:10]
    with conn() as c:
        c.execute(
            """INSERT INTO networth_snapshots (date, assets, liabilities, net_worth)
               VALUES (?,?,?,?)
               ON CONFLICT(date) DO UPDATE SET assets=excluded.assets,
                   liabilities=excluded.liabilities, net_worth=excluded.net_worth""",
            (today, totals["assets"], totals["liabilities"], totals["net_worth"]),
        )
    return {"date": today, **totals}


def list_snapshots() -> list[dict]:
    with conn() as c:
        return [row_to_dict(r) for r in
                c.execute("SELECT * FROM networth_snapshots ORDER BY date").fetchall()]


# ── Budget: transactions + limits ─────────────────────────

def create_transaction(data: dict) -> dict:
    with conn() as c:
        cur = c.execute(
            "INSERT INTO transactions (date, category, amount, kind, note) VALUES (?,?,?,?,?)",
            (data.get("date") or utcnow()[:10], data["category"], data["amount"],
             data.get("kind", "expense"), data.get("note", "")),
        )
        row = c.execute("SELECT * FROM transactions WHERE id=?", (cur.lastrowid,)).fetchone()
        return row_to_dict(row)


def list_transactions(month: str | None = None, limit: int = 500) -> list[dict]:
    with conn() as c:
        if month:
            rows = c.execute(
                "SELECT * FROM transactions WHERE date LIKE ? ORDER BY date DESC, id DESC LIMIT ?",
                (f"{month}%", limit)).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM transactions ORDER BY date DESC, id DESC LIMIT ?", (limit,)).fetchall()
        return [row_to_dict(r) for r in rows]


def delete_transaction(tx_id: int) -> bool:
    with conn() as c:
        cur = c.execute("DELETE FROM transactions WHERE id=?", (tx_id,))
        return cur.rowcount > 0


def get_budgets() -> dict[str, float]:
    with conn() as c:
        return {r["category"]: r["monthly_limit"]
                for r in c.execute("SELECT * FROM budgets").fetchall()}


def set_budget(category: str, monthly_limit: float):
    with conn() as c:
        c.execute(
            """INSERT INTO budgets (category, monthly_limit) VALUES (?,?)
               ON CONFLICT(category) DO UPDATE SET monthly_limit=excluded.monthly_limit""",
            (category, monthly_limit),
        )


def delete_budget(category: str) -> bool:
    with conn() as c:
        cur = c.execute("DELETE FROM budgets WHERE category=?", (category,))
        return cur.rowcount > 0


# ── Paper-trade simulator ─────────────────────────────────

def create_sim_trade(signal_id: int | None, asset: str, direction: str,
                     entry: float, sl: float, tp1: float) -> dict | None:
    """Open a virtual trade (the AI-approved-signals bot). Skips invalid geometry."""
    if not entry or not sl or not tp1 or entry == sl:
        return None
    with conn() as c:
        # One sim per signal — don't double-open.
        if signal_id and c.execute("SELECT 1 FROM sim_trades WHERE signal_id=?", (signal_id,)).fetchone():
            return None
        cur = c.execute(
            """INSERT INTO sim_trades (signal_id, asset, direction, entry, sl, tp1, opened_at)
               VALUES (?,?,?,?,?,?,?)""",
            (signal_id, asset.upper(), direction, entry, sl, tp1, utcnow()),
        )
        row = c.execute("SELECT * FROM sim_trades WHERE id=?", (cur.lastrowid,)).fetchone()
        return row_to_dict(row)


def list_sim_trades(limit: int = 200) -> list[dict]:
    with conn() as c:
        return [row_to_dict(r) for r in
                c.execute("SELECT * FROM sim_trades ORDER BY opened_at DESC LIMIT ?", (limit,)).fetchall()]


def open_sim_trades() -> list[dict]:
    with conn() as c:
        return [row_to_dict(r) for r in
                c.execute("SELECT * FROM sim_trades WHERE status='open'").fetchall()]


def close_sim_trade(sim_id: int, exit_price: float, outcome: str) -> dict | None:
    with conn() as c:
        t = c.execute("SELECT * FROM sim_trades WHERE id=? AND status='open'", (sim_id,)).fetchone()
        if not t:
            return None
        sign = 1 if t["direction"] == "long" else -1
        pnl_pct = round(sign * (exit_price - t["entry"]) / t["entry"] * 100, 3)
        risk_pct = abs(t["entry"] - t["sl"]) / t["entry"] * 100
        r_mult = round(pnl_pct / risk_pct, 2) if risk_pct else None
        c.execute(
            """UPDATE sim_trades SET status='closed', exit_price=?, outcome=?, pnl_pct=?,
               r_multiple=?, closed_at=? WHERE id=?""",
            (exit_price, outcome, pnl_pct, r_mult, utcnow(), sim_id),
        )
        return row_to_dict(c.execute("SELECT * FROM sim_trades WHERE id=?", (sim_id,)).fetchone())


def sim_stats() -> dict:
    sims = list_sim_trades(1000)
    closed = [t for t in sims if t["status"] == "closed"]
    wins = [t for t in closed if t["outcome"] == "win"]
    rmults = [t["r_multiple"] for t in closed if t["r_multiple"] is not None]
    n = len(closed)
    return {
        "open": len([t for t in sims if t["status"] == "open"]),
        "closed": n,
        "wins": len(wins),
        "losses": n - len(wins),
        "win_rate": round(len(wins) / n * 100, 1) if n else 0,
        "total_r": round(sum(rmults), 2) if rmults else 0,
        "expectancy_r": round(sum(rmults) / len(rmults), 2) if rmults else 0,
        "total_pnl_pct": round(sum(t["pnl_pct"] or 0 for t in closed), 2),
    }


def budget_summary(month: str) -> dict:
    txs = list_transactions(month)
    income = round(sum(t["amount"] for t in txs if t["kind"] == "income"), 2)
    expenses = round(sum(t["amount"] for t in txs if t["kind"] == "expense"), 2)
    by_category: dict[str, float] = {}
    for t in txs:
        if t["kind"] == "expense":
            by_category[t["category"]] = round(by_category.get(t["category"], 0) + t["amount"], 2)
    limits = get_budgets()
    categories = [
        {"category": cat,
         "spent": by_category.get(cat, 0),
         "limit": limits.get(cat)}
        for cat in sorted(set(by_category) | set(limits))
    ]
    return {
        "month": month,
        "income": income,
        "expenses": expenses,
        "net": round(income - expenses, 2),
        "savings_rate": round((income - expenses) / income * 100, 1) if income > 0 else 0,
        "categories": categories,
        "transactions": txs[:50],
    }
