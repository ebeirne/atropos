import json

import pytest

import intel.__main__ as cli
from intel import ingest as ingest_mod
from intel.ingest import UA, fetch, ingest
from intel.store import Store
from tests.conftest import URLS, FakeWeb, response


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "evidence.db")
    yield s
    s.close()


def test_ingest_files_a_syndicated_copy_under_its_wire(store, registry):
    out = ingest(response("local_syndicated"), store, registry)
    assert (out["new"], out["origin"], out["credit"], out["tier"]) == (True, "Reuters", "Reuters", "wire")
    assert store.get(out["id"])["origin_group"] == "reuters"


def test_second_fetch_is_conditional_and_a_304_files_nothing(store, registry):
    url = URLS["reuters_original"]
    validators = {"ETag": '"v1"', "Last-Modified": "Thu, 22 Oct 2026 13:05:00 GMT"}
    web = FakeWeb({url: lambda: response("reuters_original", headers=validators)})
    first = fetch([url], store, registry, get=web)[0]
    assert first["new"] and web.sent[0]["User-Agent"] == UA
    assert "If-None-Match" not in web.sent[0]

    web.pages[url] = response("reuters_original", status=304, headers={})
    second = fetch([url], store, registry, get=web)[0]
    assert web.sent[1]["If-None-Match"] == '"v1"'
    assert web.sent[1]["If-Modified-Since"] == "Thu, 22 Oct 2026 13:05:00 GMT"
    assert (second["status"], second["id"], second["new"]) == (304, first["id"], False)
    assert store.con.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 1
    assert store.last_fetch(url)["etag"] == '"v1"'  # carried forward for the next poll


def test_blocks_and_dead_sites_are_logged_not_filed(store, registry):
    web = FakeWeb({"https://blocked.example/a": response("ap_independent", status=403, url="https://blocked.example/a"),
                   "https://dead.example/b": ConnectionError("connection refused")})
    out = fetch(["https://blocked.example/a", "https://dead.example/b"], store, registry, get=web)
    assert [o["error"] for o in out] == ["blocked", "connection refused"]
    assert store.con.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 0
    assert store.con.execute("SELECT COUNT(*) FROM fetches").fetchone()[0] == 2


def test_cli_corroborate(tmp_path, monkeypatch, capsys):
    web = FakeWeb({url: (lambda name=name: response(name)) for name, url in URLS.items()})
    monkeypatch.setattr(cli, "fetch", lambda urls, store, registry: ingest_mod.fetch(urls, store, registry, get=web))
    cli.main(["--db", str(tmp_path / "e.db"), "corroborate", *URLS.values()])
    out = capsys.readouterr().out
    summary = json.loads(out[out.index("{\n"):])
    assert (summary["independent"], summary["has_primary"]) == (3, False)
    assert summary["excluded"] == [URLS["wsj_paywalled"]]
