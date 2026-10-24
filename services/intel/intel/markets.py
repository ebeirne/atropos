"""Prediction markets that bear on a story, from Polymarket and Kalshi, and whether they're worth listening to.

Polymarket has a text search (Gamma's public-search, active events only). Kalshi doesn't, so its open events
are paged in with their markets (200 a page, at most KALSHI_PAGES pages), kept in data/kalshi_events.json
for an hour, and filtered here: every query word of three or more letters that isn't a stopword has to
start some word of the event title or the market's title, subtitle or outcome. Kalshi lists its events
furthest-dated first, so the page cap reaches long-dated events before near-term ones.

Every market becomes one `Market` with prices as probabilities (0-1). `yes` is the bid/ask mid when both
sides are quoted, else the venue's last price. Polymarket volume and liquidity are USD. Kalshi volume is
contracts traded, and each contract pays $1, so it's read as dollars; Kalshi has no liquidity figure, so
open interest (also contracts) stands in. In a multi-outcome event whose markets share one title, the
question names its outcome ("Who will the next Pope be: Pietro Parolin?").

`search` never raises: a venue that's down, blocked or answers with something other than its usual JSON is
logged and left out, and the rest are still returned. `credible` is the gate's test of whether a market's
price means anything: open, a real probability, enough traded, and a tight enough spread.
"""
import json
import logging
import re
import time
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlencode

from intel.extract import iso_utc
from intel.ingest import UA, scrapling_get
from intel.policy import DATA_DIR

log = logging.getLogger("intel.markets")

GAMMA = "https://gamma-api.polymarket.com"
KALSHI = "https://api.elections.kalshi.com/trade-api/v2"
VENUES = ("polymarket", "kalshi")
KALSHI_PAGES = 10
KALSHI_TTL = 3600
KALSHI_CACHE = "kalshi_events.json"
POLYMARKET_EVENTS = 20
STOPWORDS = {"the", "and", "for", "with", "will", "what", "when", "who", "how", "are", "was", "were", "been", "from",
             "that", "this", "than", "into", "its", "their", "about", "does", "did", "has", "have", "had", "not",
             "but", "can", "could", "would", "should", "may", "might", "any", "all", "our", "per", "via", "says",
             "said", "after", "before", "over", "under", "more", "less", "out", "his", "her"}
EVENT_KEYS = ("event_ticker", "series_ticker", "title", "sub_title")
MARKET_KEYS = ("ticker", "title", "subtitle", "yes_sub_title", "status", "close_time", "yes_bid", "yes_ask",
               "last_price", "yes_bid_dollars", "yes_ask_dollars", "last_price_dollars", "volume", "volume_fp",
               "open_interest", "open_interest_fp")


@dataclass
class Market:
    venue: str
    id: str
    event: str
    question: str
    url: str
    yes: float | None
    bid: float | None
    ask: float | None
    spread: float | None
    volume: float
    liquidity: float | None
    close_time: str | None
    status: str


def to_dict(market):
    return asdict(market)


def credible(market, *, min_volume, max_spread):
    """Whether a market's price is worth weighing: open, strictly between 0 and 1, traded, and tightly quoted."""
    return (market.status == "open" and market.yes is not None and 0 < market.yes < 1
            and (market.volume or 0) >= min_volume and market.spread is not None and market.spread <= max_spread)


def search(query, *, venues=VENUES, limit=10, get=scrapling_get, cache_dir=DATA_DIR):
    """Open markets about `query` on each venue, highest volume first, at most `limit`."""
    if not (query or "").strip():
        return []
    finders = {"polymarket": lambda: polymarket(query, get=get),
               "kalshi": lambda: kalshi(query, get=get, cache_dir=cache_dir)}
    found = []
    for venue in venues:
        try:
            found += finders[venue]()
        except Exception as e:  # noqa: BLE001 - a venue that's down or changed shape is left out, not fatal
            log.warning("%s search for %r skipped: %s: %s", venue, query, type(e).__name__, e)
    return sorted((m for m in found if m.status == "open"), key=lambda m: m.volume or 0, reverse=True)[:limit]


def _json(url, get):
    r = get(url, {"User-Agent": UA, "Accept": "application/json"})
    if r.status != 200:
        raise RuntimeError(f"HTTP {r.status} from {url}")
    return json.loads(r.body)


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _list(x):
    """Gamma sends some arrays as JSON text ('["Yes", "No"]')."""
    if isinstance(x, str):
        try:
            x = json.loads(x)
        except ValueError:
            return []
    return x if isinstance(x, list) else []


def _quote(bid, ask, last):
    spread = round(ask - bid, 6) if bid is not None and ask is not None else None
    return (round((bid + ask) / 2, 6) if spread is not None else last), spread


def _with_outcome(question, outcome):
    return f"{question.rstrip(' ?')}: {outcome}?" if outcome else question


def query_words(query):
    return [w for w in re.findall(r"[a-z0-9]+", query.lower()) if len(w) >= 3 and w not in STOPWORDS]


def matches(words, text):
    have = set(re.findall(r"[a-z0-9]+", (text or "").lower()))
    return bool(words) and all(any(h.startswith(w) for h in have) for w in words)


