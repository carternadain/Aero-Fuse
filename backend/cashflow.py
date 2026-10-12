"""Cash: a checking balance that keeps itself up to date.

Items (paychecks, bills, debt payments, savings and investing transfers) recur on a schedule.
`sync()` posts every occurrence that has come due since the cash account was set up: income and
bills become transactions (so Budget sees them), debt payments pay down the loan, transfers move
money between accounts. Every post inserts a `cash_moves` row (unique per item + date) and adjusts
`accounts.balance` in the same transaction, so a balance and its ledger row never diverge and
calling sync twice posts nothing new. Manual transactions apply to Cash at entry time
(`transactions.cash_applied` remembers exactly what was applied so it can be reversed).

The date math (`occurrences`, `payoff`, ...) is pure and takes `today`.
"""

from __future__ import annotations

import calendar
import json
import math
import threading
from datetime import date, timedelta

import autoinvest
import db
import extras
import importer
import market_data

TYPES = ("income", "bill", "debt", "save", "invest")
FREQS = ("weekly", "biweekly", "semimonthly", "monthly", "every_n_months", "once")
UPCOMING_DAYS = 35
RECENT_LIMIT = 15
SCHEDULED_KINDS = ("income", "bill", "debt", "autoinvest")

_lock = threading.RLock()


class Invalid(ValueError):
    """A plain-English validation problem (main turns it into HTTP 400)."""


def today_local() -> date:
    return date.today()


# ── Schedule (pure) ──────────────────────────────────────

def _iso(s: str) -> date:
    return date.fromisoformat(s)


def _clamp(y: int, m: int, day: int) -> date:
    return date(y, m, max(1, min(day, calendar.monthrange(y, m)[1])))  # the 31st -> last day of short months


def occurrences(item: dict, start: date, end: date) -> list[date]:
    """Every date the item is scheduled on within [start, end] (also bounded by the item's own
    start_date / end_date), oldest first."""
    s0 = _iso(item["start_date"])
    lo, hi = max(start, s0), end
    if item.get("end_date"):
        hi = min(hi, _iso(item["end_date"]))
    if hi < lo:
        return []
    freq = item.get("frequency") or "monthly"
    if freq == "once":
        return [s0] if lo <= s0 <= hi else []
    if freq == "weekly":
        wd = int(item["day"]) if item.get("day") is not None else s0.weekday()
        d = lo + timedelta(days=(wd - lo.weekday()) % 7)
        out = []
        while d <= hi:
            out.append(d)
            d += timedelta(days=7)
        return out
    if freq == "biweekly":  # anchored on start_date, every 14 days
        k = max(0, math.ceil((lo - s0).days / 14))
        d = s0 + timedelta(days=14 * k)
        out = []
        while d <= hi:
            out.append(d)
            d += timedelta(days=14)
        return out
    step = max(1, int(item.get("interval") or 1)) if freq == "every_n_months" else 1
    day = int(item["day"]) if item.get("day") is not None else s0.day
    days = [day]
    if freq == "semimonthly":
        days.append(int(item["day2"]) if item.get("day2") is not None else day)
    out = []
    y, m = s0.year, s0.month
    while date(y, m, 1) <= hi:
        for d in sorted({_clamp(y, m, x) for x in days}):
            if lo <= d <= hi:
                out.append(d)
        m += step
        y, m = y + (m - 1) // 12, (m - 1) % 12 + 1
    return out


def monthly_factor(item: dict) -> float:
    f = item.get("frequency")
    if f == "weekly":
        return 52 / 12
    if f == "biweekly":
        return 26 / 12
    if f == "semimonthly":
        return 2.0
    if f == "monthly":
        return 1.0
    if f == "every_n_months":
        return 1.0 / max(1, int(item.get("interval") or 1))
    return 0.0  # once


def rule_monthly(rule: dict) -> float:
    return rule["amount"] * {"weekly": 52 / 12, "biweekly": 26 / 12}.get(rule.get("frequency"), 1.0)


def payoff(balance: float, rate: float | None, monthly_payment: float, today: date) -> dict | None:
    """Months until a loan/card is paid off at this payment (None = never / nothing to pay)."""
    if balance <= 0 or monthly_payment <= 0:
        return None
    r = (rate or 0) / 100 / 12
    if monthly_payment <= balance * r:
        return None  # the payment doesn't even cover the interest
    bal, months = balance, 0
    while bal > 0.005:
        bal = bal * (1 + r) - monthly_payment
        months += 1
        if months > 1200:
            return None
    idx = today.year * 12 + today.month - 1 + months
    return {"months": months, "date": f"{idx // 12:04d}-{idx % 12 + 1:02d}"}


# ── Settings ─────────────────────────────────────────────

def get_cfg() -> dict:
    try:
        v = json.loads(db.get_setting("cash") or "{}")
    except ValueError:
        v = {}
    return v if isinstance(v, dict) else {}


def set_cfg(cfg: dict) -> None:
    db.set_setting("cash", json.dumps(cfg))


# ── Balances & moves ─────────────────────────────────────

def _round(x: float) -> float:
    return round(x + 0.0, 2)


def _bump(c, acc_id: int | None, delta: float) -> None:
    if acc_id and delta:
        c.execute("UPDATE accounts SET balance=round(balance+?,2), updated_at=? WHERE id=?",
                  (delta, db.utcnow(), acc_id))


def _acct(c, acc_id: int | None):
    return c.execute("SELECT * FROM accounts WHERE id=?", (acc_id,)).fetchone() if acc_id else None


def _leave_delta(c, acc_id, amt: float) -> float:
    a = _acct(c, acc_id)
    return 0.0 if a is None else (-amt if a["kind"] == "asset" else amt)


def _enter_delta(c, acc_id, amt: float) -> float:
    a = _acct(c, acc_id)
    return 0.0 if a is None else (amt if a["kind"] == "asset" else -amt)


def _flow(c, m, sign: int) -> None:
    """Apply (+1) or reverse (-1) a move's effect on the balances it touched."""
    amt = m["amount"]
    if m["kind"] == "adjust":
        _bump(c, m["to_account_id"], sign * amt)
        return
    if m["from_account_id"]:
        _bump(c, m["from_account_id"], sign * _leave_delta(c, m["from_account_id"], amt))
    if m["to_account_id"]:
        v = m["principal"] if m["kind"] == "debt" and m["principal"] is not None else amt
        _bump(c, m["to_account_id"], sign * _enter_delta(c, m["to_account_id"], v))


