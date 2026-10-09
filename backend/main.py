"""Trading Terminal API — FastAPI backend.

Run:  uvicorn main:app --reload --port 8000   (from the backend/ directory)

Brings together:
  - Trade tracker, signal log, key levels, portfolio (SQLite)
  - News + Claude sentiment (claude-sonnet-5-5)
  - TradingView webhook (POST /webhook) for direct alerts
  - Telegram poller (background thread) for TFlab-forwarded alerts + close commands
  - POST /api/evaluate — Claude confluence check (the future Toobit bot calls this)
"""

import json
import os
import threading
import contextvars
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Load the repo-root .env regardless of where uvicorn is launched from
load_dotenv(Path(__file__).parent.parent / ".env")
load_dotenv()  # also pick up a local backend/.env if present

import auth
import charts
import claude_ai
import db
import econ_calendar
import market_data
import news
import risk
import scoring
import universe

WATCHLIST_FILE = Path(__file__).parent / "watchlist.json"
DEFAULT_WATCHLIST = ["BTC", "SOL", "SOFI", "MSFT", "RDW"]

# Editable market-screener lists (gitignored JSON, same pattern as the watchlist).
STOCKS_FILE = Path(__file__).parent / "screener_stocks.json"
OPTIONS_FILE = Path(__file__).parent / "options_stocks.json"
SCORE_ALERTS_FILE = Path(__file__).parent / "score_alerts.json"
DEFAULT_STOCKS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD",
                  "AVGO", "CRM", "NFLX", "ADBE", "ORCL", "QCOM", "INTC"]
DEFAULT_OPTIONS = ["SOFI", "RDW", "MSFT", "NVDA", "AMD", "PLTR", "HOOD", "COIN"]


def _load_list(path: Path, default: list[str]) -> list[str]:
    if path.exists():
        try:
            return json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return default[:]


def _save_list(path: Path, symbols: list[str]) -> list[str]:
    cleaned = [s.upper().strip() for s in symbols if s.strip()]
    path.write_text(json.dumps(cleaned))
    return cleaned

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")


# ── Watchlist ─────────────────────────────────────────────

def load_watchlist() -> list[str]:
    if WATCHLIST_FILE.exists():
        return json.loads(WATCHLIST_FILE.read_text())
    return DEFAULT_WATCHLIST[:]


def save_watchlist(symbols: list[str]):
    WATCHLIST_FILE.write_text(json.dumps(symbols))


# ── Telegram ──────────────────────────────────────────────

def tg_send(text: str):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "Markdown"},
            timeout=5,
        )
    except Exception as e:
        print(f"[telegram] send error: {e}")


def evaluate_signal_async(signal_id: int):
    """Run Claude's confluence check on a signal and store the verdict (the edge test).

    Runs in a background thread so the webhook/Telegram path stays fast. Pings the
    verdict to Telegram once it's ready.
    """
    try:
        sig = next((s for s in db.list_signals(50) if s["id"] == signal_id), None)
        if not sig:
            return
        recent = db.recent_confluence(sig["asset"], sig["direction"])
        verdict = claude_ai.evaluate_signal(sig, recent, db.list_levels())
        db.set_signal_ai_verdict(signal_id, verdict)

        # Paper-trade simulator: auto-open a virtual trade on every AI-approved signal.
        if verdict.get("take_trade") and verdict.get("suggested_sl") and verdict.get("suggested_tp1") and sig.get("price"):
            direction = "long" if sig["direction"] == "buy" else "short"
            sim = db.create_sim_trade(signal_id, sig["asset"], direction,
                                      sig["price"], verdict["suggested_sl"], verdict["suggested_tp1"])
            if sim:
                tg_send(f"🧪 *Sim bot opened #{sim['id']}* — {sig['asset']} {direction.upper()} @ "
                        f"`{sig['price']}` (SL `{sim['sl']}` / TP `{sim['tp1']}`)")

        if claude_ai.get_client() is not None:
            mark = "✅ TAKE" if verdict.get("take_trade") else "⏭ SKIP"
            reasons = verdict.get("reasons") or verdict.get("warnings") or []
            tg_send(
                f"🤖 *AI verdict — Signal #{signal_id}*: {mark} "
                f"(score {verdict.get('confluence_score')}/10, {verdict.get('confidence')})\n"
                + ("\n".join(f"• {r}" for r in reasons[:3]) if reasons else "")
            )
    except Exception as e:
        print(f"[evaluate] signal {signal_id} error: {e}")


def handle_incoming_signal(data: dict, source: str):
    """Shared path for TradingView webhook + Telegram-forwarded alerts."""
    sig = db.log_signal(data)
    confluence = db.recent_confluence(sig["asset"], sig["direction"])
    other_indicators = {s["indicator"] for s in confluence if s["id"] != sig["id"]}
    has_confluence = len(other_indicators - {sig["indicator"]}) > 0

    flag = "🔥 *CONFLUENCE* — both indicators agree!" if has_confluence else "Single indicator — watch for confluence."
    tg_send(
        f"📡 *Signal #{sig['id']}* ({source})\n"
        f"{'🟢' if sig['direction'] == 'buy' else '🔴'} *{sig['direction'].upper()}* {sig['asset']} `{sig['timeframe']}`\n"
        f"Indicator: *{sig['indicator'].capitalize()}* | Conviction: *{sig['conviction']}*\n"
        f"Price: `{sig['price']}`\n{flag}\n\n"
        f"Open the dashboard to take it or log a skip reason."
    )
    # Fire the AI confluence check in the background (the edge test).
    threading.Thread(target=evaluate_signal_async, args=(sig["id"],), daemon=True).start()
    return sig


