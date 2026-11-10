# 📈 Swing Terminal

An all-in-one personal finance & trading terminal. Tracks live TradingView signals,
scores stocks & crypto for long-term buy/overbought timing, surfaces crypto narratives
and earnings projections, and manages your net worth, cash flow, budget, taxes and FIRE plan — all in one
brighter-dark dashboard you can run on your phone.

> **Full operations guide → [RUNBOOK.md](RUNBOOK.md)** (setup, API keys, database, deployment, day-2 ops).

---

## The tabs

| Tab | What it does |
|---|---|
| **Home** | Greeting + Today's Brief (what matters right now) · net worth and allocation · starred tickers · week recap |
| **Invest** | **Check** any stock or crypto for a buy/wait verdict (plus LEAP checker) · **Mine**: holdings risk, sell plans, options plan · **Ideas**: swing ideas, sectors, compare, options watch, tech screener · **Crypto**: screener with long-term score, liquidation heatmap, narratives |
| **News** | Headline sentiment for what you own · upcoming earnings · macro calendar |
| **Wealth** | Accounts + auto-invest + risk · Cash (paychecks, bills, what's left) · Budget & spending (statement import, limits, alerts) · Bills · Dividends · Taxes · Goals & savings plan · What-if (crash test, FIRE, money lab) |
| **Bot** *(optional, off by default — switch on in Settings)* | Trade tracker + calendar · signal log with per-signal AI verdict · key levels · positions · sizing, stats and the paper bot |

The Settings sheet switches between Simple and Pro mode, the colour palette, and backups.
A second "demo" password can open the app on made-up data — see RUNBOOK §3.

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
