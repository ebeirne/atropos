"""Fixtures are hand-written pages about a made-up deal (Northwind Robotics buying Contoso Sensors), shaped like
the real thing: a Reuters original, a local paper running the wire copy, a Yahoo Finance repost, an AP story
reported separately, a WSJ paywall teaser, and the companies' Business Wire release."""
from pathlib import Path

import pytest
from scrapling.engines.toolbelt.custom import Response

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


def html(name):
    return (FIXTURES / f"{name}.html").read_bytes()


def response(name, status=200, headers=None, url=None):
    return Response(url=url or URLS[name], content=html(name), status=status, reason="OK", cookies={},
                    headers=headers or {}, request_headers={}, _log=False)


@pytest.fixture(scope="session")
def registry():
    return Registry()


@pytest.fixture(scope="session")
def articles():
    return {name: extract(html(name), url) for name, url in URLS.items()}
