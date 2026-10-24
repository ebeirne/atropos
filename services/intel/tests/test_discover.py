import json
from datetime import datetime, timezone

import pytest

from intel.discover import Company, Universe, clean_name, discover, parse_feed, poll_feed
from intel.store import Store
from tests.conftest import NORTHWIND, URLS, FakeWeb, page

NOW = datetime(2026, 10, 23, 12, tzinfo=timezone.utc)
RSS = """<?xml version="1.0"?><rss version="2.0"><channel><title>Business</title>
<item><title>Northwind Robotics to buy Contoso Sensors for $4.2 bln</title><link>{reuters}</link>
  <pubDate>Thu, 22 Oct 2026 13:05:00 GMT</pubDate></item>
<item><title>Oil slides as inventories build</title><link>https://example.com/oil</link>
  <pubDate>Thu, 22 Oct 2026 14:00:00 GMT</pubDate></item>
<item><title>Northwind's old news</title><link>https://example.com/old</link>
  <pubDate>Mon, 12 Oct 2026 09:00:00 GMT</pubDate></item>
<item><title>Northwind via Google</title><link>https://news.google.com/rss/articles/CBMiXYZ</link>
  <pubDate>Thu, 22 Oct 2026 15:00:00 GMT</pubDate></item>
</channel></rss>""".format(reuters=URLS["reuters_original"])
ATOM = """<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>AP</title>
<entry><title>Robot maker Northwind will pay $4.2 billion</title>
  <link rel="alternate" href="{ap}"/><link rel="self" href="https://apnews.com/feed/self"/>
  <published>2026-10-22T14:30:00Z</published></entry>
</feed>""".format(ap=URLS["ap_independent"])


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "evidence.db")
    yield s
    s.close()


def test_universe_is_watchlist_plus_holdings(tmp_path):
    wl = tmp_path / "watchlist.toml"
    wl.write_text('[[company]]\nticker = "googl"\nname = "Alphabet"\naliases = ["Google"]\n')
    u = Universe.load(wl, holdings=[("NVDA", "NVIDIA Corp"), ("GOOGL", "Alphabet Inc. Class A")])
    assert set(u.companies) == {"GOOGL", "NVDA"}
    assert u.companies["GOOGL"].aliases == ("Google",) and u.companies["GOOGL"].held
    assert u.companies["NVDA"].name == "NVIDIA"


@pytest.mark.parametrize("raw, clean", [("NVIDIA Corp", "NVIDIA"), ("Apple Inc.", "Apple"),
                                        ("Alphabet Inc. Class A", "Alphabet"), ("Banco Santander, S.A.", "Banco Santander")])
def test_clean_name(raw, clean):
    assert clean_name(raw) == clean


def test_names_match_in_any_case_and_tickers_only_in_capitals():
    u = Universe([NORTHWIND, Company("ON", "onsemi"), Company("AMZN", "Amazon")])
    assert [c.ticker for c in u.match("NORTHWIND shares jump")] == ["NWRB"]
    assert [c.ticker for c in u.match("Traders piled into $AMZN")] == ["AMZN"]
    assert u.match("amzn is a lowercase word here") == []
    assert u.match("Stocks rose on Monday") == []  # a two-letter ticker never matches on its own


def test_parse_rss_and_atom():
    rss = parse_feed(RSS)
    assert rss[0] == {"url": URLS["reuters_original"], "title": "Northwind Robotics to buy Contoso Sensors for $4.2 bln",
                      "published": "2026-10-22T13:05:00Z"}
    atom = parse_feed(ATOM)
    assert atom == [{"url": URLS["ap_independent"], "title": "Robot maker Northwind will pay $4.2 billion",
                     "published": "2026-10-22T14:30:00Z"}]
    assert parse_feed(b"<html>not a feed") == []


def test_feeds_are_polled_conditionally(store):
    url = "https://feeds.example.com/business.rss"
    web = FakeWeb({url: page(url, RSS, headers={"ETag": '"f1"'})})
    assert len(poll_feed(url, store, get=web)) == 4
    web.pages[url] = page(url, "", status=304)
    assert poll_feed(url, store, get=web) == []
    assert web.sent[1]["If-None-Match"] == '"f1"'


def test_discover_keeps_fresh_unseen_articles_about_followed_companies(store, universe):
    feed, ticker_feed = "https://feeds.example.com/business.rss", "https://tickers.example.com/NWRB"
    gdelt = {"articles": [{"url": URLS["local_syndicated"], "title": "Northwind to buy Contoso", "seendate": "20261022T164000Z"},
                          {"url": URLS["reuters_original"] + "?utm_source=gdelt", "title": "dup", "seendate": "20261022T130500Z"}]}
    pages = {feed: page(feed, RSS), ticker_feed: page(ticker_feed, ATOM)}

    def web(url, headers):
        if url.startswith("https://api.gdeltproject.org/"):
            assert "Northwind" in url
            return page(url, json.dumps(gdelt))
        return pages[url]

    cfg = {"lookback_days": 3, "max_articles": 10, "feed": [{"name": "Biz", "url": feed}],
           "ticker_feeds": {"urls": ["https://tickers.example.com/{ticker}"]}, "gdelt": {"enabled": True}}
    found = discover(store, universe, cfg, get=web, now=NOW, sleep=lambda s: None)
    assert [f["url"] for f in found] == [URLS["local_syndicated"], URLS["ap_independent"], URLS["reuters_original"]]
    assert found[0]["via"] == "GDELT" and found[2]["tickers"] == ["NWRB"]

    store.record_fetch(URLS["ap_independent"], status=200)  # fetched before: never again
    found = discover(store, universe, cfg, get=web, now=NOW, sleep=lambda s: None)
    assert URLS["ap_independent"] not in [f["url"] for f in found]


def test_gdelt_throttling_stops_gdelt_for_the_rest_of_the_cycle(store):
    from intel.discover import Company
    u = Universe([NORTHWIND, Company("CTSO", "Contoso Sensors"), Company("AMZN", "Amazon")])
    asked = []

    def web(url, headers):
        asked.append(url)
        return page(url, b"Please limit requests to one every 5 seconds")
    found = discover(store, u, {"gdelt": {"enabled": True}}, get=web, now=NOW, sleep=lambda s: None)
    assert found == [] and len(asked) == 1


def test_bing_click_tracking_links_are_unwrapped():
    from intel.discover import unwrap
    rss = ('<rss><channel><item><title>Nvidia beats</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;'
           'tid=abc&amp;url=https%3a%2f%2fwww.cnbc.com%2f2026%2f10%2f23%2fnvidia.html&amp;c=1</link>'
           '<pubDate>Fri, 23 Oct 2026 04:00:00 GMT</pubDate></item></channel></rss>')
    assert parse_feed(rss)[0]["url"] == "https://www.cnbc.com/2026/10/23/nvidia.html"
    assert unwrap("https://www.reuters.com/x") == "https://www.reuters.com/x"
