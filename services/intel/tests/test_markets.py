"""Fixtures are live responses from 2026-10-24, trimmed by hand: a Gamma public-search for "fed rate cut" (three
active events, one of their markets already closed) and two pages of Kalshi's open events joined by a cursor."""
import json
import logging
import os
import time
from dataclasses import replace

import pytest
from scrapling.engines.toolbelt.custom import Response

from intel import markets
from intel.markets import KALSHI_CACHE, Market, credible, kalshi, kalshi_events, polymarket, search, to_dict
from intel.policy import Gate
from tests.conftest import FIXTURES

POLY = "https://gamma-api.polymarket.com/public-search?q=fed+rate+cut&events_status=active&limit_per_type=20"
K1 = "https://api.elections.kalshi.com/trade-api/v2/events?status=open&with_nested_markets=true&limit=200"
K2 = K1 + "&cursor=CgYI8NbyhgcSEUtYTkNBQUZURlVULTMwV1lP"
GATE = {"min_volume": Gate().market_min_volume, "max_spread": Gate().market_max_spread}


def response(content, url, status=200):
    return Response(url=url, content=content, status=status, reason="OK", cookies={}, headers={}, request_headers={},
                    _log=False)


def fixture(name, url):
    return response((FIXTURES / f"markets_{name}.json").read_bytes(), url)


class FakeWeb:
    """Serves fixtures by URL, raises the exceptions it's given, and remembers what was asked for."""

    def __init__(self, pages):
        self.pages, self.urls = pages, []

    def __call__(self, url, headers):
        self.urls.append(url)
        page = self.pages[url]
        if isinstance(page, Exception):
            raise page
        return page


@pytest.fixture
def web():
    return FakeWeb({POLY: fixture("polymarket_search", POLY), K1: fixture("kalshi_events_p1", K1),
                    K2: fixture("kalshi_events_p2", K2)})


def by_question(found):
    return {m.question: m for m in found}


def test_polymarket_markets_parse_prices_spread_volume_url_and_close(web):
    found = by_question(polymarket("fed rate cut", get=web))
    dec = found["Fed rate cut by December 2026 meeting?"]
    assert (dec.venue, dec.event, dec.status) == ("polymarket", "Fed rate cut by...?", "open")
    assert (dec.bid, dec.ask, dec.spread, dec.yes) == (0.03, 0.033, 0.003, 0.0315)
    assert (dec.volume, dec.liquidity, dec.close_time) == (424719.098378, 57267.07057, "2027-01-29T04:59:00Z")
    assert dec.url == "https://polymarket.com/event/fed-rate-cut-by-629/fed-rate-cut-by-december-2026-meeting"
    assert dec.id.startswith("0xc60022fe")
    five = found["Will 5 Fed rate cuts happen in 2026?"]  # Gamma omits a zero bestBid
    assert (five.bid, five.ask, five.spread, five.yes) == (0.0, 0.001, 0.001, 0.0005)
    assert found["Fed emergency rate cut before 2027?"].url == "https://polymarket.com/event/fed-emergency-rate-cut-before-2027"
    assert found["Fed rate cut by January 2026 meeting?"].status == "closed"


def test_polymarket_question_names_the_outcome_when_it_is_not_yes():
    event = {"slug": "lakers-celtics", "title": "Lakers vs. Celtics", "markets": []}
    m = {"slug": "lakers-celtics", "question": "Lakers vs. Celtics", "outcomes": '["Lakers", "Celtics"]',
         "outcomePrices": '["0.41", "0.59"]', "volumeNum": 1000, "active": True, "closed": False}
    market = markets._polymarket_market(event, m, 1, False)
    assert (market.question, market.yes, market.spread, market.url) == (
        "Lakers vs. Celtics: Lakers?", 0.41, None, "https://polymarket.com/event/lakers-celtics")