_MOVE_COLS = ("date", "kind", "item_id", "fill_id", "from_account_id", "to_account_id", "amount", "principal",
              "interest", "symbol", "kind_asset", "qty", "price", "holding_id", "label", "tx_id", "note")


def _new_move(c, **kw):
    """Insert a move (ignored when its item+date or fill is already there). Returns the row or None."""
    cols = [k for k in _MOVE_COLS if k in kw]
    cur = c.execute(
        f"INSERT OR IGNORE INTO cash_moves ({','.join(cols)}, created_at) VALUES ({','.join('?' * len(cols))},?)",
        [kw[k] for k in cols] + [db.utcnow()])
    if cur.rowcount == 0:
        return None
    return c.execute("SELECT * FROM cash_moves WHERE id=?", (cur.lastrowid,)).fetchone()


def _take_back_shares(c, m) -> None:
    autoinvest._take_back(c, [{"status": "filled", "holding_id": m["holding_id"], "kind": m["kind_asset"],
                               "symbol": m["symbol"], "label": m["label"] or "", "qty": m["qty"] or 0,
                               "amount": m["amount"]}])


def reverse_move(c, m) -> None:
    """Undo a move completely: balances, shares (manual buys), and its row."""
    _flow(c, m, -1)
    if m["kind"] == "invest" and m["qty"]:
        _take_back_shares(c, m)
    c.execute("DELETE FROM cash_moves WHERE id=?", (m["id"],))


# ── Sync ─────────────────────────────────────────────────

def _cash_id() -> int | None:
    return get_cfg().get("account_id") or None


def _post(item: dict, d: date, cash_id: int) -> bool:
    """Post one occurrence in one transaction. False when it was already handled."""
    amt = _round(item["amount"])
    day = d.isoformat()
    with db.conn() as c:
        if _acct(c, cash_id) is None:
            return False
        t = item["type"]
        if t == "debt":
            lia = _acct(c, item["account_id"])
            if lia is None or lia["balance"] <= 0:
                return False
            interest = _round(lia["balance"] * (lia["rate"] or 0) / 100 / 12)
            principal = _round(max(0.0, min(amt - interest, lia["balance"])))
            m = _new_move(c, date=day, kind="debt", item_id=item["id"], from_account_id=cash_id,
                          to_account_id=item["account_id"], amount=amt, principal=principal,
                          interest=interest, note=item["name"])
        elif t in ("save", "invest"):
            if _acct(c, item["account_id"]) is None:
                return False
            m = _new_move(c, date=day, kind="transfer", item_id=item["id"], from_account_id=cash_id,
                          to_account_id=item["account_id"], amount=amt, note=item["name"])
        elif t == "income":
            m = _new_move(c, date=day, kind="income", item_id=item["id"], to_account_id=cash_id,
                          amount=amt, note=item["name"])
        else:
            m = _new_move(c, date=day, kind="bill", item_id=item["id"], from_account_id=cash_id,
                          amount=amt, note=item["name"])
        if m is None:
            return False
        if t in ("income", "bill"):
            signed = amt if t == "income" else -amt
            cur = c.execute(
                "INSERT INTO transactions (date, category, amount, kind, note, merchant, source, import_hash,"
                " cash_applied) VALUES (?,?,?,?,?,?,'plan',?,?)",
                (day, "income" if t == "income" else item["category"], amt,
                 "income" if t == "income" else "expense", item["name"], item["name"],
                 f"plan:{item['id']}:{day}", signed))
            c.execute("UPDATE cash_moves SET tx_id=? WHERE id=?", (cur.lastrowid, m["id"]))
        _flow(c, m, +1)
    return True


def _sync_autoinvest(cash_ok: bool) -> int:
    """Charge each filled auto-invest buy to its rule's account once; undo charges whose fill vanished."""
    n = 0
    with db.conn() as c:
        gone = c.execute(
            "SELECT m.* FROM cash_moves m WHERE m.kind='autoinvest' AND m.fill_id IS NOT NULL "
            "AND NOT EXISTS (SELECT 1 FROM autoinvest_fills f WHERE f.id=m.fill_id AND f.status='filled')"
        ).fetchall()
        for m in gone:
            reverse_move(c, m)
    with db.conn() as c:
        fills = c.execute(
            "SELECT f.*, r.cash_account_id AS acct, r.cash_from AS cash_from FROM autoinvest_fills f "
            "JOIN autoinvest_rules r ON r.id=f.rule_id WHERE f.status='filled' AND r.cash_account_id IS NOT NULL "
            "AND r.cash_from IS NOT NULL AND f.sched_date >= r.cash_from "
            "AND NOT EXISTS (SELECT 1 FROM cash_moves m WHERE m.fill_id=f.id)").fetchall()
    for f in fills:
        with db.conn() as c:
            if _acct(c, f["acct"]) is None:
                continue
            m = _new_move(c, date=f["sched_date"], kind="autoinvest", fill_id=f["id"], from_account_id=f["acct"],
                          amount=_round(f["amount"]), symbol=f["symbol"], kind_asset=f["kind"], qty=f["qty"],
                          price=f["price"], holding_id=f["holding_id"], label=f["label"] or "",
                          note=f"Auto-invest {f['symbol']}")
            if m is not None:
                _flow(c, m, +1)
                n += 1
    return n


def sync(today: date | None = None) -> dict:
    """Post everything that has come due. Idempotent."""
    today = today or today_local()
    posted = 0
    with _lock:
        cfg = get_cfg()
        cash_id = cfg.get("account_id")
        if cash_id:
            since = cfg.get("since")
            with db.conn() as c:
                items = [db.row_to_dict(r) for r in c.execute(
                    "SELECT * FROM cash_items WHERE paused=0 ORDER BY id")]
                done = {}
                for r in c.execute("SELECT item_id, date FROM cash_moves WHERE item_id IS NOT NULL"):
                    done.setdefault(r["item_id"], set()).add(r["date"])
            for it in items:
                floor = max([x for x in (it.get("track_from"), since) if x] or ["0001-01-01"])
                for d in occurrences(it, _iso(floor), today):
                    if d.isoformat() in done.get(it["id"], ()):
                        continue
                    try:
                        posted += _post(it, d, cash_id)
                    except Exception as e:  # noqa: BLE001 - one bad item can't block the rest
                        print(f"[cash] post {it['name']} {d}: {e}")
        try:
            posted += _sync_autoinvest(bool(cash_id))
        except Exception as e:  # noqa: BLE001
            print(f"[cash] autoinvest sync: {e}")
    return {"posted": posted}


