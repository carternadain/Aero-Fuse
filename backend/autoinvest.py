"""Auto-invest: recurring buys (Robinhood-style) that grow a holding on schedule.

A rule says "$amount of SYMBOL every week / two weeks / month, from start_date". For every
scheduled day up to today that hasn't settled, `apply()` buys amount / that day's close
(stocks roll weekends and holidays forward to the next trading day; crypto trades daily),
adds the shares to the matching holding (created if missing) with a weighted-average cost
basis, and records the buy in `autoinvest_fills`. The (rule_id, sched_date) unique index
makes it idempotent: a day is never applied twice.

Only finished daily closes are used (never the in-progress bar), so a buy scheduled for
today lands on the next run after the close is in. A day with no price yet stays pending
and is retried on the next run; nothing is ever guessed.

Fill statuses: filled (shares added), existing (recorded only: the holding's qty already
counted it, used for net worth history), skipped (the rule was paused that day).
"""

from __future__ import annotations

import calendar
import threading
from datetime import date, datetime, timedelta, timezone

import charts
import db
import nw_backfill
from market_data import _get, _set

FREQS = ("weekly", "biweekly", "monthly")
ROLL_DAYS = 7          # a stock buy rolls forward at most this far to find a close
CLOSES_TTL = 6 * 3600
MISS_TTL = 15 * 60
EPS = 1e-9

_lock = threading.Lock()


def today_utc() -> date:
    return datetime.now(timezone.utc).date()


# ── Schedule (pure) ──────────────────────────────────────

def _month_day(y: int, m: int, day: int) -> date:
    return date(y, m, min(day, calendar.monthrange(y, m)[1]))  # the 31st -> last day of short months


def schedule_dates(rule: dict, through: date) -> list[date]:
    """Every scheduled buy day from the rule's start up to `through` (inclusive), oldest first."""
    start = date.fromisoformat(rule["start_date"])
    if rule.get("end_date"):
        through = min(through, date.fromisoformat(rule["end_date"]))
    if through < start:
        return []
    freq, day = rule.get("frequency") or "monthly", int(rule.get("day") or 0)
    out: list[date] = []
    if freq == "monthly":
        day = max(1, min(31, day or 1))
        y, m = start.year, start.month
        while True:
            d = _month_day(y, m, day)
            if d > through:
                break
            if d >= start:
                out.append(d)
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    else:
        wd = max(0, min(6, day))
        d = start + timedelta(days=(wd - start.weekday()) % 7)
        step = timedelta(days=14 if freq == "biweekly" else 7)
        while d <= through:
            out.append(d)
            d += step
    return out


def next_date(rule: dict, after: date) -> date | None:
    """First scheduled day on or after `after` (None when the rule has ended)."""
    ds = [d for d in schedule_dates(rule, after + timedelta(days=62)) if d >= after]
    return ds[0] if ds else None


def trade_close(closes: dict[str, float], d: date) -> tuple[str, float] | None:
    """The close used for a buy scheduled on d: d itself, else the next day with a close
    (weekends/holidays for stocks), at most ROLL_DAYS out. None = not available yet."""
    for i in range(ROLL_DAYS + 1):
        k = (d + timedelta(days=i)).isoformat()
        p = closes.get(k)
        if p and p > 0:
            return k, float(p)
    return None


# ── Prices ───────────────────────────────────────────────

def _period(since: date, today: date) -> str:
    days = (today - since).days
    return "1y" if days < 360 else "5y" if days < 1800 else "10y"


def daily_closes(kind: str, sym: str, since: date, today: date | None = None) -> dict[str, float]:
    """Finished daily closes ("YYYY-MM-DD" -> close) covering `since`..yesterday.

    Bars dated on/after the fetch day are dropped (they're still moving), and the cache key
    carries the fetch day so a partial bar can never be served as a close later."""
    today = today or today_utc()
    period = _period(since, today)
    key = f"ai:{kind}:{sym}:{period}:{today.isoformat()}"
    hit = _get(key, CLOSES_TTL)
    if hit is not None:
        return hit  # type: ignore[return-value]
    if _get(f"{key}:miss", MISS_TTL):
        return {}
    out: dict[str, float] = {}
    try:
        if kind == "crypto":
            out = nw_backfill._to_days(charts._yahoo(f"{sym}-USD", period, "1d"))
            if not out:
                span = min((today - since).days + 10, 5 * 365)
                out = nw_backfill._to_days(charts._coinbase(sym, 86_400, span * 86_400))
        else:
            out = nw_backfill._to_days(charts._yahoo(sym, period, "1d"))
    except Exception as e:  # noqa: BLE001 - offline just means "pending"
        print(f"[autoinvest] {kind} {sym} price error: {e}")
        out = {}
    out = {d: p for d, p in out.items() if d < today.isoformat()}
    _set(key if out else f"{key}:miss", out or True)
    return out


