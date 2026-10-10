"""Survey every prediction market we can reach for this week's macro releases.

Uses Scrapling (github.com/D4Vinci/Scrapling) as a plain HTTP client against
each venue's public API or public page: no logins, no keys, no bot-check
solving, no stealth mode. A venue that blocks us is recorded as blocked.

For each venue and each release (inflation, the Fed decision, jobs) it records
whether the venue answered, how many markets mention the release, and those
markets' titles and prices where the payload carries them.

    python -I scripts/survey_venues.py            -> prints a table, writes data/venues.json
    python -I scripts/survey_venues.py --browser  -> also opens IBKR ForecastTrader in Scrapling's browser
                                                     (headless Chromium, no stealth) and records the JSON
                                                     endpoints its app reads; that is how the public
                                                     ForecastTrader feed in lib/forecastex.js was found.
"""
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import Fetcher, DynamicFetcher

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "venues.json"

RELEASES = {
    "cpi": {"terms": ["cpi", "inflation"], "re": re.compile(r"\b(cpi|inflation)\b", re.I)},
    "fomc": {"terms": ["fed", "fomc", "interest rate"],
             "re": re.compile(r"\b(fomc|fed(eral reserve)?|fed funds|rate (cut|hike)|interest rates?)\b", re.I)},
    "nfp": {"terms": ["payrolls", "jobs report", "unemployment"],
            "re": re.compile(r"\b(payrolls?|nonfarm|non-farm|jobs report|unemployment rate|jobs added)\b", re.I)},
}

IBKR = "https://www.interactivebrokers.com/tws.proxy/public/forecasttrader/prediction"
# Requests name themselves; some feeds (IBKR) refuse anonymous clients, none needs more than that.
UA = {"User-Agent": "Atropos/1.0 (local research tool)", "Accept": "application/json, text/html"}

# Each venue: a public search URL per term (or one listing URL), and how to read it.
VENUES = [
    {"name": "Kalshi", "kind": "api",
     "urls": {"cpi": ["https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXCPIYOY&status=open&limit=100"],
              "fomc": ["https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXFED&status=open&limit=100"],
              "nfp": ["https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXPAYROLLS&status=open&limit=100"]}},
    {"name": "Polymarket", "kind": "api", "search": "https://gamma-api.polymarket.com/public-search?q={q}&limit_per_type=20"},
    {"name": "Manifold", "kind": "api", "search": "https://api.manifold.markets/v0/search-markets?term={q}&limit=25&filter=open"},
    {"name": "Limitless", "kind": "api", "search": "https://api.limitless.exchange/markets/search?query={q}"},
    {"name": "PredictIt", "kind": "api", "list": "https://www.predictit.org/api/marketdata/all/"},
    {"name": "Metaculus", "kind": "api", "search": "https://www.metaculus.com/api/posts/?search={q}&statuses=open&limit=20"},
    {"name": "Smarkets", "kind": "api", "list": "https://api.smarkets.com/v3/events/?state=upcoming&limit=100"},
    {"name": "Futuur", "kind": "api", "search": "https://api.futuur.com/api/v1/markets/?search={q}&format=json"},
    {"name": "SX Bet", "kind": "api", "list": "https://api.sx.bet/markets/active"},
    {"name": "Myriad", "kind": "page", "list": "https://myriad.markets/"},
    {"name": "Drift BET", "kind": "page", "list": "https://bet.drift.trade/"},
    {"name": "Hedgehog", "kind": "page", "list": "https://hedgehog.markets/"},
    {"name": "Insight Prediction", "kind": "page", "list": "https://insightprediction.com/"},
    {"name": "ForecastEx + Kalshi + CME (IBKR ForecastTrader)", "kind": "api",
     "urls": {"cpi": [IBKR + "/product/list?categories=g137904&sortBy=open_interest"],
              "fomc": [IBKR + "/contract/list?conid=791099758&exchange=FORECASTX"],
              "nfp": [IBKR + "/product/list?categories=g137913&sortBy=open_interest"]}},
    {"name": "Betfair Exchange", "kind": "page", "list": "https://www.betfair.com/exchange/plus/"},
    {"name": "Crypto.com Predictions", "kind": "page", "list": "https://crypto.com/us/prediction"},
]

