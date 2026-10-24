"""Discovery: which new articles about the companies we follow are worth fetching this cycle.

The universe is the watchlist plus whatever the portfolio holds. Three channels feed it, all set in
feeds.toml: broad RSS/Atom feeds (an item is kept only when its title names a followed company), per-ticker
feeds, and GDELT's article search (one query per company, so one event turns up from many outlets, which is
what corroboration needs). Feeds are polled conditionally and their validators live in the `feeds` table. An
article URL we've fetched before is never fetched again. Google News and MSN links are skipped: one redirects
through a script, the other is an app that renders its article in the browser, so neither gives us the text.

Company names match case-insensitively; tickers match only in capitals and only when they're 3+ letters,
so "IT" and "ON" in a headline don't pull in Gartner and onsemi.
"""
import json
import re
import time
import tomllib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, quote, urlsplit

from lxml import etree

from intel.dedup import canonical
from intel.extract import iso_utc
from intel.ingest import UA, header, scrapling_get
from intel.policy import ROOT
from intel.store import now_iso

FEEDS_PATH, WATCHLIST_PATH = ROOT / "feeds.toml", ROOT / "watchlist.toml"
GDELT = "https://api.gdeltproject.org/api/v2/doc/doc"
SKIP_HOSTS = ("news.google.com", "msn.com")   # both hand plain clients an empty page: a redirect script, or a JS app
SUFFIXES = re.compile(r"[,.]?\s+(inc|corp|corporation|co|company|ltd|plc|holdings|group|class [a-c]|common stock|"
                      r"ordinary shares|n\.?v|s\.?a|ag|se)\.?$", re.I)
SCHEMA = """
CREATE TABLE IF NOT EXISTS feeds (
  url TEXT PRIMARY KEY, fetched_at TEXT, status INTEGER, etag TEXT, last_modified TEXT, items INTEGER, error TEXT
);
"""


def init(store):
    store.con.executescript(SCHEMA)


@dataclass(frozen=True)
class Company:
    ticker: str
    name: str
    aliases: tuple = ()
    held: bool = False

    def names(self):
        return [n for n in (self.name, *self.aliases) if n]


def clean_name(description):
    name = (description or "").strip()
    while True:
        shorter = SUFFIXES.sub("", name).strip()
        if shorter == name:
            return name
        name = shorter


class Universe:
    def __init__(self, companies):
        self.companies = {c.ticker: c for c in companies}
        self._patterns = []
        for c in self.companies.values():
            parts = [re.escape(n) for n in c.names()]
            names = re.compile(r"(?<!\w)(" + "|".join(parts) + r")(?!\w)", re.I) if parts else None
            ticker = re.compile(r"(?<![A-Za-z])\$?" + re.escape(c.ticker) + r"(?![A-Za-z])") if len(c.ticker) >= 3 else None
            self._patterns.append((c, names, ticker))

    @classmethod
    def load(cls, path=WATCHLIST_PATH, holdings=()):
        """The watchlist plus holdings: (ticker, description) pairs, e.g. from the portfolio."""
        cfg = tomllib.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        out = {r["ticker"].upper(): Company(r["ticker"].upper(), r.get("name", ""), tuple(r.get("aliases", ())))
               for r in cfg.get("company", [])}
        for ticker, description in holdings:
            t = ticker.upper()
            known = out.get(t)
            out[t] = Company(t, known.name if known else clean_name(description), known.aliases if known else (), True)
        return cls(out.values())

    def match(self, text):
        return [c for c, names, ticker in self._patterns
                if (names and names.search(text or "")) or (ticker and ticker.search(text or ""))]

    def __iter__(self):
        return iter(self.companies.values())

    def __len__(self):
        return len(self.companies)


def load_config(path=FEEDS_PATH):
    return tomllib.loads(path.read_text(encoding="utf-8"))


def unwrap(url):
    """The article behind a news aggregator's click-tracking link (Bing News wraps every link in one)."""
    parts = urlsplit(url)
    if (parts.hostname or "").endswith("bing.com") and "apiclick" in parts.path:
        return (parse_qs(parts.query).get("url") or [url])[0]
    return url


def parse_feed(body):
    """Items from an RSS or Atom document: [{url, title, published}]."""
    try:
        root = etree.fromstring(body if isinstance(body, bytes) else body.encode())
    except etree.XMLSyntaxError:
        return []
    out = []
    for el in root.iter():
        if not isinstance(el.tag, str) or etree.QName(el).localname not in ("item", "entry"):
            continue
        fields = {}
        for child in el:
            if not isinstance(child.tag, str):
                continue
            name = etree.QName(child).localname
            if name == "link":
                href = child.get("href")
                if (href and child.get("rel", "alternate") == "alternate") or (not href and child.text):
                    fields.setdefault("link", (href or child.text).strip())
            elif name in ("title", "pubDate", "published", "updated", "date") and child.text:
                fields.setdefault(name, child.text.strip())
        if fields.get("link"):
            out.append({"url": unwrap(fields["link"]), "title": fields.get("title", ""),
                        "published": iso_utc(fields.get("pubDate") or fields.get("published") or fields.get("date")
                                             or fields.get("updated"))})
    return out


