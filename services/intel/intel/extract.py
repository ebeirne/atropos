"""Turn one fetched page into an Article: clean body text plus the metadata corroboration needs.

Metadata comes from the page's own structured data first (JSON-LD NewsArticle and friends, including
@graph), then OpenGraph / article:* meta tags, then trafilatura's guesses. Body text is trafilatura's
main-content extraction, run on the page after Scrapling's AI sanitizer has dropped hidden elements,
comments and zero-width characters, so text planted for a model to read never reaches the agent. When
the page's JSON-LD carries a longer articleBody (common behind paywalls), that wins.

All dates come out as UTC ISO-8601 (`2026-10-22T14:05:00Z`); a date with no zone is taken as UTC.
"""
import json
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin, urlsplit

import trafilatura
from scrapling.core.shell import Convertor
from scrapling.parser import Selector

ARTICLE_TYPES = {"NewsArticle", "Article", "ReportageNews", "AnalysisNewsArticle", "BackgroundNewsArticle",
                 "OpinionNewsArticle", "ReviewNewsArticle", "LiveBlogPosting", "BlogPosting", "Report",
                 "TechArticle", "ScholarlyArticle"}
PAYWALL_RE = re.compile(r"subscribe to (continue|read|keep reading)|to continue reading|already a subscriber|"
                        r"subscribers? only|sign in to (read|continue)", re.I)
ZW_RE = re.compile("[​-‏⁠-⁤﻿]")
STUB_CHARS = 600  # a paywalled page with less body than this is a teaser, not evidence


@dataclass
class Article:
    url: str
    title: str = ""
    text: str = ""
    canonical_url: str = ""
    published: str | None = None
    modified: str | None = None
    authors: list = field(default_factory=list)
    publisher: str | None = None
    site_name: str | None = None
    keywords: list = field(default_factory=list)
    lang: str | None = None
    paywalled: bool = False

    @property
    def stub(self):
        return self.paywalled and len(self.text) < STUB_CHARS

    def to_dict(self):
        return asdict(self)


def iso_utc(value):
    """Best-effort parse of the date strings publishers use, to UTC ISO-8601. None when unreadable."""
    if not value or not isinstance(value, str):
        return None
    value = value.strip()
    dt = None
    try:
        dt = datetime.fromisoformat(value.replace(" ", "T", 1) if re.match(r"\d{4}-\d\d-\d\d \d", value) else value)
    except ValueError:
        try:
            dt = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _as_list(v):
    return v if isinstance(v, list) else [] if v is None else [v]


def _types(node):
    return {t.rsplit("/", 1)[-1] for t in _as_list(node.get("@type")) if isinstance(t, str)}


def _jsonld_nodes(page):
    out = []
    for script in page.css('script[type="application/ld+json"]'):
        try:
            data = json.loads(str(script.text), strict=False)
        except ValueError:
            continue
        stack = _as_list(data)
        while stack:
            node = stack.pop(0)
            if isinstance(node, dict):
                out.append(node)
                stack.extend(_as_list(node.get("@graph")))
            elif isinstance(node, list):
                stack.extend(node)
    return out


def _article_node(nodes):
    return next((n for n in nodes if _types(n) & ARTICLE_TYPES), {})


def _meta(page):
    out = {}
    for m in page.css("meta"):
        key = m.attrib.get("property") or m.attrib.get("name") or m.attrib.get("itemprop")
        content = m.attrib.get("content")
        if key and content:
            out.setdefault(key.strip().lower(), content.strip())
    return out


def _names(v):
    names = []
    for item in _as_list(v):
        name = item.get("name") if isinstance(item, dict) else item
        if isinstance(name, str) and name.strip() and not name.startswith("http"):
            names.append(name.strip())
    return names


def _keywords(v):
    if isinstance(v, str):
        v = v.split(",")
    return [k.strip() for k in _as_list(v) if isinstance(k, str) and k.strip()]


