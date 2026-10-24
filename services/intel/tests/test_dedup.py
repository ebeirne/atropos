import pytest

from intel.dedup import (canonical, cluster, containment, corroborate, detect_credit, hamming, origin, shingles,
                         simhash)
from intel.extract import Article
from tests.conftest import URLS

STORY = ("Northwind Robotics agreed to buy its longtime sensor supplier in a cash deal that values the target at "
         "thirty eight dollars a share and is expected to close next year after regulators and shareholders sign off "
         "on the terms and the financing package the company arranged with its banks this week")
OTHER = ("Federal Reserve officials held interest rates steady on Wednesday and signaled they were in no hurry to "
         "cut again until inflation shows clearer signs of cooling toward the central bank target over the coming "
         "months according to the statement released after the two day meeting in Washington")


@pytest.mark.parametrize("raw, expected", [
    ("http://www.example.com/a/b/?utm_source=rss&utm_medium=feed", "https://example.com/a/b"),
    ("https://example.com/a?fbclid=x&id=7&gclid=y", "https://example.com/a?id=7"),
    ("https://example.com/a?b=2&a=1#comments", "https://example.com/a?a=1&b=2"),
    ("https://amp.example.com/story/amp/", "https://example.com/story"),
    ("https://example.com/story.amp.html", "https://example.com/story.html"),
    ("https://m.example.com/story", "https://example.com/story"),
    ("https://EXAMPLE.com/", "https://example.com/"),
])
def test_canonical(raw, expected):
    assert canonical(raw) == expected


def test_simhash_separates_copies_from_independent_reporting(articles):
    r = articles["reuters_original"].text
    assert hamming(simhash(r), simhash(r.replace("roughly 31%", "about 31%"))) <= 4
    assert hamming(simhash(r), simhash(articles["local_syndicated"].text)) <= 14
    assert hamming(simhash(r), simhash(articles["ap_independent"].text)) >= 20


def test_simhash_is_stable_across_runs():
    # stored hashes must mean the same thing tomorrow, so this can't depend on Python's per-process hash()
    assert f"{simhash('the quick brown fox jumps over the lazy dog'):016x}" == "e6e24a20c4a99180"


def test_truncated_copy_is_contained(articles):
    full, half = shingles(articles["reuters_original"].text), shingles(articles["local_syndicated"].text)
    assert containment(full, half) > 0.95
    assert containment(full, shingles(articles["ap_independent"].text)) < 0.1


@pytest.mark.parametrize("text, authors, expected", [
    ("NEW YORK, Oct 22 (Reuters) - Stocks rose.", [], "Reuters"),
    ("Stocks rose.\n\nReporting by A. Writer; Editing by B. Editor", [], "Reuters"),
    ("Stocks rose on Wednesday.", ["Reuters"], "Reuters"),
    ("WASHINGTON (AP) — Lawmakers met.", [], "Associated Press"),
    ("Lawmakers met.", ["The Associated Press"], "Associated Press"),
    ("(Bloomberg) -- Shares slid.", [], "Bloomberg"),
    ("SAN JOSE, Calif.--(BUSINESS WIRE)--Northwind today announced", [], "Business Wire"),
    ("CHICAGO, Oct. 22, 2026 /PRNewswire/ -- Acme today announced", [], "PR Newswire"),
    ("Stocks rose, according to the Associated Press, as traders bought.", ["Jane Doe"], None),
])
def test_detect_credit(registry, text, authors, expected):
    found = detect_credit(Article(url="https://bayareadaily.com/x", text=text, authors=authors), registry)
    assert (found.name if found else None) == expected


def test_origin_follows_a_cross_domain_canonical(registry):
    a = Article(url="https://stocknewsdaily.com/northwind", text=STORY,
                canonical_url="https://www.reuters.com/business/northwind-2026-10-22/")
    assert origin(a, registry).name == "Reuters"


def test_aggregator_without_attribution_counts_zero(registry):
    o = origin(Article(url="https://finance.yahoo.com/news/x.html", text=STORY), registry)
    assert (o.tier, o.weight) == ("aggregator", 0.0)


def test_fixture_story_has_three_independent_owners(articles, registry):
    c = corroborate(list(articles.values()), registry)
    assert {o.group for o in c.origins} == {"reuters", "ap", "businesswire.com"}
    assert c.independent == 3
    assert c.score == pytest.approx(0.9 + 0.9 + 0.5)
    assert not c.has_primary
    assert c.excluded == [URLS["wsj_paywalled"]]
    reuters = next(o for o in c.origins if o.group == "reuters")
    assert set(reuters.urls) == {URLS["reuters_original"], URLS["local_syndicated"], URLS["yahoo_repost"]}
    assert reuters.clusters == 1


def test_one_owner_counts_once(registry):
    wsj = Article(url="https://www.wsj.com/a", text=STORY, published="2026-10-22T12:00:00Z")
    mw = Article(url="https://www.marketwatch.com/b", text=OTHER, published="2026-10-22T13:00:00Z")
    c = corroborate([wsj, mw], registry)
    assert [(o.group, o.clusters, o.weight) for o in c.origins] == [("dowjones", 2, 0.75)]


def test_primary_source_is_flagged(registry):
    c = corroborate([Article(url="https://www.sec.gov/Archives/edgar/data/1/x-8k.htm", text=STORY)], registry)
    assert c.has_primary and c.origins[0].weight == 1.0


def test_short_texts_dont_merge_on_wording(registry):
    a = Article(url="https://a-news.com/1", text="Northwind buys Contoso for $4.2 billion")
    b = Article(url="https://b-news.com/2", text="Northwind buys Contoso for $4.2 billion in cash")
    assert len(cluster([a, b], registry)) == 2


def test_generic_headline_on_different_days_doesnt_merge(registry):
    title = "Stock market today: Dow, S&P 500 and Nasdaq live updates for investors"
    a = Article(url="https://cnbc.com/live/1", title=title, text=STORY, published="2026-10-21T13:00:00Z")
    b = Article(url="https://cnbc.com/live/2", title=title, text=OTHER, published="2026-10-22T13:00:00Z")
    assert len(cluster([a, b], registry)) == 2
    b.published = "2026-10-21T18:00:00Z"
    assert len(cluster([a, b], registry)) == 1