# ── Holdings math ────────────────────────────────────────

def _find_holding(c, kind: str, symbol: str, label: str):
    return c.execute(
        "SELECT * FROM holdings WHERE kind=? AND upper(symbol)=? AND lower(trim(coalesce(label,'')))=? "
        "ORDER BY id LIMIT 1", (kind, symbol.upper(), (label or "").strip().lower())).fetchone()


def add_cost(qty: float, cost: float | None, add_qty: float, amount: float) -> float | None:
    """Weighted-average cost per unit after buying add_qty for amount. Pure.
    An existing position with no cost basis stays unknown (we won't guess its cost)."""
    if qty <= EPS:
        return amount / add_qty if add_qty > EPS else cost
    if cost is None:
        return None
    return (qty * cost + amount) / (qty + add_qty)


def remove_cost(qty: float, cost: float | None, rm_qty: float, amount: float) -> float | None:
    """Undo add_cost: cost per unit after taking back rm_qty bought for amount. Pure."""
    left = qty - rm_qty
    if cost is None or left <= EPS:
        return cost
    c2 = (qty * cost - amount) / left
    return c2 if c2 > 0 else cost


def _add_to_holding(c, rule: dict, qty: float, amount: float) -> int:
    h = _find_holding(c, rule["kind"], rule["symbol"], rule.get("label") or "")
    if h is None:
        cur = c.execute(
            "INSERT INTO holdings (symbol, kind, qty, cost_basis, label, updated_at, note) VALUES (?,?,?,?,?,?,?)",
            (rule["symbol"].upper(), rule["kind"], round(qty, 10), amount / qty, rule.get("label") or "",
             db.utcnow(), ""))
        return cur.lastrowid
    cost = add_cost(h["qty"] or 0, h["cost_basis"], qty, amount)
    c.execute("UPDATE holdings SET qty=?, cost_basis=?, updated_at=? WHERE id=?",
              (round((h["qty"] or 0) + qty, 10), cost, db.utcnow(), h["id"]))
    return h["id"]


def _take_back(c, fills: list) -> None:
    """Remove the shares a set of 'filled' rows added, per holding, deleting emptied holdings."""
    per: dict[int, list[float]] = {}
    for f in fills:
        if f["status"] != "filled":
            continue
        h = c.execute("SELECT * FROM holdings WHERE id=?", (f["holding_id"],)).fetchone() if f["holding_id"] else None
        h = h or _find_holding(c, f["kind"], f["symbol"], f["label"] or "")
        if h is None:
            continue  # the holding was deleted by hand: nothing to take back
        acc = per.setdefault(h["id"], [0.0, 0.0])
        acc[0] += f["qty"]
        acc[1] += f["amount"]
    for hid, (q, amt) in per.items():
        h = c.execute("SELECT * FROM holdings WHERE id=?", (hid,)).fetchone()
        left = (h["qty"] or 0) - q
        if left <= 1e-8:
            c.execute("DELETE FROM holdings WHERE id=?", (hid,))
        else:
            c.execute("UPDATE holdings SET qty=?, cost_basis=?, updated_at=? WHERE id=?",
                      (round(left, 10), remove_cost(h["qty"], h["cost_basis"], q, amt), db.utcnow(), hid))


# ── Apply ────────────────────────────────────────────────

def _settled(c, rule_id: int) -> set[str]:
    return {r["sched_date"] for r in c.execute("SELECT sched_date FROM autoinvest_fills WHERE rule_id=?", (rule_id,))}


def due_dates(rule: dict, settled: set[str], today: date) -> list[date]:
    """Scheduled days up to today that still need a buy. Pure."""
    if rule.get("paused"):
        return []
    floor = rule.get("resume_from")
    return [d for d in schedule_dates(rule, today)
            if d.isoformat() not in settled and (not floor or d.isoformat() >= floor)]


