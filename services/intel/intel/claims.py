"""Claims: what an article asserts about a company we follow, tied to the words that say it.

Claude reads one article and returns its claims: ticker, event type, a one-line statement, what it means for
the stock (positive / negative / neutral), when it happened, and a verbatim quote. A claim is kept only if
its quote really is in the article (compared after normalizing whitespace, quotes and dashes) and its ticker
is one we follow, so the model can't add facts the page doesn't contain or drift onto other companies.

Without Claude, a deterministic pass takes each sentence that names a followed company and files it as a
neutral claim, with an event type guessed from keywords. Stories still form and corroboration still runs,
but a neutral claim never becomes a trade.

A claim's `first_seen` is its document's: that's when we held the information, whenever we read it.
"""
import re

from intel import llm
from intel.store import now_iso, to_article

EVENT_TYPES = ("merger_acquisition", "earnings", "guidance", "regulatory", "legal", "product", "management",
               "capital", "macro", "other")
DIRECTIONS = ("positive", "negative", "neutral")
KEYWORDS = [  # first match wins, for the no-model fallback
    ("merger_acquisition", r"\b(acquir\w*|merger|takeover|buyout|to buy|agreed to buy|deal to buy|tender offer)\b"),
    ("guidance", r"\b(guidance|outlook|forecast\w*|raises? (its )?(full-year|annual))\b"),
    ("earnings", r"\b(earnings|quarterly (results|profit|revenue)|revenue rose|revenue fell|eps|net income)\b"),
    ("regulatory", r"\b(fda|ftc|sec|doj|antitrust|regulator\w*|approval|approved|investigation)\b"),
    ("legal", r"\b(lawsuit|sued|court|settle\w*|verdict|indict\w*)\b"),
    ("management", r"\b(ceo|chief executive|cfo|resign\w*|appoint\w*|steps down|names? .{0,30} as)\b"),
    ("capital", r"\b(buyback|repurchase|dividend|offering|debt|notes due|credit facility|split)\b"),
    ("product", r"\b(launch\w*|unveil\w*|announc\w* (a|its) new|release[sd]?)\b"),
]
SCHEMA = """
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id), first_seen TEXT NOT NULL,
  extracted_at TEXT NOT NULL, extractor TEXT NOT NULL, ticker TEXT NOT NULL, event_type TEXT NOT NULL,
  statement TEXT NOT NULL, direction TEXT NOT NULL, event_date TEXT, quote TEXT NOT NULL, story_id INTEGER,
  UNIQUE (document_id, ticker, statement)
);
CREATE INDEX IF NOT EXISTS claims_story ON claims(story_id);
CREATE INDEX IF NOT EXISTS claims_ticker ON claims(ticker, event_type, first_seen);
CREATE TABLE IF NOT EXISTS extractions (
  document_id INTEGER PRIMARY KEY REFERENCES documents(id), extracted_at TEXT NOT NULL, extractor TEXT NOT NULL,
  claims INTEGER NOT NULL
);
"""
SYSTEM = ("You extract factual claims about publicly traded companies from one news article, for a long-term "
          "investor who will only act on claims several independent outlets confirm. Report what the article "
          "asserts, not your own knowledge. Only include companies from the list you're given.")
OUTPUT = {
    "type": "object", "additionalProperties": False, "required": ["claims"],
    "properties": {"claims": {"type": "array", "items": {
        "type": "object", "additionalProperties": False,
        "required": ["ticker", "event_type", "statement", "direction", "event_date", "quote"],
        "properties": {
            "ticker": {"type": "string"},
            "event_type": {"type": "string", "enum": list(EVENT_TYPES)},
            "statement": {"type": "string"},
            "direction": {"type": "string", "enum": list(DIRECTIONS)},
            "event_date": {"type": "string"},
            "quote": {"type": "string"},
        }}}},
}


def init(store):
    store.con.executescript(SCHEMA)


def _norm(s):
    s = (s or "").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"[‒-―]", "-", s)
    return " ".join(s.split()).lower()


def grounded(quote, text):
    q = _norm(quote).strip(" .\"'")
    return len(q) >= 15 and q in _norm(text)