TITLE_KEYS = ("title", "question", "name", "product_name", "strike_label", "subtitle", "yes_sub_title", "groupItemTitle", "shortName")
PRICE_KEYS = ("probability", "outcomePrices", "yes_bid", "yes_ask", "last_price", "lastTradePrice", "bestBid",
              "bestAsk", "lastTradePrice", "prices", "price", "yesPrice", "BestBuyYesCost", "LastTradePrice")


def fetch(url):
    t0 = time.time()
    try:
        page = Fetcher.get(url, timeout=20, stealthy_headers=False, follow_redirects=True, headers=UA)
        return {"status": page.status, "ms": int((time.time() - t0) * 1000), "page": page}
    except Exception as e:  # network resets, DNS, TLS: the venue is unreachable from here
        return {"status": None, "ms": int((time.time() - t0) * 1000), "error": f"{type(e).__name__}: {str(e)[:120]}"}


def walk(node, rx, found, depth=0):
    """Collect every object whose title-like field matches the release."""
    if depth > 8:
        return
    if isinstance(node, dict):
        title = next((str(node[k]) for k in TITLE_KEYS if isinstance(node.get(k), str)), None)
        if title and rx.search(title):
            price = {k: node[k] for k in PRICE_KEYS if k in node and node[k] not in (None, "", [])}
            found.append({"title": title[:160], "price": price,
                          "url": node.get("url") or node.get("slug") or node.get("ticker") or None})
        for v in node.values():
            walk(v, rx, found, depth + 1)
    elif isinstance(node, list):
        for v in node:
            walk(v, rx, found, depth + 1)


def read(res, rx):
    page = res.get("page")
    if page is None:
        return []
    found = []
    try:
        walk(page.json(), rx, found)
    except Exception:
        text = page.get_all_text(separator=" ") if hasattr(page, "get_all_text") else str(page.body)[:200000]
        found = [{"title": m.group(0), "price": {}, "url": None} for m in rx.finditer(str(text))][:20]
    seen, out = set(), []
    for f in found:
        if f["title"] not in seen:
            seen.add(f["title"]); out.append(f)
    return out


def discover_forecastex():
    """Open ForecastTrader in a real (headless) browser and list the JSON endpoints its app calls."""
    seen = []

    def setup(page):
        def on_resp(r):
            try:
                ct = (r.headers or {}).get("content-type", "")
            except Exception:
                ct = ""
            if "json" in ct and "forecasttrader" in r.url:
                seen.append({"status": r.status, "url": r.url})
        page.on("response", on_resp)

    for url in ("https://www.interactivebrokers.com/predictionmarkets/app/#/markets?category=g137904",
                "https://www.interactivebrokers.com/predictionmarkets/app/#/791099758/product-details/contracts?exchange=FORECASTX"):
        DynamicFetcher.fetch(url, headless=True, network_idle=True, google_search=False, page_setup=setup, timeout=90000, wait=3000)
    return seen


def main():
    report = {"surveyed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "tool": "Scrapling Fetcher (plain HTTP)",
              "venues": []}
    for v in VENUES:
        row = {"name": v["name"], "kind": v["kind"], "releases": {}, "reachable": False, "statuses": []}
        cache = {}
        for rid, rel in RELEASES.items():
            if "urls" in v:
                urls = v["urls"][rid]
            elif "search" in v:
                urls = [v["search"].format(q=t.replace(" ", "+")) for t in rel["terms"]]
            else:
                urls = [v["list"]]
            markets = []
            for u in urls:
                if u not in cache:
                    cache[u] = fetch(u)
                res = cache[u]
                row["statuses"].append(res.get("status") or res.get("error"))
                if res.get("status") and 200 <= res["status"] < 300:
                    row["reachable"] = True
                markets += read(res, rel["re"])
            uniq = {m["title"]: m for m in markets}
            row["releases"][rid] = {"count": len(uniq), "markets": list(uniq.values())[:12]}
        row["statuses"] = sorted({str(s) for s in row["statuses"]})
        report["venues"].append(row)
        counts = " ".join(f"{k}:{row['releases'][k]['count']:>3}" for k in RELEASES)
        print(f"{v['name']:<24} {'reachable' if row['reachable'] else 'BLOCKED  '}  {counts}   {', '.join(row['statuses'])[:70]}")
        sys.stdout.flush()
    if "--browser" in sys.argv:
        report["browser_discovery"] = discover_forecastex()
        print("browser discovery:", len(report["browser_discovery"]), "JSON endpoints")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=1, default=str), encoding="utf-8")
    print("\nwrote", OUT)


if __name__ == "__main__":
    main()