def apply(today: date | None = None, fetch=daily_closes, rule_ids: list[int] | None = None) -> dict:
    """Settle every due buy whose close is known. Idempotent; safe to call any time."""
    today = today or today_utc()
    with _lock:
        with db.conn() as c:
            rules = [db.row_to_dict(r) for r in c.execute("SELECT * FROM autoinvest_rules ORDER BY id")]
            if rule_ids is not None:
                rules = [r for r in rules if r["id"] in rule_ids]
            due = {r["id"]: due_dates(r, _settled(c, r["id"]), today) for r in rules}
        need: dict[tuple[str, str], date] = {}
        for r in rules:
            if due[r["id"]]:
                k = (r["kind"], r["symbol"].upper())
                need[k] = min(need.get(k, today), due[r["id"]][0])
        closes = {}
        for (kind, sym), since in need.items():
            try:
                closes[(kind, sym)] = fetch(kind, sym, since, today) or {}
            except Exception as e:  # noqa: BLE001
                print(f"[autoinvest] fetch {kind} {sym} error: {e}")
                closes[(kind, sym)] = {}
        filled = pending = 0
        with db.conn() as c:
            for r in rules:
                cl = closes.get((r["kind"], r["symbol"].upper()), {})
                for d in due[r["id"]]:
                    tc = trade_close(cl, d)
                    if tc is None:
                        pending += 1
                        continue
                    tdate, price = tc
                    qty = r["amount"] / price
                    existing = bool(r.get("track_from")) and d.isoformat() < r["track_from"]
                    cur = c.execute(
                        "INSERT OR IGNORE INTO autoinvest_fills (rule_id, symbol, kind, label, sched_date, trade_date,"
                        " qty, price, amount, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (r["id"], r["symbol"].upper(), r["kind"], r.get("label") or "", d.isoformat(), tdate,
                         qty, price, r["amount"], "existing" if existing else "filled", db.utcnow()))
                    if cur.rowcount == 0:
                        continue  # already applied (another run got here first)
                    if not existing:
                        hid = _add_to_holding(c, r, qty, r["amount"])
                        c.execute("UPDATE autoinvest_fills SET holding_id=? WHERE id=?", (hid, cur.lastrowid))
                    filled += 1
        return {"filled": filled, "pending": pending}


def safe_apply(**kw) -> dict:
    try:
        out = apply(**kw)
        if out["filled"] or out["pending"]:
            print(f"[autoinvest] {out}")
        return out
    except Exception as e:  # noqa: BLE001 - never take a caller down
        print(f"[autoinvest] apply error: {e}")
        return {"filled": 0, "pending": 0, "error": str(e)}


# ── Rules CRUD ───────────────────────────────────────────

FIELDS = ("symbol", "kind", "amount", "frequency", "day", "start_date", "end_date", "label")


def _with_stats(c, r: dict, today: date, fills_limit: int = 0) -> dict:
    s = c.execute(
        "SELECT count(*) n, coalesce(sum(amount),0) amt, coalesce(sum(qty),0) q FROM autoinvest_fills "
        "WHERE rule_id=? AND status IN ('filled','existing')", (r["id"],)).fetchone()
    added = c.execute("SELECT coalesce(sum(qty),0) q FROM autoinvest_fills WHERE rule_id=? AND status='filled'",
                      (r["id"],)).fetchone()["q"]
    settled = _settled(c, r["id"])
    nd = None if r["paused"] else next_date(r, today)
    if nd and nd.isoformat() in settled:  # today's buy is done: show the one after
        nd = next_date(r, today + timedelta(days=1))
    out = {**r, "paused": bool(r["paused"]), "buys": s["n"], "invested": round(s["amt"], 2),
           "qty": round(s["q"], 10), "added_qty": round(added, 10), "pending": len(due_dates(r, settled, today)),
           "next_date": nd.isoformat() if nd else None}
    if fills_limit:
        out["fills"] = [db.row_to_dict(f) for f in c.execute(
            "SELECT * FROM autoinvest_fills WHERE rule_id=? AND status!='skipped' ORDER BY sched_date DESC LIMIT ?",
            (r["id"], fills_limit))]
    return out


def list_rules(today: date | None = None) -> list[dict]:
    today = today or today_utc()
    with db.conn() as c:
        rows = [db.row_to_dict(r) for r in c.execute("SELECT * FROM autoinvest_rules ORDER BY paused, symbol, id")]
        return [_with_stats(c, r, today) for r in rows]


def get_rule(rule_id: int, today: date | None = None, fills: int = 6) -> dict | None:
    today = today or today_utc()
    with db.conn() as c:
        r = c.execute("SELECT * FROM autoinvest_rules WHERE id=?", (rule_id,)).fetchone()
        return _with_stats(c, db.row_to_dict(r), today, fills) if r else None


def _clean(data: dict) -> dict:
    out = {k: data[k] for k in FIELDS if k in data}
    if "symbol" in out:
        out["symbol"] = str(out["symbol"]).upper().strip()
    if "label" in out:
        out["label"] = (out["label"] or "").strip()
    if "end_date" in out and not out["end_date"]:
        out["end_date"] = None
    return out


def create_rule(data: dict, add_past: bool = True, today: date | None = None) -> int:
    """add_past=False: buys before today are already in the holding's qty, so they're only
    recorded (for net worth history), not added again."""
    today = today or today_utc()
    d = _clean(data)
    cash_id = data.get("cash_account_id") or None  # paid from this account (fills from today on)
    now = db.utcnow()
    with db.conn() as c:
        cur = c.execute(
            "INSERT INTO autoinvest_rules (symbol, kind, amount, frequency, day, start_date, end_date, label,"
            " paused, track_from, cash_account_id, cash_from, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?)",
            (d["symbol"], d.get("kind", "stock"), d["amount"], d.get("frequency", "monthly"), int(d.get("day", 1)),
             d["start_date"], d.get("end_date"), d.get("label", ""),
             None if add_past else today.isoformat(),
             cash_id, today.isoformat() if cash_id else None, now, now))
        rid = cur.lastrowid
    return rid


