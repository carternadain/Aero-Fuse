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


def demo_hash() -> str:
    """Optional second password that signs into the demo (fake data). Only works with login on."""
    return os.getenv("DEMO_PASSWORD_HASH", "").strip() if enabled() else ""


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


def issue_token(demo: bool = False) -> str:
    """Owner: "<exp>.<sig>". Demo: "demo.<exp>.<sig>", signed over "demo:<exp>" so an
    owner signature can't be reused for a demo token or the other way round."""
    exp = str(int(time.time()) + SESSION_TTL)
    return f"demo.{exp}.{_sign('demo:' + exp)}" if demo else f"{exp}.{_sign(exp)}"


def token_kind(token: str | None) -> str | None:
    """'owner', 'demo', or None when the token is missing, forged or expired."""
    if not token or "." not in token:
        return None
    kind = "owner"
    if token.startswith("demo."):
        if not demo_hash():
            return None  # demo switched off: its sessions stop working
        kind, token = "demo", token[5:]
    exp, _, sig = token.partition(".")
    if not hmac.compare_digest(sig, _sign(("demo:" if kind == "demo" else "") + exp)):
        return None
    try:
        return kind if int(exp) > time.time() else None
    except ValueError:
        return None


def valid_token(token: str | None) -> bool:
    return token_kind(token) is not None


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
    if sys.argv[1:] == ["hash-demo-password"]:
        pw = secrets.token_urlsafe(9)
        print(f"Demo password: {pw}\n\nAdd this line to .env:\n")
        print(f"DEMO_PASSWORD_HASH={hash_password(pw)}")
    elif sys.argv[1:] == ["hash-password"]:
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
        sys.exit("usage: python auth.py hash-password | hash-demo-password")
