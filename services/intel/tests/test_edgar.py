import logging
import os
import time

import pytest
from scrapling.engines.toolbelt.custom import Response

from intel import edgar
from intel.dedup import corroborate
from intel.edgar import TICKERS_URL, file_primary_evidence, recent_filings, ticker_map
from intel.store import Store, to_article
from tests.conftest import FIXTURES, FakeWeb

UA = "Atropos research test@example.com"
SUBMISSIONS = "https://data.sec.gov/submissions/CIK0001999001.json"
FILING = "https://www.sec.gov/Archives/edgar/data/1999001/"
EIGHT_K = FILING + "000119312526412290/d812290d8k.htm"
FORM_425 = FILING + "000119312526412377/d812377d425.htm"
TEN_Q = FILING + "000199900126000031/nwrb-20260630.htm"


def sec(name, url, status=200, headers=None):
    return Response(url=url, content=(FIXTURES / name).read_bytes(), status=status, reason="OK", cookies={},
                    headers=headers or {}, request_headers={}, _log=False)


FakeSEC = FakeWeb  # remembers the URLs it was asked for


@pytest.fixture(autouse=True)
def contact(monkeypatch):
    monkeypatch.setenv("SEC_USER_AGENT", UA)
    monkeypatch.setattr(edgar, "DELAY", 0)


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "evidence.db")
    yield s
    s.close()


@pytest.fixture
def tickers(tmp_path):
    return ticker_map(get=FakeSEC({TICKERS_URL: sec("sec_company_tickers.json", TICKERS_URL)}), cache=tmp_path / "t.json")


def web(**extra):
    return FakeSEC({SUBMISSIONS: lambda: sec("sec_submissions_nwrb.json", SUBMISSIONS),
                    EIGHT_K: lambda: sec("sec_8k_nwrb.htm", EIGHT_K, headers={"ETag": '"8k-v1"'}), **extra})


def test_without_a_contact_nothing_is_requested(monkeypatch, tmp_path, store, registry, caplog):
    monkeypatch.delenv("SEC_USER_AGENT")
    monkeypatch.setattr(edgar, "_warned", False)
    w = web()
    with caplog.at_level(logging.WARNING, logger="intel.edgar"):
        assert ticker_map(get=w, cache=tmp_path / "t.json") == {}
        assert recent_filings("NWRB", since="2026-01-01", get=w) == []
        assert file_primary_evidence("NWRB", store, registry, since="2026-01-01", get=w) == []
    assert w.urls == [] and not (tmp_path / "t.json").exists()
    assert sum("SEC_USER_AGENT" in r.message for r in caplog.records) == 1  # once per run, not per company


def test_ticker_map_normalizes_and_reuses_its_cache(tmp_path):
    cache = tmp_path / "t.json"
    w = FakeSEC({TICKERS_URL: lambda: sec("sec_company_tickers.json", TICKERS_URL)})
    m = ticker_map(get=w, cache=cache)
    assert m["NWRB"] == {"cik": 1999001, "name": "Northwind Robotics, Inc."}
    assert m["BRK.B"] == m["brk-b"] == m["BRK-B"] == {"cik": 1067983, "name": "BERKSHIRE HATHAWAY INC"}
    assert "brk.b" in m and m.get("nope") is None and len(m) == 3
    assert w.sent[0]["User-Agent"] == UA and "gzip" in w.sent[0]["Accept-Encoding"]

    assert ticker_map(get=w, cache=cache)["brk.b"]["cik"] == 1067983 and len(w.urls) == 1  # from disk
    old = time.time() - 25 * 3600
    os.utime(cache, (old, old))
    assert ticker_map(get=w, cache=cache) == m and len(w.urls) == 2  # stale: fetched again
    os.utime(cache, (old, old))
    assert ticker_map(get=FakeSEC({TICKERS_URL: ConnectionError("down")}), cache=cache) == m  # stale beats nothing


