"""Tax estimates: realized gains (short vs long term), loss-harvest candidates, wash-sale warnings.

US federal 2026 rules, ESTIMATES ONLY. Own tables live here (created by init()) so db.py stays untouched.
main.py wires `holdings_provider = valued_holdings` to avoid a circular import.
"""

import re
from datetime import date, datetime, timedelta, timezone
from typing import Callable

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import db

router = APIRouter()

# main.py sets this to valued_holdings (returns {"holdings": [...]}).
holdings_provider: Callable[[], dict] | None = None

# ── 2026 rates ────────────────────────────────────────────

BRACKETS = {
    "single": [(12_400, .10), (50_400, .12), (105_700, .22), (201_775, .24),
               (256_225, .32), (640_600, .35), (float("inf"), .37)],
    "mfj": [(24_800, .10), (100_800, .12), (211_400, .22), (403_550, .24),
            (512_450, .32), (768_700, .35), (float("inf"), .37)],
}
LTCG_BREAKS = {"single": (49_450, 545_500), "mfj": (98_900, 613_700)}
NIIT_THRESHOLD = {"single": 200_000, "mfj": 250_000}
NIIT_RATE = 0.038
LOSS_CAP = 3000.0

KNOWN_CRYPTO = set("BTC ETH SOL XRP DOGE ADA AVAX LINK DOT MATIC POL SUI BNB LTC HYPE PEPE SHIB TON TRX "
                   "NEAR APT ARB OP INJ TIA SEI".split())
TAX_ADVANTAGED = re.compile(r"401|ira|roth|hsa|403b|tsp|529", re.I)
OCC = re.compile(r"^([A-Z]{1,6})\d{6}[CP]\d{8}$")