def safe_sync(today: date | None = None) -> dict:
    try:
        return sync(today)
    except Exception as e:  # noqa: BLE001 - never take a caller down
        print(f"[cash] sync error: {e}")
        return {"posted": 0, "error": str(e)}


# ── Transactions hook ────────────────────────────────────

def _tx_signed(kind: str, amount: float) -> float:
    return _round(amount if kind == "income" else -amount)  # a refund (negative expense) adds back


def apply_new_tx(tx_id: int) -> None:
    """A manual transaction was just added: apply it to Cash (when Cash is set up and it's not older
    than the setup day)."""
    cfg = get_cfg()
    cash_id = cfg.get("account_id")
    if not cash_id:
        return
    with db.conn() as c:
        t = c.execute("SELECT * FROM transactions WHERE id=?", (tx_id,)).fetchone()
        if t is None or t["cash_applied"] is not None or _acct(c, cash_id) is None:
            return
        if cfg.get("since") and t["date"] < cfg["since"]:
            return
        delta = _tx_signed(t["kind"], t["amount"])
        _bump(c, cash_id, delta)
        c.execute("UPDATE transactions SET cash_applied=? WHERE id=?", (delta, tx_id))


def reapply_tx(tx_id: int) -> None:
    """A transaction that was applied to Cash changed: back out the old amount, apply the new one."""
    cash_id = _cash_id()
    with db.conn() as c:
        t = c.execute("SELECT * FROM transactions WHERE id=?", (tx_id,)).fetchone()
        if t is None or t["cash_applied"] is None:
            return
        delta = _tx_signed(t["kind"], t["amount"])
        _bump(c, cash_id, delta - t["cash_applied"])
        c.execute("UPDATE transactions SET cash_applied=? WHERE id=?", (delta, tx_id))


def _undo_txs(c, rows) -> None:
    cash_id = _cash_id()
    for r in rows:
        if r["cash_applied"] is not None:
            _bump(c, cash_id, -r["cash_applied"])
    ids = [r["id"] for r in rows]
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        c.execute(f"UPDATE cash_moves SET tx_id=NULL WHERE tx_id IN ({','.join('?' * len(chunk))})", chunk)


def delete_transaction(tx_id: int) -> bool:
    with db.conn() as c:
        rows = c.execute("SELECT id, cash_applied FROM transactions WHERE id=?", (tx_id,)).fetchall()
        if not rows:
            return False
        _undo_txs(c, rows)
        c.execute("DELETE FROM transactions WHERE id=?", (tx_id,))
    return True


def delete_transactions(ids: list[int] | None = None, month: str | None = None, batch: str | None = None) -> int:
    where, args = db._scope(ids, month, batch)
    with db.conn() as c:
        rows = c.execute(f"SELECT id, cash_applied FROM transactions WHERE {where}", args).fetchall()
        _undo_txs(c, rows)
        return c.execute(f"DELETE FROM transactions WHERE {where}", args).rowcount


# ── Items: validation & CRUD ─────────────────────────────

ITEM_FIELDS = ("name", "type", "amount", "frequency", "interval", "day", "day2", "start_date", "end_date",
               "track_from", "category", "account_id", "varies", "paused", "note")


def _check_date(v, field: str) -> str:
    try:
        return _iso(str(v)).isoformat()
    except (ValueError, TypeError):
        raise Invalid(f"{field} must look like 2026-10-08")


def validate_item(d: dict, acct: dict | None, cash_id: int | None = None) -> dict:
    """Clean a full item. `acct` is the linked account (a dict with at least `kind`) or None."""
    out: dict = {}
    out["name"] = str(d.get("name") or "").strip()
    if not out["name"]:
        raise Invalid("Give it a name.")
    out["type"] = d.get("type")
    if out["type"] not in TYPES:
        raise Invalid(f"type must be one of {list(TYPES)}")
    try:
        out["amount"] = _round(float(d.get("amount")))
    except (TypeError, ValueError):
        raise Invalid("Enter an amount above zero.")
    if not (0 < out["amount"] <= 100_000_000):
        raise Invalid("Enter an amount above zero.")
    f = out["frequency"] = d.get("frequency")
    if f not in FREQS:
        raise Invalid(f"frequency must be one of {list(FREQS)}")
    out["start_date"] = _check_date(d.get("start_date"), "start_date")
    out["end_date"] = _check_date(d["end_date"], "end_date") if d.get("end_date") else None
    if out["end_date"] and out["end_date"] < out["start_date"]:
        raise Invalid("The end date is before the start date.")
    out["track_from"] = _check_date(d["track_from"], "track_from") if d.get("track_from") else None

    def _day(key: str, lo: int, hi: int, label: str, required: bool = True):
        v = d.get(key)
        if v is None or v == "":
            if required:
                raise Invalid(f"Pick {label}.")
            return None
        try:
            v = int(v)
        except (TypeError, ValueError):
            raise Invalid(f"Pick {label}.")
        if not lo <= v <= hi:
            raise Invalid(f"Pick {label}.")
        return v

    out["day"], out["day2"] = None, None
    out["interval"] = 1
    if f == "weekly":
        out["day"] = _day("day", 0, 6, "a weekday (0 = Monday ... 6 = Sunday)")
    elif f == "biweekly":
        out["day"] = _day("day", 0, 6, "a weekday (0 = Monday ... 6 = Sunday)", required=False)
    elif f in ("monthly", "every_n_months", "semimonthly"):
        out["day"] = _day("day", 1, 31, "a day of the month (1-31)")
        if f == "semimonthly":
            out["day2"] = _day("day2", 1, 31, "a second day of the month (1-31)")
        if f == "every_n_months":
            out["interval"] = _day("interval", 1, 120, "how many months apart (1-120)")
    out["varies"] = 1 if d.get("varies") else 0
    out["paused"] = 1 if d.get("paused") else 0
    out["note"] = str(d.get("note") or "").strip()
    out["category"], out["account_id"] = None, None
    t = out["type"]
    if t == "bill":
        cat = d.get("category")
        if cat not in importer.EXPENSE_CATEGORIES:
            raise Invalid("Pick a spending category for this bill.")
        out["category"] = cat
    elif t == "debt":
        if acct is None or acct.get("kind") != "liability":
            raise Invalid("Pick the loan or card this payment goes to.")
        out["account_id"] = d.get("account_id")
    elif t in ("save", "invest"):
        if acct is None or acct.get("kind") != "asset":
            raise Invalid("Pick the account this money goes to.")
        if cash_id and d.get("account_id") == cash_id:
            raise Invalid("Pick a different account than Cash.")
        out["account_id"] = d.get("account_id")
    return out


