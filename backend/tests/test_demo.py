"""Demo login: its own password, its own database, and no way into the real data."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import auth  # noqa: E402

OWNER_PW, DEMO_PW = "owner-password-123", "demo-password-456"
_HASHES = (auth.hash_password(OWNER_PW), auth.hash_password(DEMO_PW))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_PASSWORD_HASH", _HASHES[0])
    monkeypatch.setenv("DEMO_PASSWORD_HASH", _HASHES[1])
    monkeypatch.setenv("COOKIE_SECURE", "0")
    import db
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "terminal.db")
    monkeypatch.setattr(db, "DEMO_DB_PATH", tmp_path / "demo.db")
    import taxes
    db.init_db()
    taxes.init()
    from fastapi.testclient import TestClient
    import main
    return TestClient(main.app)  # no `with`: background loops stay off


def names(client):
    return {a["name"] for a in client.get("/api/accounts").json()["accounts"]}


def login(client, pw):
    client.cookies.clear()
    r = client.post("/api/auth/login", json={"password": pw})
    assert r.status_code == 200, r.text
    return r


def test_demo_and_owner_see_different_data(client):
    login(client, OWNER_PW)
    client.post("/api/accounts", json={"name": "Real checking", "balance": 123})
    assert client.get("/api/auth/check").json()["demo"] is False
    assert "Real checking" in names(client)

    login(client, DEMO_PW)
    assert client.get("/api/auth/check").json()["demo"] is True
    seen = names(client)
    assert "Real checking" not in seen and "Checking" in seen

    # demo edits land in demo.db only, and the next demo sign-in starts fresh
    client.post("/api/accounts", json={"name": "Visitor was here", "balance": 1})
    login(client, OWNER_PW)
    assert "Visitor was here" not in names(client)
    login(client, DEMO_PW)
    assert "Visitor was here" not in names(client)


def test_demo_blocks_exports_and_shared_lists(client):
    login(client, DEMO_PW)
    assert client.get("/api/export/db").status_code == 403
    assert client.get("/api/export/json").status_code == 403
    assert client.post("/api/backups/run").status_code == 403
    assert client.put("/api/watchlist/stocks", json={"symbols": ["X"]}).status_code == 403
    assert client.get("/api/watchlist/stocks").status_code == 200


def test_tokens_dont_cross(monkeypatch):
    monkeypatch.setenv("APP_PASSWORD_HASH", _HASHES[0])
    monkeypatch.setenv("DEMO_PASSWORD_HASH", _HASHES[1])
    owner, demo = auth.issue_token(), auth.issue_token(demo=True)
    assert auth.token_kind(owner) == "owner" and auth.token_kind(demo) == "demo"
    assert auth.token_kind("demo." + owner) is None   # an owner signature isn't a demo one
    assert auth.token_kind(demo[5:]) is None          # nor the other way round
    monkeypatch.setenv("DEMO_PASSWORD_HASH", "")
    assert auth.token_kind(demo) is None              # demo switched off: its sessions end
    assert auth.token_kind(owner) == "owner"
