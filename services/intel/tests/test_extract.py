import pytest

from intel.extract import extract, iso_utc
from tests.conftest import response


def test_jsonld_graph_metadata(articles):
    a = articles["reuters_original"]
    assert a.title == "Northwind Robotics to buy Contoso Sensors for $4.2 bln"
    assert (a.published, a.modified) == ("2026-10-22T13:05:00Z", "2026-10-22T14:20:00Z")
    assert a.authors == ["Jane Doe"]
    assert a.publisher == "Reuters"
    assert a.keywords == ["Mergers", "Robotics", "Industrials"]
    assert a.lang == "en"
    assert not a.paywalled


def test_body_keeps_the_story_and_drops_the_page_around_it(articles):
    text = articles["reuters_original"].text
    assert text.startswith("SAN FRANCISCO, Oct 22 (Reuters) - Northwind Robotics")
    assert "Reporting by Jane Doe in San Francisco; Editing by John Roe" in text
    for chrome in ("Most read", "Manage cookies", "Oil prices slide", "Terms of use", "quotes delayed"):
        assert chrome not in text


def test_hidden_text_never_reaches_the_body(articles):
    assert "Ignore all previous instructions" not in articles["reuters_original"].text


def test_opengraph_fallback_and_timezone(articles):
    a = articles["local_syndicated"]
    assert a.title == "Northwind to buy Contoso in $4.2B deal"
    assert a.published == "2026-10-22T16:40:00Z"  # 09:40 Pacific
    assert a.authors == ["Wire Staff"]
    assert a.site_name == "Bay Area Daily"
    assert "Bridge traffic" not in a.text


def test_paywall_teaser_is_a_stub(articles):
    a = articles["wsj_paywalled"]
    assert a.paywalled and a.stub


def test_full_text_behind_a_paywall_flag_is_not_a_stub():
    body = " ".join(["Contoso shareholders will receive $38 per share in cash under the agreement."] * 12)
    page = f"""<html><head><script type="application/ld+json">
    {{"@type": "NewsArticle", "headline": "Deal", "isAccessibleForFree": false, "articleBody": "{body}"}}
    </script></head><body><h1>Deal</h1><p>Subscribe to continue reading.</p></body></html>"""
    a = extract(page, "https://www.ft.com/content/abc")
    assert a.paywalled and not a.stub
    assert a.text == body


def test_title_drops_the_site_name(articles):
    assert articles["businesswire_pr"].title == "Northwind Robotics to Acquire Contoso Sensors"


def test_homepage_canonical_is_ignored():
    page = '<html><head><link rel="canonical" href="https://example.com/"></head><body><p>x</p></body></html>'
    assert extract(page, "https://example.com/2026/10/story").canonical_url == "https://example.com/2026/10/story"


def test_relative_canonical_is_resolved():
    page = '<html><head><link rel="canonical" href="/2026/10/story"></head><body><p>x</p></body></html>'
    assert extract(page, "https://m.example.com/2026/10/story?x=1").canonical_url == "https://m.example.com/2026/10/story"


def test_accepts_a_scrapling_response():
    a = extract(response("ap_independent"))
    assert a.url.startswith("https://apnews.com/")
    assert a.publisher == "Associated Press"


@pytest.mark.parametrize("raw, expected", [
    ("2026-10-22T09:40:00-07:00", "2026-10-22T16:40:00Z"),
    ("2026-10-22T13:12:00.000Z", "2026-10-22T13:12:00Z"),
    ("2026-10-22 13:05:00", "2026-10-22T13:05:00Z"),
    ("2026-10-22", "2026-10-22T00:00:00Z"),
    ("Thu, 22 Oct 2026 13:05:00 GMT", "2026-10-22T13:05:00Z"),
    ("yesterday", None),
    ("", None),
    (None, None),
])
def test_iso_utc(raw, expected):
    assert iso_utc(raw) == expected