def _acct_dict(account_id) -> dict | None:
    if not account_id:
        return None
    with db.conn() as c:
        a = _acct(c, account_id)
        return db.row_to_dict(a) if a else None


def create_item(data: dict, today: date | None = None) -> int:
    today = today or today_local()
    acct = _acct_dict(data.get("account_id")) if data.get("type") in ("debt", "save", "invest") else None
    d = validate_item(data, acct, _cash_id())
    d["track_from"] = d["track_from"] or today.isoformat()  # earlier occurrences are history, never posted
    now = db.utcnow()
    cols = list(ITEM_FIELDS)
    with db.conn() as c:
        cur = c.execute(
            f"INSERT INTO cash_items ({','.join(cols)}, created_at, updated_at) "
            f"VALUES ({','.join('?' * len(cols))},?,?)", [d[k] for k in cols] + [now, now])
        return cur.lastrowid


def update_item(item_id: int, patch: dict) -> bool:
    with db.conn() as c:
        row = c.execute("SELECT * FROM cash_items WHERE id=?", (item_id,)).fetchone()
        if row is None:
            return False
    merged = {**db.row_to_dict(row), **{k: v for k, v in patch.items() if k in ITEM_FIELDS}}
    acct = _acct_dict(merged.get("account_id")) if merged.get("type") in ("debt", "save", "invest") else None
    d = validate_item(merged, acct, _cash_id())
    d["track_from"] = d["track_from"] or merged.get("track_from")
    cols = list(ITEM_FIELDS)
    with db.conn() as c:
        c.execute(f"UPDATE cash_items SET {','.join(k + '=?' for k in cols)}, updated_at=? WHERE id=?",
                  [d[k] for k in cols] + [db.utcnow(), item_id])
    return True


def delete_item(item_id: int) -> bool:
    with db.conn() as c:
        return c.execute("DELETE FROM cash_items WHERE id=?", (item_id,)).rowcount > 0


# ── Manual actions ───────────────────────────────────────

def setup(account_id: int | None, new_name: str | None, balance: float | None, today: date | None = None) -> None:
    today = today or today_local()
    with _lock:
        if new_name and new_name.strip():
            acc = db.create_account({"name": new_name.strip(), "category": "cash", "kind": "asset",
                                     "balance": _round(balance) if balance is not None else 0})
            account_id, balance = acc["id"], None
        elif account_id:
            a = _acct_dict(account_id)
            if a is None:
                raise Invalid("That account doesn't exist.")
            if a["kind"] != "asset":
                raise Invalid("Cash has to be an account you own, not a loan or card.")
        cfg = get_cfg()
        cfg["account_id"] = account_id or None
        cfg["since"] = today.isoformat() if account_id else None
        set_cfg(cfg)
        if account_id and balance is not None:
            set_balance(account_id, balance, today)


def set_balance(account_id: int, balance: float, today: date | None = None) -> None:
    today = today or today_local()
    with db.conn() as c:
        a = _acct(c, account_id)
        if a is None:
            raise Invalid("That account doesn't exist.")
        delta = _round(float(balance) - a["balance"])
        if delta == 0:
            return
        m = _new_move(c, date=today.isoformat(), kind="adjust", to_account_id=account_id, amount=delta,
                      note="Balance correction")
        _flow(c, m, +1)


def move_money(from_id: int, to_id: int, amount: float, day: str | None, note: str,
               today: date | None = None) -> None:
    today = today or today_local()
    if not (amount and amount > 0):
        raise Invalid("Enter an amount above zero.")
    if from_id == to_id:
        raise Invalid("Pick two different accounts.")
    day = _check_date(day, "date") if day else today.isoformat()
    with db.conn() as c:
        if _acct(c, from_id) is None or _acct(c, to_id) is None:
            raise Invalid("That account doesn't exist.")
        m = _new_move(c, date=day, kind="transfer", from_account_id=from_id, to_account_id=to_id,
                      amount=_round(amount), note=(note or "").strip())
        _flow(c, m, +1)


def log_invest(account_id: int, symbol: str, kind: str, amount: float, day: str | None, price: float | None,
               label: str | None, today: date | None = None) -> dict:
    today = today or today_local()
    symbol = (symbol or "").strip().upper()
    if not symbol or len(symbol) > 15:
        raise Invalid("Enter the ticker you bought.")
    if kind not in ("stock", "crypto"):
        raise Invalid("kind must be stock or crypto")
    if not (amount and amount > 0):
        raise Invalid("Enter an amount above zero.")
    day = _check_date(day, "date") if day else today.isoformat()
    if price is None:
        try:
            price = market_data.live_quote(symbol, kind).get("price")
        except Exception:  # noqa: BLE001
            price = None
    if not price or price <= 0:
        raise Invalid(f"Couldn't get a price for {symbol}. Enter the price you paid.")
    qty = amount / price
    label = (label or "").strip() or "Robinhood"
    with db.conn() as c:
        if _acct(c, account_id) is None:
            raise Invalid("That account doesn't exist.")
        hid = autoinvest._add_to_holding(c, {"kind": kind, "symbol": symbol, "label": label}, qty, amount)
        m = _new_move(c, date=day, kind="invest", from_account_id=account_id, amount=_round(amount),
                      symbol=symbol, kind_asset=kind, qty=qty, price=price, holding_id=hid, label=label,
                      note=f"Bought {symbol}")
        _flow(c, m, +1)
        mid = m["id"]
    return {"move_id": mid, "symbol": symbol, "qty": qty, "price": price, "amount": _round(amount)}


def undo_move(move_id: int) -> bool:
    with db.conn() as c:
        m = c.execute("SELECT * FROM cash_moves WHERE id=?", (move_id,)).fetchone()
        if m is None:
            return False
        if m["item_id"] is not None or m["fill_id"] is not None or m["kind"] in SCHEDULED_KINDS:
            raise Invalid("That one was posted automatically from your plan, so it can't be undone here.")
        reverse_move(c, m)
    return True