def _has_path(u):
    return bool(urlsplit(u).path.strip("/"))


def _canonical(page, url, node, meta):
    link = page.css('link[rel~="canonical"]').first
    entity = node.get("mainEntityOfPage")
    for cand in (link.attrib.get("href") if link else None, meta.get("og:url"), node.get("url"),
                 entity.get("@id") if isinstance(entity, dict) else entity):
        if isinstance(cand, str) and cand.strip():
            cand = urljoin(url, cand.strip())
            # some sites point every paywalled or AMP page's canonical at the homepage; that's no canonical at all
            if _has_path(cand) or not _has_path(url):
                return cand
    return url


def _clean_title(title, sites):
    """Drop a trailing " | Business Wire" / " - Bay Area Daily" when it's the site's own name."""
    title = ZW_RE.sub("", str(title)).strip()
    names = {s.strip().lower() for s in sites if s}
    for sep in (" | ", " - ", " – ", " — "):
        head, _, tail = title.rpartition(sep)
        if head and tail.strip().lower() in names:
            return head.strip()
    return title


def _paywalled(node, html, text):
    flags = [node.get("isAccessibleForFree")] + [p.get("isAccessibleForFree") for p in _as_list(node.get("hasPart"))
                                                 if isinstance(p, dict)]
    if any(str(f).lower() == "false" for f in flags if f is not None):
        return True
    return len(text) < 1500 and bool(PAYWALL_RE.search(html))


def extract(page, url=None):
    """`page` is a Scrapling Response or Selector (or raw HTML with `url`). Returns an Article."""
    if isinstance(page, (str, bytes)):
        page = Selector(content=page, url=url or "")
    url = url or page.url
    nodes = _jsonld_nodes(page)
    node = _article_node(nodes)
    meta = _meta(page)

    clean = Convertor._sanitize_for_ai(page).html_content
    text = trafilatura.extract(clean, url=url, include_comments=False, include_tables=False) or ""
    body = node.get("articleBody")
    if isinstance(body, str) and len(body.strip()) > len(text):
        text = body.strip()
    text = ZW_RE.sub("", text)

    tmeta = None
    def fallback(attr):
        nonlocal tmeta
        if tmeta is None:
            tmeta = trafilatura.extract_metadata(clean, default_url=url) or False
        return getattr(tmeta, attr, None) if tmeta else None

    publisher = _names(node.get("publisher"))
    site_name = meta.get("og:site_name") or fallback("sitename")
    html_el = page.css("html").first
    title = node.get("headline") or meta.get("og:title") or str(page.css("title::text").get() or "").strip() or fallback("title") or ""
    title = _clean_title(title, [site_name] + publisher)
    if title and text.startswith(title):  # trafilatura keeps the <h1>; the body shouldn't repeat the headline
        text = text[len(title):].lstrip()
    return Article(
        url=url,
        title=title,
        text=text,
        canonical_url=_canonical(page, url, node, meta),
        published=iso_utc(node.get("datePublished")) or iso_utc(meta.get("article:published_time"))
                  or iso_utc(meta.get("og:published_time")) or iso_utc(meta.get("pubdate"))
                  or iso_utc(meta.get("parsely-pub-date")) or iso_utc(fallback("date")),
        modified=iso_utc(node.get("dateModified")) or iso_utc(meta.get("article:modified_time"))
                 or iso_utc(meta.get("og:updated_time")),
        authors=_names(node.get("author")) or _names(meta.get("author")) or _names(fallback("author")),
        publisher=publisher[0] if publisher else None,
        site_name=site_name,
        keywords=_keywords(node.get("keywords")) or _keywords(meta.get("news_keywords")) or _keywords(meta.get("keywords")),
        lang=(html_el.attrib.get("lang") if html_el else None) or node.get("inLanguage"),
        paywalled=_paywalled(node, clean, text),
    )