def update_rule(rule_id: int, data: dict, apply_to: str = "future", today: date | None = None,
                fetch=daily_closes) -> bool:
    """Edit a rule. Schedule changes either rewrite every past buy (apply_to='all': undo the
    shares it added, then replay with the new settings) or only shape buys from today on
    (apply_to='future': past buys stay as they were)."""
    today = today or today_utc()
    fields = _clean(data)
    paused = data.get("paused")
    with db.conn() as c:
        r = c.execute("SELECT * FROM autoinvest_rules WHERE id=?", (rule_id,)).fetchone()
        if r is None:
            return False
        r = db.row_to_dict(r)
    changed = {k: v for k, v in fields.items() if r.get(k) != v}
    with db.conn() as c:
        has_fills = bool(_settled(c, rule_id))
    if changed and apply_to == "future" and has_fills:
        apply(today=today, fetch=fetch, rule_ids=[rule_id])  # settle what the old settings owe first
    sets: dict = dict(changed)
    with db.conn() as c:
        if changed and apply_to == "all":
            fills = c.execute("SELECT * FROM autoinvest_fills WHERE rule_id=?", (rule_id,)).fetchall()
            _take_back(c, fills)
            c.execute("DELETE FROM autoinvest_fills WHERE rule_id=?", (rule_id,))
            sets["resume_from"] = None
        elif changed and has_fills:
            sets["resume_from"] = today.isoformat()
        if "cash_account_id" in data and (data["cash_account_id"] or None) != r.get("cash_account_id"):
            sets["cash_account_id"] = data["cash_account_id"] or None
            sets["cash_from"] = today.isoformat() if data["cash_account_id"] else None
        if paused is not None and bool(paused) != bool(r["paused"]):
            sets["paused"] = 1 if paused else 0
            if paused:
                sets["paused_at"] = today.isoformat()
            else:
                # days that passed while paused were skipped, not owed
                since = r.get("paused_at") or today.isoformat()
                rr = {**r, **changed, "paused": 0}
                have = _settled(c, rule_id)
                for d in schedule_dates(rr, today - timedelta(days=1)):
                    if d.isoformat() >= since and d.isoformat() not in have:
                        c.execute(
                            "INSERT OR IGNORE INTO autoinvest_fills (rule_id, symbol, kind, label, sched_date,"
                            " status, created_at) VALUES (?,?,?,?,?, 'skipped', ?)",
                            (rule_id, rr["symbol"], rr["kind"], rr.get("label") or "", d.isoformat(), db.utcnow()))
                sets["paused_at"] = None
        if sets:
            sets["updated_at"] = db.utcnow()
            cols = ", ".join(f"{k}=?" for k in sets)
            c.execute(f"UPDATE autoinvest_rules SET {cols} WHERE id=?", [*sets.values(), rule_id])
    return True


def delete_rule(rule_id: int, keep_shares: bool = True) -> bool:
    """keep_shares: the shares stay in the holding and the buys stay in the ledger (so net
    worth history still knows when they were bought). Otherwise the shares the rule added
    are taken back out."""
    with db.conn() as c:
        if c.execute("SELECT 1 FROM autoinvest_rules WHERE id=?", (rule_id,)).fetchone() is None:
            return False
        if not keep_shares:
            fills = c.execute("SELECT * FROM autoinvest_fills WHERE rule_id=? AND status='filled'",
                              (rule_id,)).fetchall()
            _take_back(c, fills)
            c.execute("DELETE FROM autoinvest_fills WHERE rule_id=? AND status='filled'", (rule_id,))
        c.execute("DELETE FROM autoinvest_fills WHERE rule_id=? AND status='skipped'", (rule_id,))
        c.execute("UPDATE autoinvest_fills SET rule_id=NULL WHERE rule_id=?", (rule_id,))
        c.execute("DELETE FROM autoinvest_rules WHERE id=?", (rule_id,))
    return True


def ledger() -> list[dict]:
    """Every settled buy that's part of a holding's qty (filled or existing), for history."""
    with db.conn() as c:
        return [{"kind": r["kind"], "symbol": r["symbol"], "label": r["label"] or "",
                 "date": r["trade_date"] or r["sched_date"], "qty": r["qty"]}
                for r in c.execute("SELECT * FROM autoinvest_fills WHERE status IN ('filled','existing') "
                                   "ORDER BY sched_date")]
