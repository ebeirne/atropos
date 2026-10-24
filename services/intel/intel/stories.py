"""Stories: one event told by many articles, so it can be corroborated once.

A claim joins the story with the same ticker and event type whose latest claim is at most WINDOW_DAYS older;
otherwise it starts a new story. Within a week a company rarely has two separate deals or two earnings
reports, and keying on the model's wording instead would split one event into several stories. A story's
evidence is its claims' documents, so `corroboration()` counts the independent owners behind the event, and
`direction()` is what the claims say it means for the stock.

Status: open (collecting evidence) -> proposed (a trade is waiting for you) -> executed / passed (the gate or
the model said no; it's re-checked when new evidence arrives) / closed (older than the policy's story age).
"""
import json
from datetime import datetime, timedelta

from intel import claims as claims_mod
from intel.dedup import corroborate
from intel.store import now_iso, to_article

WINDOW_DAYS = 5
SCHEMA = """
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY, ticker TEXT NOT NULL, event_type TEXT NOT NULL, title TEXT NOT NULL,
  first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  checked_at TEXT, gate TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stories_key ON stories(ticker, event_type, last_seen);
"""


def init(store):
    claims_mod.init(store)
    store.con.executescript(SCHEMA)


def _days_before(iso, days):
    return (datetime.fromisoformat(iso.replace("Z", "+00:00")) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


def assign(store):
    """Put every unassigned claim in a story. Returns the ids of stories that got new claims."""
    init(store)
    touched = set()
    rows = store.con.execute("SELECT * FROM claims WHERE story_id IS NULL ORDER BY first_seen, id").fetchall()
    with store.tx() as con:
        for c in rows:
            s = con.execute("SELECT id, first_seen FROM stories WHERE ticker=? AND event_type=? AND last_seen >= ? "
                            "AND status != 'closed' ORDER BY last_seen DESC LIMIT 1",
                            (c["ticker"], c["event_type"], _days_before(c["first_seen"], WINDOW_DAYS))).fetchone()
            if s is None:
                sid = con.execute("INSERT INTO stories(ticker, event_type, title, first_seen, last_seen, updated_at) "
                                  "VALUES (?,?,?,?,?,?)", (c["ticker"], c["event_type"], c["statement"],
                                                            c["first_seen"], c["first_seen"], now_iso())).lastrowid
            else:
                sid = s["id"]
                con.execute("UPDATE stories SET last_seen=MAX(last_seen, ?), first_seen=MIN(first_seen, ?), updated_at=?, "
                            "status=CASE WHEN status='passed' THEN 'open' ELSE status END WHERE id=?",
                            (c["first_seen"], c["first_seen"], now_iso(), sid))
            con.execute("UPDATE claims SET story_id=? WHERE id=?", (sid, c["id"]))
            touched.add(sid)
    return sorted(touched)


def get(store, story_id):
    row = store.con.execute("SELECT * FROM stories WHERE id=?", (story_id,)).fetchone()
    if not row:
        return None
    story = dict(row)
    story["gate"] = json.loads(story["gate"]) if story["gate"] else None
    return story


def listing(store, *, status=None, ticker=None, limit=50):
    init(store)
    sql, args = "SELECT * FROM stories WHERE 1=1", []
    if status:
        sql += " AND status=?"
        args.append(status)
    if ticker:
        sql += " AND ticker=?"
        args.append(ticker.upper())
    rows = store.con.execute(sql + " ORDER BY last_seen DESC LIMIT ?", (*args, limit)).fetchall()
    return [{**dict(r), "gate": json.loads(r["gate"]) if r["gate"] else None} for r in rows]


def documents(store, story_id, *, as_of=None):
    """The documents behind a story's claims (that we held by `as_of`), oldest first."""
    sql = ("SELECT DISTINCT d.id FROM documents d JOIN claims c ON c.document_id = d.id WHERE c.story_id=?"
           + (" AND d.first_seen <= ?" if as_of else "") + " ORDER BY d.first_seen")
    return [store.get(r["id"]) for r in store.con.execute(sql, (story_id, as_of) if as_of else (story_id,))]


def corroboration(store, registry, story_id, *, as_of=None):
    return corroborate([to_article(d) for d in documents(store, story_id, as_of=as_of)], registry)


def direction(claims):
    """What the claims say for the stock: positive / negative when they agree, else mixed or neutral."""
    votes = {d: sum(1 for c in claims if c["direction"] == d) for d in ("positive", "negative")}
    if votes["positive"] and votes["negative"]:
        return "mixed"
    return "positive" if votes["positive"] else "negative" if votes["negative"] else "neutral"


def set_status(store, story_id, status, gate=None):
    with store.tx() as con:
        con.execute("UPDATE stories SET status=?, gate=COALESCE(?, gate), checked_at=?, updated_at=? WHERE id=?",
                    (status, json.dumps(gate) if gate is not None else None, now_iso(), now_iso(), story_id))


def close_stale(store, max_age_days, *, now=None):
    """Close open/passed stories with no new claim in `max_age_days`. Returns how many."""
    cutoff = _days_before(now or now_iso(), max_age_days)
    with store.tx() as con:
        return con.execute("UPDATE stories SET status='closed', updated_at=? WHERE status IN ('open','passed') "
                           "AND last_seen < ?", (now_iso(), cutoff)).rowcount
