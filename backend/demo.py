"""Demo login: a second password (DEMO_PASSWORD_HASH) that opens the app on its own
database of made-up data (demo.db), so carter can show Aero to people without showing
their real money.

The request middleware sets `active` for demo sessions; db.conn() and the in-memory cache
read it, so every request from a demo session reads and writes demo.db and a separate
cache. Background loops (alerts, snapshots, Telegram) never set it and keep using the real
database. Each demo sign-in rebuilds demo.db from scratch.
"""

import contextvars

active: contextvars.ContextVar[bool] = contextvars.ContextVar("demo", default=False)

# Endpoints a demo session can't use: they touch real files, cost money, send things, or
# hand out the database. Prefix match on the path.
BLOCKED = (
    "/api/export", "/api/backups", "/api/evaluate", "/api/push",
)
BLOCKED_WRITES = ("/api/watchlist",)  # these lists live in shared JSON files, not the DB


def on() -> bool:
    return active.get()


def blocked(method: str, path: str) -> bool:
    if path.startswith(BLOCKED):
        return True
    return method not in ("GET", "HEAD", "OPTIONS") and path.startswith(BLOCKED_WRITES)
