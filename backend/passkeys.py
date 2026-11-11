"""Passkey sign-in (Face ID / Touch ID / a security key) for the single owner.

A passkey is a key pair made by the phone or computer. The private half never leaves the
device and is only used after Face ID, Touch ID or the device PIN; this server stores the
public half and checks a signature at sign-in. The password keeps working as the fallback.

- Adding or removing a passkey needs an owner session (never a demo session).
- Each passkey is pinned to the site it was made on (`rp_id`, the hostname). The browser
  enforces that too: a passkey for one site can't be used on another.
- Challenges are random, single use, and expire after five minutes.
- Failed sign-ins count toward the same lockout as wrong passwords (see auth.py).

Needs the `webauthn` package. Without it the app still runs and passkeys are simply off.
"""

from __future__ import annotations

import json
import os
import secrets
import time
from urllib.parse import urlsplit

import auth
import db

CHALLENGE_TTL = 300
MAX_PASSKEYS = 10
USER_ID = b"aero-owner"  # one account, so one fixed user handle

_challenges: dict[str, tuple[float, str]] = {}  # challenge (b64url) -> (expires, "register" | "login")


class PasskeyError(Exception):
    """A request we refuse; the message is safe to show."""


def _lib():
    try:
        import webauthn  # noqa: F401
        return webauthn
    except Exception:
        return None


def available() -> bool:
    return auth.enabled() and _lib() is not None


def init() -> None:
    with db.conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS passkeys (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        cred_id TEXT NOT NULL UNIQUE,      -- base64url credential id
                        public_key TEXT NOT NULL,          -- base64url COSE public key
                        sign_count INTEGER NOT NULL DEFAULT 0,
                        rp_id TEXT NOT NULL,               -- hostname it was made on
                        name TEXT NOT NULL DEFAULT '',
                        created_at TEXT NOT NULL,
                        last_used_at TEXT)""")


def site(headers) -> tuple[str, str]:
    """(rp_id, origin) for this request. The browser's Origin header names the page that is
    asking; PASSKEY_ORIGIN pins it instead when set (e.g. https://aero.example.com)."""
    origin = os.getenv("PASSKEY_ORIGIN", "").strip() or headers.get("origin", "")
    parts = urlsplit(origin)
    if parts.scheme not in ("https", "http") or not parts.hostname:
        raise PasskeyError("Passkeys need the app opened in a browser over https")
    if parts.scheme == "http" and parts.hostname not in ("localhost", "127.0.0.1"):
        raise PasskeyError("Passkeys only work over https")
    return parts.hostname, f"{parts.scheme}://{parts.netloc}"


def host_of(headers) -> str:
    """Hostname the browser is on, for the open "is a passkey set up here?" check. A plain GET
    carries no Origin header, so fall back to the proxy's forwarded host. Nothing is trusted
    on the strength of this: it only decides whether the sign-in page shows the button."""
    pinned = os.getenv("PASSKEY_ORIGIN", "").strip() or headers.get("origin", "")
    if pinned:
        return urlsplit(pinned).hostname or ""
    host = (headers.get("x-forwarded-host") or headers.get("host") or "").split(",")[0].strip()
    return urlsplit(f"//{host}").hostname or ""


def _new_challenge(purpose: str) -> bytes:
    now = time.time()
    for k in [k for k, (exp, _) in _challenges.items() if exp < now]:
        _challenges.pop(k, None)
    if len(_challenges) > 200:  # someone hammering the open endpoint: drop the oldest
        for k in sorted(_challenges, key=lambda k: _challenges[k][0])[:100]:
            _challenges.pop(k, None)
    raw = secrets.token_bytes(32)
    _challenges[auth._b64(raw)] = (now + CHALLENGE_TTL, purpose)
    return raw


def _take_challenge(client_data_b64: str, purpose: str) -> bytes:
    """Find the challenge the browser signed, and spend it. Raises if unknown, expired or reused."""
    try:
        ch = json.loads(auth._unb64(client_data_b64))["challenge"]
    except Exception:
        raise PasskeyError("Malformed passkey response")
    exp, kind = _challenges.pop(ch, (0.0, ""))
    if kind != purpose or exp < time.time():
        raise PasskeyError("That sign-in request expired. Try again.")
    return auth._unb64(ch)


def _rows(rp_id: str | None = None) -> list[dict]:
    with db.conn() as c:
        q = "SELECT * FROM passkeys" + (" WHERE rp_id=?" if rp_id else "") + " ORDER BY id"
        return [dict(r) for r in c.execute(q, (rp_id,) if rp_id else ())]


def registered(rp_id: str) -> bool:
    return bool(_rows(rp_id))


def list_public() -> list[dict]:
    return [{"id": r["id"], "name": r["name"], "site": r["rp_id"], "created_at": r["created_at"],
             "last_used_at": r["last_used_at"]} for r in _rows()]


def delete(pk_id: int) -> bool:
    with db.conn() as c:
        return c.execute("DELETE FROM passkeys WHERE id=?", (pk_id,)).rowcount > 0


def _descriptors(rows: list[dict]):
    from webauthn.helpers.structs import PublicKeyCredentialDescriptor
    return [PublicKeyCredentialDescriptor(id=auth._unb64(r["cred_id"])) for r in rows]


# ── Adding a passkey (owner session) ──────────────────────

def register_options(headers) -> dict:
    wa = _lib()
    if wa is None:
        raise PasskeyError("Passkeys aren't installed on this server")
    rp_id, _ = site(headers)
    if len(_rows()) >= MAX_PASSKEYS:
        raise PasskeyError(f"You already have {MAX_PASSKEYS} passkeys. Remove one first.")
    from webauthn.helpers.structs import AuthenticatorSelectionCriteria, ResidentKeyRequirement, UserVerificationRequirement
    opts = wa.generate_registration_options(
        rp_id=rp_id, rp_name="Aero", user_id=USER_ID, user_name="Aero", user_display_name="Aero",
        challenge=_new_challenge("register"), timeout=CHALLENGE_TTL * 1000,
        exclude_credentials=_descriptors(_rows(rp_id)),  # don't make a second one on the same device
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.REQUIRED),
    )
    return json.loads(wa.options_to_json(opts))


