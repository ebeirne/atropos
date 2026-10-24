"""Point-in-time evidence store: every page we read, when we first held it, and what it said.

`first_seen` is the knowledge time, the moment we first held that exact text at that URL. A page's own
published date can be backdated or bumped on every edit, so backtests and trade audits go through `as_of`
and `version_as_of`, which never return text we didn't hold at the time asked. Each distinct text per
canonical URL is one row in `documents`, so an article edited after publication keeps its earlier versions.
Every fetch, including 304s and failures, is one row in `fetches`, carrying the ETag / Last-Modified for
the next conditional GET. Raw HTML is kept gzipped so pages can be re-extracted later.

Tiny sqlite3 layer like services/basis/backend/db.py: one file, two tables, no ORM.
"""
import gzip
import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from intel.dedup import CONTAINMENT, MIN_SHINGLES, NEAR_BITS, canonical, containment, hamming, shingles, simhash
from intel.extract import Article
from intel.sources import host_of

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "evidence.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  canonical_url TEXT NOT NULL, content_hash TEXT NOT NULL, first_seen TEXT NOT NULL,
  url TEXT NOT NULL, domain TEXT NOT NULL, title TEXT, text TEXT NOT NULL,
  published TEXT, modified TEXT, authors TEXT, publisher TEXT, site_name TEXT, keywords TEXT, lang TEXT,
  paywalled INTEGER NOT NULL DEFAULT 0, simhash TEXT, credit TEXT, origin TEXT, origin_group TEXT, tier TEXT,
  raw BLOB,
  UNIQUE (canonical_url, content_hash)
);
CREATE INDEX IF NOT EXISTS documents_seen ON documents(first_seen);
CREATE INDEX IF NOT EXISTS documents_canonical ON documents(canonical_url, first_seen);
CREATE TABLE IF NOT EXISTS fetches (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL, fetched_at TEXT NOT NULL, status INTEGER,
  document_id INTEGER REFERENCES documents(id), etag TEXT, last_modified TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS fetches_url ON fetches(url, fetched_at);
"""
COLUMNS = "id, canonical_url, content_hash, first_seen, url, domain, title, text, published, modified, authors, " \
          "publisher, site_name, keywords, lang, paywalled, simhash, credit, origin, origin_group, tier"


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def content_hash(text):
    return hashlib.sha256(" ".join((text or "").split()).encode()).hexdigest()


def to_article(row):
    """A stored document back as an Article, so stored evidence can go straight into dedup.corroborate."""
    return Article(url=row["url"], title=row["title"] or "", text=row["text"], canonical_url=row["canonical_url"],
                   published=row["published"], modified=row["modified"], authors=json.loads(row["authors"] or "[]"),
                   publisher=row["publisher"], site_name=row["site_name"], keywords=json.loads(row["keywords"] or "[]"),
                   lang=row["lang"], paywalled=bool(row["paywalled"]))


class Store:
    def __init__(self, path=DEFAULT_DB):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.con = sqlite3.connect(str(path), check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        self.con.execute("PRAGMA journal_mode=WAL")
        self.con.executescript(SCHEMA)

    def close(self):
        self.con.close()

    @contextmanager
    def tx(self):
        try:
            yield self.con
            self.con.commit()
        except Exception:
            self.con.rollback()
            raise

    def put(self, article, *, origin=None, credit=None, fetched_at=None, status=200, raw=None, etag=None,
            last_modified=None, requested_url=None):
        """File one extracted page. Returns (document id, True when this text at this URL is new to us).

        The fetch is logged under `requested_url` when given (the URL before redirects), so the next
        `last_fetch` of that same URL finds it.
        """
        fetched_at = fetched_at or now_iso()
        canon, digest = canonical(article.canonical_url or article.url), content_hash(article.text)
        with self.tx() as con:
            cur = con.execute(
                "INSERT OR IGNORE INTO documents(canonical_url, content_hash, first_seen, url, domain, title, text, "
                "published, modified, authors, publisher, site_name, keywords, lang, paywalled, simhash, credit, "
                "origin, origin_group, tier, raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (canon, digest, fetched_at, article.url, host_of(article.url), article.title, article.text,
                 article.published, article.modified, json.dumps(article.authors), article.publisher,
                 article.site_name, json.dumps(article.keywords), article.lang, int(article.paywalled),
                 f"{simhash(article.text):016x}", credit.name if credit else None, origin.name if origin else None,
                 origin.group if origin else None, origin.tier if origin else None,
                 gzip.compress(raw.encode() if isinstance(raw, str) else raw) if raw else None))
            new = cur.rowcount == 1
            doc_id = cur.lastrowid if new else con.execute(
                "SELECT id FROM documents WHERE canonical_url=? AND content_hash=?", (canon, digest)).fetchone()[0]
            con.execute("INSERT INTO fetches(url, fetched_at, status, document_id, etag, last_modified) VALUES (?,?,?,?,?,?)",
                        (requested_url or article.url, fetched_at, status, doc_id, etag, last_modified))
        return doc_id, new

    def record_fetch(self, url, *, status=None, document_id=None, etag=None, last_modified=None, error=None,
                     fetched_at=None):
        """A fetch that produced no new text: a 304, a block, a timeout."""
        with self.tx() as con:
            con.execute("INSERT INTO fetches(url, fetched_at, status, document_id, etag, last_modified, error) "
                        "VALUES (?,?,?,?,?,?,?)", (url, fetched_at or now_iso(), status, document_id, etag,
                                                   last_modified, error))

    def last_fetch(self, url):
        """The most recent successful fetch of `url` with a document, for conditional GETs and the seen-set."""
        row = self.con.execute("SELECT * FROM fetches WHERE url=? AND document_id IS NOT NULL "
                               "ORDER BY fetched_at DESC, id DESC LIMIT 1", (url,)).fetchone()
        return dict(row) if row else None

    def get(self, document_id):
        row = self.con.execute(f"SELECT {COLUMNS} FROM documents WHERE id=?", (document_id,)).fetchone()
        return dict(row) if row else None

    def raw(self, document_id):
        row = self.con.execute("SELECT raw FROM documents WHERE id=?", (document_id,)).fetchone()
        return gzip.decompress(row[0]).decode() if row and row[0] else None

    def as_of(self, when, *, since=None, limit=None):
        """Every document we held at `when` (and first saw after `since`), newest knowledge first."""
        sql = f"SELECT {COLUMNS} FROM documents WHERE first_seen <= ?"
        args = [when]
        if since:
            sql += " AND first_seen >= ?"
            args.append(since)
        sql += " ORDER BY first_seen DESC, id DESC"
        if limit:
            sql += " LIMIT ?"
            args.append(limit)
        return [dict(r) for r in self.con.execute(sql, args)]

    def version_as_of(self, url, when):
        """The text of one article as we held it at `when`, or None if we hadn't read it yet."""
        row = self.con.execute(f"SELECT {COLUMNS} FROM documents WHERE canonical_url=? AND first_seen <= ? "
                               "ORDER BY first_seen DESC, id DESC LIMIT 1", (canonical(url), when)).fetchone()
        return dict(row) if row else None

    def near(self, text, *, within=NEAR_BITS, since=None, until=None):
        """Stored copies of `text` (the same story seen before, maybe on another site): SimHash shortlists,
        shingle containment confirms. Texts too short to judge on wording return nothing."""
        sh = shingles(text)
        if len(sh) < MIN_SHINGLES:
            return []
        h = simhash(text)
        return [r for r in self.as_of(until or "9999", since=since)
                if r["simhash"] and hamming(int(r["simhash"], 16), h) <= within
                and containment(sh, shingles(r["text"])) >= CONTAINMENT]
