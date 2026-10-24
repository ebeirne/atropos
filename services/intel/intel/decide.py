"""From a corroborated story to a trade proposal, or a written reason why not.

The gate runs in code, in this order, and every check is saved on the story so the page can show why:
  fresh        the story's first claim is within policy.gate.max_story_age_days
  primary      a primary source backs it: an SEC filing or official release (tier primary), or the company's own
               press release (a press_release origin whose text names the ticker the way releases do)
  independent  at least min_independent_major owners at major_weight or above, besides that primary source
  direction    the claims agree the news is positive or negative for the stock
  markets      no credible prediction market contradicts it (Claude judges each market's bearing; volume and
               spread come from the venue and are checked in code)
Then Claude writes the thesis (buy / sell / hold, conviction, horizon, risks, what would prove it wrong) from the
claims, the corroboration and the market context. It never sees or sets a dollar amount. Sizing is code: a buy is
base_position_pct of equity scaled by conviction, a sell is the held value scaled by conviction, and the guard
(guard.py) has the last word on every order. Without Claude nothing is proposed: a keyword read of the news is
enough to file evidence, not to trade on.
"""
import json
import re
from datetime import datetime, timedelta, timezone

from intel import llm, stories
from intel import claims as claims_mod
from intel.markets import credible, to_dict
from intel.store import now_iso

SCHEMA = """
CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY, story_id INTEGER NOT NULL REFERENCES stories(id), created_at TEXT NOT NULL,
  ticker TEXT NOT NULL, side TEXT NOT NULL, notional REAL NOT NULL, conviction REAL NOT NULL, horizon_months INTEGER,
  thesis TEXT NOT NULL, risks TEXT, invalidation TEXT, evidence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed', order_id INTEGER, decided_at TEXT, note TEXT
);
CREATE INDEX IF NOT EXISTS proposals_status ON proposals(status, created_at);
"""
BEARINGS = ("supports", "contradicts", "unrelated")
SYSTEM = ("You help a long-term individual investor decide whether well-corroborated company news justifies changing a "
          "position. Horizons are 6 to 36 months. Be skeptical: most news is already priced in, and holding is a fine "
          "answer. You never size trades; the investor's rules do.")
MARKETS_OUT = {"type": "object", "additionalProperties": False, "required": ["markets"], "properties": {
    "markets": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                           "required": ["id", "bearing", "reason"], "properties": {
        "id": {"type": "string"}, "bearing": {"type": "string", "enum": list(BEARINGS)}, "reason": {"type": "string"}}}}}}
THESIS_OUT = {"type": "object", "additionalProperties": False,
              "required": ["action", "conviction", "horizon_months", "thesis", "risks", "invalidation"], "properties": {
    "action": {"type": "string", "enum": ["buy", "sell", "hold"]}, "conviction": {"type": "number"},
    "horizon_months": {"type": "integer"}, "thesis": {"type": "string"}, "risks": {"type": "string"},
    "invalidation": {"type": "string"}}}


def init(store):
    stories.init(store)
    store.con.executescript(SCHEMA)