def register_verify(headers, credential: dict, name: str = "") -> dict:
    wa = _lib()
    if wa is None:
        raise PasskeyError("Passkeys aren't installed on this server")
    rp_id, origin = site(headers)
    challenge = _take_challenge((credential.get("response") or {}).get("clientDataJSON", ""), "register")
    try:
        v = wa.verify_registration_response(credential=credential, expected_challenge=challenge, expected_rp_id=rp_id,
                                            expected_origin=origin, require_user_verification=True)
    except Exception as e:
        raise PasskeyError(f"Couldn't verify that passkey ({type(e).__name__})")
    row = (auth._b64(v.credential_id), auth._b64(v.credential_public_key), v.sign_count, rp_id,
           (name or "").strip()[:40] or "Passkey", db.utcnow())
    with db.conn() as c:
        try:
            c.execute("INSERT INTO passkeys (cred_id, public_key, sign_count, rp_id, name, created_at) VALUES (?,?,?,?,?,?)", row)
        except Exception:
            raise PasskeyError("That passkey is already added")
    return {"ok": True, "passkeys": list_public()}


# ── Signing in (no session yet) ───────────────────────────

def login_options(headers) -> dict:
    wa = _lib()
    if wa is None:
        raise PasskeyError("Passkeys aren't installed on this server")
    rp_id, _ = site(headers)
    rows = _rows(rp_id)
    if not rows:
        raise PasskeyError("No passkey is set up for this site")
    from webauthn.helpers.structs import UserVerificationRequirement
    opts = wa.generate_authentication_options(
        rp_id=rp_id, challenge=_new_challenge("login"), timeout=CHALLENGE_TTL * 1000,
        allow_credentials=_descriptors(rows), user_verification=UserVerificationRequirement.REQUIRED)
    return json.loads(wa.options_to_json(opts))


def login_verify(headers, credential: dict) -> bool:
    """True only for a valid, user-verified signature from a stored passkey for this site."""
    wa = _lib()
    if wa is None:
        return False
    rp_id, origin = site(headers)
    challenge = _take_challenge((credential.get("response") or {}).get("clientDataJSON", ""), "login")
    row = next((r for r in _rows(rp_id) if r["cred_id"] == credential.get("id")), None)
    if row is None:
        return False
    try:
        v = wa.verify_authentication_response(
            credential=credential, expected_challenge=challenge, expected_rp_id=rp_id, expected_origin=origin,
            credential_public_key=auth._unb64(row["public_key"]), credential_current_sign_count=row["sign_count"],
            require_user_verification=True)
    except Exception:
        return False
    with db.conn() as c:
        c.execute("UPDATE passkeys SET sign_count=?, last_used_at=? WHERE id=?", (v.new_sign_count, db.utcnow(), row["id"]))
    return True