def telegram_poll_loop():
    last_update_id = 0
    print("[telegram] poller started")
    while True:
        try:
            resp = requests.get(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates",
                params={"offset": last_update_id + 1, "timeout": 20},
                timeout=30,
            )
            for update in resp.json().get("result", []):
                last_update_id = update["update_id"]
                text = (update.get("message", {}).get("text") or "").strip()
                if not text:
                    continue
                print(f"[telegram] {text[:80]}")
                handle_telegram_message(text)
        except Exception as e:
            print(f"[telegram] poll error: {e}")
            time.sleep(10)
        time.sleep(2)


def handle_telegram_message(text: str):
    # TradingView JSON forwarded into the chat by the TFlab bot
    if text.startswith("{"):
        try:
            handle_incoming_signal(json.loads(text), source="telegram")
        except json.JSONDecodeError:
            tg_send("⚠️ Couldn't parse signal JSON — check the TradingView alert message format.")
        return

    parts = text.lower().split()
    if parts and parts[0] == "close" and len(parts) >= 3:
        # close <trade_id> <exit_price> [notes...]
        try:
            trade = db.close_trade(int(parts[1]), float(parts[2]), " ".join(parts[3:]))
        except ValueError:
            trade = None
        if trade:
            stats = db.trade_stats()
            emoji = "✅" if trade["outcome"] == "win" else ("❌" if trade["outcome"] == "loss" else "➖")
            tg_send(
                f"{emoji} *Trade #{trade['id']} closed — {trade['outcome'].upper()}*\n"
                f"{trade['asset']} {trade['direction'].upper()} | P&L: `{trade['pnl_pct']}%`\n\n"
                f"📊 Record: {stats['wins']}W/{stats['losses']}L — {stats['win_rate']}% | "
                f"Total P&L: {stats['total_pnl_pct']}%"
            )
        else:
            tg_send("❌ Trade not found or already closed. Format: `close <id> <exit_price> [notes]`")
        return

    if parts and parts[0] == "status":
        s = db.trade_stats()
        tg_send(
            f"📊 *Terminal Status*\n"
            f"Open: {s['open_trades']} | Closed: {s['closed']}\n"
            f"Record: {s['wins']}W/{s['losses']}L — {s['win_rate']}%\n"
            f"Total P&L: {s['total_pnl_pct']}% | Avg RR: {s['avg_rr']}"
        )
        return

    tg_send(
        "📖 *Commands:*\n"
        "`status` — current record\n"
        "`close <trade_id> <exit_price> [notes]` — close a trade\n"
        "TradingView JSON alerts are logged automatically."
    )


# ── Score alerts ──────────────────────────────────────────

ALERT_BANDS = {"accumulate", "overbought"}
ALERT_INTERVAL = 30 * 60  # seconds between score sweeps


def _band_message(item: dict) -> str:
    icon = "🟢" if item["band"] == "accumulate" else "🔴"
    verb = "entered ACCUMULATE zone" if item["band"] == "accumulate" else "is now EXTREMELY OVERBOUGHT"
    return (f"{icon} *{item['symbol']}* {verb}\n"
            f"Long-term score: *{item['score']}* ({item['label']}) · {item['kind']}")


def score_alert_loop():
    """Ping Telegram when a watched asset newly crosses into Accumulate / Overbought.

    First run with no saved state seeds silently (no startup spam); thereafter only
    band *transitions* into a noteworthy band alert.
    """
    print("[alerts] score-alert sweeper started")
    seeding = not SCORE_ALERTS_FILE.exists()
    while True:
        try:
            saved = json.loads(SCORE_ALERTS_FILE.read_text()) if SCORE_ALERTS_FILE.exists() else {}
            current: dict[str, str] = {}
            for a in gather_scored_assets():
                if a["score"] is None:
                    continue
                b = scoring.band(a["score"])
                current[a["symbol"]] = b
                if seeding:
                    continue
                if b in ALERT_BANDS and saved.get(a["symbol"]) != b:
                    tg_send(_band_message({**a, "band": b}))
            # Preserve bands for symbols we couldn't score this cycle.
            merged = {**saved, **current}
            SCORE_ALERTS_FILE.write_text(json.dumps(merged))
            seeding = False
        except Exception as e:
            print(f"[alerts] sweep error: {e}")
        time.sleep(ALERT_INTERVAL)


# ── Paper-trade simulator marking ─────────────────────────

SIM_INTERVAL = 5 * 60  # seconds between price marks


