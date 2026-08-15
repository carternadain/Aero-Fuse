"""
Trading Journal Server — NeuroWave + Kryptonite
Telegram Edition — 100% Free, No API key needed

Flow:
  TradingView alert fires
    → TFlab bot forwards JSON to your Telegram
      → This script polls Telegram for new messages
        → Logs trade to trades.json

Run: python server.py
"""

import json
import os
import time
import requests
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# ── Config ──────────────────────────────────────────────
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")   # from @BotFather
TELEGRAM_CHAT_ID   = os.getenv("TELEGRAM_CHAT_ID",   "")   # your chat/group ID
TRADES_FILE        = "trades.json"
MAX_PAPER_TRADES   = 30
POLL_INTERVAL      = 3   # seconds between Telegram checks
# ────────────────────────────────────────────────────────

last_update_id = 0   # tracks which Telegram messages we've already processed


# ── File helpers ─────────────────────────────────────────

def load_trades():
    if os.path.exists(TRADES_FILE):
        with open(TRADES_FILE, "r") as f:
            return json.load(f)
    return []


def save_trades(trades):
    with open(TRADES_FILE, "w") as f:
        json.dump(trades, f, indent=2)


# ── Telegram helpers ──────────────────────────────────────

def tg_send(text: str):
    """Send a message back to your Telegram chat."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print(f"[MSG] {text}")
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "Markdown"},
            timeout=5
        )
    except Exception as e:
        print(f"[Telegram send error] {e}")


def tg_get_updates():
    """Fetch new messages from Telegram."""
    global last_update_id
    try:
        resp = requests.get(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates",
            params={"offset": last_update_id + 1, "timeout": 2},
            timeout=10
        )
        data = resp.json()
        return data.get("result", [])
    except Exception as e:
        print(f"[Telegram poll error] {e}")
        return []


# ── Stats ─────────────────────────────────────────────────

def build_stats(trades):
    closed = [t for t in trades if t.get("status") == "closed"]
    stats  = {"total_closed": len(closed), "wins": 0, "losses": 0,
               "by_indicator": {}, "by_conviction": {}, "by_direction": {}}
    for t in closed:
        outcome = t.get("outcome", "")
        w_key   = "wins" if outcome == "win" else "losses"
        stats[w_key] += 1
        for bucket, key in [("by_indicator",  t.get("indicator",  "unknown")),
                             ("by_conviction", t.get("conviction", "unknown")),
                             ("by_direction",  t.get("direction",  "unknown"))]:
            if key not in stats[bucket]:
                stats[bucket][key] = {"wins": 0, "losses": 0}
            stats[bucket][key][w_key] += 1
    total = stats["wins"] + stats["losses"]
    stats["win_rate"] = f"{round(stats['wins']/total*100)}%" if total else "0%"
    return stats


# ── Signal processing ─────────────────────────────────────

def process_signal(data: dict):
    """Log a new trade from a TradingView signal."""
    trades = load_trades()
    total  = len(trades)

    if total >= MAX_PAPER_TRADES:
        tg_send("✅ *30 paper trades complete!* Upload `trades.json` to Claude for analysis.")
        return

    direction  = data.get("direction",  "unknown").lower()
    symbol     = data.get("symbol",     "SOLUSD")
    price      = data.get("price",      "unknown")
    indicator  = data.get("indicator",  "neurowave").lower()
    conviction = data.get("conviction", "unknown").lower()
    timeframe  = data.get("timeframe",  "15m")

    trade = {
        "trade_number": total + 1,
        "timestamp":    datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "symbol":       symbol,
        "direction":    direction,
        "entry_price":  price,
        "exit_price":   None,
        "outcome":      None,
        "status":       "open",
        "indicator":    indicator,
        "conviction":   conviction,
        "timeframe":    timeframe,
        "notes":        ""
    }

    trades.append(trade)
    save_trades(trades)

    remaining  = MAX_PAPER_TRADES - total - 1
    dir_emoji  = "🟢" if direction == "buy" else "🔴"
    conv_label = "HIGH 🔵🔵" if conviction == "high" else "LOW 🔵"

    print(f"[#{trade['trade_number']}] {direction.upper()} {symbol} @ {price} | {indicator} | {conviction}")
    tg_send(
        f"📡 *Trade #{trade['trade_number']}/30 Logged*\n"
        f"{dir_emoji} *{direction.upper()}* {symbol} `{timeframe}`\n"
        f"Indicator: *{indicator.capitalize()}*\n"
        f"Conviction: *{conv_label}*\n"
        f"Entry: `{price}`\n"
        f"_{remaining} trades remaining_\n\n"
        f"Reply: `close {trade['trade_number']} <exit_price> win` or `close {trade['trade_number']} <exit_price> loss`"
    )


def process_close(trade_num: int, exit_price: float, outcome: str, notes: str = ""):
    """Close a trade with a result."""
    trades = load_trades()
    trade  = next((t for t in trades if t["trade_number"] == trade_num), None)

    if not trade:
        tg_send(f"❌ Trade #{trade_num} not found.")
        return
    if trade["status"] == "closed":
        tg_send(f"❌ Trade #{trade_num} is already closed.")
        return

    trade["exit_price"] = exit_price
    trade["outcome"]    = outcome
    trade["status"]     = "closed"
    trade["notes"]      = notes
    save_trades(trades)

    stats     = build_stats(trades)
    emoji     = "✅" if outcome == "win" else "❌"

    # Scoreboard
    ind_lines = "\n".join(
        f"  {k.capitalize()}: {v.get('wins',0)}W/{v.get('losses',0)}L"
        for k, v in stats["by_indicator"].items()
    )
    conv_lines = "\n".join(
        f"  {k.capitalize()} conviction: {v.get('wins',0)}W/{v.get('losses',0)}L"
        for k, v in stats["by_conviction"].items()
    )

    print(f"[#{trade_num}] Closed — {outcome.upper()} @ {exit_price} | {stats['wins']}W/{stats['losses']}L")
    tg_send(
        f"{emoji} *Trade #{trade_num} — {outcome.upper()}*\n"
        f"{trade['symbol']} | {trade['indicator'].capitalize()} "
        f"| {trade['direction'].upper()} | {trade['conviction'].capitalize()} conviction\n"
        f"Entry: `{trade['entry_price']}` → Exit: `{exit_price}`\n"
        f"Notes: _{notes}_\n\n"
        f"📊 *Record:* {stats['wins']}W / {stats['losses']}L — {stats['win_rate']}\n\n"
        f"*By Indicator:*\n{ind_lines}\n\n"
        f"*By Conviction:*\n{conv_lines}"
    )

    if stats["total_closed"] >= MAX_PAPER_TRADES:
        tg_send(
            f"🎓 *30 Paper Trades Complete!*\n"
            f"Final: {stats['wins']}W / {stats['losses']}L — {stats['win_rate']}\n\n"
            f"Upload `trades.json` to Claude for full AI analysis & go-live verdict! 🚀"
        )


def process_status():
    """Send current stats to Telegram."""
    trades = load_trades()
    stats  = build_stats(trades)
    open_t = [t for t in trades if t["status"] == "open"]

    ind_lines = "\n".join(
        f"  {k.capitalize()}: {v.get('wins',0)}W/{v.get('losses',0)}L"
        for k, v in stats["by_indicator"].items()
    ) or "  No closed trades yet"

    conv_lines = "\n".join(
        f"  {k.capitalize()} conviction: {v.get('wins',0)}W/{v.get('losses',0)}L"
        for k, v in stats["by_conviction"].items()
    ) or "  No closed trades yet"

    tg_send(
        f"📊 *Journal Status*\n"
        f"Progress: {stats['total_closed']}/{MAX_PAPER_TRADES}\n"
        f"Open trades: {len(open_t)}\n"
        f"Record: {stats['wins']}W / {stats['losses']}L — {stats['win_rate']}\n\n"
        f"*By Indicator:*\n{ind_lines}\n\n"
        f"*By Conviction:*\n{conv_lines}"
    )


# ── Message router ────────────────────────────────────────

def handle_message(text: str):
    """
    Routes incoming Telegram messages.

    TradingView signals arrive as JSON:
      {"symbol":"SOLUSD","direction":"buy","price":"84.67","indicator":"neurowave","conviction":"high","timeframe":"15m"}

    You close trades by replying:
      close 1 85.50 win
      close 1 83.10 loss notes go here

    Check status:
      status
    """
    text = text.strip()

    # ── JSON signal from TradingView via TFlab ──
    if text.startswith("{"):
        try:
            data = json.loads(text)
            process_signal(data)
        except json.JSONDecodeError:
            tg_send("⚠️ Couldn't parse signal JSON. Check your TradingView alert message format.")
        return

    # ── Manual close command ──
    # Format: close <trade_num> <exit_price> <win|loss> [optional notes]
    parts = text.lower().split()
    if parts and parts[0] == "close":
        try:
            trade_num  = int(parts[1])
            exit_price = float(parts[2])
            outcome    = parts[3]   # win or loss
            notes      = " ".join(parts[4:]) if len(parts) > 4 else ""
            if outcome not in ("win", "loss"):
                raise ValueError
            process_close(trade_num, exit_price, outcome, notes)
        except (IndexError, ValueError):
            tg_send(
                "⚠️ Format: `close <trade_number> <exit_price> <win|loss> [notes]`\n"
                "Example: `close 1 85.50 win clean breakout`"
            )
        return

    # ── Status check ──
    if parts and parts[0] == "status":
        process_status()
        return

    # ── Help ──
    tg_send(
        "📖 *Commands:*\n"
        "`status` — see current record\n"
        "`close 1 85.50 win` — close trade #1 as a win\n"
        "`close 1 83.10 loss choppy entry` — close with notes\n\n"
        "TradingView signals are logged automatically when they arrive as JSON."
    )


# ── Main polling loop ─────────────────────────────────────

def main():
    global last_update_id

    if not TELEGRAM_BOT_TOKEN:
        print("❌ TELEGRAM_BOT_TOKEN not set in .env — see README.md")
        return

    print("🚀 Trading Journal running — polling Telegram...")
    print(f"📁 Trades saved to: {TRADES_FILE}")
    print("💬 Send 'status' in Telegram to check progress\n")

    tg_send("🟢 *Trading Journal Bot is online!*\nWaiting for NeuroWave + Kryptonite signals...")

    while True:
        updates = tg_get_updates()
        for update in updates:
            last_update_id = update["update_id"]
            message = update.get("message", {})
            text    = message.get("text", "").strip()
            if text:
                print(f"[Telegram] {text[:80]}")
                handle_message(text)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
