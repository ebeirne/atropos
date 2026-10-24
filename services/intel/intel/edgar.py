"""Primary-source evidence from SEC EDGAR: a listed company's own filings, filed as `primary` tier documents.

News about a merger is corroborated best by the 8-K that announces it. `ticker_map` turns a ticker into the
company's CIK using SEC's company_tickers.json (cached on disk for a day), `recent_filings` reads the
company's submissions index from data.sec.gov, and `file_primary_evidence` fetches each new filing's primary
document, extracts it like any other page and files it under SEC EDGAR. A filing's title is its company,
form and 8-K items ("Northwind Robotics, Inc. 8-K (Items 1.01, 9.01: Entry into a Material Definitive
Agreement)"), and its published time is EDGAR's acceptance time. EDGAR writes acceptanceDateTime in Eastern
wall-clock time with a trailing Z (an 18:04 acceptance falls after the 17:30 cutoff and carries the next
day's filingDate), so the Z is ignored and the time converted from New York to UTC.

SEC's fair-access rules ask for a User-Agent naming a contact and at most ten requests a second. The contact
comes from SEC_USER_AGENT (as elsewhere in Atropos); without it nothing here touches the network. Requests
are spaced DELAY seconds apart. Only `filings.recent` is read (the last year or 1,000 filings), which is all
a news check needs.
"""
import json
import logging
import os
import time
from dataclasses import replace
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from intel.extract import extract, iso_utc
from intel.ingest import BLOCKED, header, scrapling_get
from intel.policy import DATA_DIR

log = logging.getLogger(__name__)

TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
ARCHIVES = "https://www.sec.gov/Archives/edgar/data"
DEFAULT_FORMS = ("8-K", "6-K", "425", "SC TO-T", "SC 14D9", "DEFM14A", "S-4", "10-Q", "10-K")
DELAY = 0.15  # seconds between requests; SEC allows 10 a second
EASTERN = ZoneInfo("America/New_York")
ITEMS = {
    "1.01": "Entry into a Material Definitive Agreement",
    "1.02": "Termination of a Material Definitive Agreement",
    "1.03": "Bankruptcy or Receivership",
    "1.05": "Material Cybersecurity Incident",
    "2.01": "Completion of Acquisition or Disposition of Assets",
    "2.02": "Results of Operations and Financial Condition",
    "2.03": "Creation of a Direct Financial Obligation",
    "2.05": "Costs Associated with Exit or Disposal Activities",
    "2.06": "Material Impairments",
    "3.01": "Delisting Notice or Transfer of Listing",
    "3.02": "Unregistered Sales of Equity Securities",
    "4.01": "Change in Certifying Accountant",
    "4.02": "Non-Reliance on Previously Issued Financial Statements",
    "5.01": "Change in Control of Registrant",
    "5.02": "Departure/Election of Directors or Officers",
    "5.03": "Amendments to Articles of Incorporation or Bylaws",
    "5.07": "Submission of Matters to a Vote of Security Holders",
    "7.01": "Regulation FD Disclosure",
    "8.01": "Other Events",
    "9.01": "Financial Statements and Exhibits",
}

_last_request = 0.0


def normalize_ticker(ticker):
    """EDGAR's spelling of a ticker: upper case, share class after a dash ("brk.b" -> "BRK-B")."""
    return str(ticker).strip().upper().replace(".", "-").replace("/", "-")


class Tickers(dict):
    """TICKER -> {"cik", "name"} that answers to any spelling of a ticker: "BRK.B", "brk-b" and "BRK-B" are one key."""

    def __getitem__(self, key):
        return super().__getitem__(normalize_ticker(key))

    def __contains__(self, key):
        return super().__contains__(normalize_ticker(key))

    def get(self, key, default=None):
        return super().get(normalize_ticker(key), default)


_warned = False  # say once per run that EDGAR is off, not once per company


def _user_agent():
    return os.environ.get("SEC_USER_AGENT", "").strip()


def _no_contact():
    global _warned
    if _user_agent():
        return False
    if not _warned:
        _warned = True
        log.warning('SEC_USER_AGENT is not set; SEC requires a contact (e.g. "Atropos research you@example.com"), '
                    "so EDGAR is skipped")
    return True


def _request(get, url, accept):
    """One request to SEC, no sooner than DELAY after the last, carrying the contact SEC asks for."""
    global _last_request
    wait = DELAY - (time.monotonic() - _last_request)
    if wait > 0:
        time.sleep(wait)
    try:
        return get(url, {"User-Agent": _user_agent(), "Accept-Encoding": "gzip, deflate", "Accept": accept})
    finally:
        _last_request = time.monotonic()


def _json(get, url):
    """The JSON at `url`, or None (logged) when EDGAR doesn't answer with it."""
    try:
        response = _request(get, url, "application/json")
        if response.status < 400:
            return json.loads(response.body)
        log.warning("EDGAR %s: HTTP %s", url, response.status)
    except Exception as e:  # noqa: BLE001 - logged; callers get nothing rather than a crash
        log.warning("EDGAR %s: %s: %s", url, type(e).__name__, e)
    return None