def snooze(account_id: int, today: date | None = None) -> None:
    today = today or today_local()
    nxt = None
    with db.conn() as c:
        items = [db.row_to_dict(r) for r in c.execute(
            "SELECT * FROM cash_items WHERE type='invest' AND paused=0 AND account_id=?", (account_id,))]
    for it in items:
        o = occurrences(it, today + timedelta(days=1), today + timedelta(days=400))
        if o and (nxt is None or o[0] < nxt):
            nxt = o[0]
    cfg = get_cfg()
    cfg.setdefault("snooze", {})[str(account_id)] = (nxt or today + timedelta(days=7)).isoformat()
    cfg.setdefault("snooze_set", {})[str(account_id)] = today.isoformat()
    set_cfg(cfg)


# ── Payload ──────────────────────────────────────────────

def _active(it: dict, today: date) -> bool:
    return not it["paused"] and not (it.get("end_date") and it["end_date"] < today.isoformat())


def build(today: date | None = None) -> dict:
    today = today or today_local()
    cfg = get_cfg()
    cash_id = cfg.get("account_id")
    with db.conn() as c:
        accounts = [db.row_to_dict(r) for r in c.execute("SELECT * FROM accounts ORDER BY kind, category, name")]
        items = [db.row_to_dict(r) for r in c.execute("SELECT * FROM cash_items ORDER BY type, name, id")]
        rules = [db.row_to_dict(r) for r in c.execute(
            "SELECT * FROM autoinvest_rules WHERE cash_account_id IS NOT NULL ORDER BY symbol, id")]
        moves = [db.row_to_dict(r) for r in c.execute(
            "SELECT * FROM cash_moves ORDER BY date DESC, id DESC LIMIT ?", (RECENT_LIMIT,))]
        txs = [db.row_to_dict(r) for r in c.execute(
            "SELECT * FROM transactions WHERE cash_applied IS NOT NULL AND (import_hash IS NULL OR "
            "import_hash NOT LIKE 'plan:%') ORDER BY date DESC, id DESC LIMIT ?", (RECENT_LIMIT,))]
        last_dep = {r["a"]: r["d"] for r in c.execute(
            "SELECT to_account_id a, max(date) d FROM cash_moves WHERE kind='transfer' AND to_account_id IS NOT NULL "
            "GROUP BY to_account_id")}
    by_id = {a["id"]: a for a in accounts}
    cash = by_id.get(cash_id) if cash_id else None

    def dead_debt(it: dict) -> bool:
        a = by_id.get(it["account_id"])
        return it["type"] == "debt" and (a is None or a["balance"] <= 0)

    tomorrow, horizon = today + timedelta(days=1), today + timedelta(days=UPCOMING_DAYS)
    eom = date(today.year, today.month, calendar.monthrange(today.year, today.month)[1])
    upcoming, out_items = [], []
    for it in items:
        live = _active(it, today) and not dead_debt(it)
        occ = occurrences(it, tomorrow, max(horizon, eom)) if live else []
        for d in occ:
            if d <= horizon:
                upcoming.append({"date": d.isoformat(), "item_id": it["id"], "name": it["name"], "type": it["type"],
                                 "amount": it["amount"], "signed": it["amount"] if it["type"] == "income" else -it["amount"]})
        acc = by_id.get(it["account_id"]) if it["account_id"] else None
        pay = None
        if it["type"] == "debt" and acc and live:
            pay = payoff(acc["balance"], acc.get("rate"), it["amount"] * monthly_factor(it), today)
        out_items.append({**it, "monthly": _round(it["amount"] * monthly_factor(it)),
                          "next_date": occ[0].isoformat() if occ else None,
                          "account_name": acc["name"] if acc else None,
                          "account_balance": acc["balance"] if acc else None, "payoff": pay})
    upcoming.sort(key=lambda u: (u["date"], u["item_id"]))

    month = {"income": 0.0, "bills": 0.0, "debt": 0.0, "save": 0.0, "invest": 0.0, "autoinvest": 0.0}
    key = {"income": "income", "bill": "bills", "debt": "debt", "save": "save", "invest": "invest"}
    for it in items:
        if _active(it, today) and not dead_debt(it):
            month[key[it["type"]]] += it["amount"] * monthly_factor(it)
    ai = []
    for r in rules:
        m = 0.0 if r["paused"] else rule_monthly(r)
        if r["cash_account_id"] == cash_id:
            month["autoinvest"] += m
        ai.append({"rule_id": r["id"], "symbol": r["symbol"], "amount": r["amount"], "frequency": r["frequency"],
                   "monthly": _round(m), "cash_account_id": r["cash_account_id"], "paused": bool(r["paused"])})
    # Day-to-day spending (groceries, gas) is logged as it happens, so plan for it with the budget
    # targets, less what scheduled bills in the same category already cover.
    billed: dict[str, float] = {}
    for it in items:
        if it["type"] == "bill" and _active(it, today):
            billed[it["category"]] = billed.get(it["category"], 0.0) + it["amount"] * monthly_factor(it)
    with db.conn() as c:
        month["spending"] = sum(max(0.0, r["monthly_limit"] - billed.get(r["category"], 0.0))
                                for r in c.execute("SELECT * FROM budgets"))
    month = {k: _round(v) for k, v in month.items()}
    month["left"] = _round(month["income"] - month["bills"] - month["debt"] - month["save"] - month["invest"]
                           - month["autoinvest"] - month["spending"])

    month_end = None
    if cash:
        month_end = cash["balance"] + sum(u["signed"] for u in upcoming if u["date"] <= eom.isoformat())
        for r in rules:
            if r["cash_account_id"] == cash_id and not r["paused"] and r.get("cash_from"):
                month_end -= r["amount"] * sum(1 for d in autoinvest.schedule_dates(r, eom)
                                               if d > today and d.isoformat() >= r["cash_from"])
        month_end = _round(month_end)

    to_invest = []
    snooze_until, snooze_set = cfg.get("snooze") or {}, cfg.get("snooze_set") or {}
    for aid in sorted({it["account_id"] for it in items if it["type"] == "invest" and it["account_id"]}):
        a = by_id.get(aid)
        if a is None or a["balance"] < 1:
            continue
        ld = last_dep.get(aid)
        until, set_on = snooze_until.get(str(aid)), snooze_set.get(str(aid))
        snoozed = bool(until and today.isoformat() < until and not (ld and set_on and ld > set_on))
        to_invest.append({"account_id": aid, "name": a["name"], "balance": a["balance"], "last_deposit": ld,
                          "snoozed": snoozed})

    names = {i["id"]: i["name"] for i in items}
    recent = []
    for m in moves:
        k = m["kind"]
        sym = m["symbol"]
        if k == "adjust":
            signed, name = m["amount"], "Balance correction"
        else:
            to_cash = m["to_account_id"] == cash_id and cash_id
            from_cash = m["from_account_id"] == cash_id and cash_id
            if to_cash and not from_cash:
                signed = m["amount"]
            elif from_cash or m["from_account_id"]:
                signed = -m["amount"]
            else:
                signed = m["amount"]
            if m["item_id"] in names:
                name = names[m["item_id"]]
            elif k == "invest" or k == "autoinvest":
                name = f"Bought {sym}" if sym else "Investment"
            elif m["note"]:
                name = m["note"]
            else:
                dest = by_id.get(m["to_account_id"])
                name = f"Moved to {dest['name']}" if dest else "Transfer"
            if m["note"] and not m["item_id"] and k == "transfer":
                name = m["note"]
        recent.append({"id": f"m{m['id']}", "date": m["date"], "kind": k, "name": name, "amount": abs(m["amount"]),
                       "signed": signed, "move_id": m["id"], "tx_id": m["tx_id"], "symbol": sym, "qty": m["qty"],
                       "_k": (m["date"], m["created_at"], m["id"])})
    for t in txs:
        recent.append({"id": f"t{t['id']}", "date": t["date"], "kind": "income" if t["kind"] == "income" else "spent",
                       "name": t.get("merchant") or t.get("note") or t["category"], "amount": abs(t["amount"]),
                       "signed": t["cash_applied"], "move_id": None, "tx_id": t["id"], "symbol": None, "qty": None,
                       "_k": (t["date"], "", t["id"])})
    recent.sort(key=lambda r: r["_k"], reverse=True)
    recent = recent[:RECENT_LIMIT]
    for r in recent:
        r.pop("_k", None)

    return {
        "setup": {"account_id": cash_id, "since": cfg.get("since")},
        "cash": {"id": cash["id"], "name": cash["name"], "balance": cash["balance"]} if cash else None,
        "accounts": [{"id": a["id"], "name": a["name"], "category": a["category"], "kind": a["kind"],
                      "balance": a["balance"], "rate": a.get("rate")} for a in accounts],
        "to_invest": to_invest,
        "upcoming": upcoming,
        "month": month,
        "month_end": month_end,
        "items": out_items,
        "autoinvest": ai,
        "recent": recent,
    }