def _ago(days, now):
    return (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


def issuer_release(doc, ticker):
    """A press release that names the ticker the way an issuer's own release does: "(NASDAQ: NWRB)"."""
    return doc["tier"] == "press_release" and re.search(
        rf"\((?:NASDAQ|Nasdaq|NYSE(?: American| Arca)?|Cboe|NasdaqGS|NasdaqGM)[^:)]*:\s*{re.escape(ticker)}\)", doc["text"]) is not None


def gate(story, claims, corr, docs, policy, *, now=None):
    """The checks in order. Returns {"ok": bool, "failed": name or None, "checks": {name: {ok, detail}}}."""
    now = now or datetime.now(timezone.utc)
    g = policy.gate
    checks = {}
    checks["fresh"] = {"ok": story["first_seen"] >= _ago(g.max_story_age_days, now),
                       "detail": f"first seen {story['first_seen']}; the limit is {g.max_story_age_days} days"}
    primary = [o.name for o in corr.origins if o.tier == "primary"]
    releases = sorted({d["origin"] for d in docs if issuer_release(d, story["ticker"])})
    checks["primary"] = {"ok": bool(primary or releases) or not g.require_primary,
                         "detail": ", ".join(primary + [f"{r} (the company's own release)" for r in releases])
                         or "no SEC filing, official release or company press release yet"}
    majors = [o for o in corr.origins if o.weight >= g.major_weight and o.tier not in ("primary", "press_release")]
    checks["independent"] = {"ok": len(majors) >= g.min_independent_major,
                             "detail": f"{len(majors)} independent major source(s): " + (", ".join(o.name for o in majors) or "none")
                                       + f"; {g.min_independent_major} needed"}
    way = stories.direction(claims)
    checks["direction"] = {"ok": way in ("positive", "negative"), "detail": f"the claims read {way} for the stock"}
    failed = next((name for name, c in checks.items() if not c["ok"]), None)
    return {"ok": failed is None, "failed": failed, "checks": checks, "direction": way}


def _claims_text(claims, docs):
    by_id = {d["id"]: d for d in docs}
    return "\n".join(f'- [{by_id[c["document_id"]]["origin"] or by_id[c["document_id"]]["domain"]}] {c["statement"]} '
                     f'(quote: "{c["quote"]}")' for c in claims if c["document_id"] in by_id)


def market_context(story, company, claims, docs, policy, *, search, ask=None):
    """Related prediction markets, each with whether it's credible and how it bears on the story."""
    found = search(company.name or story["ticker"]) if search else []
    rows = [{**to_dict(m), "credible": credible(m, min_volume=policy.gate.market_min_volume,
                                                max_spread=policy.gate.market_max_spread),
             "bearing": "unknown", "reason": ""} for m in found]
    judge = [r for r in rows if r["credible"]]
    if judge:
        listing = "\n".join(f'- id={r["id"]} [{r["venue"]}] {r["question"]}: yes at {r["yes"]:.0%}, volume ${r["volume"]:,.0f}, '
                            f'closes {r["close_time"]}' for r in judge)
        answer = (ask or llm.ask)(SYSTEM, f"News about {story['ticker']} ({company.name}):\n{_claims_text(claims, docs)}\n\n"
                                  f"Prediction markets found by searching the company name:\n{listing}\n\nFor each market, "
                                  "say whether its current price supports the investment case these claims make, "
                                  "contradicts it, or is unrelated to it, with one sentence why.", MARKETS_OUT, effort="low")
        for j in (answer or {}).get("markets", []):
            for r in judge:
                if str(r["id"]) == str(j["id"]) and j["bearing"] in BEARINGS:
                    r["bearing"], r["reason"] = j["bearing"], j["reason"]
    return rows


def thesis(story, company, claims, docs, corr, markets, portfolio, *, ask=None):
    held = portfolio.value(story["ticker"]) if portfolio else 0.0
    weight = portfolio.weight_pct(story["ticker"]) if portfolio and portfolio.equity else 0.0
    origins = "\n".join(f"- {o.name} ({o.tier}, {len(o.urls)} article(s))" for o in corr.origins)
    mk = "\n".join(f'- [{m["venue"]}] {m["question"]}: yes at {m["yes"]:.0%}; {m["bearing"]}: {m["reason"]}'
                   for m in markets if m["credible"]) or "- none credible"
    position = f"${held:,.0f} held, {weight:.1f}% of the portfolio" if held else "not held"
    prompt = (f"Company: {company.name} ({story['ticker']}). Event type: {story['event_type']}.\n"
              f"Position: {position}.\n\n"
              f"Claims, each tied to a quote from its source:\n{_claims_text(claims, docs)}\n\n"
              f"Independent owners behind the story:\n{origins}\n\nRelated prediction markets:\n{mk}\n\n"
              "Should the investor buy, sell (only possible if held; no shorting) or hold? Give conviction from 0 to 1 "
              "(0.6 or more only if the news clearly changes the company's prospects over your horizon), the horizon in "
              "months, the thesis in two or three sentences, the main risks, and what specific future news would prove it wrong.")
    answer = (ask or llm.ask)(SYSTEM, prompt, THESIS_OUT, effort="high")
    if answer is None:
        return None
    answer["conviction"] = max(0.0, min(1.0, float(answer.get("conviction", 0))))
    answer["horizon_months"] = max(1, min(60, int(answer.get("horizon_months") or 12)))
    return answer


def size(side, conviction, portfolio, ticker, policy):
    if not portfolio or portfolio.equity <= 0:
        return 0.0
    if side == "buy":
        return round(portfolio.equity * policy.sizing.base_position_pct / 100 * conviction, 2)
    return round(portfolio.value(ticker) * conviction, 2)


def evaluate(store, policy, story_id, universe, portfolio, *, registry, search=None, ask=None, now=None):
    """Run one story through the gate and, if it passes, propose a trade. Returns {story_id, status, ...}."""
    init(store)
    story = stories.get(store, story_id)
    claims = claims_mod.for_story(store, story_id)
    docs = stories.documents(store, story_id)
    corr = stories.corroboration(store, registry, story_id)
    company = universe.companies.get(story["ticker"])
    result = {"story_id": story_id, "ticker": story["ticker"], "corroboration": corr.to_dict()}

    def passed(reason, **extra):
        record = {**result, **extra, "reason": reason}
        stories.set_status(store, story_id, "passed", {k: v for k, v in record.items() if k != "story_id"})
        return {**record, "status": "passed"}

    if company is None:
        return passed("not a company we follow any more")
    g = gate(story, claims, corr, docs, policy, now=now)
    result["gate"] = g
    if not g["ok"]:
        return passed(f"gate: {g['failed']}: {g['checks'][g['failed']]['detail']}")
    markets = market_context(story, company, claims, docs, policy, search=search, ask=ask)
    result["markets"] = markets
    against = [m for m in markets if m["credible"] and m["bearing"] == "contradicts"]
    if against and policy.gate.block_on_market_contradiction:
        return passed(f"a credible prediction market contradicts it: {against[0]['question']}")
    t = thesis(story, company, claims, docs, corr, markets, portfolio, ask=ask)
    if t is None:
        return passed("Claude isn't available, and nothing is traded on a keyword read")
    result["thesis"] = t
    want = {"positive": "buy", "negative": "sell"}[g["direction"]]
    if t["action"] == "hold" or t["action"] != want or t["conviction"] < policy.gate.min_conviction:
        return passed(f"the model says {t['action']} at conviction {t['conviction']:.2f}" +
                      ("" if t["action"] in ("hold", want) else f", against {g['direction']} news"))
    notional = size(t["action"], t["conviction"], portfolio, story["ticker"], policy)
    if notional <= 0:
        return passed("nothing to sell" if t["action"] == "sell" else "no portfolio equity to size from")
    with store.tx() as con:
        pid = con.execute("INSERT INTO proposals(story_id, created_at, ticker, side, notional, conviction, horizon_months, "
                          "thesis, risks, invalidation, evidence) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                          (story_id, now_iso(), story["ticker"], t["action"], notional, t["conviction"], t["horizon_months"],
                           t["thesis"], t["risks"], t["invalidation"], json.dumps(result))).lastrowid
    stories.set_status(store, story_id, "proposed", {k: v for k, v in result.items() if k != "story_id"})
    return {**result, "status": "proposed", "proposal_id": pid, "side": t["action"], "notional": notional}


def proposals(store, *, status=None, limit=100):
    init(store)
    sql, args = "SELECT * FROM proposals", ()
    if status:
        sql, args = sql + " WHERE status=?", (status,)
    rows = store.con.execute(sql + " ORDER BY created_at DESC, id DESC LIMIT ?", (*args, limit)).fetchall()
    return [{**dict(r), "evidence": json.loads(r["evidence"])} for r in rows]


def get_proposal(store, proposal_id):
    init(store)
    r = store.con.execute("SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone()
    return {**dict(r), "evidence": json.loads(r["evidence"])} if r else None


def set_proposal(store, proposal_id, status, *, order_id=None, note=None):
    with store.tx() as con:
        con.execute("UPDATE proposals SET status=?, order_id=COALESCE(?, order_id), note=COALESCE(?, note), decided_at=? "
                    "WHERE id=?", (status, order_id, note, now_iso(), proposal_id))
