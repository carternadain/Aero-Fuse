"""The target mix is saved with the other settings and rejected unless it adds up to 100."""
import pytest
from fastapi.testclient import TestClient

import db


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db")
    db.init_db()
    import main
    return TestClient(main.app)


def test_no_targets_until_set(client):
    assert client.get("/api/settings").json()["rebalance_targets"] is None


def test_saves_and_returns_targets_without_touching_other_settings(client):
    client.put("/api/settings", json={"monthly_expenses": 3000})
    r = client.put("/api/settings", json={"rebalance_targets": {"investing": 60, "retirement": 25, "crypto": 10, "cash": 5}})
    assert r.status_code == 200
    j = client.get("/api/settings").json()
    assert j["rebalance_targets"] == {"investing": 60.0, "retirement": 25.0, "crypto": 10.0, "cash": 5.0}
    assert j["monthly_expenses"] == 3000


@pytest.mark.parametrize("bad", [
    {"investing": 60, "retirement": 25, "crypto": 10, "cash": 10},
    {"investing": 120, "retirement": -20, "crypto": 0, "cash": 0},
])
def test_rejects_a_mix_that_is_not_100(client, bad):
    assert client.put("/api/settings", json={"rebalance_targets": bad}).status_code == 422
    assert client.get("/api/settings").json()["rebalance_targets"] is None


def test_clearing(client):
    client.put("/api/settings", json={"rebalance_targets": {"investing": 100}})
    assert client.get("/api/settings").json()["rebalance_targets"]["cash"] == 0
    client.put("/api/settings", json={"rebalance_targets": None})
    assert client.get("/api/settings").json()["rebalance_targets"] is None
