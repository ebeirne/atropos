import pytest

from intel import stories
from intel.claims import file_new
from intel.store import Store
from tests.conftest import FakeClaude


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "evidence.db")
    stories.init(s)
    yield s
    s.close()


def claim(store, ticker, event, when, direction="positive", statement=None):
    doc = store.con.execute("INSERT INTO documents(canonical_url, content_hash, first_seen, url, domain, text) "
                            "VALUES (?,?,?,?,?,?)", (f"https://x.com/{when}{event}", when + event, when,
                                                     f"https://x.com/{when}{event}", "x.com", "text")).lastrowid
    store.con.execute("INSERT INTO claims(document_id, first_seen, extracted_at, extractor, ticker, event_type, statement, "
                      "direction, quote) VALUES (?,?,?,?,?,?,?,?,?)",
                      (doc, when, when, "test", ticker, event, statement or f"{ticker} {event} {when}", direction, "q"))
    store.con.commit()


def test_same_ticker_and_event_within_the_window_is_one_story(store):
    claim(store, "NWRB", "merger_acquisition", "2026-10-22T13:00:00Z")
    claim(store, "NWRB", "merger_acquisition", "2026-10-24T09:00:00Z")
    claim(store, "NWRB", "earnings", "2026-10-24T09:00:00Z")
    claim(store, "NWRB", "merger_acquisition", "2026-11-05T09:00:00Z")  # 12 days later: a new event
    assert stories.assign(store) == [1, 2, 3]
    rows = store.con.execute("SELECT story_id, COUNT(*) FROM claims GROUP BY story_id").fetchall()
    assert [tuple(r) for r in rows] == [(1, 2), (2, 1), (3, 1)]
    s = stories.get(store, 1)
    assert (s["first_seen"], s["last_seen"], s["status"]) == ("2026-10-22T13:00:00Z", "2026-10-24T09:00:00Z", "open")


def test_new_evidence_reopens_a_passed_story(store):
    claim(store, "NWRB", "merger_acquisition", "2026-10-22T13:00:00Z")
    stories.assign(store)
    stories.set_status(store, 1, "passed", {"reason": "only one source"})
    assert stories.get(store, 1)["gate"] == {"reason": "only one source"}
    claim(store, "NWRB", "merger_acquisition", "2026-10-22T18:00:00Z")
    assert stories.assign(store) == [1]
    assert stories.get(store, 1)["status"] == "open"


@pytest.mark.parametrize("dirs, way", [(["positive", "positive", "neutral"], "positive"), (["negative"], "negative"),
                                       (["positive", "negative"], "mixed"), (["neutral", "neutral"], "neutral")])
def test_direction(dirs, way):
    assert stories.direction([{"direction": d} for d in dirs]) == way


def test_story_corroboration_counts_its_documents_owners(store, articles, universe, registry):
    for name in articles:
        store.put(articles[name], fetched_at="2026-10-22T15:00:00Z")
    file_new(store, universe, ask=FakeClaude())
    assert stories.assign(store) == [1]
    c = stories.corroboration(store, registry, 1)
    assert {o.group for o in c.origins} == {"reuters", "ap", "businesswire.com"}
    assert len(stories.documents(store, 1)) == 5  # the WSJ teaser has no claims
    assert stories.documents(store, 1, as_of="2026-10-22T14:00:00Z") == []


def test_stale_stories_close(store):
    claim(store, "NWRB", "merger_acquisition", "2026-10-01T13:00:00Z")
    claim(store, "NWRB", "earnings", "2026-10-22T13:00:00Z")
    stories.assign(store)
    assert stories.close_stale(store, 7, now="2026-10-23T00:00:00Z") == 1
    assert [s["status"] for s in stories.listing(store)] == ["open", "closed"]
