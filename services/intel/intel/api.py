"""HTTP API for the evidence and the trade queue. Atropos proxies it at /api/intel/* (INTEL_URL).

    python -m intel serve --port 8002 --every 60     serve, and run a cycle every 60 minutes

It answers only requests addressed to this machine (a Host other than localhost / 127.0.0.1 is refused, which
stops DNS rebinding), and every write needs an `x-intel-client: 1` header. A page on another site can't add
that header without a CORS preflight this server never approves, so it can't approve a trade behind your back.
INTEL_ALLOWED_HOSTS adds host names, comma-separated, if you reach it some other way.

A cycle takes minutes (fetching, reading, judging), so POST /cycle starts one in the background and GET /cycle
reports on it. Each request opens its own SQLite connection (WAL mode lets the cycle write meanwhile), and the
policy file is re-read on every request, so an edit to policy.toml applies without a restart.
"""
import logging
import os
import threading
import time
from dataclasses import asdict
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from intel import broker as broker_mod
from intel import claims, decide, pipeline, stories
from intel import policy as policy_mod
from intel import portfolio as portfolio_mod
from intel.sources import Registry
from intel.store import DEFAULT_DB, Store

DB_PATH = Path(os.environ.get("INTEL_DB", DEFAULT_DB))
DATA_DIR = Path(os.environ.get("INTEL_DATA", policy_mod.DATA_DIR))
DOC_FIELDS = ("id", "title", "url", "domain", "origin", "tier", "credit", "published", "first_seen", "paywalled")
log = logging.getLogger("intel.api")
app = FastAPI(title="Atropos intel")
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"] +
                   [h.strip() for h in os.environ.get("INTEL_ALLOWED_HOSTS", "").split(",") if h.strip()])
STATE = {"running": False, "started": None, "last": None, "error": None}
_lock = threading.Lock()
_registry = None


@app.middleware("http")
async def writes_need_the_client_header(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-intel-client") != "1":
        return JSONResponse({"detail": "writes need the x-intel-client: 1 header"}, status_code=403)
    return await call_next(request)


def _store():
    return Store(DB_PATH)


def _reg():
    global _registry
    _registry = _registry or Registry()
    return _registry


def run_cycle():
    """Run one cycle unless one is already running. Returns False when it was."""
    if not _lock.acquire(blocking=False):
        return False
    STATE.update(running=True, started=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), error=None)
    store = _store()
    try:
        STATE["last"] = pipeline.cycle(store, _reg(), policy_mod.load(), data_dir=DATA_DIR)
    except Exception as e:  # noqa: BLE001 - a failed cycle is reported, the server keeps serving
        log.exception("cycle failed")
        STATE["error"] = f"{type(e).__name__}: {e}"
    finally:
        store.close()
        STATE["running"] = False
        _lock.release()
    return True


def schedule(every_minutes):
    def loop():
        while True:
            run_cycle()
            time.sleep(every_minutes * 60)
    threading.Thread(target=loop, daemon=True, name="intel-cycle").start()


@app.get("/health")
def health():
    p = policy_mod.load()
    from intel import llm
    return {"ok": True, "llm": llm.available(), "model": llm.MODEL, "killed": policy_mod.killed(DATA_DIR), "mode": p.mode,
            "broker": p.broker, "running": STATE["running"]}


@app.post("/cycle", status_code=202)
def start_cycle():
    if STATE["running"]:
        raise HTTPException(409, "a cycle is already running")
    threading.Thread(target=run_cycle, daemon=True, name="intel-cycle-once").start()
    return {"started": True}


@app.get("/cycle")
def cycle_state():
    return STATE


@app.get("/stories")
def list_stories(status: str | None = None, ticker: str | None = None, limit: int = 50):
    store = _store()
    try:
        return stories.listing(store, status=status, ticker=ticker, limit=limit)
    finally:
        store.close()


@app.get("/stories/{story_id}")
def story(story_id: int):
    store = _store()
    try:
        s = stories.get(store, story_id)
        if s is None:
            raise HTTPException(404, "no such story")
        docs = [{k: d[k] for k in DOC_FIELDS} for d in stories.documents(store, story_id)]
        return {**s, "claims": claims.for_story(store, story_id), "documents": docs,
                "corroboration": stories.corroboration(store, _reg(), story_id).to_dict(),
                "proposals": [p for p in decide.proposals(store) if p["story_id"] == story_id]}
    finally:
        store.close()


@app.get("/evidence/{doc_id}")
def evidence(doc_id: int):
    store = _store()
    try:
        d = store.get(doc_id)
        if d is None:
            raise HTTPException(404, "no such document")
        return {**{k: d[k] for k in DOC_FIELDS}, "text": d["text"], "canonical_url": d["canonical_url"]}
    finally:
        store.close()


@app.get("/proposals")
def list_proposals(status: str | None = None, limit: int = 100):
    store = _store()
    try:
        return decide.proposals(store, status=status, limit=limit)
    finally:
        store.close()


@app.post("/proposals/{proposal_id}/approve")
def approve(proposal_id: int):
    store = _store()
    try:
        return pipeline.approve(store, policy_mod.load(), proposal_id, data_dir=DATA_DIR)
    finally:
        store.close()


@app.post("/proposals/{proposal_id}/reject")
def reject(proposal_id: int, body: dict = Body(default={})):
    store = _store()
    try:
        return pipeline.reject(store, proposal_id, body.get("note"))
    finally:
        store.close()


@app.get("/orders")
def orders(status: str | None = None):
    store = _store()
    try:
        broker_mod.init(store)
        return broker_mod.orders(store, status=status)
    finally:
        store.close()


@app.post("/orders/{order_id}")
def mark_order(order_id: int, body: dict = Body(...)):
    """Record what happened to an order you placed by hand at Fidelity: {"status": "filled" | "canceled"}."""
    if body.get("status") not in ("filled", "canceled"):
        raise HTTPException(400, 'status must be "filled" or "canceled"')
    store = _store()
    try:
        broker_mod.init(store)
        return broker_mod.ManualBroker(store).mark(order_id, body["status"])
    except ValueError as e:  # missing, or not an order you place by hand
        raise HTTPException(400, str(e)) from None
    finally:
        store.close()


@app.get("/kill")
def kill_state():
    return {"killed": policy_mod.killed(DATA_DIR)}


@app.post("/kill")
def kill(body: dict = Body(...)):
    policy_mod.set_killed(bool(body.get("on", True)), DATA_DIR)
    return {"killed": policy_mod.killed(DATA_DIR)}


@app.get("/policy")
def policy():
    return asdict(policy_mod.load())


@app.get("/portfolio")
def portfolio():
    p = policy_mod.load()
    store = _store()
    try:
        b = broker_mod.make(p, store) if p.broker == "alpaca" else None
        return asdict(portfolio_mod.current(p, broker=b, data_dir=DATA_DIR))
    finally:
        store.close()
