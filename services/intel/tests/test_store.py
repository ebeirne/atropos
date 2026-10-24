from dataclasses import replace

import pytest

from intel.store import Store, to_article
from tests.conftest import URLS, html

T1, T2, T3 = "2026-10-22T13:10:00Z", "2026-10-22T15:00:00Z", "2026-10-23T09:00:00Z"


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "evidence.db")
    yield s
    s.close()


def fetches(store):
    return store.con.execute("SELECT COUNT(*) FROM fetches").fetchone()[0]


def test_same_text_is_filed_once_and_keeps_its_first_seen(store, articles):
    a = articles["reuters_original"]
    doc, new = store.put(a, fetched_at=T1)
    assert new
    assert store.put(a, fetched_at=T2) == (doc, False)
    assert store.get(doc)["first_seen"] == T1
    assert fetches(store) == 2


def test_edited_article_keeps_every_version_point_in_time(store, articles):
    v1 = articles["reuters_original"]
    v2 = replace(v1, text=v1.text.replace("about $4.2 billion", "about $4.4 billion"))
    store.put(v1, fetched_at=T1)
    store.put(v2, fetched_at=T3)
    url = URLS["reuters_original"]
    assert store.version_as_of(url, "2026-10-22T13:00:00Z") is None
    assert "$4.2 billion" in store.version_as_of(url, T2)["text"]
    assert "$4.4 billion" in store.version_as_of(url, T3)["text"]


def test_as_of_never_returns_later_knowledge(store, articles):
    store.put(articles["reuters_original"], fetched_at=T1)
    store.put(articles["ap_independent"], fetched_at=T3)
    assert [r["domain"] for r in store.as_of(T2)] == ["reuters.com"]
    assert [r["domain"] for r in store.as_of(T3, since=T2)] == ["apnews.com"]
    assert len(store.as_of(T3)) == 2


def test_the_same_text_on_two_sites_is_two_documents(store, articles):
    a = articles["reuters_original"]
    store.put(a, fetched_at=T1)
    _, new = store.put(replace(a, url="https://www.msn.com/en-us/money/x", canonical_url=""), fetched_at=T2)
    assert new


def test_origin_and_raw_html_are_kept(store, articles, registry):
    a = articles["local_syndicated"]
    reuters = registry.lookup("reuters.com")
    doc, _ = store.put(a, origin=reuters, credit=reuters, fetched_at=T1, raw=html("local_syndicated"))
    row = store.get(doc)
    assert (row["origin"], row["origin_group"], row["tier"], row["credit"]) == ("Reuters", "reuters", "wire", "Reuters")
    assert row["canonical_url"] == "https://bayareadaily.com/business/northwind-contoso-deal"
    assert "Bay Area Daily" in store.raw(doc)


def test_round_trip_back_to_an_article(store, articles):
    a = articles["reuters_original"]
    doc, _ = store.put(a, fetched_at=T1)
    back = to_article(store.get(doc))
    assert (back.text, back.authors, back.keywords, back.published) == (a.text, a.authors, a.keywords, a.published)


def test_near_finds_copies_seen_before_but_not_the_same_event_reported_separately(store, articles):
    store.put(articles["reuters_original"], fetched_at=T1)
    store.put(articles["ap_independent"], fetched_at=T1)
    hits = store.near(articles["yahoo_repost"].text)
    assert [r["domain"] for r in hits] == ["reuters.com"]
    assert store.near("too short to judge") == []


def test_last_fetch_skips_failures(store, articles):
    url = URLS["reuters_original"]
    doc, _ = store.put(articles["reuters_original"], fetched_at=T1, etag='"v1"', last_modified="Thu, 22 Oct 2026 13:05:00 GMT")
    store.record_fetch(url, status=503, error="blocked", fetched_at=T2)
    last = store.last_fetch(url)
    assert (last["document_id"], last["etag"], last["fetched_at"]) == (doc, '"v1"', T1)