def polymarket(query, *, get=scrapling_get):
    data = _json(f"{GAMMA}/public-search?" + urlencode({"q": query, "events_status": "active",
                                                         "limit_per_type": POLYMARKET_EVENTS}), get)
    if not isinstance(data, dict) or not isinstance(data.get("events", []), list):
        raise ValueError("not a Gamma search response")
    out = []
    for event in data.get("events") or []:
        markets = event.get("markets") or []
        shared = Counter(m.get("question") for m in markets)
        out += [_polymarket_market(event, m, len(markets), shared[m.get("question")] > 1) for m in markets]
    return out


def _polymarket_market(event, m, siblings, shared):
    outcomes, prices = _list(m.get("outcomes")), _list(m.get("outcomePrices"))
    bid, ask, given = _f(m.get("bestBid")), _f(m.get("bestAsk")), _f(m.get("spread"))
    if bid is None and ask is not None and given is not None:
        bid = round(ask - given, 6)  # Gamma leaves bestBid out when the best bid is zero
    yes, spread = _quote(bid, ask, _f(prices[0]) if prices else _f(m.get("lastTradePrice")))
    question = m.get("question") or event.get("title") or ""
    if shared:
        question = _with_outcome(question, m.get("groupItemTitle"))
    if outcomes and str(outcomes[0]).lower() != "yes":
        question = _with_outcome(question, outcomes[0])
    url = f"https://polymarket.com/event/{event.get('slug') or m.get('slug')}"
    if siblings > 1 and m.get("slug"):
        url += f"/{m['slug']}"
    live = m.get("active", True) and not m.get("closed") and not m.get("archived") and m.get("acceptingOrders", True)
    return Market(venue="polymarket", id=str(m.get("conditionId") or m.get("id")), event=event.get("title") or question,
                  question=question, url=url, yes=yes, bid=bid, ask=ask, spread=spread,
                  volume=_f(m.get("volumeNum")) or _f(m.get("volume")) or 0.0,
                  liquidity=_f(m.get("liquidityNum")) or _f(m.get("liquidity")),
                  close_time=iso_utc(m.get("endDate") or event.get("endDate")), status="open" if live else "closed")


def kalshi(query, *, get=scrapling_get, cache_dir=DATA_DIR):
    words = query_words(query)
    if not words:
        return []
    out = []
    for event in kalshi_events(get=get, cache_dir=cache_dir):
        markets = event.get("markets") or []
        shared = Counter(m.get("title") for m in markets)
        for m in markets:
            if matches(words, " ".join(filter(None, (event.get("title"), m.get("title"), m.get("subtitle"),
                                                     m.get("yes_sub_title"))))):
                out.append(_kalshi_market(event, m, shared[m.get("title")] > 1))
    return out


def kalshi_events(*, get=scrapling_get, cache_dir=DATA_DIR):
    """Kalshi's open events with their markets, trimmed to the fields we read, from cache when under an hour old."""
    path = Path(cache_dir) / KALSHI_CACHE
    if path.exists() and time.time() - path.stat().st_mtime < KALSHI_TTL:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            pass
    events, cursor = [], None
    for _ in range(KALSHI_PAGES):
        params = {"status": "open", "with_nested_markets": "true", "limit": 200, **({"cursor": cursor} if cursor else {})}
        page = _json(f"{KALSHI}/events?{urlencode(params)}", get)
        if not isinstance(page, dict) or not isinstance(page.get("events"), list):
            raise ValueError("not a Kalshi events page")
        events += [{**{k: e.get(k) for k in EVENT_KEYS},
                    "markets": [{k: m[k] for k in MARKET_KEYS if k in m} for m in e.get("markets") or []]}
                   for e in page["events"]]
        cursor = page.get("cursor")
        if not cursor or not page["events"]:
            break
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(events), encoding="utf-8")
    tmp.replace(path)
    return events


def _kalshi_price(m, key):
    dollars = _f(m.get(f"{key}_dollars"))
    if dollars is not None:
        return dollars
    cents = _f(m.get(key))
    return cents / 100 if cents is not None else None


def _kalshi_market(event, m, shared):
    bid, ask = _kalshi_price(m, "yes_bid"), _kalshi_price(m, "yes_ask")
    if not ask:
        bid = ask = None  # a zero ask is an empty book, not a price
    yes, spread = _quote(bid, ask, _kalshi_price(m, "last_price"))
    question = m.get("title") or event.get("title") or ""
    if shared:
        question = _with_outcome(question, m.get("yes_sub_title") or m.get("subtitle"))
    volume, interest = _f(m.get("volume_fp")), _f(m.get("open_interest_fp"))
    return Market(venue="kalshi", id=m.get("ticker") or "", event=event.get("title") or question, question=question,
                  url=f"https://kalshi.com/events/{event.get('event_ticker') or m.get('event_ticker')}",
                  yes=yes, bid=bid, ask=ask, spread=spread,
                  volume=volume if volume is not None else _f(m.get("volume")) or 0.0,
                  liquidity=interest if interest is not None else _f(m.get("open_interest")),
                  close_time=iso_utc(m.get("close_time")),
                  status="open" if m.get("status") in ("active", "open") else "closed")
