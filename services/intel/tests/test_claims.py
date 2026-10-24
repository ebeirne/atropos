import pytest

from intel import claims
from intel.claims import extract_claims, file_new, grounded
from intel.store import Store
from tests.conftest import FakeClaude


@pytest.fixture
def store(tmp_path, articles):
    s = Store(tmp_path / "evidence.db")
    yield s
    s.close()


def test_grounded_tolerates_typography_but_not_invention():
    text = "“Every robot we ship depends on what Contoso builds,” Alvarez said — in a call."
    assert grounded('"Every robot we ship  depends on what Contoso builds,"', text)
    assert grounded("Alvarez said - in a call", text)
    assert not grounded("Contoso will double its revenue next year", text)
    assert not grounded("Contoso", text)  # too short to pin anything to


def test_claims_must_quote_the_article_and_name_a_followed_company(articles, universe):
    a = articles["reuters_original"]

    def ask(system, prompt, schema, **kw):
        good = "The deal values Contoso at $38 per share, a premium of roughly 31% to its closing price on Tuesday."
        return {"claims": [
            {"ticker": "NASDAQ:NWRB", "event_type": "merger_acquisition", "statement": "Northwind buys Contoso at $38",
             "direction": "positive", "event_date": "2026-10-22", "quote": good},
            {"ticker": "NWRB", "event_type": "guidance", "statement": "Northwind raises guidance",
             "direction": "positive", "event_date": "", "quote": "Northwind raised its full-year guidance to $9 a share."},
            {"ticker": "CTSO", "event_type": "merger_acquisition", "statement": "Contoso is bought",
             "direction": "positive", "event_date": "", "quote": good},
        ]}
    kept, extractor = extract_claims(a, universe, ask=ask)
    assert extractor == "claude-opus-5-5"
    assert [(c["ticker"], c["statement"]) for c in kept] == [("NWRB", "Northwind buys Contoso at $38")]


def test_without_claude_the_fallback_files_neutral_claims(articles, universe, monkeypatch):
    monkeypatch.setattr(claims.llm, "available", lambda: False)
    kept, extractor = extract_claims(articles["reuters_original"], universe)
    assert extractor == "heuristic"
    assert kept and all(c["direction"] == "neutral" for c in kept)
    assert kept[0]["event_type"] == "merger_acquisition"
    assert all(grounded(c["quote"], articles["reuters_original"].text) for c in kept)


def test_articles_about_nobody_we_follow_cost_no_model_call(universe):
    from intel.extract import Article
    calls = []
    kept, _ = extract_claims(Article(url="https://x.com/a", title="Oil slides", text="Crude fell 3% on Tuesday."),
                             universe, ask=lambda *a, **k: calls.append(1))
    assert kept == [] and calls == []


def test_file_new_reads_each_document_once_and_skips_teasers(store, articles, universe):
    for name in ("reuters_original", "wsj_paywalled", "ap_independent"):
        store.put(articles[name], fetched_at="2026-10-22T15:00:00Z")
    claude = FakeClaude()
    new = file_new(store, universe, ask=claude)
    assert len(new) == 2 and len(claude.calls) == 2  # the WSJ teaser isn't read
    rows = store.con.execute("SELECT extractor, claims FROM extractions ORDER BY document_id").fetchall()
    assert [tuple(r) for r in rows] == [("claude-opus-5-5", 1), ("skipped: paywall teaser", 0), ("claude-opus-5-5", 1)]
    assert file_new(store, universe, ask=claude) == [] and len(claude.calls) == 2
    c = store.con.execute("SELECT * FROM claims ORDER BY id").fetchone()
    assert c["first_seen"] == "2026-10-22T15:00:00Z" and c["story_id"] is None
    assert claims.for_story(store, 1) == []


def test_fallback_reads_are_read_again_once_claude_is_back(store, articles, universe, monkeypatch):
    from intel import stories
    monkeypatch.setattr(claims.llm, "available", lambda: False)
    store.put(articles["reuters_original"], fetched_at="2026-10-22T15:00:00Z")
    first = file_new(store, universe)
    assert first and {c["direction"] for c in first} == {"neutral"}
    stories.assign(store)
    assert file_new(store, universe) == []          # still no Claude: nothing to do again
    again = file_new(store, universe, ask=FakeClaude())
    assert [c["direction"] for c in again] == ["positive"]
    assert {r[0] for r in store.con.execute("SELECT extractor FROM claims")} == {"claude-opus-5-5"}
    stories.assign(store)
    statuses = [s["status"] for s in stories.listing(store)]
    assert statuses.count("open") == 1 and set(statuses) == {"open", "closed"}   # the neutral stories are gone


def test_a_failed_claude_read_is_not_retried_every_cycle(store, articles, universe):
    store.put(articles["reuters_original"], fetched_at="2026-10-22T15:00:00Z")
    file_new(store, universe, ask=lambda *a, **k: None)
    assert store.con.execute("SELECT extractor FROM extractions").fetchone()[0] == "heuristic: no answer"
    calls = []
    assert file_new(store, universe, ask=lambda *a, **k: calls.append(1)) == [] and calls == []
