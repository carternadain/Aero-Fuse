# 🛠️ Swing Terminal — Runbook

Everything to run, understand, back up, and deploy this app. One document, kept current.

- [1. What's running](#1-whats-running)
- [2. Run it locally](#2-run-it-locally)
- [3. API keys (.env)](#3-api-keys-env)
- [4. The database](#4-the-database)
- [5. Data sources — and is the data good?](#5-data-sources--and-is-the-data-good)
- [6. TradingView signals](#6-tradingview-signals)
- [7. Make it not just local (deploy)](#7-make-it-not-just-local-deploy)
- [8. Day-2 operations](#8-day-2-operations)

---

## 1. What's running

Two processes:

| Process | Stack | Port | Responsibilities |
|---|---|---|---|
| **Backend** | FastAPI + SQLite (`backend/`) | 8000 | API, trade/signal DB, Telegram poller, TradingView webhook, Claude eval, market-data fetchers |
| **Frontend** | Next.js 15 + Tailwind v4 (`frontend/`) | 3000 | The dashboard; proxies `/api/*` to the backend (see `frontend/next.config.mjs`) |

The frontend never calls the backend directly from the browser — Next rewrites `/api/*` and
`/webhook` server-side to `API_BASE` (default `http://127.0.0.1:8000`). That's why it works on
your phone over the LAN with no CORS issues.

---

## 2. Run it locally

```powershell
# Terminal 1 — backend (FastAPI, port 8000)
cd backend
..\.venv\Scripts\python -m uvicorn main:app --port 8000

# Terminal 2 — frontend (Next.js, port 3000)
cd frontend
npm install            # first run only
npm run dev
```

Open **http://localhost:3000**.

- **First run / new machine — install backend deps:** `..\.venv\Scripts\python -m pip install -r backend\requirements.txt`
  (this pulls `yfinance` + `lxml`, needed for the stock screener & earnings).
- **On your phone (same Wi-Fi):** run `npm run dev -- -H 0.0.0.0`, find your PC's IPv4 with
  `ipconfig`, then browse to `http://<your-pc-ip>:3000`.
- Restart the backend after editing `.env` — keys are read at startup.

---

## 3. API keys (.env)

All keys live in **`.env` at the repo root** (gitignored — never committed). Telegram is
already configured; only Claude is needed to unlock the AI features.

```env
# ── Telegram (already set via @BotFather) ──
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# ── Claude — unlocks AI sentiment + signal evaluation (the edge test) ──
# Get it at https://platform.claude.com → API Keys
ANTHROPIC_API_KEY=sk-ant-...

# ── Optional: richer crypto news (Google News RSS is the free fallback) ──
CRYPTOPANIC_API_KEY=

# ── Login + webhook lock — REQUIRED before the app is reachable from the internet ──
# Generate both with:  cd backend ; ..\.venv\Scripts\python auth.py hash-password
APP_PASSWORD_HASH=scrypt$32768$8$1$...
WEBHOOK_SECRET=...
# SESSION_SECRET=        # optional; defaults to one derived from the password hash
# COOKIE_SECURE=0        # only for testing over plain http on your LAN (phone → http://<pc-ip>:3000)
```

| Key | Required? | Powers |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | already set | Signal pings + `close`/`status` commands |
| `ANTHROPIC_API_KEY` | **for AI features** | News sentiment **and** the per-signal Claude verdict / edge report. Without it, signals still log — they just show "awaiting" instead of a take/skip verdict. |
| `CRYPTOPANIC_API_KEY` | no | Crypto-native news feed; falls back to free Google News RSS |
| `APP_PASSWORD_HASH` | **when hosted** | Turns on the login page. Unset = no login (fine on localhost only — the backend logs a loud warning). Changing it signs out every device. |
| `WEBHOOK_SECRET` | **when hosted** | TradingView alerts must carry it (see §6). With login on but no secret, `/webhook` rejects everything. |

### How the login works
- One password, stored only as an **scrypt hash** — the plain password is never on disk.
- Signing in sets a 30-day **HttpOnly, Secure, SameSite=Lax** cookie (JavaScript can't read it;
  other sites can't use it to make requests). Sign out with the arrow icon at the top right.
- **Every `/api/*` call is checked by the backend**, so the data is locked even if someone
  skips the login page. The page redirect itself is in `frontend/middleware.ts`.
- 5 wrong passwords from one IP (or 30 total) → locked for 15 minutes.

---

## 4. The database

**One SQLite file: `backend/terminal.db`.** No server, no connection string — that file *is*
your data. It's gitignored. `db.py` is the only module that touches it (so the schema can
change in one place). On startup, `db.init_db()` creates tables if missing and `db.migrate()`
applies additive column upgrades (e.g. the signal AI-verdict columns) to existing files safely.

### Tables

| Table | Contents |
|---|---|
| `trades`, `partials` | Trade tracker + partial closes |
| `signals` | Every TradingView signal + taken/skip + outcome + **AI verdict** (`ai_take`, `ai_score`, `ai_confidence`, `ai_reasons`, `ai_warnings`) |
| `levels` | Pinned liquidity zones & key levels |
| `positions` | Portfolio (crypto swings + LEAP calls) |
| `accounts`, `holdings`, `networth_snapshots` | Net worth: manual balances, live-priced holdings, history chart (auto-snapshotted hourly) |
| `transactions`, `budgets` | Budget tracker + category limits |

> Editable screener watchlists live in JSON, not the DB: `backend/watchlist.json`,
> `screener_stocks.json`, `options_stocks.json` (all gitignored, auto-seeded with defaults).

### Operations

| Task | How |
|---|---|
| **Back up** | Copy the file. Safe online copy: `sqlite3 terminal.db ".backup backup.db"` (don't plain-copy mid-write). |
| **Restore** | Stop backend → replace `terminal.db` with the backup → start backend. |
| **Reset / wipe** | Stop backend → delete `terminal.db` → start backend (tables recreate empty). |
| **Load demo data** | `cd backend` → `..\.venv\Scripts\python seed_demo.py` |
| **Inspect** | `sqlite3 backend/terminal.db ".tables"` then SQL, or open in DB Browser for SQLite. |
| **Export** | `sqlite3 -header -csv backend/terminal.db "SELECT * FROM trades;" > trades.csv` |

### Backups and restore

- **Automatic:** the backend writes `backend/backups/terminal-YYYY-MM-DD.db` once a day (and shortly
  after startup if today's is missing), using SQLite's online backup, so copies are consistent.
  The newest 14 are kept. The folder is gitignored.
- **Env vars:** `BACKUP_DIR` (default `backend/backups`), `BACKUP_KEEP` (default `14`).
- **Download:** Wealth tab → "Backup & Export" (JSON of everything, transactions CSV, database file,
  and a "Back up now" button). API: `/api/export/json`, `/api/export/transactions.csv?month=YYYY-MM`,
  `/api/export/db`, `/api/backups`.
- **Restore:** stop the backend → copy the chosen backup over `backend/terminal.db`
  (e.g. `cp backend/backups/terminal-2026-01-31.db backend/terminal.db`; delete any
  `terminal.db-wal` / `-shm` next to it) → start the backend. There is deliberately no
  restore button in the browser.
- Backups sit on the same disk as the database; copy them off the machine now and then.

---

## 5. Data sources — and is the data good?

**Yes — it's real, live data, not mocked.** Specifics:

| Feed | Source | Quality notes |
|---|---|---|
| Crypto prices / 7d sparkline / 24h-1y % | **CoinGecko** (free, no key) | Accurate, real-time-ish. ~10–30 calls/min free limit; cached 5 min. |
| Crypto long-term score history | CoinGecko daily history | ~1y of real daily closes; cached 6h/coin. |
| Crypto narratives | CoinGecko categories | Real categories, filtered to >$500M market cap and sorted by 24h move (drops scam micro-caps). |
| Stock prices / history / earnings / analyst targets | **Yahoo Finance** via `yfinance` | Real market data. Yahoo occasionally throttles → cached 6–12h, per-ticker try/except; a throttled coin/stock shows "no data" and fills in on the next refresh. |
| News headlines | Google News RSS (or CryptoPanic) | Free, real. |
| Sentiment + signal verdict | Claude `claude-sonnet-5-5` | Only when `ANTHROPIC_API_KEY` is set. |

**The long-term score is honest math**, computed from real OHLC: 35% inverted RSI(14) +
35% distance from the 200-day MA + 30% 52-week range position. It's a *timing heuristic for
mean-reversion*, not a price prediction — treat it as one input, not a buy button. The only
caveat is occasional CoinGecko/Yahoo rate-limit gaps, which self-heal on refresh.

---

## 6. TradingView signals

Two ways to get signals in (no app change needed for either):

**A — Direct webhook** (needs TradingView Pro+): point an alert's webhook at
`https://<your-host>/webhook?token=<WEBHOOK_SECRET>` with a JSON message like:

```json
{"symbol":"{{ticker}}","direction":"buy","price":"{{close}}","indicator":"neurowave","conviction":"high","timeframe":"{{interval}}"}
```

(Instead of `?token=`, you can put `"secret":"<WEBHOOK_SECRET>"` inside the JSON message.)

Set one alert per signal type (~4–6 total) for NeuroWave & Kryptonite, buy & sell. When both
indicators fire the same direction within ~90 min, the signal log flags 🔥 confluence.

**B — Telegram relay** (free): keep your TFlab bot forwarding alerts into your Telegram chat;
the backend poller logs any JSON message automatically. Same templates, no webhook.

Either way, each new signal triggers the background Claude verdict (if the key is set).

---

## 7. Make it not just local (deploy)

The app is two processes with different needs. The backend must run **always-on** (Telegram
poller) with a **persistent disk** (`terminal.db`) — so a normal serverless host won't do.

### ✅ Live setup (Oct 2026) — how the running server differs from the steps below

- **Server:** Oracle Always Free, Phoenix, `VM.Standard.A1.Flex` (1 OCPU / 6 GB, ARM), Ubuntu 24.04, 2 GB swap.
- **Address:** `https://<ip-with-dashes>.sslip.io`. sslip.io resolves to the IP, so no DuckDNS account; Caddy gets a Let's Encrypt cert for it. Caddy does HTTPS + security headers only — **no basic auth** (the app login does the locking, and basic auth breaks the iPhone home-screen app).
- **Node 22 from nodejs.org** (checksum-verified tarball in `/usr/local`): Ubuntu's apt Node is 18, too old for Tailwind v4.
- **Ports:** Oracle Security List ingress 80,443 (+22); iptables rules saved with `netfilter-persistent`. The app itself listens on 127.0.0.1 only.
- **Cache warmer:** background threads refresh holdings (60s), markets/news (2m) and screeners (15m) before their caches expire, so pages stay fast. The API service sets `PYTHONUNBUFFERED=1` so `[warm]` lines show in `journalctl -u terminal-api`.
- **Backups:** `~/backup-db.sh` via cron at 09:15 UTC → `~/backups/terminal-YYYY-MM-DD.db`, 14 days kept.
- **Code** is shipped from the local repo with `git archive` (no GitHub token on the server). **To update:** commit, then
  ```bash
  ./deploy.sh ubuntu@<server-ip>
  ```
  It never touches the server's `terminal.db` or `.env`.
- **The server's database is now the main copy.** The local `backend/terminal.db` no longer syncs with it.
- **Local dev now needs the login too**, because `.env` sets `APP_PASSWORD_HASH`. Comment that line out locally if you want it open on localhost.

### Recommended: Oracle Cloud "Always Free" VPS — free forever, nothing changes

Telegram poller runs 24/7, the DB lives on a real disk, real HTTPS, your PC can be off.

**7.1 Create the server (~10 min)**
1. https://cloud.oracle.com/free (card for identity only — Always Free shapes are never billed).
2. Compute → Create Instance → **Ubuntu 24.04**, shape **VM.Standard.A1.Flex** (Ampere, 2 OCPU / 12 GB — inside Always Free; retry/another AD if "out of capacity"). Download the SSH key.
3. Networking → add **ingress rules** for TCP **80** and **443** from `0.0.0.0/0` on the VCN's Default Security List.
4. SSH in: `ssh -i path\to\key.key ubuntu@<PUBLIC_IP>`

**7.2 Open the OS firewall** (Oracle Ubuntu blocks ports by default)
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo apt update && sudo apt install -y iptables-persistent && sudo netfilter-persistent save
```

**7.3 Install runtimes**
```bash
sudo apt install -y python3-venv python3-pip git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

**7.4 Get the code + secrets**
```bash
cd ~ && git clone https://github.com/carternadain/Aero-Fuse.git
cd Aero-Fuse
nano .env       # paste TELEGRAM_*, ANTHROPIC_API_KEY, (CRYPTOPANIC_API_KEY)
chmod 600 .env  # only your user can read the secrets
```
Generate the login lines **after 7.5** (needs the venv) and append them to `.env`:
```bash
cd backend && ../.venv/bin/python auth.py hash-password && cd ..   # paste both printed lines into .env
```
> Private repo? Clone with a fine-grained PAT: `https://<TOKEN>@github.com/<user>/<repo>.git`

**7.5 Build both apps**
```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cd frontend && npm install && npm run build && cd ..
```

**7.6 Run both as services (auto-start, auto-restart)**
```bash
sudo tee /etc/systemd/system/terminal-api.service >/dev/null <<'UNIT'
[Unit]
Description=Trading Terminal API
After=network-online.target
[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/Aero-Fuse/backend
ExecStart=/home/ubuntu/Aero-Fuse/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT

sudo tee /etc/systemd/system/terminal-web.service >/dev/null <<'UNIT'
[Unit]
Description=Trading Terminal Frontend
After=terminal-api.service
[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/Aero-Fuse/frontend
ExecStart=/usr/bin/npm run start
Environment=PORT=3000
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload && sudo systemctl enable --now terminal-api terminal-web
```

**7.7 Free domain + automatic HTTPS** (DuckDNS + Caddy)
1. https://www.duckdns.org → create a subdomain (e.g. `carter-terminal`) → point it at the server IP.
2. Caddy just terminates HTTPS — the app's own login (§3) does the locking, so the home-screen
   app works (browser basic-auth pop-ups break installed iOS web apps):
```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'CADDY'
carter-terminal.duckdns.org {
    header Strict-Transport-Security "max-age=31536000"
    reverse_proxy 127.0.0.1:3000
}
CADDY
sudo systemctl reload caddy
```
3. **Check before you trust it:** open the site in a private window → you must land on the
   login page, and `https://carter-terminal.duckdns.org/api/accounts` must return 401.

TradingView webhook → `https://carter-terminal.duckdns.org/webhook?token=<WEBHOOK_SECRET>`.

**7.8 Daily DB backups**
```bash
mkdir -p ~/backups && chmod 700 ~/backups && crontab -e   # backups hold your net worth — keep them private
# add: 0 6 * * * cp /home/ubuntu/Aero-Fuse/backend/terminal.db /home/ubuntu/backups/terminal-$(date +\%u).db
```

**7.9 Stronger: Cloudflare Tunnel + Access (free, recommended once real money data is in here)**

Adds a second lock *in front of* the app — Google sign-in + 2FA, enforced by Cloudflare before a
request ever reaches your server — and the server needs **no open ports at all**.
1. Move your domain's DNS to Cloudflare (needs a real domain, ~$10/yr; DuckDNS can't do this).
2. On the server: install `cloudflared`, run `cloudflared tunnel login`, create a tunnel, and route
   `terminal.<yourdomain>` → `http://127.0.0.1:3000`. Then close ports 80/443 (7.2) and drop Caddy.
3. Cloudflare dashboard → Zero Trust → Access → Applications → add `terminal.<yourdomain>`,
   policy: *Allow — emails — your Google address*.
4. Add a second application for `terminal.<yourdomain>/webhook` with policy **Bypass** (TradingView
   can't sign in; the `WEBHOOK_SECRET` still protects it).

Keep `APP_PASSWORD_HASH` set too — two independent locks.

### Faster but weaker alternatives
- **Vercel (frontend) + ngrok (backend on your PC):** quickest to a URL, but your PC must stay on and the tunnel can drop. Set Vercel env `API_BASE` to the ngrok URL.
- **Render free backend:** ❌ ephemeral disk **wipes `terminal.db` on every deploy** — only viable after migrating SQLite → Turso/Postgres (`db.py` is the only file that changes).

---

## 8. Day-2 operations

**Deploy an update (VPS):**
```bash
cd ~/Aero-Fuse && git pull
.venv/bin/pip install -r backend/requirements.txt
cd frontend && npm install && npm run build && cd ..
sudo systemctl restart terminal-api terminal-web
```

**Telegram commands:** `status` (record), `close <id> <exit_price> [notes]` (close a trade),
any TradingView JSON (logged as a signal).

**Troubleshooting**

| Symptom | Check |
|---|---|
| "Backend offline" banner | Is uvicorn up? `journalctl -u terminal-api -n 50 --no-pager` (VPS) or the terminal (local). |
| Screener row shows "no data" | CoinGecko/Yahoo rate limit — refresh; it self-heals from cache. |
| Signals log but no AI verdict | `ANTHROPIC_API_KEY` not set / invalid — check `.env`, restart backend. |
| Site unreachable (VPS) | OCI ingress 80/443 **and** `sudo iptables -L INPUT -n` show the ACCEPT rules. |
| HTTPS cert fails (VPS) | DuckDNS IP matches `curl -s ifconfig.me`; port 80 open (Let's Encrypt needs it). |
