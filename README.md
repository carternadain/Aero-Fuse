# 📈 Swing Terminal

An all-in-one personal finance & trading terminal. Tracks live TradingView signals,
scores stocks & crypto for long-term buy/overbought timing, surfaces crypto narratives
and earnings projections, and manages your net worth, FIRE plan, and budget — all in one
brighter-dark dashboard you can run on your phone.

> **Full operations guide → [RUNBOOK.md](RUNBOOK.md)** (setup, API keys, database, deployment, day-2 ops).

---

## The five tabs

| Tab | What it does |
|---|---|
| **Trading** | Stats + AI edge report · news sentiment · trade tracker · signal log (with per-signal AI verdict) · key levels · portfolio |
| **Stocks** | Options Watch (your tickers + live TradingView confluence) · Tech Screener (long-term buy/overbought score, click for history chart) |
| **Crypto** | Top-15 screener with sparklines + long-term score (click a row for its score-history chart) · live "what's moving" narratives |
| **News** | Upcoming earnings + bullish/bearish analyst projections · headline sentiment |
| **Wealth** | Net worth tracker · FIRE calculator · budget tracker |

## How it finds an edge

- **Signal testing:** every incoming TradingView alert auto-runs a Claude confluence check
  (your rules: both-indicator confluence + liquidity sweep + ≥2:1 RR + HTF alignment). The
  verdict is stored next to the signal, and the **edge report** compares win rate of
  AI-approved vs AI-skipped vs raw alerts — so you can see whether the alerts alone are profitable.
- **Long-term score (0–100):** blends RSI(14), distance from the 200-day moving average, and
  52-week range position → *Accumulate / Buy zone / Neutral / Overbought / Extremely overbought*.
  The score-history chart shows when each asset was a buy vs overbought over the past year.

## Tech

- **Backend:** FastAPI + SQLite (`backend/`, port 8000). Telegram poller + TradingView webhook.
- **Frontend:** Next.js 15 + Tailwind v4 + recharts (`frontend/`, port 3000).
- **Free data, no key:** CoinGecko (crypto prices, history, narratives), Yahoo Finance via
  `yfinance` (stock history, earnings, analyst targets), Google News RSS.
- **Claude (`claude-sonnet-5-5`):** news sentiment + signal evaluation (optional — set `ANTHROPIC_API_KEY`).

## Quick start

```powershell
# backend (terminal 1)
cd backend ; ..\.venv\Scripts\python -m uvicorn main:app --port 8000

# frontend (terminal 2)
cd frontend ; npm install ; npm run dev
```

Open **http://localhost:3000**. See [RUNBOOK.md](RUNBOOK.md) for API keys, the database, and hosting it online.

> **Hosting it?** Set `APP_PASSWORD_HASH` + `WEBHOOK_SECRET` first (`python backend/auth.py hash-password`) — see RUNBOOK §3 and §7.

> `server.py` in the repo root is the original v0 paper-trade journal (superseded by `backend/`); kept for reference only.