def _prompt(article, doc_id, source, companies):
    names = "\n".join(f"- {c.ticker}: {', '.join(c.names()) or c.ticker}" for c in companies)
    return (f"Companies to look for:\n{names}\n\n{llm.article_block(doc_id, article.title, source, article.text)}\n\n"
            "List each distinct factual claim the article makes about these companies' business: deals, results, "
            "guidance, regulatory or legal actions, products, management changes, financing. Skip opinions, price "
            "moves and analyst ratings unless they are the news itself. For each claim:\n"
            "- statement: one plain sentence, specific (who, what, how much)\n"
            "- direction: what it most likely means for that company's stock over the next year\n"
            "- event_date: YYYY-MM-DD of the event if stated or clear, else empty\n"
            "- quote: an exact sentence or phrase copied from the article that states the claim\n"
            'Return {"claims": []} if the article makes no such claim.')


def _sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z\"'(])", text or "") if len(s.strip()) >= 30]


def _heuristic(article, companies, universe):
    out, seen = [], set()
    for sentence in _sentences(article.text):
        hits = [c for c in universe.match(sentence) if c in companies]
        for c in hits:
            event = next((name for name, pat in KEYWORDS if re.search(pat, sentence, re.I)), "other")
            if (c.ticker, event) in seen:
                continue
            seen.add((c.ticker, event))
            out.append({"ticker": c.ticker, "event_type": event, "statement": sentence[:400], "direction": "neutral",
                        "event_date": "", "quote": sentence[:400]})
    return out


def extract_claims(article, universe, *, doc_id=0, source="", ask=None):
    """(claims, extractor) for one Article; only companies in `universe` that the article mentions are asked about."""
    companies = universe.match(article.title + "\n" + article.text)
    if not companies:
        return [], "none"
    tried = ask is not None or llm.available()
    answer = (ask or llm.ask)(SYSTEM, _prompt(article, doc_id, source, companies), OUTPUT)
    if answer is None:   # "heuristic" alone means Claude wasn't there to ask, so the document is read again later
        return _heuristic(article, companies, universe), "heuristic: no answer" if tried else "heuristic"
    allowed = {c.ticker for c in companies}
    kept = []
    for c in answer.get("claims", []):
        ticker = c["ticker"].upper().split(":")[-1].strip().split(".")[0] if c.get("ticker") else ""
        if ticker in allowed and c.get("event_type") in EVENT_TYPES and c.get("direction") in DIRECTIONS \
                and c.get("statement", "").strip() and grounded(c.get("quote", ""), article.text):
            kept.append({**c, "ticker": ticker, "statement": c["statement"].strip(),
                         "event_date": c.get("event_date") or ""})
    return kept, llm.MODEL


def file_new(store, universe, *, ask=None, limit=None):
    """Extract claims from every stored document not read yet, and once Claude is available, read again the
    ones the keyword fallback read without it (their neutral claims make way). Returns the new claim rows."""
    init(store)
    reread = " OR e.extractor = 'heuristic'" if ask is not None or llm.available() else ""
    rows = store.con.execute("SELECT d.id, d.first_seen, d.origin FROM documents d LEFT JOIN extractions e "
                             "ON e.document_id = d.id WHERE e.document_id IS NULL" + reread + " ORDER BY d.first_seen" +
                             (f" LIMIT {int(limit)}" if limit else "")).fetchall()
    new = []
    for row in rows:
        with store.tx() as con:
            con.execute("DELETE FROM claims WHERE document_id=? AND extractor='heuristic'", (row["id"],))
        doc = store.get(row["id"])
        article = to_article(doc)
        if article.stub:
            claims, extractor = [], "skipped: paywall teaser"
        else:
            claims, extractor = extract_claims(article, universe, doc_id=row["id"], source=row["origin"] or doc["domain"], ask=ask)
        at = now_iso()
        with store.tx() as con:
            for c in claims:
                cur = con.execute("INSERT OR IGNORE INTO claims(document_id, first_seen, extracted_at, extractor, ticker, "
                                  "event_type, statement, direction, event_date, quote) VALUES (?,?,?,?,?,?,?,?,?,?)",
                                  (row["id"], row["first_seen"], at, extractor, c["ticker"], c["event_type"],
                                   c["statement"], c["direction"], c["event_date"] or None, c["quote"]))
                if cur.rowcount:
                    new.append({"id": cur.lastrowid, "document_id": row["id"], **c})
            con.execute("INSERT OR REPLACE INTO extractions(document_id, extracted_at, extractor, claims) VALUES (?,?,?,?)",
                        (row["id"], at, extractor, len(claims)))
    return new


def for_story(store, story_id):
    return [dict(r) for r in store.con.execute("SELECT * FROM claims WHERE story_id=? ORDER BY first_seen", (story_id,))]