def test_kalshi_markets_parse_dollar_strings(web, tmp_path):
    found = {m.id: m for m in kalshi("fed", get=web, cache_dir=tmp_path)}
    c25 = found["KXFEDDECISION-26DEC-C25"]
    assert (c25.venue, c25.event, c25.status) == ("kalshi", "Fed decision in Dec 2026?", "open")
    assert c25.question == "Will the Federal Reserve Cut rates by 25bps at their December 2026 meeting?"
    assert (c25.bid, c25.ask, c25.spread, c25.yes) == (0.01, 0.02, 0.01, 0.015)
    assert (c25.volume, c25.liquidity, c25.close_time) == (228400.72, 194351.73, "2026-12-09T18:59:00Z")
    assert c25.url == "https://kalshi.com/events/KXFEDDECISION-26DEC"
    assert found["KXFEDDECISION-26DEC-C26"].bid == 0.0  # a zero bid under a live ask is a price
    t1 = found["KXFEDFUNDSYEAR-29JAN01-T1.00"]  # no offers: Kalshi shows the ask at $1
    assert (t1.ask, t1.spread, t1.yes) == (1.0, 0.36, 0.82)


def test_kalshi_shared_titles_name_their_outcome(web, tmp_path):
    assert sorted(m.question for m in kalshi("next pope", get=web, cache_dir=tmp_path)) == [
        "Who will the next Pope be: Pierbattista Pizzaballa?", "Who will the next Pope be: Pietro Parolin?"]


def test_kalshi_integer_cents_and_empty_books():
    event = {"event_ticker": "FED-26DEC", "title": "Fed decision in Dec 2026?"}
    old = {"ticker": "FED-26DEC-C25", "title": "Cut 25bps?", "yes_bid": 44, "yes_ask": 47, "last_price": 45,
           "volume": 12000, "open_interest": 800, "status": "open", "close_time": "2026-12-09T18:59:00Z"}
    m = markets._kalshi_market(event, old, False)
    assert (m.bid, m.ask, m.spread, m.yes, m.volume, m.liquidity) == (0.44, 0.47, 0.03, 0.455, 12000.0, 800.0)
    empty = {"ticker": "X", "title": "X?", "yes_bid_dollars": "0.0000", "yes_ask_dollars": "0.0000",
             "last_price_dollars": "0.0500", "volume_fp": "10.00", "status": "active"}
    m = markets._kalshi_market(event, empty, False)
    assert (m.bid, m.ask, m.spread, m.yes) == (None, None, None, 0.05)
    assert markets._kalshi_market(event, {**empty, "status": "finalized"}, False).status == "closed"


def test_kalshi_needs_every_significant_query_word(web, tmp_path):
    ids = lambda q: sorted(m.id for m in kalshi(q, get=web, cache_dir=tmp_path))
    assert ids("Will the Fed cut rates?") == ["KXFEDDECISION-26DEC-C25", "KXFEDDECISION-26DEC-C26"]
    assert ids("fed funds rate") == ["KXFEDFUNDSYEAR-29JAN01-T1.00", "KXFEDFUNDSYEAR-29JAN01-T1.25",
                                     "KXFEDFUNDSYEAR-29JAN01-T1.50"]
    assert ids("Warsh out as Fed chair") == ["KXWARSHOUT-26JUL-27JAN01", "KXWARSHOUT-26JUL-28JAN01"]
    assert ids("fed maintains") == ["KXFEDDECISION-26DEC-H0"]  # the outcome label counts
    assert ids("AfD") == ["KXGERELECTION-29MAR25-AFD"]
    assert ids("AI") == [] and ids("will the and of") == [] and ids("Fed rate cut Mars") == []