def ticker_map(*, get=scrapling_get, cache=DATA_DIR / "sec_tickers.json", max_age_hours=24):
    """TICKER -> {"cik": int, "name": str} for every company EDGAR lists. A stale cache beats nothing when SEC is down."""
    if _no_contact():
        return Tickers()
    cache, cached, fresh = Path(cache) if cache else None, None, False
    if cache and cache.exists():
        try:
            cached = json.loads(cache.read_text(encoding="utf-8"))
            fresh = time.time() - cache.stat().st_mtime < max_age_hours * 3600
        except ValueError:
            cached = None
    if fresh:
        return Tickers(cached)
    data = _json(get, TICKERS_URL)
    if not isinstance(data, dict):
        return Tickers(cached or {})
    out = Tickers({normalize_ticker(r["ticker"]): {"cik": int(r["cik_str"]), "name": r["title"]} for r in data.values()})
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        tmp = cache.with_suffix(".tmp")
        tmp.write_text(json.dumps(out), encoding="utf-8")
        tmp.replace(cache)
    return out


def _cutoff(since):
    """`since` as a filing date (YYYY-MM-DD) or, when it has a time, a UTC instant."""
    s = since.isoformat() if hasattr(since, "isoformat") else str(since).strip()
    if len(s) == 10:
        return date.fromisoformat(s).isoformat()
    cutoff = iso_utc(s)
    if not cutoff:
        raise ValueError(f"since must be an ISO date or datetime, not {since!r}")
    return cutoff


def _accepted(value):
    try:
        local = datetime.fromisoformat(value[:19])
    except (TypeError, ValueError):
        return None
    return local.replace(tzinfo=EASTERN).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def recent_filings(ticker, *, since, forms=DEFAULT_FORMS, get=scrapling_get, tickers=None):
    """The company's filings of `forms` filed on/after `since`, newest first.

    `since` is a date (compared with the filing date) or a datetime (compared with the acceptance time).
    Pass `tickers` (a `ticker_map()`) to reuse one map across many calls; otherwise it's loaded here.
    """
    if _no_contact():
        return []
    key, cutoff = normalize_ticker(ticker), _cutoff(since)
    tickers = ticker_map(get=get) if tickers is None else tickers
    hit = tickers.get(key)
    if not hit:
        log.warning("EDGAR: no CIK for ticker %r", ticker)
        return []
    data = _json(get, SUBMISSIONS_URL.format(cik=hit["cik"]))
    recent = ((data or {}).get("filings") or {}).get("recent") or {}
    out = []
    for r in (dict(zip(recent, row)) for row in zip(*recent.values())):
        accepted = _accepted(r.get("acceptanceDateTime"))
        when = r["filingDate"] if len(cutoff) == 10 else accepted or f"{r['filingDate']}T00:00:00Z"
        if r.get("form") not in forms or when < cutoff:
            continue
        acc, doc = r["accessionNumber"], r.get("primaryDocument")
        folder = f"{ARCHIVES}/{hit['cik']}/{acc.replace('-', '')}"
        out.append({"ticker": key, "cik": hit["cik"], "company": data.get("name") or hit["name"], "form": r["form"],
                    "filed": r["filingDate"], "accepted": accepted, "accession": acc,
                    "items": [i.strip() for i in (r.get("items") or "").split(",") if i.strip()],
                    "description": r.get("primaryDocDescription") or "",
                    "url": f"{folder}/{doc}" if doc else f"{folder}/{acc}-index.htm"})
    out.sort(key=lambda f: (f["filed"], f["accepted"] or ""), reverse=True)
    return out


def _title(f):
    if not f["items"]:
        return f"{f['company']} {f['form']}"
    names = "; ".join(ITEMS[i] for i in f["items"] if i in ITEMS and i != "9.01")
    label = "Items" if len(f["items"]) > 1 else "Item"
    return f"{f['company']} {f['form']} ({label} {', '.join(f['items'])}{': ' + names if names else ''})"


def file_primary_evidence(ticker, store, registry, *, since, forms=DEFAULT_FORMS, get=scrapling_get, tickers=None):
    """Fetch and file each recent filing we haven't read yet. Returns one summary per filing, read before or not."""
    if _no_contact():
        return []
    sec, out = registry.lookup("sec.gov"), []
    for f in recent_filings(ticker, since=since, forms=forms, get=get, tickers=tickers):
        url, title = f["url"], _title(f)
        summary = {"form": f["form"], "filed": f["filed"], "url": url, "title": title}
        prev = store.last_fetch(url)
        if prev:
            out.append({"id": prev["document_id"], "new": False, **summary})
            continue
        try:
            response = _request(get, url, "text/html,application/xhtml+xml")
            if response.status >= 400:
                error = "blocked" if response.status in BLOCKED else "http error"
                store.record_fetch(url, status=response.status, error=error)
                out.append({"url": url, "status": response.status, "error": error})
                continue
            article = replace(extract(response), title=title, published=f["accepted"] or f"{f['filed']}T00:00:00Z")
        except Exception as e:  # noqa: BLE001 - one bad filing shouldn't stop the rest
            store.record_fetch(url, error=f"{type(e).__name__}: {e}")
            out.append({"url": url, "error": str(e)})
            continue
        doc_id, new = store.put(article, origin=sec, status=response.status, raw=response.body, requested_url=url,
                                etag=header(response.headers, "etag"),
                                last_modified=header(response.headers, "last-modified"))
        out.append({"id": doc_id, "new": new, **summary})
    return out