def account_monthly(account_id: int) -> float:
    """Monthly sum of active 'save' items into an account (a goal's pace)."""
    today = today_local()
    with db.conn() as c:
        items = [db.row_to_dict(r) for r in c.execute(
            "SELECT * FROM cash_items WHERE type='save' AND account_id=?", (account_id,))]
    return _round(sum(i["amount"] * monthly_factor(i) for i in items if _active(i, today)))


def payload(today: date | None = None) -> dict:
    """Sync, then build (what every /api/cash endpoint returns)."""
    today = today or today_local()
    safe_sync(today)
    return build(today)


# ── Plan import ──────────────────────────────────────────

def plan_template() -> dict:
    """An example plan with obviously fake numbers (real ones live in a private file, never the repo)."""
    return {
        "version": 1,
        "accounts": [
            {"key": "checking", "name": "Example Checking", "category": "cash", "kind": "asset", "balance": 1000},
            {"key": "savings", "name": "Example Savings", "category": "cash", "kind": "asset", "balance": 500},
            {"key": "broker_cash", "name": "Example Brokerage Cash", "category": "brokerage", "kind": "asset",
             "balance": 0},
            {"key": "card", "name": "Example Credit Card", "category": "credit_card", "kind": "liability",
             "balance": 1200, "rate": 20},
        ],
        "cash_account": "checking",
        "items": [
            {"key": "job", "name": "Main job", "type": "income", "amount": 1000, "frequency": "semimonthly",
             "day": 1, "day2": 15, "start_date": "2026-01-01"},
            {"key": "rent", "name": "Rent", "type": "bill", "amount": 500, "frequency": "monthly", "day": 1,
             "start_date": "2026-01-01", "category": "rent"},
            {"key": "phone", "name": "Phone", "type": "bill", "amount": 40, "frequency": "monthly", "day": 12,
             "start_date": "2026-01-01", "category": "subscriptions", "varies": True},
            {"key": "card_pay", "name": "Credit card payment", "type": "debt", "amount": 100,
             "frequency": "monthly", "day": 20, "start_date": "2026-01-01", "account": "card"},
            {"key": "save", "name": "Savings transfer", "type": "save", "amount": 50, "frequency": "biweekly",
             "day": 4, "start_date": "2026-01-02", "account": "savings"},
            {"key": "weekly_invest", "name": "Weekly investing", "type": "invest", "amount": 25,
             "frequency": "weekly", "day": 4, "start_date": "2026-01-02", "account": "broker_cash"},
        ],
        "autoinvest": [
            {"key": "ira", "symbol": "VOO", "kind": "stock", "amount": 100, "frequency": "monthly", "day": 1,
             "start_date": "2026-01-01", "label": "Example IRA", "from": "checking"},
        ],
        "contributions": [
            {"key": "work401k", "account": "Example 401(k)", "bucket": "retirement", "amount": 100,
             "frequency": "semimonthly", "plan_type": "401k", "employer_match": 50},
        ],
        "goals": [
            {"key": "rainy", "name": "Example emergency fund", "target": 5000, "account": "savings",
             "date": "2027-12-31"},
        ],
        "budgets": [
            {"key": "food", "category": "food", "limit": 300},
        ],
    }


def _plan_list(plan: dict, name: str) -> list[dict]:
    v = plan.get(name) or []
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


def _num(v, label: str, allow_none: bool = False):
    if v is None and allow_none:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        raise Invalid(f"{label} must be a number")