def test_kalshi_follows_the_cursor_and_reuses_its_cache_for_an_hour(web, tmp_path):
    events = kalshi_events(get=web, cache_dir=tmp_path)
    assert web.urls == [K1, K2]
    assert [e["event_ticker"] for e in events][:2] == ["KXELONMARS-99", "KXFEDDECISION-26DEC"] and len(events) == 6
    assert "rules_primary" not in events[1]["markets"][0]  # cached trimmed
    search("fed rate cut", venues=("kalshi",), get=web, cache_dir=tmp_path)
    kalshi("pope", get=web, cache_dir=tmp_path)
    assert web.urls == [K1, K2]

    hour_ago = time.time() - 3601
    os.utime(tmp_path / KALSHI_CACHE, (hour_ago, hour_ago))
    kalshi_events(get=web, cache_dir=tmp_path)
    assert web.urls == [K1, K2, K1, K2]


def test_kalshi_stops_at_the_page_cap(tmp_path):
    asked = []

    def endless(url, headers):
        asked.append(url)
        return fixture("kalshi_events_p1", url)
    kalshi_events(get=endless, cache_dir=tmp_path)
    assert len(asked) == markets.KALSHI_PAGES


def test_search_ranks_open_markets_by_volume_across_venues(web, tmp_path):
    found = search("fed rate cut", get=web, cache_dir=tmp_path, limit=20)
    assert {m.venue for m in found} == {"polymarket", "kalshi"}
    assert all(m.status == "open" for m in found) and len(found) == 9
    assert [m.volume for m in found] == sorted((m.volume for m in found), reverse=True)
    top = search("fed rate cut", get=web, cache_dir=tmp_path, limit=3)
    assert [m.question for m in top] == ["Will no Fed rate cuts happen in 2026?", "Will 1 Fed rate cut happen in 2026?",
                                         "Will 5 Fed rate cuts happen in 2026?"]


def test_a_failing_venue_still_returns_the_other(web, tmp_path, caplog):
    web.pages[POLY] = ConnectionError("connection reset")
    with caplog.at_level(logging.WARNING, logger="intel.markets"):
        assert {m.venue for m in search("fed rate cut", get=web, cache_dir=tmp_path)} == {"kalshi"}
    assert "polymarket" in caplog.text and "connection reset" in caplog.text

    junk = FakeWeb({POLY: fixture("polymarket_search", POLY),
                    K1: response(b"<html><body>Just a moment...</body></html>", K1)})
    assert {m.venue for m in search("fed rate cut", get=junk, cache_dir=tmp_path / "fresh")} == {"polymarket"}
    down = FakeWeb({POLY: response(b'{"error": "unavailable"}', POLY, status=503), K1: TimeoutError("timed out")})
    assert search("fed rate cut", get=down, cache_dir=tmp_path / "down") == []
    assert not (tmp_path / "down" / KALSHI_CACHE).exists()


def test_credible_needs_open_real_price_volume_and_a_tight_spread():
    m = Market(venue="kalshi", id="X", event="E", question="Q?", url="u", yes=0.5, bid=0.46, ask=0.54, spread=0.08,
               volume=5000.0, liquidity=None, close_time=None, status="open")
    assert credible(m, **GATE)  # both limits are inclusive
    for change in ({"volume": 4999.99}, {"spread": 0.0801}, {"spread": None}, {"yes": 0.0}, {"yes": 1.0},
                   {"yes": None}, {"status": "closed"}):
        assert not credible(replace(m, **change), **GATE), change
    assert credible(replace(m, volume=100.0), min_volume=50, max_spread=0.08)


def test_credible_on_live_shapes(web, tmp_path):
    found = by_question(search("fed rate cut", get=web, cache_dir=tmp_path, limit=50))
    assert credible(found["Fed rate cut by December 2026 meeting?"], **GATE)
    assert not credible(found["Fed rate cut by March 2027 meeting?"], **GATE)  # $2.2k traded
    assert credible(found["Will the Federal Reserve Cut rates by 25bps at their December 2026 meeting?"], **GATE)


def test_to_dict_is_json_ready(web):
    d = to_dict(polymarket("fed rate cut", get=web)[0])
    assert {"id", "venue", "question", "yes", "volume", "close_time", "url", "spread", "status"} <= set(d)
    assert json.loads(json.dumps(d)) == d