def init():
    with db.conn() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS tax_trade_cost (
                trade_id INTEGER PRIMARY KEY REFERENCES trades(id) ON DELETE CASCADE,
                cost REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tax_holding_dates (
                holding_id INTEGER PRIMARY KEY REFERENCES holdings(id) ON DELETE CASCADE,
                acquired TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tax_sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                kind TEXT DEFAULT 'stock',
                qty REAL,
                acquired TEXT NOT NULL,
                sold TEXT NOT NULL,
                proceeds REAL NOT NULL,
                cost REAL NOT NULL,
                account TEXT DEFAULT '',
                note TEXT DEFAULT '',
                created_at TEXT NOT NULL
            );
            """
        )


# ── settings ──────────────────────────────────────────────

def _float_setting(key: str, default: float | None) -> float | None:
    v = db.get_setting(key)
    try:
        return float(v) if v not in (None, "") else default
    except ValueError:
        return default


def load_settings() -> dict:
    filing = db.get_setting("tax_filing")
    return {
        "filing": filing if filing in BRACKETS else "single",
        "income": _float_setting("tax_income", None),
        "state_rate": _float_setting("tax_state_rate", 0.0) or 0.0,
        "carryover": _float_setting("tax_carryover", 0.0) or 0.0,
    }


def rates_for(settings: dict, net_lt: float = 0.0, net_total: float = 0.0) -> dict:
    """Marginal rates as decimals. Unset income -> assume 24% ordinary / 15% LTCG / no NIIT."""
    state = settings["state_rate"] / 100
    income = settings["income"]
    if income is None:
        return {"ordinary": 0.24, "ltcg": 0.15, "niit": 0.0, "state": state, "assumed": True}
    filing = settings["filing"]
    ordinary = next(r for cap, r in BRACKETS[filing] if income <= cap)
    lo, hi = LTCG_BREAKS[filing]
    stacked = income + max(net_lt, 0)
    ltcg = 0.0 if stacked <= lo else (0.15 if stacked <= hi else 0.20)
    niit = NIIT_RATE if income + max(net_total, 0) > NIIT_THRESHOLD[filing] and net_total > 0 else 0.0
    return {"ordinary": ordinary, "ltcg": ltcg, "niit": niit, "state": state, "assumed": False}


# ── netting (pure) ────────────────────────────────────────

def net_gains(st_gain: float, st_loss: float, lt_gain: float, lt_loss: float,
              carryover: float, rates: dict) -> dict:
    """Net short/long term, apply the $3,000 cap, estimate tax. Negative est_tax = a tax cut."""
    net_st = st_gain - st_loss - carryover  # carryover counts as a short-term loss
    net_lt = lt_gain - lt_loss
    pos_st, pos_lt = net_st, net_lt
    if pos_st < 0 < pos_lt:
        pos_lt, pos_st = pos_lt + pos_st, 0.0
    elif pos_lt < 0 < pos_st:
        pos_st, pos_lt = pos_st + pos_lt, 0.0
    net = net_st + net_lt
    state, niit = rates["state"], rates["niit"]
    deductible = carry_forward = 0.0
    if net > 0:
        est = max(pos_st, 0) * (rates["ordinary"] + niit + state) + max(pos_lt, 0) * (rates["ltcg"] + niit + state)
    else:
        deductible = min(LOSS_CAP, -net)
        est = -deductible * (rates["ordinary"] + state)
        carry_forward = -net - deductible
    gross_net = (st_gain - st_loss) + (lt_gain - lt_loss)
    return {"net_st": net_st, "net_lt": net_lt, "net": net, "est_tax": est,
            "deductible_loss": deductible, "carry_forward": carry_forward,
            "carryover_used": min(carryover, max(gross_net, 0.0))}


def _totals(items: list[dict]) -> tuple[float, float, float, float]:
    sg = sl = lg = ll = 0.0
    for i in items:
        g = i["gain"]
        if g is None:
            continue
        if i["term"] == "long":
            lg, ll = lg + max(g, 0), ll + max(-g, 0)
        else:
            sg, sl = sg + max(g, 0), sl + max(-g, 0)
    return sg, sl, lg, ll


# ── helpers ───────────────────────────────────────────────

def _d(s: str) -> date:
    return date.fromisoformat(s[:10])


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _root(symbol: str) -> str:
    m = OCC.match(symbol.upper())
    return m.group(1) if m else symbol.upper()


def _term(acquired: str, sold: str, direction: str = "long") -> str:
    return "long" if direction == "long" and (_d(sold) - _d(acquired)).days > 365 else "short"


def _is_crypto(symbol: str, crypto_symbols: set[str]) -> bool:
    s = symbol.upper()
    return s in crypto_symbols or s in KNOWN_CRYPTO


def _r2(x: float | None) -> float | None:
    return None if x is None else round(x + 0.0, 2)


def _load_holdings() -> list[dict]:
    with db.conn() as c:
        dates = {r["holding_id"]: r["acquired"] for r in c.execute("SELECT * FROM tax_holding_dates")}
    return [{**h, "acquired": dates.get(h["id"])} for h in db.list_holdings()]


def _realized(year: int, crypto_symbols: set[str]) -> list[dict]:
    out = []
    with db.conn() as c:
        costs = {r["trade_id"]: r["cost"] for r in c.execute("SELECT * FROM tax_trade_cost")}
        trades = c.execute("SELECT * FROM trades WHERE status='closed' AND closed_at IS NOT NULL").fetchall()
        sales = c.execute("SELECT * FROM tax_sales").fetchall()
    for t in trades:
        if int(t["closed_at"][:4]) != year:
            continue
        cost = costs.get(t["id"])
        pnl = t["pnl_pct"] or 0.0
        gain = cost * pnl / 100 if cost else None
        acq, sold = t["opened_at"][:10], t["closed_at"][:10]
        out.append({"source": "trade", "id": t["id"], "symbol": t["asset"].upper(),
                    "kind": "crypto" if _is_crypto(t["asset"], crypto_symbols) else "stock",
                    "direction": t["direction"], "qty": None, "acquired": acq, "sold": sold,
                    "cost": _r2(cost), "proceeds": _r2(cost + gain) if gain is not None else None,
                    "gain": _r2(gain), "term": _term(acq, sold, t["direction"]),
                    "needs_cost": cost is None, "wash": None})
    for s in sales:
        if int(s["sold"][:4]) != year:
            continue
        out.append({"source": "sale", "id": s["id"], "symbol": s["symbol"].upper(), "kind": s["kind"] or "stock",
                    "direction": None, "qty": s["qty"], "acquired": s["acquired"], "sold": s["sold"],
                    "cost": _r2(s["cost"]), "proceeds": _r2(s["proceeds"]),
                    "gain": _r2(s["proceeds"] - s["cost"]), "term": _term(s["acquired"], s["sold"]),
                    "needs_cost": False, "wash": None})
    out.sort(key=lambda r: (r["sold"], r["id"]), reverse=True)
    return out


def _all_years() -> set[int]:
    with db.conn() as c:
        ys = {int(r[0]) for r in c.execute(
            "SELECT DISTINCT substr(closed_at,1,4) FROM trades WHERE status='closed' AND closed_at IS NOT NULL")}
        ys |= {int(r[0]) for r in c.execute("SELECT DISTINCT substr(sold,1,4) FROM tax_sales")}
    return ys


def _wash_scan(realized: list[dict], holdings: list[dict]) -> list[dict]:
    """Flag realized stock/option losses with a same-symbol buy within 30 days either side."""
    with db.conn() as c:
        buys = [dict(r) for r in c.execute(
            "SELECT id, asset, opened_at FROM trades WHERE direction='long'")]
        sales = [dict(r) for r in c.execute("SELECT id, symbol, acquired FROM tax_sales")]
    warnings = []
    for r in realized:
        if r["kind"] == "crypto" or r["gain"] is None or r["gain"] >= 0:
            continue
        root, sold = _root(r["symbol"]), _d(r["sold"])
        near = lambda ds: abs((_d(ds) - sold).days) <= 30
        reasons = []
        for b in buys:
            if _root(b["asset"]) == root and not (r["source"] == "trade" and b["id"] == r["id"]) \
                    and near(b["opened_at"]):
                reasons.append(f"you bought {b['asset']} again on {b['opened_at'][:10]} (journal trade)")
        for s in sales:
            if _root(s["symbol"]) == root and not (r["source"] == "sale" and s["id"] == r["id"]) \
                    and near(s["acquired"]):
                reasons.append(f"a {s['symbol']} lot was acquired on {s['acquired']}")
        possible = False
        for h in holdings:
            if h["kind"] == "crypto" or _root(h["symbol"]) != root:
                continue
            if h["acquired"]:
                if near(h["acquired"]):
                    reasons.append(f"you bought {h['symbol']} on {h['acquired']}"
                                   + (f" ({h['label']})" if h["label"] else ""))
            else:
                possible = True
        if reasons:
            w = {"status": "flagged", "reason": "Replacement buy within 30 days: " + "; ".join(reasons[:3]) + "."}
        elif possible:
            w = {"status": "possible",
                 "reason": f"You still hold {root} and its buy date is unknown. Set it to check the 30-day window."}
        else:
            continue
        r["wash"] = w
        warnings.append({"symbol": r["symbol"], "sold": r["sold"], "loss": _r2(-r["gain"]), **w})
    return warnings


def _harvest(year_items: list[dict], settings: dict, rates: dict, today: date,
             rows: list[dict], all_holdings: list[dict]) -> tuple[list[dict], dict]:
    dates = {h["id"]: h["acquired"] for h in all_holdings}
    with db.conn() as c:
        recent = [dict(r) for r in c.execute(
            "SELECT id, asset, opened_at FROM trades WHERE direction='long' AND opened_at >= ?",
            ((today - timedelta(days=30)).isoformat(),))]
    sg, sl, lg, ll = _totals(year_items)
    carry = settings["carryover"]
    base = net_gains(sg, sl, lg, ll, carry, rates)["est_tax"]

    def saved(extra: list[tuple[str, float]]) -> float:
        a, b, c_, d = sg, sl, lg, ll
        for term, loss in extra:
            if term == "long":
                d += loss
            else:
                b += loss
        return base - net_gains(a, b, c_, d, carry, rates)["est_tax"]

    cands = []
    for h in rows:
        if h.get("pnl") is None or h["pnl"] >= 0 or h.get("price") is None:
            continue
        if TAX_ADVANTAGED.search(h.get("label") or "") or (h.get("note") or "").strip():
            continue
        cands.append(h)
    cands.sort(key=lambda h: h["pnl"])
    cands = cands[:12]

    out, extras = [], []
    for h in cands:
        acq = dates.get(h["id"])
        term = None if not acq else ("long" if (today - _d(acq)).days > 365 else "short")
        loss = -h["pnl"]
        extras.append((term or "short", loss))
        if h["kind"] == "crypto":
            note, rebuy = "Crypto isn't under the wash-sale rule today.", None
        else:
            rebuy = (today + timedelta(days=31)).isoformat()
            root = _root(h["symbol"])
            warns = []
            if any(_root(b["asset"]) == root for b in recent):
                warns.append("you opened a long journal trade on it in the last 30 days")
            if any(o["id"] != h["id"] and o["kind"] != "crypto" and _root(o["symbol"]) == root
                   for o in all_holdings):
                warns.append("you also hold it in another account (IRA buys count too)")
            # rebuy_after carries the 30-day date; the note only holds extra wash-sale risks
            note = ("Careful: " + " and ".join(warns) + ", which could trigger a wash sale.") if warns else ""
        out.append({"holding_id": h["id"], "symbol": h["symbol"], "display": h.get("display") or h["symbol"],
                    "kind": h["kind"], "label": h.get("label") or "", "value": _r2(h.get("value")),
                    "loss": _r2(loss), "term": term, "acquired": acq,
                    "est_saved": _r2(saved([extras[-1]])), "wash_note": note, "rebuy_after": rebuy})
    total = {"loss": _r2(sum(l for _, l in extras)), "est_saved": _r2(saved(extras)) if extras else 0.0}
    return out, total


# ── report ────────────────────────────────────────────────

def report(year: int | None = None) -> dict:
    today = _today()
    year = year or today.year
    settings = load_settings()
    all_holdings = _load_holdings()
    rows: list[dict] = []
    if holdings_provider:
        try:
            rows = holdings_provider().get("holdings", [])
        except Exception as e:  # prices unreachable — still show realized data
            print(f"[taxes] holdings provider failed: {e}")
    crypto_symbols = {h["symbol"].upper() for h in (rows or all_holdings) if h["kind"] == "crypto"}

    realized = _realized(year, crypto_symbols)
    sg, sl, lg, ll = _totals(realized)
    carry = settings["carryover"]
    rates = rates_for(settings, lg - ll, (sg - sl) + (lg - ll) - carry)
    res = net_gains(sg, sl, lg, ll, carry, rates)
    # What the same gains would cost with no losses and no carryover.
    gains_only = net_gains(sg, 0, lg, 0, 0, rates)["est_tax"]
    wash = _wash_scan(realized, all_holdings)
    harvest, harvest_total = [], {"loss": 0.0, "est_saved": 0.0}
    if year == today.year:  # harvesting only helps the year still open
        harvest, harvest_total = _harvest(realized, settings, rates, today, rows, all_holdings)
    years = sorted(_all_years() | {today.year}, reverse=True)
    return {
        "year": year,
        "years": years,
        "settings": settings,
        "rates": rates,
        "summary": {"st_gain": _r2(sg), "st_loss": _r2(sl), "lt_gain": _r2(lg), "lt_loss": _r2(ll),
                    "net_st": _r2(res["net_st"]), "net_lt": _r2(res["net_lt"]), "net": _r2(res["net"]),
                    "carryover_used": _r2(res["carryover_used"]),
                    "deductible_loss": _r2(res["deductible_loss"]),
                    "carry_forward": _r2(res["carry_forward"]),
                    "est_tax": _r2(res["est_tax"]), "already_saved": _r2(max(gains_only - res["est_tax"], 0.0))},
        "realized": realized,
        "harvest": harvest,
        "harvest_total": harvest_total,
        "wash": wash,
        "missing_cost": sum(1 for r in realized if r["needs_cost"]),
        "days_left": max((date(year, 12, 31) - today).days, 0),
    }


# ── routes ────────────────────────────────────────────────

class SettingsIn(BaseModel):
    filing: str = "single"
    income: float | None = None
    state_rate: float = 0.0
    carryover: float = 0.0


class CostIn(BaseModel):
    cost: float | None = None


class AcquiredIn(BaseModel):
    acquired: str | None = None


class SaleIn(BaseModel):
    symbol: str
    kind: str = "stock"
    qty: float | None = None
    acquired: str
    sold: str
    proceeds: float
    cost: float
    account: str = ""
    note: str = ""


def _check_date(s: str, label: str) -> str:
    try:
        return date.fromisoformat(s).isoformat()
    except (ValueError, TypeError):
        raise HTTPException(400, f"{label} must be YYYY-MM-DD")


@router.get("/api/taxes")
def get_taxes(year: int | None = None):
    if year is not None and not 1990 <= year <= 2100:
        raise HTTPException(400, "year out of range")
    return report(year)


@router.put("/api/taxes/settings")
def put_settings(body: SettingsIn):
    if body.filing not in BRACKETS:
        raise HTTPException(400, "filing must be 'single' or 'mfj'")
    if body.income is not None and body.income < 0:
        raise HTTPException(400, "income can't be negative")
    if not 0 <= body.state_rate <= 30:
        raise HTTPException(400, "state_rate must be 0-30 (percent)")
    if body.carryover < 0:
        raise HTTPException(400, "carryover can't be negative")
    db.set_setting("tax_filing", body.filing)
    db.set_setting("tax_income", None if body.income is None else str(body.income))
    db.set_setting("tax_state_rate", str(body.state_rate))
    db.set_setting("tax_carryover", str(body.carryover))
    return report()


@router.put("/api/taxes/trades/{trade_id}")
def put_trade_cost(trade_id: int, body: CostIn):
    with db.conn() as c:
        if not c.execute("SELECT 1 FROM trades WHERE id=?", (trade_id,)).fetchone():
            raise HTTPException(404, "Trade not found")
        if body.cost is None or body.cost <= 0:
            c.execute("DELETE FROM tax_trade_cost WHERE trade_id=?", (trade_id,))
        else:
            c.execute("INSERT INTO tax_trade_cost (trade_id, cost) VALUES (?, ?) "
                      "ON CONFLICT(trade_id) DO UPDATE SET cost=excluded.cost", (trade_id, body.cost))
    return {"ok": True}


@router.put("/api/taxes/holdings/{holding_id}")
def put_holding_date(holding_id: int, body: AcquiredIn):
    with db.conn() as c:
        if not c.execute("SELECT 1 FROM holdings WHERE id=?", (holding_id,)).fetchone():
            raise HTTPException(404, "Holding not found")
        if not body.acquired:
            c.execute("DELETE FROM tax_holding_dates WHERE holding_id=?", (holding_id,))
        else:
            acq = _check_date(body.acquired, "acquired")
            c.execute("INSERT INTO tax_holding_dates (holding_id, acquired) VALUES (?, ?) "
                      "ON CONFLICT(holding_id) DO UPDATE SET acquired=excluded.acquired", (holding_id, acq))
    return {"ok": True}


@router.post("/api/taxes/sales")
def add_sale(body: SaleIn):
    symbol = body.symbol.strip().upper()
    if not symbol:
        raise HTTPException(400, "symbol required")
    if body.kind not in ("stock", "crypto", "option"):
        raise HTTPException(400, "kind must be stock, crypto or option")
    acquired, sold = _check_date(body.acquired, "acquired"), _check_date(body.sold, "sold")
    if _d(sold) < _d(acquired):
        raise HTTPException(400, "sold can't be before acquired")
    if body.proceeds < 0 or body.cost < 0:
        raise HTTPException(400, "proceeds and cost can't be negative")
    if body.qty is not None and body.qty <= 0:
        raise HTTPException(400, "qty must be positive")
    with db.conn() as c:
        cur = c.execute(
            "INSERT INTO tax_sales (symbol, kind, qty, acquired, sold, proceeds, cost, account, note, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (symbol, body.kind, body.qty, acquired, sold, body.proceeds, body.cost,
             body.account.strip(), body.note.strip(), db.utcnow()))
        return dict(c.execute("SELECT * FROM tax_sales WHERE id=?", (cur.lastrowid,)).fetchone())


@router.delete("/api/taxes/sales/{sale_id}")
def delete_sale(sale_id: int):
    with db.conn() as c:
        if c.execute("DELETE FROM tax_sales WHERE id=?", (sale_id,)).rowcount == 0:
            raise HTTPException(404, "Sale not found")
    return {"ok": True}
