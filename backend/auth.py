"""Single-user login for the hosted terminal.

- Password is stored only as an scrypt hash in .env (APP_PASSWORD_HASH).
- A successful login sets an HttpOnly, SameSite=Lax session cookie holding a
  signed expiry ("<expires>.<hmac>") — stateless, so nothing to store server-side.
- The signing key is SESSION_SECRET, or derived from the password hash, so
  changing the password logs every device out.
- Failed logins are rate-limited per client IP and globally.
- No APP_PASSWORD_HASH set → auth is disabled (local dev) with a loud warning.

Generate a hash:   ..\\.venv\\Scripts\\python auth.py hash-password
"""

import base64
import hashlib
import hmac
import os
import secrets
import sys
import time
from collections import defaultdict, deque

COOKIE_NAME = "st_session"
SESSION_TTL = 30 * 24 * 3600          # 30 days
FAIL_WINDOW = 15 * 60                 # seconds
MAX_FAILS_PER_IP = 5
MAX_FAILS_GLOBAL = 30

_SCRYPT = {"n": 2**15, "r": 8, "p": 1}


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, maxmem=64 * 1024 * 1024, dklen=32, **_SCRYPT)
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${_b64(salt)}${_b64(dk)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, want = stored.split("$")
        if algo != "scrypt":
            return False
        dk = hashlib.scrypt(password.encode(), salt=_unb64(salt), n=int(n), r=int(r), p=int(p),
                            maxmem=64 * 1024 * 1024, dklen=len(_unb64(want)))
        return hmac.compare_digest(dk, _unb64(want))
    except Exception:
        return False


def password_hash() -> str:
    return os.getenv("APP_PASSWORD_HASH", "").strip()


def enabled() -> bool:
    return bool(password_hash())


def cookie_secure() -> bool:
    """Secure cookies by default; COOKIE_SECURE=0 only for plain-http LAN testing."""
    return os.getenv("COOKIE_SECURE", "1") != "0"


def _key() -> bytes:
    explicit = os.getenv("SESSION_SECRET", "").strip()
    if explicit:
        return explicit.encode()
    return hashlib.sha256(b"st-session:" + password_hash().encode()).digest()


def _sign(payload: str) -> str:
    return _b64(hmac.new(_key(), payload.encode(), hashlib.sha256).digest())


def issue_token() -> str:
    exp = str(int(time.time()) + SESSION_TTL)
    return f"{exp}.{_sign(exp)}"


def valid_token(token: str | None) -> bool:
    if not token or "." not in token:
        return False
    exp, sig = token.split(".", 1)
    if not hmac.compare_digest(sig, _sign(exp)):
        return False
    try:
        return int(exp) > time.time()
    except ValueError:
        return False


# ── Login rate limiting ───────────────────────────────────

_fails: dict[str, deque] = defaultdict(deque)
_global_fails: deque = deque()


def _prune(q: deque, now: float) -> None:
    while q and now - q[0] > FAIL_WINDOW:
        q.popleft()


def locked_out(ip: str) -> bool:
    now = time.time()
    _prune(_fails[ip], now)
    _prune(_global_fails, now)
    return len(_fails[ip]) >= MAX_FAILS_PER_IP or len(_global_fails) >= MAX_FAILS_GLOBAL


def record_failure(ip: str) -> None:
    now = time.time()
    _fails[ip].append(now)
    _global_fails.append(now)


def clear_failures(ip: str) -> None:
    _fails.pop(ip, None)


def client_ip(headers, fallback: str) -> str:
    # Next's proxy (and Caddy in front of it) append to X-Forwarded-For; the left-most
    # entry is the original client.
    fwd = headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() if fwd else fallback


# ── Webhook shared secret ─────────────────────────────────

def webhook_secret() -> str:
    return os.getenv("WEBHOOK_SECRET", "").strip()


def webhook_ok(provided: str | None) -> bool:
    want = webhook_secret()
    return bool(want) and bool(provided) and hmac.compare_digest(provided.encode(), want.encode())


if __name__ == "__main__":
    if sys.argv[1:] == ["hash-password"]:
        import getpass
        pw = getpass.getpass("New password: ")
        if len(pw) < 12:
            sys.exit("Use at least 12 characters.")
        if getpass.getpass("Repeat: ") != pw:
            sys.exit("Passwords don't match.")
        print("\nAdd these lines to .env:\n")
        print(f"APP_PASSWORD_HASH={hash_password(pw)}")
        print(f"WEBHOOK_SECRET={secrets.token_urlsafe(24)}")
    else:
        sys.exit("usage: python auth.py hash-password")