def analyze(plan: dict, skip=(), check_rule=None) -> tuple[list[dict], list[str], list[dict]]:
    """Work out what importing `plan` would do. Returns (rows for the preview, errors, ops to run).
    Row keys look like "items:rent" (section:key). Rows in `skip` get no op and cause no errors."""
    rows: list[dict] = []
    errors: list[str] = []
    ops: list[dict] = []
    skip = set(skip or [])
    if not isinstance(plan, dict) or plan.get("version") != 1:
        return rows, ["This plan file isn't version 1."], ops
    accts = {a["name"].strip().lower(): a for a in db.list_accounts()}
    aliases: dict[str, dict] = {}   # plan account key -> {"existing": acct|None, "kind", "skipped", "name"}

    def add(section, key, label, detail, status, op=None):
        rk = f"{section}:{key}"
        rows.append({"key": rk, "section": section, "label": label, "detail": detail, "status": status})
        if rk not in skip and op is not None and status != "exists":
            ops.append({"section": section, "key": key, "status": status, **op})
        return rk in skip

    def err(section, key, label, msg, skipped):
        if not skipped:
            errors.append(f"{label}: {msg}")

    for a in _plan_list(plan, "accounts"):
        key, name = str(a.get("key") or a.get("name") or ""), str(a.get("name") or "").strip()
        label = name or key or "Account"
        sk = f"accounts:{key}" in skip
        try:
            if not key or not name:
                raise Invalid("needs a key and a name")
            cat = a.get("category") or "other"
            kind = a.get("kind") or ("liability" if cat in ("credit_card", "loan", "mortgage") else "asset")
            if kind not in ("asset", "liability"):
                raise Invalid("kind must be asset or liability")
            bal = _num(a.get("balance"), "balance", True)
            rate = _num(a.get("rate"), "rate", True)
        except Invalid as e:
            err("accounts", key, label, str(e), sk)
            continue
        ex = accts.get(name.lower())
        aliases[key] = {"existing": ex, "kind": ex["kind"] if ex else kind, "skipped": sk, "name": name}
        detail = (f"{kind}, {cat}" + (f", balance {bal:,.2f}" if bal is not None else "")
                  + (f", {rate:g}% APR" if rate else ""))
        if ex is None:
            add("accounts", key, name, detail, "new", {"kind": "account_new", "data": {
                "name": name, "category": cat, "kind": kind, "balance": bal or 0, "rate": rate}})
        elif (bal is not None and abs(bal - ex["balance"]) > 0.004) or (rate is not None and rate != ex.get("rate")):
            add("accounts", key, name, detail, "update", {"kind": "account_update", "id": ex["id"], "data": {
                **({"balance": bal} if bal is not None else {}), **({"rate": rate} if rate is not None else {})}})
        else:
            add("accounts", key, name, detail, "exists")

    def resolve(ref):
        """Plan account key (or an existing account's name) -> (alias dict | None, error | None)."""
        if ref is None:
            return None, "needs an account"
        if str(ref) in aliases:
            al = aliases[str(ref)]
            if al["skipped"] and al["existing"] is None:
                return None, f"uses '{al['name']}', which you skipped"
            return al, None
        ex = accts.get(str(ref).strip().lower())
        if ex:
            return {"existing": ex, "kind": ex["kind"], "skipped": False, "name": ex["name"]}, None
        return None, f"uses account '{ref}', which isn't in the plan"

    cash_ref = plan.get("cash_account")
    cfg = get_cfg()
    if cash_ref is not None:
        al, e = resolve(cash_ref)
        if e:
            errors.append(f"Cash account {e}")
        elif not cfg.get("account_id"):
            add("cash", "account", f"Cash account: {al['name']}", "Used for paychecks, bills and spending",
                "new", {"kind": "cash_setup", "ref": str(cash_ref)})
        else:
            cur = (cfg.get("account_id") == (al["existing"] or {}).get("id"))
            add("cash", "account", f"Cash account: {al['name']}",
                "Already set up" if cur else "Cash is already set up with a different account", "exists")

    with db.conn() as c:
        have = {(r["name"].strip().lower(), r["type"]) for r in c.execute("SELECT name, type FROM cash_items")}
    for it in _plan_list(plan, "items"):
        key, name = str(it.get("key") or it.get("name") or ""), str(it.get("name") or "").strip()
        label = name or key or "Item"
        sk = f"items:{key}" in skip
        try:
            al = None
            if it.get("type") in ("debt", "save", "invest"):
                al, e = resolve(it.get("account"))
                if e:
                    raise Invalid(e)
            data = {**it, "account_id": (al["existing"] or {}).get("id") if al else None}
            clean = validate_item(data, {"kind": al["kind"]} if al else None)
        except Invalid as e:
            err("items", key, label, str(e), sk)
            continue
        detail = f"{clean['type']} ${clean['amount']:,.2f} {clean['frequency'].replace('_', ' ')}"
        if (name.lower(), clean["type"]) in have:
            add("items", key, name, detail, "exists")
        else:
            add("items", key, name, detail, "new", {"kind": "item", "data": clean,
                                                    "ref": str(it.get("account")) if al else None})

    with db.conn() as c:
        rules = [db.row_to_dict(r) for r in c.execute("SELECT * FROM autoinvest_rules")]
    for r in _plan_list(plan, "autoinvest"):
        key, sym = str(r.get("key") or r.get("symbol") or ""), str(r.get("symbol") or "").upper().strip()
        label = f"Auto-invest {sym}" if sym else "Auto-invest"
        sk = f"autoinvest:{key}" in skip
        try:
            data = {"symbol": sym, "kind": r.get("kind", "stock"), "amount": _num(r.get("amount"), "amount"),
                    "frequency": r.get("frequency", "monthly"), "day": r.get("day", 1),
                    "start_date": r.get("start_date"), "end_date": r.get("end_date"),
                    "label": str(r.get("label") or "").strip()}
            if check_rule:
                check_rule(data)
            al = None
            if r.get("from"):
                al, e = resolve(r.get("from"))
                if e:
                    raise Invalid(e)
        except Invalid as e:
            err("autoinvest", key, label, str(e), sk)
            continue
        except Exception as e:  # noqa: BLE001 - HTTPException from main's rule check
            err("autoinvest", key, label, str(getattr(e, "detail", e)), sk)
            continue
        ex = next((x for x in rules if x["symbol"].upper() == sym
                   and (x["label"] or "").strip().lower() == data["label"].lower()), None)
        detail = f"${data['amount']:,.2f} {data['frequency']}" + (f" from {al['name']}" if al else "")
        if ex is None:
            add("autoinvest", key, label, detail, "new", {"kind": "autoinvest_new", "data": data,
                                                          "ref": str(r.get("from")) if al else None})
        elif al and (al["existing"] is None or ex.get("cash_account_id") != al["existing"]["id"]):
            add("autoinvest", key, label, detail, "update", {"kind": "autoinvest_link", "id": ex["id"],
                                                             "ref": str(r.get("from"))})
        else:
            add("autoinvest", key, label, detail, "exists")

    with db.conn() as c:
        contribs = {r["account"].strip().lower() for r in c.execute("SELECT account FROM contributions")}
    for r in _plan_list(plan, "contributions"):
        key, name = str(r.get("key") or r.get("account") or ""), str(r.get("account") or "").strip()
        sk = f"contributions:{key}" in skip
        try:
            if not name:
                raise Invalid("needs an account name")
            amt = _num(r.get("amount"), "amount")
            if amt <= 0:
                raise Invalid("amount must be more than 0")
            freq = r.get("frequency", "monthly")
            if freq not in db.PERIODS_PER_MONTH:
                raise Invalid(f"frequency must be one of {list(db.PERIODS_PER_MONTH)}")
            data = {"account": name, "bucket": r.get("bucket", "retirement"), "amount": amt, "frequency": freq,
                    "plan_type": r.get("plan_type", "other"),
                    "employer_match": _num(r.get("employer_match") or 0, "employer_match")}
        except Invalid as e:
            err("contributions", key, name or key or "Contribution", str(e), sk)
            continue
        detail = f"${amt:,.2f} {freq}"
        if name.lower() in contribs:
            add("contributions", key, name, detail, "exists")
        else:
            add("contributions", key, name, detail, "new", {"kind": "contribution", "data": data})

    goals = {str(g.get("name") or "").strip().lower() for g in extras.goals()}
    for g in _plan_list(plan, "goals"):
        key, name = str(g.get("key") or g.get("name") or ""), str(g.get("name") or "").strip()
        sk = f"goals:{key}" in skip
        try:
            if not name:
                raise Invalid("needs a name")
            target = _num(g.get("target"), "target")
            if target <= 0:
                raise Invalid("target must be more than 0")
            al, e = resolve(g.get("account")) if g.get("account") else (None, None)
            if e:
                raise Invalid(e)
            if g.get("date"):
                _check_date(g["date"], "date")
        except Invalid as e:
            err("goals", key, name or key or "Goal", str(e), sk)
            continue
        detail = f"${target:,.0f}" + (f" by {g['date']}" if g.get("date") else "")
        if name.lower() in goals:
            add("goals", key, name, detail, "exists")
        else:
            add("goals", key, name, detail, "new", {"kind": "goal", "data": {
                "name": name, "target": target, "date": g.get("date") or None, "metric": "net_worth"},
                "ref": str(g.get("account")) if al else None})

    budgets = db.get_budgets()
    for b in _plan_list(plan, "budgets"):
        key, cat = str(b.get("key") or b.get("category") or ""), b.get("category")
        sk = f"budgets:{key}" in skip
        try:
            if cat not in importer.EXPENSE_CATEGORIES:
                raise Invalid(f"'{cat}' isn't a spending category")
            lim = _num(b.get("limit"), "limit")
            if lim < 0:
                raise Invalid("limit can't be negative")
        except Invalid as e:
            err("budgets", key, f"Budget {cat}", str(e), sk)
            continue
        detail = f"${lim:,.0f} a month"
        if cat in budgets and abs(budgets[cat] - lim) < 0.005:
            add("budgets", key, str(cat), detail, "exists")
        else:
            add("budgets", key, str(cat), detail, "update" if cat in budgets else "new",
                {"kind": "budget", "category": cat, "limit": lim})
    return rows, errors, ops


