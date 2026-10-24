import json

import pytest
from fastapi.testclient import TestClient

from intel import api, decide, stories
from intel.claims import file_new
from intel.dedup import origin
from intel.policy import Policy
from intel.portfolio import Portfolio
from intel.store import Store
from tests.conftest import FakeClaude
from tests.test_decide import NOW

HOLDINGS = {"source": "file", "cash": 20000, "positions": [{"symbol": "SPY", "units": 100, "price": 668.2}]}


@pytest.fixture
def client(tmp_path, monkeypatch, articles, universe, registry):
    monkeypatch.setattr(api, "DB_PATH", tmp_path / "evidence.db")
    monkeypatch.setattr(api, "DATA_DIR", tmp_path)
    monkeypatch.setenv("ATROPOS_URL", "http://127.0.0.1:9")  # nothing listens there: holdings come from the file
    monkeypatch.delenv("INTEL_KILL", raising=False)
    (tmp_path / "portfolio.json").write_text(json.dumps(HOLDINGS))
    store = Store(api.DB_PATH)
    for a in articles.values():
        store.put(a, origin=origin(a, registry), fetched_at="2026-10-22T15:00:00Z")
    file_new(store, universe, ask=FakeClaude())
    stories.assign(store)
    decide.evaluate(store, Policy(), 1, universe, Portfolio(86820, 20000, {}, "file"), registry=registry,
                    search=lambda q: [], ask=FakeClaude(), now=NOW)
    store.close()
    return TestClient(api.app, base_url="http://127.0.0.1", headers={"x-intel-client": "1"})


def test_health_and_policy(client):
    h = client.get("/health").json()
    assert h["ok"] and h["mode"] == "approve" and h["broker"] == "proposals" and not h["killed"]
    assert client.get("/policy").json()["gate"]["min_independent_major"] == 2


def test_stories_show_their_evidence_and_why(client):
    [s] = client.get("/stories").json()
    assert (s["ticker"], s["status"]) == ("NWRB", "proposed")
    detail = client.get("/stories/1").json()
    assert len(detail["claims"]) == 5 and len(detail["documents"]) == 5
    assert detail["corroboration"]["independent"] == 3
    assert detail["proposals"][0]["side"] == "buy"
    assert client.get("/stories/99").status_code == 404
    doc = client.get(f"/evidence/{detail['documents'][0]['id']}").json()
    assert doc["text"] and doc["tier"]


def test_approve_sends_it_to_the_checklist_and_you_mark_it_filled(client):
    [p] = client.get("/proposals", params={"status": "proposed"}).json()
    out = client.post(f"/proposals/{p['id']}/approve").json()
    assert (out["proposal_status"], out["status"]) == ("approved", "manual")
    [o] = client.get("/orders").json()
    assert o["status"] == "manual"
    assert client.post(f"/orders/{o['id']}", json={"status": "filled"}).json()["status"] == "filled"
    assert client.post(f"/orders/{o['id']}", json={"status": "bogus"}).status_code == 400
    assert client.post("/orders/999", json={"status": "filled"}).status_code == 400


def test_reject(client):
    out = client.post("/proposals/1/reject", json={"note": "already own enough robots"}).json()
    assert out["proposal_status"] == "rejected"
    assert client.get("/proposals").json()[0]["note"] == "already own enough robots"


def test_kill_switch(client):
    assert client.post("/kill", json={"on": True}).json() == {"killed": True}
    assert client.get("/health").json()["killed"]
    assert client.post("/proposals/1/approve").json()["proposal_status"] == "blocked"  # the guard refuses while killed
    assert client.post("/kill", json={"on": False}).json() == {"killed": False}


def test_cycle_state(client):
    assert client.get("/cycle").json()["running"] is False


def test_only_local_hosts_and_marked_writes_get_through(client):
    assert client.get("/health", headers={"host": "evil.example.com"}).status_code == 400  # DNS rebinding
    bare = TestClient(api.app, base_url="http://127.0.0.1")
    assert bare.get("/health").status_code == 200
    assert bare.post("/proposals/1/approve").status_code == 403  # what a cross-site form post would look like
    assert client.get("/proposals").json()[0]["status"] == "proposed"
