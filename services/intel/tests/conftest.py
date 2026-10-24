"""Fixtures are hand-written pages about a made-up deal (Northwind Robotics buying Contoso Sensors), shaped like
the real thing: a Reuters original, a local paper running the wire copy, a Yahoo Finance repost, an AP story
reported separately, a WSJ paywall teaser, and the companies' Business Wire release."""
import re
from pathlib import Path

import pytest
from scrapling.engines.toolbelt.custom import Response

from intel.discover import Company, Universe
from intel.extract import extract
from intel.sources import Registry

FIXTURES = Path(__file__).parent / "fixtures"
URLS = {
    "reuters_original": "https://www.reuters.com/business/northwind-robotics-buy-contoso-sensors-42-bln-2026-10-22/",
    "local_syndicated": "https://www.bayareadaily.com/business/northwind-contoso-deal/",
    "yahoo_repost": "https://finance.yahoo.com/news/northwind-robotics-buy-contoso-sensors-130500123.html",
    "ap_independent": "https://apnews.com/article/northwind-robotics-contoso-acquisition-7f3a2b",
    "wsj_paywalled": "https://www.wsj.com/business/deals/northwind-robotics-contoso-sensors-deal-4b1c9e2a",
    "businesswire_pr": "https://www.businesswire.com/news/home/20261022005123/en/Northwind-Robotics-to-Acquire-Contoso-Sensors",
}
NORTHWIND = Company("NWRB", "Northwind Robotics", ("Northwind",))


def html(name):
    return (FIXTURES / f"{name}.html").read_bytes()


def page(url, body, status=200, headers=None):
    return Response(url=url, content=body if isinstance(body, bytes) else body.encode(), status=status, reason="OK",
                    cookies={}, headers=headers or {}, request_headers={}, _log=False)


def response(name, status=200, headers=None, url=None):
    return page(url or URLS[name], html(name), status, headers)


class FakeWeb:
    """Stands in for Scrapling's Fetcher: serves pages by URL and remembers what it was asked."""

    def __init__(self, pages):
        self.pages, self.sent, self.urls = pages, [], []

    def __call__(self, url, headers):
        self.sent.append(dict(headers))
        self.urls.append(url)
        p = self.pages[url]
        if isinstance(p, Exception):
            raise p
        return p() if callable(p) else p


class FakeClaude:
    """Answers the three prompts the service sends (claims, market bearing, thesis) from the prompt itself."""

    def __init__(self, direction="positive", action="buy", conviction=0.8, bearing="supports"):
        self.direction, self.action, self.conviction, self.bearing = direction, action, conviction, bearing
        self.calls = []

    def __call__(self, system, prompt, schema, **kw):
        from intel import claims, decide
        self.calls.append(schema)
        if schema is claims.OUTPUT:
            body = re.search(r"</title>\n(.*?)\n</article>", prompt, re.S)[1]
            quote = next((s.strip() for s in re.split(r"(?<=[.!?])\s+", body) if "Contoso" in s and len(s) > 30), None)
            return {"claims": [{"ticker": "NWRB", "event_type": "merger_acquisition", "direction": self.direction,
                                "statement": f"Northwind Robotics agreed to buy Contoso Sensors ({quote[:30]})",
                                "event_date": "2026-10-22", "quote": quote}] if quote else []}
        if schema is decide.MARKETS_OUT:
            return {"markets": [{"id": i, "bearing": self.bearing, "reason": "test"} for i in re.findall(r"id=(\S+)", prompt)]}
        if schema is decide.THESIS_OUT:
            return {"action": self.action, "conviction": self.conviction, "horizon_months": 18,
                    "thesis": "Owning its sensor supplier lowers costs.", "risks": "Integration.",
                    "invalidation": "The deal is blocked."}
        raise AssertionError("unexpected schema")


@pytest.fixture(scope="session")
def registry():
    return Registry()


@pytest.fixture(scope="session")
def articles():
    return {name: extract(html(name), url) for name, url in URLS.items()}


@pytest.fixture
def universe():
    return Universe([NORTHWIND])