def sim_mark_loop():
    """Close virtual trades when price hits their SL or TP1 (the emotionless bot, on paper)."""
    print("[sim] paper-trade marker started")
    while True:
        try:
            for t in db.open_sim_trades():
                price = market_data.spot_price(t["asset"])
                if price is None:
                    continue
                hit = None
                if t["direction"] == "long":
                    if price <= t["sl"]:
                        hit = (t["sl"], "loss")
                    elif price >= t["tp1"]:
                        hit = (t["tp1"], "win")
                else:  # short
                    if price >= t["sl"]:
                        hit = (t["sl"], "loss")
                    elif price <= t["tp1"]:
                        hit = (t["tp1"], "win")
                if hit:
                    closed = db.close_sim_trade(t["id"], hit[0], hit[1])
                    if closed:
                        emoji = "✅" if hit[1] == "win" else "❌"
                        tg_send(f"🧪 {emoji} *Sim #{closed['id']} closed — {hit[1].upper()}* "
                                f"{closed['asset']} | {closed['r_multiple']}R ({closed['pnl_pct']}%)")
        except Exception as e:
            print(f"[sim] mark error: {e}")
        time.sleep(SIM_INTERVAL)


# ── Net worth auto-snapshot ───────────────────────────────

NETWORTH_INTERVAL = 60 * 60  # seconds


def networth_snapshot_loop():
    """Hourly upsert of today's snapshot so live-priced holdings draw the chart on their own."""
    print("[networth] auto-snapshot started")
    while True:
        try:
            # Anything tracked → keep today's point current (also corrects it after deletions).
            if db.list_holdings() or db.list_accounts():
                db.take_snapshot(valued_holdings()["value"])
        except Exception as e:
            print(f"[networth] snapshot error: {e}")
        time.sleep(NETWORTH_INTERVAL)


# ── Cache warmer ──────────────────────────────────────────
# Refreshes every dataset before its cache expires, so page loads never wait on
# Yahoo / CoinGecko / news feeds. (Cold, Swing Ideas took ~14s and earnings ~18s.)

# Each tier runs in its own thread. A tier refreshes entries older than factor×TTL every
# `every` seconds, so the oldest a user ever sees is about factor×TTL + every + job time.
# That has to stay under the shortest TTL in the tier:
#   holdings  : quotes TTL 180s  -> 0.5×180 + 60  + ~5s  ≈ 155s
#   markets   : min TTL 300s     -> 0.4×300 + 120 + ~10s ≈ 250s
#   screeners : min TTL 3600s    -> 0.5×3600 + 900 + ~35s ≈ 2735s
WARM_TIERS = [
    # (label, every seconds, ttl factor, jobs)
    ("holdings", 60, 0.5, [lambda: valued_holdings()]),
    ("markets", 120, 0.4, [lambda: markets_crypto(), lambda: markets_top_buys(), lambda: markets_narratives(),
                           lambda: context_crypto(), lambda: get_news(refresh=False)]),
    ("screeners", 900, 0.5, [lambda: markets_discover(), lambda: markets_stocks(),
                             lambda: markets_options_watch(), lambda: markets_earnings(),
                             lambda: get_portfolio_chart("3M"), lambda: get_portfolio_chart("1Y"),
                             lambda: get_portfolio_chart("5Y")]),
    # charts: 1D TTL 300s -> 0.4×300 + 120 + ~15s ≈ 255s; 1W/1M (TTL ≥ 1800s) ride along
    ("charts", 120, 0.4, [lambda: get_portfolio_sparks(), lambda: get_portfolio_chart("1D"),
                          lambda: get_portfolio_chart("1W"), lambda: get_portfolio_chart("1M")]),
]


def cache_warmer_loop(label: str, every: int, factor: float, jobs: list):
    print(f"[warm] {label} warmer started (every {every}s)")
    while True:
        t0 = time.time()
        with market_data.refreshing(factor):
            for job in jobs:
                try:
                    job()
                except Exception as e:
                    print(f"[warm] {label} job error: {e}")
        took = time.time() - t0
        if took > 2:
            print(f"[warm] {label} refreshed in {took:.1f}s")
        time.sleep(max(5.0, every - took))


# ── App setup ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    if not auth.enabled():
        print("[auth] " + "!" * 60)
        print("[auth] APP_PASSWORD_HASH not set — LOGIN DISABLED. Fine on localhost,")
        print("[auth] never expose this server. Generate one: python auth.py hash-password")
        print("[auth] " + "!" * 60)
    elif not auth.webhook_secret():
        print("[auth] WEBHOOK_SECRET not set — /webhook will reject all alerts")
    threading.Thread(target=sim_mark_loop, daemon=True).start()
    threading.Thread(target=networth_snapshot_loop, daemon=True).start()
    for label, every, factor, jobs in WARM_TIERS:
        threading.Thread(target=cache_warmer_loop, args=(label, every, factor, jobs), daemon=True).start()
    if TELEGRAM_BOT_TOKEN:
        threading.Thread(target=telegram_poll_loop, daemon=True).start()
        threading.Thread(target=score_alert_loop, daemon=True).start()
    else:
        print("[telegram] TELEGRAM_BOT_TOKEN not set — poller + alerts disabled")
    yield