def poll_feed(url, store, *, get=scrapling_get):
    """A feed's items, or [] when it's unchanged (304), unreachable or not a feed."""
    init(store)
    prev = store.con.execute("SELECT etag, last_modified FROM feeds WHERE url=?", (url,)).fetchone()
    headers = {"User-Agent": UA, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml"}
    if prev and prev["etag"]:
        headers["If-None-Match"] = prev["etag"]
    if prev and prev["last_modified"]:
        headers["If-Modified-Since"] = prev["last_modified"]
    status, items, error, etag, modified = None, [], None, None, None
    try:
        r = get(url, headers)
        status, etag, modified = r.status, header(r.headers, "etag"), header(r.headers, "last-modified")
        if r.status == 200:
            items = parse_feed(r.body)
        elif r.status != 304:
            error = f"HTTP {r.status}"
    except Exception as e:  # noqa: BLE001 - one dead feed shouldn't stop the cycle
        error = f"{type(e).__name__}: {e}"
    with store.tx() as con:
        con.execute("INSERT INTO feeds(url, fetched_at, status, etag, last_modified, items, error) VALUES (?,?,?,?,?,?,?) "
                    "ON CONFLICT(url) DO UPDATE SET fetched_at=excluded.fetched_at, status=excluded.status, "
                    "etag=COALESCE(excluded.etag, feeds.etag), last_modified=COALESCE(excluded.last_modified, feeds.last_modified), "
                    "items=excluded.items, error=excluded.error",
                    (url, now_iso(), status, etag, modified, len(items), error))
    return items


def _gdelt_time(seen):
    m = re.fullmatch(r"(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z", seen or "")
    return f"{m[1]}-{m[2]}-{m[3]}T{m[4]}:{m[5]}:{m[6]}Z" if m else None


def gdelt(company, cfg, *, get=scrapling_get):
    """GDELT's article list for one company: real publisher URLs across many outlets. None when GDELT is
    throttling us (a 429, its "Please limit requests" text, or a dropped connection), so the caller can back off."""
    query = " OR ".join(f'"{n}"' for n in company.names()) or company.ticker
    query = f"({query}) sourcelang:english" if len(company.names()) > 1 else f"{query} sourcelang:english"
    url = (f"{GDELT}?query={quote(query)}&mode=artlist&format=json&sort=datedesc"
           f"&maxrecords={cfg.get('max_records', 50)}&timespan={cfg.get('timespan', '3d')}")
    try:
        r = get(url, {"User-Agent": UA, "Accept": "application/json"})
    except Exception:  # noqa: BLE001 - after a burst GDELT stops answering for a while
        return None
    if r.status == 429 or r.body.lstrip().startswith(b"Please limit"):
        return None
    try:
        data = json.loads(r.body) if r.status == 200 and r.body.strip() else {}
    except ValueError:
        return []
    return [{"url": a["url"], "title": a.get("title", ""), "published": _gdelt_time(a.get("seendate"))}
            for a in data.get("articles", []) if a.get("url")]


def _seen(store, url):
    return store.con.execute("SELECT 1 FROM fetches WHERE url=? UNION SELECT 1 FROM documents WHERE canonical_url=? LIMIT 1",
                             (url, canonical(url))).fetchone() is not None


def refusing_hosts(store, *, days=7, at_least=2):
    """Hosts that refused us (blocked) at least `at_least` times in `days`: their links aren't worth the budget."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = store.con.execute("SELECT url FROM fetches WHERE error='blocked' AND fetched_at >= ?", (since,)).fetchall()
    counts = {}
    for r in rows:
        h = (urlsplit(r["url"]).hostname or "").lower()
        counts[h] = counts.get(h, 0) + 1
    return {h for h, n in counts.items() if n >= at_least}


def discover(store, universe, cfg=None, *, get=scrapling_get, now=None, sleep=time.sleep, registry=None):
    """New article URLs worth fetching: [{url, title, published, via, tickers}]. When there are more than the
    cycle's budget, the best-sourced go first (a wire or major outlet before a rewrite site), then the newest."""
    init(store)
    cfg = cfg if cfg is not None else load_config()
    now = now or datetime.now(timezone.utc)
    oldest = (now - timedelta(days=cfg.get("lookback_days", 3))).strftime("%Y-%m-%dT%H:%M:%SZ")
    found, throttled = [], False
    for feed in cfg.get("feed", []):
        for item in poll_feed(feed["url"], store, get=get):
            hits = universe.match(item["title"])
            if hits:
                found.append({**item, "via": feed.get("name", feed["url"]), "tickers": [c.ticker for c in hits]})
    for c in universe:
        for pattern in cfg.get("ticker_feeds", {}).get("urls", []):
            url = pattern.format(ticker=quote(c.ticker), name=quote(c.name or c.ticker))
            found += [{**i, "via": f"{c.ticker} feed", "tickers": [c.ticker]} for i in poll_feed(url, store, get=get)]
        g = cfg.get("gdelt", {})
        if g.get("enabled") and not throttled:
            # GDELT allows one request per 5 seconds per IP and counts retries, so it gets a single attempt,
            # and once it says slow down, the rest of this cycle leaves it alone
            once = (lambda u, h: scrapling_get(u, h, retries=1)) if get is scrapling_get else get
            items = gdelt(c, g, get=once)
            throttled = items is None
            found += [{**i, "via": "GDELT", "tickers": [c.ticker]} for i in items or []]
            sleep(g.get("min_interval_seconds", 10))

    out, keys, refusing = {}, set(), refusing_hosts(store)
    for item in found:
        if any(h in item["url"] for h in SKIP_HOSTS) or (item["published"] and item["published"] < oldest):
            continue
        if (urlsplit(item["url"]).hostname or "").lower() in refusing:
            continue
        key = canonical(item["url"])
        if key in out:
            out[key]["tickers"] = sorted(set(out[key]["tickers"]) | set(item["tickers"]))
            continue
        if key in keys or _seen(store, item["url"]):
            keys.add(key)
            continue
        out[key] = item
    weight = (lambda i: registry.lookup(i["url"]).weight) if registry else (lambda i: 0)
    ranked = sorted(out.values(), key=lambda i: (weight(i), i["published"] or ""), reverse=True)
    return ranked[:cfg.get("max_articles", 60)]
