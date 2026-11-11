"""Passkey sign-in, exercised end to end with a software authenticator (a P-256 key that
signs exactly what a phone would), so the checks that matter are real: signature, challenge,
site binding, user verification, lockout, and who may add or remove a passkey."""
import hashlib
import json
import struct
import sys
from pathlib import Path

import cbor2
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import auth  # noqa: E402

OWNER_PW, DEMO_PW = "owner-password-123", "demo-password-456"
_HASHES = (auth.hash_password(OWNER_PW), auth.hash_password(DEMO_PW))
ORIGIN = "https://aero.example.com"
H = {"origin": ORIGIN}


class Phone:
    """A minimal WebAuthn authenticator."""

    def __init__(self, rp_id="aero.example.com", origin=ORIGIN, uv=True):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.cred_id = hashlib.sha256(str(id(self)).encode()).digest()[:20]
        self.rp_id, self.origin, self.uv, self.count = rp_id, origin, uv, 0

    def _client_data(self, typ, challenge):
        return json.dumps({"type": typ, "challenge": challenge, "origin": self.origin, "crossOrigin": False}).encode()

    def _auth_data(self, attested):
        flags = 0x01 | (0x04 if self.uv else 0) | (0x40 if attested else 0)
        self.count += 1
        out = hashlib.sha256(self.rp_id.encode()).digest() + bytes([flags]) + struct.pack(">I", self.count)
        if attested:
            pub = self.key.public_key().public_numbers()
            cose = cbor2.dumps({1: 2, 3: -7, -1: 1, -2: pub.x.to_bytes(32, "big"), -3: pub.y.to_bytes(32, "big")})
            out += bytes(16) + struct.pack(">H", len(self.cred_id)) + self.cred_id + cose
        return out

    def create(self, options):
        cd = self._client_data("webauthn.create", options["challenge"])
        att = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": self._auth_data(True)})
        cid = auth._b64(self.cred_id)
        return {"id": cid, "rawId": cid, "type": "public-key",
                "response": {"clientDataJSON": auth._b64(cd), "attestationObject": auth._b64(att)}}

    def get(self, options):
        cd = self._client_data("webauthn.get", options["challenge"])
        ad = self._auth_data(False)
        sig = self.key.sign(ad + hashlib.sha256(cd).digest(), ec.ECDSA(hashes.SHA256()))
        cid = auth._b64(self.cred_id)
        return {"id": cid, "rawId": cid, "type": "public-key",
                "response": {"clientDataJSON": auth._b64(cd), "authenticatorData": auth._b64(ad), "signature": auth._b64(sig)}}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_PASSWORD_HASH", _HASHES[0])
    monkeypatch.setenv("DEMO_PASSWORD_HASH", _HASHES[1])
    monkeypatch.setenv("COOKIE_SECURE", "0")
    monkeypatch.delenv("PASSKEY_ORIGIN", raising=False)
    import db
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "terminal.db")
    monkeypatch.setattr(db, "DEMO_DB_PATH", tmp_path / "demo.db")
    import passkeys
    import taxes
    db.init_db(); taxes.init(); passkeys.init()
    passkeys._challenges.clear()
    auth._fails.clear(); auth._global_fails.clear()
    from fastapi.testclient import TestClient
    import main
    return TestClient(main.app)


def login(client, pw):
    client.cookies.clear()
    assert client.post("/api/auth/login", json={"password": pw}).status_code == 200


def add_passkey(client, phone, name="iPhone"):
    opts = client.post("/api/auth/passkey/register/options", headers=H).json()
    return client.post("/api/auth/passkey/register/verify", headers=H, json={"credential": phone.create(opts), "name": name})


def sign_in(client, phone, headers=H):
    r = client.post("/api/auth/passkey/login/options", headers=headers)
    if r.status_code != 200:
        return r
    return client.post("/api/auth/passkey/login/verify", headers=headers, json={"credential": phone.get(r.json())})


def test_add_then_sign_in_with_passkey(client):
    login(client, OWNER_PW)
    phone = Phone()
    r = add_passkey(client, phone)
    assert r.status_code == 200, r.text
    assert [p["name"] for p in r.json()["passkeys"]] == ["iPhone"]
    assert client.get("/api/auth/passkey/status", headers=H).json() == {"available": True, "registered": True}

    client.cookies.clear()
    assert client.get("/api/accounts").status_code == 401
    assert sign_in(client, phone).status_code == 200
    assert client.get("/api/accounts").status_code == 200           # a real owner session
    assert client.get("/api/auth/check").json()["demo"] is False


def test_adding_needs_an_owner_session(client):
    client.cookies.clear()
    assert client.post("/api/auth/passkey/register/options", headers=H).status_code == 401
    assert client.get("/api/auth/passkeys").status_code == 401
    login(client, DEMO_PW)
    assert client.post("/api/auth/passkey/register/options", headers=H).status_code == 403
    assert client.get("/api/auth/passkeys").status_code == 403
    assert client.delete("/api/auth/passkeys/1").status_code == 403