app = FastAPI(title="Trading Terminal API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes reachable without a session: the login flow itself. /webhook has its own secret.
AUTH_OPEN = {"/api/auth/login", "/api/auth/logout", "/api/auth/check"}


@app.middleware("http")
async def require_session(request: Request, call_next):
    path = request.url.path
    if auth.enabled() and path.startswith("/api/") and path not in AUTH_OPEN:
        if not auth.valid_token(request.cookies.get(auth.COOKIE_NAME)):
            return JSONResponse({"detail": "Not signed in"}, status_code=401)
    return await call_next(request)


class LoginIn(BaseModel):
    password: str


@app.post("/api/auth/login")
def auth_login(body: LoginIn, request: Request, response: Response):
    if not auth.enabled():
        return {"ok": True, "auth": False}
    ip = auth.client_ip(request.headers, request.client.host if request.client else "?")
    if auth.locked_out(ip):
        raise HTTPException(429, "Too many attempts — wait 15 minutes")
    if not auth.verify_password(body.password, auth.password_hash()):
        auth.record_failure(ip)
        raise HTTPException(401, "Wrong password")
    auth.clear_failures(ip)
    response.set_cookie(
        auth.COOKIE_NAME, auth.issue_token(), max_age=auth.SESSION_TTL,
        httponly=True, secure=auth.cookie_secure(), samesite="lax", path="/",
    )
    return {"ok": True, "auth": True}


@app.post("/api/auth/logout")
def auth_logout(response: Response):
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/auth/check")
def auth_check(request: Request):
    """200 when signed in (or auth is off); 401 otherwise. Used by the Next middleware."""
    if auth.enabled() and not auth.valid_token(request.cookies.get(auth.COOKIE_NAME)):
        raise HTTPException(401, "Not signed in")
    return {"ok": True, "auth": auth.enabled()}


# ── Models ────────────────────────────────────────────────

class TradeIn(BaseModel):
    asset: str
    direction: str
    entry: float
    sl: float
    tp1: float | None = None
    tp2: float | None = None
    tp3: float | None = None
    risk_pct: float = 1.0
    signal_source: str = "manual"
    liquidity_sweep: bool = False
    htf_aligned: bool = False
    notes: str = ""
    signal_id: int | None = None


class CloseIn(BaseModel):
    exit_price: float
    notes: str = ""


class PartialIn(BaseModel):
    pct: float
    price: float
    level: str = ""


class SignalPatch(BaseModel):
    taken: bool | None = None
    skip_reason: str | None = None
    outcome: str | None = None


class LevelIn(BaseModel):
    asset: str
    price: float
    label: str = ""
    kind: str = "liquidity"


class PositionIn(BaseModel):
    asset: str
    kind: str = "crypto"
    qty: float
    entry: float
    current: float | None = None
    strike: float | None = None
    expiry: str | None = None
    notes: str = ""


class PositionPatch(BaseModel):
    qty: float | None = None
    entry: float | None = None
    current: float | None = None
    strike: float | None = None
    expiry: str | None = None
    notes: str | None = None


class WatchlistIn(BaseModel):
    symbols: list[str]


class AccountIn(BaseModel):
    name: str
    category: str = "cash"
    kind: str = "asset"
    balance: float = 0


class HoldingIn(BaseModel):
    symbol: str
    kind: str = "crypto"
    qty: float
    cost_basis: float | None = None
    label: str = ""


class ContributionIn(BaseModel):
    account: str
    bucket: str = "retirement"
    amount: float
    employer_match: float = 0
    frequency: str = "monthly"
    plan_type: str = "other"
    match_max: float | None = None


class ContributionPatch(BaseModel):
    account: str | None = None
    bucket: str | None = None
    amount: float | None = None
    employer_match: float | None = None
    frequency: str | None = None
    plan_type: str | None = None
    match_max: float | None = None


class SettingsIn(BaseModel):
    monthly_expenses: float | None = None


class HoldingPatch(BaseModel):
    symbol: str | None = None
    kind: str | None = None
    qty: float | None = None
    cost_basis: float | None = None
    label: str | None = None


class AccountPatch(BaseModel):
    name: str | None = None
    category: str | None = None
    kind: str | None = None
    balance: float | None = None


class TransactionIn(BaseModel):
    date: str | None = None
    category: str
    amount: float
    kind: str = "expense"
    note: str = ""


class BudgetIn(BaseModel):
    category: str
    monthly_limit: float


# ── Trades ────────────────────────────────────────────────

@app.get("/api/trades")
def get_trades(asset: str | None = None, status: str | None = None,
               outcome: str | None = None, signal_source: str | None = None):
    return db.list_trades({"asset": asset, "status": status,
                           "outcome": outcome, "signal_source": signal_source})


@app.post("/api/trades")
def post_trade(trade: TradeIn):
    return db.create_trade(trade.model_dump())


@app.post("/api/trades/{trade_id}/close")
def post_close(trade_id: int, body: CloseIn):
    trade = db.close_trade(trade_id, body.exit_price, body.notes)
    if not trade:
        raise HTTPException(404, "Trade not found or already closed")
    return trade


@app.post("/api/trades/{trade_id}/partial")
def post_partial(trade_id: int, body: PartialIn):
    trade = db.add_partial(trade_id, body.pct, body.price, body.level)
    if not trade:
        raise HTTPException(404, "Trade not found or already closed")
    return trade


@app.delete("/api/trades/{trade_id}")
def remove_trade(trade_id: int):
    if not db.delete_trade(trade_id):
        raise HTTPException(404, "Trade not found")
    return {"ok": True}


@app.get("/api/stats")
def get_stats():
    return db.trade_stats()


@app.get("/api/analytics")
def get_analytics():
    return db.analytics()


# ── Signals ───────────────────────────────────────────────

@app.get("/api/signals")
def get_signals(limit: int = 200):
    return db.list_signals(limit)


@app.patch("/api/signals/{signal_id}")
def patch_signal(signal_id: int, body: SignalPatch):
    sig = db.update_signal(signal_id, {k: v for k, v in body.model_dump().items() if v is not None})
    if not sig:
        raise HTTPException(404, "Signal not found")
    return sig


# ── Levels ────────────────────────────────────────────────

@app.get("/api/levels")
def get_levels():
    return db.list_levels()


@app.post("/api/levels")
def post_level(level: LevelIn):
    return db.create_level(level.model_dump())


@app.delete("/api/levels/{level_id}")
def remove_level(level_id: int):
    if not db.delete_level(level_id):
        raise HTTPException(404, "Level not found")
    return {"ok": True}


# ── Positions ─────────────────────────────────────────────

@app.get("/api/positions")
def get_positions():
    return db.list_positions()


@app.post("/api/positions")
def post_position(pos: PositionIn):
    return db.create_position(pos.model_dump())


@app.patch("/api/positions/{pos_id}")
def patch_position(pos_id: int, body: PositionPatch):
    pos = db.update_position(pos_id, {k: v for k, v in body.model_dump().items() if v is not None})
    if not pos:
        raise HTTPException(404, "Position not found")
    return pos


@app.delete("/api/positions/{pos_id}")
def remove_position(pos_id: int):
    if not db.delete_position(pos_id):
        raise HTTPException(404, "Position not found")
    return {"ok": True}


# ── Net worth ─────────────────────────────────────────────

@app.get("/api/accounts")
def get_accounts():
    return {"accounts": db.list_accounts(), "totals": db.networth_totals(valued_holdings()["value"])}


OPTION_MULTIPLIER = 100


def option_display(occ: str) -> str:
    """AMZN271217C00260000 -> 'AMZN $260C 12/17/27' (falls back to the raw symbol)."""
    import re
    m = re.fullmatch(r"([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})", occ.upper())
    if not m:
        return occ
    root, yy, mm, dd, cp, strike = m.groups()
    k = int(strike) / 1000
    return f"{root} ${k:g}{cp} {int(mm)}/{int(dd)}/{yy}"


def valued_holdings() -> dict:
    """Every holding marked to live prices, plus portfolio-level totals."""
    rows = db.list_holdings()
    ctxs = [contextvars.copy_context() for _ in rows]  # carry the warmer's TTL factor into workers
    with ThreadPoolExecutor(max_workers=8) as pool:
        quotes = list(pool.map(lambda pair: pair[0].run(market_data.live_quote, pair[1]["symbol"], pair[1]["kind"]),
                               zip(ctxs, rows)))
    out, value, prev_value, cost = [], 0.0, 0.0, 0.0
    for h, q in zip(rows, quotes):
        price = q["price"]
        mult = OPTION_MULTIPLIER if h["kind"] == "option" else 1
        val = h["qty"] * price * mult if price is not None else None
        pnl = (val - h["qty"] * h["cost_basis"] * mult) if val is not None and h["cost_basis"] else None
        if val is not None:
            value += val
            chg = q["change_1d"]
            prev_value += val / (1 + chg / 100) if chg is not None else val
            if h["cost_basis"]:
                cost += h["qty"] * h["cost_basis"] * mult
        out.append({**h, "price": price, "change_1d": q["change_1d"], "multiplier": mult,
                    "display": option_display(h["symbol"]) if h["kind"] == "option" else h["symbol"],
                    "value": round(val, 2) if val is not None else None,
                    "pnl": round(pnl, 2) if pnl is not None else None})
    out.sort(key=lambda r: r["value"] or 0, reverse=True)
    return {
        "holdings": out,
        "value": round(value, 2),
        "change_1d": round(value - prev_value, 2),
        "change_1d_pct": round((value / prev_value - 1) * 100, 2) if prev_value else None,
    }


@app.get("/api/holdings")
def get_holdings():
    return valued_holdings()


CHART_RANGES = tuple(charts.RANGES)


@app.get("/api/chart/{kind}/{symbol}")
def get_asset_chart(kind: str, symbol: str, range: str = "1D"):
    if kind not in ("crypto", "stock", "option") or range not in CHART_RANGES:
        raise HTTPException(400, f"kind crypto|stock|option, range one of {CHART_RANGES}")
    return charts.asset_chart(kind, symbol.upper(), range)


@app.get("/api/portfolio/chart")
def get_portfolio_chart(range: str = "1D"):
    if range not in CHART_RANGES:
        raise HTTPException(400, f"range one of {CHART_RANGES}")
    return charts.portfolio_chart(valued_holdings()["holdings"], range)


NW_RANGES = {"LIVE": "LIVE", "1D": "1D", "1W": "1W", "1M": "1M", "1Y": "1Y", "ALL": "5Y"}


@app.get("/api/networth/chart")
def get_networth_chart(range: str = "1D"):
    """Net worth over time = live holdings priced over the range + manual balances − debts.
    1Y/ALL are back-calculated from today's holdings (recorded history is short)."""
    if range not in NW_RANGES:
        raise HTTPException(400, f"range one of {list(NW_RANGES)}")
    accounts = db.list_accounts()
    manual = sum(a["balance"] for a in accounts if a["kind"] == "asset") -         sum(a["balance"] for a in accounts if a["kind"] == "liability")
    out = charts.portfolio_chart(valued_holdings()["holdings"], NW_RANGES[range], offset=manual)
    snaps = db.list_snapshots()
    out["backfilled"] = range in ("1Y", "ALL")
    out["history_since"] = snaps[0]["date"] if snaps else None
    return out


@app.get("/api/portfolio/sparks")
def get_portfolio_sparks():
    return charts.sparks(valued_holdings()["holdings"])


@app.post("/api/holdings")
def post_holding(h: HoldingIn):
    if h.kind not in ("crypto", "stock", "option"):
        raise HTTPException(400, "kind must be 'crypto', 'stock' or 'option'")
    return db.create_holding(h.model_dump())


@app.patch("/api/holdings/{h_id}")
def patch_holding(h_id: int, body: HoldingPatch):
    h = db.update_holding(h_id, {k: v for k, v in body.model_dump().items() if v is not None})
    if not h:
        raise HTTPException(404, "Holding not found")
    return h


@app.delete("/api/holdings/{h_id}")
def remove_holding(h_id: int):
    if not db.delete_holding(h_id):
        raise HTTPException(404, "Holding not found")
    return {"ok": True}


@app.post("/api/accounts")
def post_account(acc: AccountIn):
    return db.create_account(acc.model_dump())


@app.patch("/api/accounts/{acc_id}")
def patch_account(acc_id: int, body: AccountPatch):
    acc = db.update_account(acc_id, {k: v for k, v in body.model_dump().items() if v is not None})
    if not acc:
        raise HTTPException(404, "Account not found")
    return acc


@app.delete("/api/accounts/{acc_id}")
def remove_account(acc_id: int):
    if not db.delete_account(acc_id):
        raise HTTPException(404, "Account not found")
    return {"ok": True}


@app.get("/api/contributions")
def get_contributions():
    rows = db.list_contributions()
    by_bucket: dict[str, float] = {}
    for r in rows:
        by_bucket[r["bucket"]] = round(by_bucket.get(r["bucket"], 0) + r["monthly"] + r["monthly_match"], 2)
    return {
        "contributions": rows,
        "monthly_you": round(sum(r["monthly"] for r in rows), 2),
        "monthly_match": round(sum(r["monthly_match"] for r in rows), 2),
        "by_bucket": by_bucket,
    }


@app.post("/api/contributions")
def post_contribution(body: ContributionIn):
    if body.frequency not in db.PERIODS_PER_MONTH:
        raise HTTPException(400, f"frequency must be one of {list(db.PERIODS_PER_MONTH)}")
    return db.create_contribution(body.model_dump())


@app.patch("/api/contributions/{c_id}")
def patch_contribution(c_id: int, body: ContributionPatch):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if fields.get("match_max") == 0:
        fields["match_max"] = None
    row = db.update_contribution(c_id, fields)
    if not row:
        raise HTTPException(404, "Contribution not found")
    return row


@app.delete("/api/contributions/{c_id}")
def remove_contribution(c_id: int):
    if not db.delete_contribution(c_id):
        raise HTTPException(404, "Contribution not found")
    return {"ok": True}


@app.get("/api/networth/risk")
def get_networth_risk():
    """Risk rating over everything tracked. Uses logged spending (this or last month) for the cash cushion."""
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    last = (now.replace(day=1) - timedelta(days=1))
    expenses = None
    for m in (now.strftime("%Y-%m"), last.strftime("%Y-%m")):
        e = db.budget_summary(m)["expenses"]
        if e > 0:
            expenses = max(expenses or 0, e)
    if expenses is None:  # fall back to the user's own estimate
        est = db.get_setting("monthly_expenses")
        expenses = float(est) if est else None
    return risk.rate(valued_holdings()["holdings"], db.list_accounts(), expenses)


@app.get("/api/settings")
def get_settings():
    est = db.get_setting("monthly_expenses")
    return {"monthly_expenses": float(est) if est else None}


@app.put("/api/settings")
def put_settings(body: SettingsIn):
    v = body.monthly_expenses
    db.set_setting("monthly_expenses", str(v) if v and v > 0 else None)
    return get_settings()


@app.post("/api/networth/snapshot")
def post_snapshot():
    return db.take_snapshot(valued_holdings()["value"])


@app.get("/api/networth/history")
def get_networth_history():
    return db.list_snapshots()


# ── Budget ────────────────────────────────────────────────

@app.get("/api/budget/summary")
def get_budget_summary(month: str | None = None):
    from datetime import datetime, timezone
    if not month:
        month = datetime.now(timezone.utc).strftime("%Y-%m")
    return db.budget_summary(month)


@app.post("/api/transactions")
def post_transaction(tx: TransactionIn):
    return db.create_transaction(tx.model_dump())


@app.delete("/api/transactions/{tx_id}")
def remove_transaction(tx_id: int):
    if not db.delete_transaction(tx_id):
        raise HTTPException(404, "Transaction not found")
    return {"ok": True}


@app.put("/api/budgets")
def put_budget(body: BudgetIn):
    db.set_budget(body.category, body.monthly_limit)
    return {"ok": True}


@app.delete("/api/budgets/{category}")
def remove_budget(category: str):
    db.delete_budget(category)
    return {"ok": True}


# ── Watchlist ─────────────────────────────────────────────

@app.get("/api/watchlist")
def get_watchlist():
    return {"symbols": load_watchlist()}


@app.put("/api/watchlist")
def put_watchlist(body: WatchlistIn):
    symbols = [s.upper().strip() for s in body.symbols if s.strip()]
    save_watchlist(symbols)
    news.clear_cache()
    return {"symbols": symbols}


# Editable screener lists (stocks + options watch)

@app.get("/api/watchlist/stocks")
def get_stocks_watchlist():
    return {"symbols": _load_list(STOCKS_FILE, DEFAULT_STOCKS)}


@app.put("/api/watchlist/stocks")
def put_stocks_watchlist(body: WatchlistIn):
    return {"symbols": _save_list(STOCKS_FILE, body.symbols)}


@app.get("/api/watchlist/options")
def get_options_watchlist():
    return {"symbols": _load_list(OPTIONS_FILE, DEFAULT_OPTIONS)}


@app.put("/api/watchlist/options")
def put_options_watchlist(body: WatchlistIn):
    return {"symbols": _save_list(OPTIONS_FILE, body.symbols)}


# ── Market intelligence (free data) ───────────────────────

@app.get("/api/markets/crypto")
def markets_crypto():
    return {"coins": market_data.crypto_markets(15)}


@app.get("/api/markets/narratives")
def markets_narratives():
    return {"narratives": market_data.crypto_categories(12)}


@app.get("/api/markets/stocks")
def markets_stocks():
    symbols = _load_list(STOCKS_FILE, DEFAULT_STOCKS)
    return {"stocks": [market_data.stock_score(s) for s in symbols]}


@app.get("/api/markets/options-watch")
def markets_options_watch():
    symbols = _load_list(OPTIONS_FILE, DEFAULT_OPTIONS)
    out = []
    for sym in symbols:
        score = market_data.stock_score(sym)
        signals = [s for s in db.list_signals(200) if s["asset"] == sym][:6]
        indicators = {s["indicator"] for s in signals}
        out.append({
            **score,
            "signals": signals,
            "has_confluence": len(indicators & {"neurowave", "kryptonite"}) >= 2,
        })
    return {"stocks": out}


@app.get("/api/markets/earnings")
def markets_earnings():
    # Earnings for both the tech screener and the options watch (deduped).
    symbols = list(dict.fromkeys(
        _load_list(OPTIONS_FILE, DEFAULT_OPTIONS) + _load_list(STOCKS_FILE, DEFAULT_STOCKS)
    ))
    rows = [market_data.stock_earnings(s) for s in symbols]
    rows = [r for r in rows if r]
    # Soonest dated first; undated last.
    rows.sort(key=lambda r: (r.get("next_earnings") is None, r.get("next_earnings") or ""))
    return {"earnings": rows}


def gather_scored_assets() -> list[dict]:
    """Unified scored list across crypto + watched stocks (for Top Buys + alerts).

    Each item: {kind, id, symbol, price, score, label}. `id` is what the history
    chart needs (CoinGecko coin id for crypto, ticker for stocks).
    """
    assets: list[dict] = []
    for c in market_data.crypto_markets(15):
        sc = c.get("score")
        assets.append({
            "kind": "crypto", "id": c["id"], "symbol": c["symbol"], "price": c.get("price"),
            "score": sc["score"] if sc else None, "label": sc["label"] if sc else None,
        })
    stock_syms = list(dict.fromkeys(
        _load_list(STOCKS_FILE, DEFAULT_STOCKS) + _load_list(OPTIONS_FILE, DEFAULT_OPTIONS)
    ))
    for sym in stock_syms:
        s = market_data.stock_score(sym)
        sc = s.get("score")
        assets.append({
            "kind": "stock", "id": sym, "symbol": sym, "price": s.get("price"),
            "score": sc["score"] if sc else None, "label": sc["label"] if sc else None,
        })
    return assets


@app.get("/api/context/crypto")
def context_crypto():
    return market_data.crypto_context()


@app.get("/api/context/calendar")
def context_calendar():
    return {"events": econ_calendar.upcoming(45)}


@app.get("/api/markets/top-buys")
def markets_top_buys(min_score: float = 0):
    scored = [a for a in gather_scored_assets() if a["score"] is not None and a["score"] >= min_score]
    scored.sort(key=lambda a: a["score"], reverse=True)
    return {"assets": scored}


@app.get("/api/markets/discover")
def markets_discover():
    """Swing Ideas: the curated sector universe, scored + momentum, best score first."""
    market_data.prefetch_stock_histories(universe.all_tickers())
    watched = set(_load_list(OPTIONS_FILE, DEFAULT_OPTIONS))
    rows = []
    for sector, names in universe.SECTORS.items():
        for sym, name in names:
            s = market_data.stock_score(sym)
            sc = s.get("score") if s else None
            rows.append({
                "kind": "stock", "id": sym, "symbol": sym, "name": name, "sector": sector,
                "price": s.get("price") if s else None,
                "score": sc["score"] if sc else None, "label": sc["label"] if sc else None,
                "watched": sym in watched,
                **market_data.stock_momentum(sym),
            })
    rows.sort(key=lambda r: (r["score"] is None, -(r["score"] or 0)))
    return {"sectors": list(universe.SECTORS), "stocks": rows}


@app.get("/api/markets/history/{kind}/{key_id}")
def markets_history(kind: str, key_id: str):
    if kind not in ("crypto", "stock"):
        raise HTTPException(400, "kind must be 'crypto' or 'stock'")
    return market_data.history_with_scores(kind, key_id)


@app.get("/api/signals/edge-report")
def signals_edge_report():
    return db.edge_report()


# ── Paper-trade simulator ─────────────────────────────────

@app.get("/api/sim/trades")
def sim_trades():
    return db.list_sim_trades()


@app.get("/api/sim/stats")
def sim_stats():
    return db.sim_stats()


# ── News + sentiment ──────────────────────────────────────

_sentiment_cache: dict[str, dict] = {}


@app.get("/api/news")
def get_news(refresh: bool = Query(False)):
    if refresh:
        news.clear_cache()
    watchlist = load_watchlist()
    items = news.get_news(watchlist)
    macro = news.get_macro_news()

    unscored = [h for h in items + macro if h["id"] not in _sentiment_cache]
    if unscored:
        scores = claude_ai.score_headlines(unscored)
        _sentiment_cache.update(scores)
        # Anything Claude didn't return (or no API key) gets a neutral placeholder
        for h in unscored:
            _sentiment_cache.setdefault(
                h["id"],
                {"sentiment": "neutral",
                 "summary": "" if claude_ai.get_client() else "Set ANTHROPIC_API_KEY for AI sentiment"},
            )

    def enrich(h):
        return {**h, **_sentiment_cache.get(h["id"], {"sentiment": "neutral", "summary": ""})}

    return {
        "watchlist": [enrich(h) for h in items],
        "macro": [enrich(h) for h in macro],
        "ai_enabled": claude_ai.get_client() is not None,
    }


# ── Live crypto prices (Coinbase public API, no key) ──────

@app.get("/api/prices")
def get_prices():
    out = {}
    for sym in load_watchlist():
        if sym not in ("BTC", "SOL", "ETH", "XRP", "DOGE", "ADA", "AVAX", "LINK"):
            continue
        try:
            r = requests.get(f"https://api.coinbase.com/v2/prices/{sym}-USD/spot", timeout=5)
            out[sym] = float(r.json()["data"]["amount"])
        except Exception:
            pass
    return out


# ── TradingView webhook ───────────────────────────────────

@app.post("/webhook")
async def tradingview_webhook(request: Request, token: str | None = Query(None)):
    """TradingView alert webhook. Message body should be the JSON template from SETUP.md.

    With WEBHOOK_SECRET set, the alert must carry it — either as ?token=... on the
    webhook URL or as a "secret" field in the JSON message.
    """
    try:
        data = await request.json()
    except Exception:
        body = (await request.body()).decode(errors="replace")
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            raise HTTPException(400, "Body must be JSON — check your TradingView alert message")
    if not isinstance(data, dict):
        raise HTTPException(400, "Body must be a JSON object")
    provided = token or data.pop("secret", None)
    if auth.webhook_secret():
        if not auth.webhook_ok(provided if isinstance(provided, str) else None):
            raise HTTPException(401, "Bad or missing webhook secret")
    elif auth.enabled():
        # Hosted (login on) but no secret configured: refuse rather than accept anyone's alerts.
        raise HTTPException(503, "Set WEBHOOK_SECRET in .env to accept webhooks")
    sig = handle_incoming_signal(data, source="tradingview")
    return {"ok": True, "signal_id": sig["id"]}


# ── Claude trade evaluation (future bot entry point) ──────

@app.post("/api/evaluate/{signal_id}")
def evaluate(signal_id: int):
    signals = {s["id"]: s for s in db.list_signals(500)}
    sig = signals.get(signal_id)
    if not sig:
        raise HTTPException(404, "Signal not found")
    recent = db.recent_confluence(sig["asset"], sig["direction"])
    verdict = claude_ai.evaluate_signal(sig, recent, db.list_levels())
    return {"signal": sig, "verdict": verdict}


@app.get("/")
def root():
    return {"service": "trading-terminal-api", "docs": "/docs"}