def import_plan(plan: dict, skip=(), check_rule=None, today: date | None = None) -> dict:
    """Run the plan. Idempotent: anything already there is left alone. Returns counts and the new autoinvest ids."""
    today = today or today_local()
    rows, errors, ops = analyze(plan, skip, check_rule)
    if errors:
        raise Invalid(" ".join(errors[:3]))
    created = {"accounts": 0, "items": 0, "autoinvest": 0, "contributions": 0, "goals": 0, "budgets": 0}
    updated = {"accounts": 0, "autoinvest": 0, "budgets": 0}
    new_rules: list[int] = []
    ids: dict[str, int] = {}
    for a in db.list_accounts():
        ids[a["name"].strip().lower()] = a["id"]

    def acct_id(ref) -> int | None:
        if ref is None:
            return None
        if str(ref) in ids:
            return ids[str(ref)]
        return ids.get(str(ref).strip().lower())

    # accounts first so everything else can point at them
    for al in _plan_list(plan, "accounts"):
        name = str(al.get("name") or "").strip().lower()
        if name in ids:
            ids[str(al.get("key"))] = ids[name]
    for op in sorted(ops, key=lambda o: 0 if o["kind"].startswith("account") else 1):
        k = op["kind"]
        if k == "account_new":
            acc = db.create_account(op["data"])
            ids[str(op["key"])] = acc["id"]
            ids[acc["name"].strip().lower()] = acc["id"]
            created["accounts"] += 1
        elif k == "account_update":
            db.update_account(op["id"], op["data"])
            updated["accounts"] += 1
        elif k == "cash_setup":
            if not get_cfg().get("account_id") and acct_id(op["ref"]):
                cfg = get_cfg()
                cfg["account_id"], cfg["since"] = acct_id(op["ref"]), today.isoformat()
                set_cfg(cfg)
        elif k == "item":
            d = {**op["data"], "account_id": acct_id(op.get("ref"))}
            create_item(d, today)
            created["items"] += 1
        elif k == "autoinvest_new":
            d = {**op["data"], "cash_account_id": acct_id(op.get("ref"))}
            new_rules.append(autoinvest.create_rule(d, add_past=False, today=today))
            created["autoinvest"] += 1
        elif k == "autoinvest_link":
            autoinvest.update_rule(op["id"], {"cash_account_id": acct_id(op["ref"])}, today=today)
            updated["autoinvest"] += 1
        elif k == "contribution":
            db.create_contribution(op["data"])
            created["contributions"] += 1
        elif k == "goal":
            extras.save_goal({**op["data"], "account_id": acct_id(op.get("ref"))})
            created["goals"] += 1
        elif k == "budget":
            db.set_budget(op["category"], op["limit"])
            (updated if op["status"] == "update" else created)["budgets"] += 1
    return {"created": created, "updated": updated, "new_rule_ids": new_rules}