def test_unknown_key_is_rejected_and_counts_toward_lockout(client):
    login(client, OWNER_PW)
    assert add_passkey(client, Phone()).status_code == 200
    client.cookies.clear()
    stranger = Phone()
    for _ in range(auth.MAX_FAILS_PER_IP):
        assert sign_in(client, stranger).status_code == 401
    assert sign_in(client, stranger).status_code == 429
    assert client.get("/api/accounts").status_code == 401


def test_right_id_wrong_key_is_rejected(client):
    login(client, OWNER_PW)
    phone = Phone()
    assert add_passkey(client, phone).status_code == 200
    client.cookies.clear()
    forger = Phone()
    forger.cred_id = phone.cred_id                                   # claims to be the real one, signs with its own key
    assert sign_in(client, forger).status_code == 401


def test_challenge_is_single_use(client):
    login(client, OWNER_PW)
    phone = Phone()
    assert add_passkey(client, phone).status_code == 200
    client.cookies.clear()
    opts = client.post("/api/auth/passkey/login/options", headers=H).json()
    cred = phone.get(opts)
    assert client.post("/api/auth/passkey/login/verify", headers=H, json={"credential": cred}).status_code == 200
    client.cookies.clear()
    r = client.post("/api/auth/passkey/login/verify", headers=H, json={"credential": cred})   # replay
    assert r.status_code == 400 and "expired" in r.json()["detail"]


def test_made_up_challenge_is_refused(client):
    login(client, OWNER_PW)
    phone = Phone()
    assert add_passkey(client, phone).status_code == 200
    client.cookies.clear()
    cred = phone.get({"challenge": auth._b64(b"x" * 32)})
    assert client.post("/api/auth/passkey/login/verify", headers=H, json={"credential": cred}).status_code == 400


def test_signature_made_for_another_site_is_rejected(client):
    login(client, OWNER_PW)
    phone = Phone()
    assert add_passkey(client, phone).status_code == 200
    client.cookies.clear()
    phone.origin = "https://evil.example.net"                        # a phishing page relaying to the real server
    assert sign_in(client, phone).status_code == 401
    phone.origin, phone.rp_id = ORIGIN, "evil.example.net"
    assert sign_in(client, phone).status_code == 401


def test_other_site_has_no_passkeys(client):
    login(client, OWNER_PW)
    assert add_passkey(client, Phone()).status_code == 200
    client.cookies.clear()
    other = {"origin": "https://other.example.org"}
    assert client.get("/api/auth/passkey/status", headers=other).json()["registered"] is False
    assert client.post("/api/auth/passkey/login/options", headers=other).status_code == 400


def test_user_verification_is_required(client):
    login(client, OWNER_PW)
    assert add_passkey(client, Phone(uv=False)).status_code == 400   # no Face ID / PIN: not accepted at all
    phone = Phone()
    assert add_passkey(client, phone).status_code == 200
    client.cookies.clear()
    phone.uv = False
    assert sign_in(client, phone).status_code == 401


def test_plain_http_is_refused_except_localhost(client):
    import passkeys
    with pytest.raises(passkeys.PasskeyError):
        passkeys.site({"origin": "http://aero.example.com"})
    with pytest.raises(passkeys.PasskeyError):
        passkeys.site({})
    assert passkeys.site({"origin": "http://localhost:3000"}) == ("localhost", "http://localhost:3000")
    assert passkeys.site({"origin": "https://aero.example.com"}) == ("aero.example.com", "https://aero.example.com")


def test_remove_passkey_stops_it_working(client):
    login(client, OWNER_PW)
    phone = Phone()
    pk = add_passkey(client, phone).json()["passkeys"][0]
    assert client.delete(f"/api/auth/passkeys/{pk['id']}").json()["passkeys"] == []
    client.cookies.clear()
    assert sign_in(client, phone).status_code == 400                 # nothing registered for the site any more


def test_same_device_cannot_be_added_twice(client):
    login(client, OWNER_PW)
    phone = Phone()
    assert add_passkey(client, phone).status_code == 200
    r = add_passkey(client, phone)
    assert r.status_code == 400 and "already" in r.json()["detail"]


def test_passkeys_off_without_login(client, monkeypatch):
    monkeypatch.delenv("APP_PASSWORD_HASH")
    assert client.get("/api/auth/passkey/status", headers=H).json() == {"available": False, "registered": False}
    assert client.post("/api/auth/passkey/login/options", headers=H).status_code == 400


def test_status_finds_the_site_from_the_proxy_headers(client):
    """The sign-in page asks with a plain GET (no Origin header) through the Next proxy, which
    may report the inner hop as http. The button must still show."""
    login(client, OWNER_PW)
    assert add_passkey(client, Phone()).status_code == 200
    client.cookies.clear()
    via_proxy = {"x-forwarded-host": "aero.example.com", "x-forwarded-proto": "http", "host": "127.0.0.1:8000"}
    assert client.get("/api/auth/passkey/status", headers=via_proxy).json()["registered"] is True
    assert client.get("/api/auth/passkey/status", headers={"host": "127.0.0.1:8000"}).json()["registered"] is False
