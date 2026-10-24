"""One cycle: find the news, read it, group it, check it, and propose (or in auto mode, place) trades.

  1. portfolio  what you hold: Alpaca, or Fidelity through atropos (SnapTrade, read-only), or data/portfolio.json
  2. universe   the watchlist plus your holdings
  3. discover   new article URLs from the feeds and GDELT
  4. ingest     fetch, extract and file them
  5. claims     Claude reads the new documents about followed companies
  6. stories    claims grouped by ticker and event
  7. primary    each touched story's company gets its recent SEC filings filed as evidence
  8. decide     gate, prediction markets, thesis, sizing: a proposal or a reason why not
  9. execute    auto mode only: proposals go through the guard to the broker
The kill switch stops a cycle after step 6, so evidence keeps accumulating and nothing is proposed or placed.
A proposal waiting for you moves on with `approve()` (through the same guard) or `reject()`. Proposals expire
after PROPOSAL_TTL_DAYS, since the price they were made at has moved on.
"""
import logging
from datetime import datetime, timedelta, timezone

from intel import broker as broker_mod
from intel import claims, decide, discover, edgar, ingest, llm, markets, stories
from intel import portfolio as portfolio_mod
from intel.guard import Order
from intel.policy import DATA_DIR, killed
from intel.store import now_iso

PROPOSAL_TTL_DAYS = 3
PRIMARY_LOOKBACK_DAYS = 3  # SEC filings this long before a story's first article still count for it
log = logging.getLogger("intel.pipeline")


def _since(iso, days):
    return (datetime.fromisoformat(iso.replace("Z", "+00:00")) - timedelta(days=days)).strftime("%Y-%m-%d")


def expire(store, *, now=None):
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=PROPOSAL_TTL_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    decide.init(store)
    with store.tx() as con:
        return con.execute("UPDATE proposals SET status='expired', decided_at=? WHERE status='proposed' AND created_at < ?",
                           (now_iso(), cutoff)).rowcount


def cycle(store, registry, policy, *, get=None, ask=None, search=None, transport=None, feeds_cfg=None,
          watchlist=discover.WATCHLIST_PATH, now=None, data_dir=DATA_DIR):
    """Run steps 1-9 once. Every network-facing piece can be swapped for tests. Returns a report."""
    fetch_get = {"get": get} if get else {}
    report = {"started": now_iso(), "llm": llm.available(), "mode": policy.mode, "broker": policy.broker}
    b = broker_mod.make(policy, store, transport=transport) if policy.broker == "alpaca" else None
    pf = portfolio_mod.current(policy, broker=b, data_dir=data_dir, **({"transport": transport} if transport else {}))
    report["portfolio"] = {"source": pf.source, "equity": pf.equity, "positions": len(pf.positions)}
    universe = discover.Universe.load(watchlist, holdings=[(t, "") for t in pf.positions])
    report["universe"] = len(universe)

    found = discover.discover(store, universe, feeds_cfg, **fetch_get, now=now, registry=registry)
    fetched = ingest.fetch([f["url"] for f in found], store, registry, **fetch_get)
    report["discovered"], report["fetched"] = len(found), sum(1 for f in fetched if f.get("new"))
    new_claims = claims.file_new(store, universe, ask=ask)
    touched = set(stories.assign(store))
    # filings are evidence too: file them, then read them, so the story they back sees them this cycle
    primary = []
    for sid in sorted(touched):
        story = stories.get(store, sid)
        if story["status"] in ("open", "passed"):
            primary += edgar.file_primary_evidence(story["ticker"], store, registry,
                                                   since=_since(story["first_seen"], PRIMARY_LOOKBACK_DAYS), **fetch_get)
    if any(p.get("new") for p in primary):
        new_claims += claims.file_new(store, universe, ask=ask)
        touched |= set(stories.assign(store))
    report["claims"], report["stories_touched"] = len(new_claims), sorted(touched)
    report["primary"] = [{k: p.get(k) for k in ("form", "filed", "title", "url", "new", "error")} for p in primary]
    report["closed"] = stories.close_stale(store, policy.gate.max_story_age_days)
    report["expired"] = expire(store, now=now)

    if killed(data_dir):
        report["killed"] = True
        report["finished"] = now_iso()
        return report

    decisions = []
    for sid in sorted(touched):
        if stories.get(store, sid)["status"] not in ("open", "passed"):
            continue
        decisions.append(decide.evaluate(store, policy, sid, universe, pf, registry=registry,
                                         search=search if search is not None else markets.search, ask=ask, now=now))
    report["decisions"] = [{k: d.get(k) for k in ("story_id", "ticker", "status", "reason", "proposal_id", "side", "notional")}
                           for d in decisions]
    if policy.mode == "auto":
        report["executed"] = [approve(store, policy, d["proposal_id"], transport=transport, data_dir=data_dir)
                              for d in decisions if d["status"] == "proposed"]
    report["finished"] = now_iso()
    return report


def approve(store, policy, proposal_id, *, transport=None, data_dir=DATA_DIR):
    """Send a waiting proposal through the guard to the broker. Returns what happened."""
    p = decide.get_proposal(store, proposal_id)
    if p is None or p["status"] != "proposed":
        return {"proposal_id": proposal_id, "status": "error",
                "reasons": [f"proposal is {p['status'] if p else 'missing'}, not waiting for approval"]}
    kw = {"transport": transport} if transport else {}
    b = broker_mod.make(policy, store, **kw)
    pf = portfolio_mod.current(policy, broker=b if policy.broker == "alpaca" else None, data_dir=data_dir, **kw)
    order = Order(p["ticker"], p["side"], p["notional"], proposal_id=proposal_id, reason=p["thesis"][:200])
    res = broker_mod.execute(order, pf, policy, store, b, data_dir=data_dir)
    status = {"manual": "approved", "submitted": "executed", "filled": "executed", "rejected": "blocked"}.get(res["status"], "failed")
    decide.set_proposal(store, proposal_id, status, order_id=res.get("order_id"), note="; ".join(res.get("reasons") or []) or None)
    if status in ("approved", "executed"):
        stories.set_status(store, p["story_id"], "executed")
    return {"proposal_id": proposal_id, "proposal_status": status, **res}


def reject(store, proposal_id, note=None):
    p = decide.get_proposal(store, proposal_id)
    if p is None or p["status"] != "proposed":
        return {"proposal_id": proposal_id, "status": "error", "reasons": ["not waiting for approval"]}
    decide.set_proposal(store, proposal_id, "rejected", note=note or "rejected by you")
    stories.set_status(store, p["story_id"], "passed")
    return {"proposal_id": proposal_id, "proposal_status": "rejected"}
