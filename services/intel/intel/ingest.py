"""Fetch pages with Scrapling, extract them, and file them as evidence.

Plain HTTP through Scrapling's Fetcher with a User-Agent that names us, the same way scripts/survey_venues.py
reaches the venues: no stealth mode, no bot-check solving. A site that blocks us is logged as blocked and
contributes nothing. A page we've read before is requested with If-None-Match / If-Modified-Since, so an
unchanged page costs a 304 and no new row.
"""
from intel.dedup import detect_credit, origin
from intel.extract import extract

UA = "Atropos/1.0 (personal research tool; evidence for long-term trades)"
BLOCKED = {401, 403, 407, 429, 451, 503}


def header(headers, name):
    return next((v for k, v in (headers or {}).items() if k.lower() == name), None)


def ingest(response, store, registry, *, requested_url=None, fetched_at=None):
    """Extract one Scrapling Response and file it. Returns a short summary of what was filed."""
    article = extract(response)
    credit = detect_credit(article, registry)
    src = origin(article, registry, credit)
    doc_id, new = store.put(article, origin=src, credit=credit, fetched_at=fetched_at, status=response.status,
                            raw=response.body, etag=header(response.headers, "etag"),
                            last_modified=header(response.headers, "last-modified"), requested_url=requested_url)
    return {"id": doc_id, "new": new, "status": response.status, "url": article.url, "title": article.title,
            "published": article.published, "origin": src.name, "tier": src.tier,
            "credit": credit.name if credit else None, "paywalled": article.paywalled, "stub": article.stub,
            "chars": len(article.text)}


def scrapling_get(url, headers, retries=3):
    from scrapling.fetchers import Fetcher
    return Fetcher.get(url, timeout=20, stealthy_headers=False, follow_redirects=True, headers=headers, retries=retries)


def fetch(urls, store, registry, *, get=scrapling_get):
    """Fetch and ingest each URL. `get(url, headers)` returns a Scrapling Response; tests pass their own."""
    out = []
    for url in urls:
        headers = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"}
        prev = store.last_fetch(url)
        if prev and prev["etag"]:
            headers["If-None-Match"] = prev["etag"]
        if prev and prev["last_modified"]:
            headers["If-Modified-Since"] = prev["last_modified"]
        try:
            response = get(url, headers)
        except Exception as e:  # noqa: BLE001 - a dead site is a fact to log, not a crash
            store.record_fetch(url, error=f"{type(e).__name__}: {e}")
            out.append({"url": url, "status": None, "error": str(e)})
            continue
        if response.status == 304 and prev:
            store.record_fetch(url, status=304, document_id=prev["document_id"],
                               etag=header(response.headers, "etag") or prev["etag"],
                               last_modified=header(response.headers, "last-modified") or prev["last_modified"])
            out.append({"id": prev["document_id"], "new": False, "status": 304, "url": url})
        elif response.status >= 400:
            error = "blocked" if response.status in BLOCKED else "http error"
            store.record_fetch(url, status=response.status, error=error)
            out.append({"url": url, "status": response.status, "error": error})
        else:
            out.append(ingest(response, store, registry, requested_url=url))
    return out