def test_recent_filings_filter_by_date_and_form(tickers):
    w = web()
    out = recent_filings("nwrb", since="2026-08-01", get=w, tickers=tickers)
    assert [(f["form"], f["filed"]) for f in out] == [("425", "2026-10-22"), ("8-K", "2026-10-22"), ("10-Q", "2026-08-06")]
    assert out[1] == {"ticker": "NWRB", "cik": 1999001, "company": "Northwind Robotics, Inc.", "form": "8-K",
                      "filed": "2026-10-22", "accepted": "2026-10-22T11:05:33Z", "accession": "0001193125-26-412290",
                      "items": ["1.01", "9.01"], "description": "8-K", "url": EIGHT_K}
    assert [f["url"] for f in out] == [FORM_425, EIGHT_K, TEN_Q] and out[0]["items"] == []
    assert w.urls == [SUBMISSIONS] and w.sent[0]["User-Agent"] == UA

    eight_ks = recent_filings("NWRB", since="2025-01-01", forms=("8-K",), get=w, tickers=tickers)
    assert [(f["filed"], f["items"]) for f in eight_ks] == [("2026-10-22", ["1.01", "9.01"]), ("2025-02-12", ["2.02", "9.01"])]
    assert eight_ks[1]["accepted"] == "2025-02-12T21:05:12Z"  # EST in February
    assert [f["form"] for f in recent_filings("NWRB", since="2026-10-22T12:00:00Z", get=w, tickers=tickers)] == ["425"]
    assert recent_filings("ZZZZ", since="2026-01-01", get=w, tickers=tickers) == []


def test_an_8k_is_filed_as_primary_evidence(store, registry, tickers, articles):
    w = web()
    out = file_primary_evidence("NWRB", store, registry, since="2026-10-01", forms=("8-K",), get=w, tickers=tickers)
    assert [(o["new"], o["form"], o["filed"], o["url"]) for o in out] == [(True, "8-K", "2026-10-22", EIGHT_K)]
    doc = store.get(out[0]["id"])
    assert (doc["origin"], doc["tier"], doc["published"]) == ("SEC EDGAR", "primary", "2026-10-22T11:05:33Z")
    assert doc["title"] == out[0]["title"] == \
        "Northwind Robotics, Inc. 8-K (Items 1.01, 9.01: Entry into a Material Definitive Agreement)"
    assert "$38.00 per share in cash" in doc["text"] and "FORM 8-K" in store.raw(out[0]["id"])
    assert store.last_fetch(EIGHT_K)["etag"] == '"8k-v1"'
    assert all(h["User-Agent"] == UA for h in w.sent)

    news = [articles["reuters_original"], articles["ap_independent"], articles["businesswire_pr"]]
    assert not corroborate(news, registry).has_primary
    assert corroborate(news + [to_article(doc)], registry).has_primary


def test_a_second_call_skips_filings_already_read(store, registry, tickers):
    w = web()
    first = file_primary_evidence("NWRB", store, registry, since="2026-10-01", forms=("8-K",), get=w, tickers=tickers)
    second = file_primary_evidence("NWRB", store, registry, since="2026-10-01", forms=("8-K",), get=w, tickers=tickers)
    assert w.urls.count(EIGHT_K) == 1
    assert second == [{**first[0], "new": False}]
    assert store.con.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 1


def test_fetch_errors_are_logged_and_retried_next_time(store, registry, tickers):
    w = web(**{EIGHT_K: ConnectionError("connection reset"), FORM_425: lambda: sec("sec_8k_nwrb.htm", FORM_425, status=403)})
    out = file_primary_evidence("NWRB", store, registry, since="2026-10-01", forms=("8-K", "425"), get=w, tickers=tickers)
    assert out == [{"url": FORM_425, "status": 403, "error": "blocked"}, {"url": EIGHT_K, "error": "connection reset"}]
    rows = store.con.execute("SELECT url, status, error, document_id FROM fetches ORDER BY id").fetchall()
    assert [tuple(r) for r in rows] == [(FORM_425, 403, "blocked", None),
                                        (EIGHT_K, None, "ConnectionError: connection reset", None)]
    assert store.con.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 0

    w.pages[EIGHT_K] = lambda: sec("sec_8k_nwrb.htm", EIGHT_K)
    again = file_primary_evidence("NWRB", store, registry, since="2026-10-01", forms=("8-K",), get=w, tickers=tickers)
    assert again[0]["new"] and w.urls.count(EIGHT_K) == 2
