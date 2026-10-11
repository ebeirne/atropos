"""Basis API. Run: uvicorn backend.main:app --reload --port 8000"""
import json, logging, threading, time, shutil
from datetime import datetime, timezone, date as _date
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend import config, db, calibration
from backend.basis import basis_stats, btc_prob_above
from backend.trust import trust as trust_score
from backend.betas import event_prob_series, betas as compute_betas, scenario as run_scenario

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("basis.api")

app = FastAPI(title="Basis", version="0.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

EVENTS = json.loads(config.EVENTS_PATH.read_text())
EVENT_BY_ID = {e["id"]: e for e in EVENTS}

if config.DEMO_MODE:
    snap_db = config.SNAPSHOT_DIR / "basis.db"
    snap_cal = config.SNAPSHOT_DIR / "calibration.json"
    if snap_cal.exists():
        config.CALIBRATION_PATH = snap_cal
        calibration.CALIBRATION_PATH = snap_cal
    CON = db.connect(snap_db if snap_db.exists() else None)
    log.info("DEMO_MODE: serving from %s", snap_db)
else:
    CON = db.connect()

LAST_REFRESH = {"ts": None, "ok": None, "error": None}


# ---------- core assembly ----------
def _all_vols():
    return [r["volume_24h"] for r in CON.execute("SELECT volume_24h FROM market_state").fetchall()]


def _venue_block(ev, state, all_vols):
    out = {}
    for venue, s in state.items():
        t = trust_score(s, all_vols, ev["resolution_date"])
        out[venue] = {"p": s["p_yes"], "spread": s["spread"], "volume_24h": s["volume_24h"],
                      "last_trade_ts": s["last_trade_ts"], "stale": bool(s.get("stale")),
                      "top10_holder_share": s["top10_holder_share"], "largest_trade_24h": s["largest_trade_24h"],
                      "trust": t}
    return out


def _primary_p(venues):
    """Volume-weighted average of venue prices (falls back to simple mean)."""
    ps = [(v["p"], v["volume_24h"] or 0) for v in venues.values() if v["p"] is not None]
    if not ps:
        return None
    w = sum(x[1] for x in ps)
    return sum(p * (vol if w > 0 else 1) for p, vol in ps) / (w if w > 0 else len(ps))


def summarize(ev, all_vols=None):
    all_vols = all_vols if all_vols is not None else _all_vols()
    state = db.get_state(CON, ev["id"])
    venues = _venue_block(ev, state, all_vols)
    p_raw = _primary_p(venues)
    p_cal = calibration.calibrate(p_raw)
    prices = db.get_prices(CON, ev["id"])
    proxy_rows = db.get_proxy(CON, ev["id"])
    if ev.get("settled"):  # after resolution the proxy is trivially 0/1; show the series only up to the meeting
        proxy_rows = [r for r in proxy_rows if r[0] <= ev["resolution_date"]]
    p_proxy = proxy_rows[-1][1] if proxy_rows else None
    proxy_detail = proxy_rows[-1][2] if proxy_rows else None
    # basis uses the venue with the longest history for the z-score window
    hist_venue = max(prices, key=lambda v: len(prices[v])) if prices else None
    basis_now, z, basis_series = basis_stats(prices.get(hist_venue, []), proxy_rows) if proxy_rows else (None, None, [])
    if p_raw is not None and p_proxy is not None:
        basis_now = p_raw - p_proxy
    best = max(venues.values(), key=lambda v: v["trust"]["score"]) if venues else None
    return {
        "id": ev["id"], "title": ev["title"], "category": ev["category"], "resolution_date": ev["resolution_date"],
        "settled": bool(ev.get("settled")),
        "p_raw": p_raw, "p_calibrated": p_cal, "p_proxy": p_proxy, "proxy_type": (ev.get("proxy") or {}).get("type"),
        "proxy_detail": proxy_detail,
        "basis": basis_now, "basis_z": z,
        "trust_score": best["trust"]["score"] if best else 0,
        "leakage_flag": any(v["trust"]["leakage_flag"] for v in venues.values()),
        "stale": any(v["stale"] for v in venues.values()),
        "venues": venues,
        "_basis_series": basis_series, "_prices": prices, "_proxy_rows": proxy_rows,
    }


def strip(d):
    return {k: v for k, v in d.items() if not k.startswith("_")}


# ---------- routes ----------
@app.get("/health")
def health():
    return {"ok": True, "demo_mode": config.DEMO_MODE, "last_refresh": LAST_REFRESH, "events": len(EVENTS)}


@app.get("/events")
def list_events():
    vols = _all_vols()
    return [strip(summarize(ev, vols)) for ev in EVENTS]


@app.get("/events/{event_id}")
def get_event(event_id: str):
    ev = EVENT_BY_ID.get(event_id)
    if not ev:
        raise HTTPException(404, "unknown event")
    s = summarize(ev)
    prices = s["_prices"]
    history = {v: [{"date": d, "p": p} for d, p in rows] for v, rows in prices.items()}
    history["proxy"] = [{"date": d, "p": p} for d, p, _ in s["_proxy_rows"]]
    prob = event_prob_series(prices)
    assets = {t: db.get_asset(CON, t) for t in ev.get("beta_assets", [])}
    b = compute_betas(prob, assets)
    out = strip(s)
    out.update({
        "history": history,
        "basis_series": [{"date": d, "basis": v} for d, v in s["_basis_series"]],
        "betas": b,
        "betas_note": "OLS of asset daily % return on daily change (pp) in event probability. Co-movement, not causation; small n.",
        "proxy": ev.get("proxy"),
        "proxy_note": {"fedfunds": "P(move) = (implied rate after meeting - baseline) / 0.25, clipped; ignores term premium & intra-month timing.",
                       "btc_options": "Risk-neutral N(d2) from Deribit mark IV; terminal probability vs. a 'touch' market."}.get(out["proxy_type"]),
        "sources": {"kalshi_ticker": ev.get("kalshi_ticker"), "polymarket_condition_id": ev.get("polymarket_condition_id")},
    })
    return out


@app.get("/calibration")
def get_calibration():
    c = calibration.load()
    if not c:
        raise HTTPException(503, "calibration not fitted; run make backfill")
    return c["raw"]


class ScenarioIn(BaseModel):
    event_id: str
    p_new: float


@app.post("/scenario")
def scenario(inp: ScenarioIn):
    ev = EVENT_BY_ID.get(inp.event_id)
    if not ev:
        raise HTTPException(404, "unknown event")
    s = summarize(ev)
    prob = event_prob_series(s["_prices"])
    assets = {t: db.get_asset(CON, t) for t in ev.get("beta_assets", [])}
    b = compute_betas(prob, assets)
    p_now = s["p_raw"] if s["p_raw"] is not None else (float(prob.iloc[-1]) if len(prob) else 0.5)
    return {"event_id": ev["id"], "p_now": p_now, "p_new": inp.p_new,
            "moves": run_scenario(b, p_now, inp.p_new),
            "note": "expected_move_pct = beta_per_pp x (p_new - p_now) x 100. Co-movement, not causation."}


@app.get("/divergence")
def divergence():
    """P2: events ranked by |basis z| x trust (falls back to |basis| when z unavailable)."""
    rows = []
    for s in list_events():
        if s["p_proxy"] is None or s["basis"] is None:
            continue
        z = s["basis_z"] if s["basis_z"] is not None else 0.0
        score = abs(z if abs(z) > 0 else s["basis"] * 10) * s["trust_score"] / 100
        direction = "above" if s["basis"] > 0 else "below"
        reason = (f"Prediction market {s['p_raw']*100:.0f}% vs proxy {s['p_proxy']*100:.0f}% "
                  f"({direction} by {abs(s['basis'])*100:.0f}pp, z={z:+.1f}); trust {s['trust_score']}")
        rows.append({**s, "divergence_score": round(score, 3), "reason": reason})
    rows.sort(key=lambda r: -r["divergence_score"])
    return rows


@app.get("/arb")
def arb():
    """P2: fee-adjusted cross-venue price gap. Kalshi taker fee ≈ 0.07*p*(1-p) per contract; Polymarket ~0 on most markets (2% winnings on some)."""
    out = []
    for s in list_events():
        v = s["venues"]
        if "kalshi" in v and "polymarket" in v and v["kalshi"]["p"] is not None and v["polymarket"]["p"] is not None:
            pk, pp = v["kalshi"]["p"], v["polymarket"]["p"]
            fee_k = 0.07 * pk * (1 - pk)
            fee_p = 0.02 * max(pp, 1 - pp)
            gap = pk - pp
            net = abs(gap) - fee_k - fee_p - (v["kalshi"]["spread"] or 0) / 2 - (v["polymarket"]["spread"] or 0) / 2
            out.append({"id": s["id"], "title": s["title"], "kalshi_p": pk, "polymarket_p": pp, "gap": gap,
                        "fees_and_half_spreads": fee_k + fee_p + (v["kalshi"]["spread"] or 0) / 2 + (v["polymarket"]["spread"] or 0) / 2,
                        "net_edge": net, "actionable": net > 0})
    out.sort(key=lambda r: -r["net_edge"])
    return out


# ---------- P1: belief search ----------
class BeliefIn(BaseModel):
    belief: str


@app.post("/belief")
def belief(inp: BeliefIn):
    from backend import ai
    match = ai.match_events(inp.belief, EVENTS)
    ids = [i for i in match.get("matched_event_ids", []) if i in EVENT_BY_ID]
    cards = [strip(summarize(EVENT_BY_ID[i])) for i in ids]
    explanation = ai.explain(inp.belief, cards) if cards else None
    return {"interpretation": match.get("interpretation", ""), "matched": cards, "explanation": explanation,
            "ai_available": ai.available()}


# ---------- background refresh ----------
def _refresh_loop():
    from scripts.backfill import refresh_state, compute_proxy
    from backend.clients import proxies
    while True:
        try:
            try:
                options, _ = proxies.deribit_btc_options()
            except Exception:  # noqa: BLE001
                options = []
            for ev in EVENTS:
                if ev.get("settled"):
                    continue
                refresh_state(CON, ev)
                if (ev.get("proxy") or {}).get("type") == "btc_options" and options:
                    compute_proxy(CON, ev, options, [])
            LAST_REFRESH.update(ts=datetime.now(timezone.utc).isoformat(), ok=True, error=None)
        except Exception as e:  # noqa: BLE001
            log.exception("refresh failed")
            LAST_REFRESH.update(ts=datetime.now(timezone.utc).isoformat(), ok=False, error=str(e))
        time.sleep(config.REFRESH_SECONDS)


@app.on_event("startup")
def _start():
    if not config.DEMO_MODE:
        threading.Thread(target=_refresh_loop, daemon=True).start()
