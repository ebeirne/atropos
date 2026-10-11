"""Pull history + current state for every event in data/events.json into data/basis.db,
fit the calibration curve from settled Kalshi markets, and compute proxy series.

Usage: python -m scripts.backfill [--skip-calibration] [--only EVENT_ID]
"""
import argparse, json, logging, sys
from datetime import date
from backend.config import EVENTS_PATH
from backend import db, calibration
from backend.clients import kalshi, polymarket, proxies
from backend.basis import fedfunds_series, btc_prob_above

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("backfill")


def load_events():
    return json.loads(EVENTS_PATH.read_text())


def refresh_state(con, ev):
    """Current market_state for both venues. Safe to call every 60s."""
    if ev.get("kalshi_ticker"):
        try:
            s = kalshi.state(ev["kalshi_ticker"], ev.get("kalshi_series"))
            db.upsert_state(con, ev["id"], "kalshi", s)
        except Exception as e:  # noqa: BLE001
            log.warning("%s kalshi state failed: %s", ev["id"], e)
    if ev.get("polymarket_condition_id"):
        try:
            s = polymarket.state(ev["polymarket_condition_id"], ev["polymarket_yes_token_id"])
            db.upsert_state(con, ev["id"], "polymarket", s)
        except Exception as e:  # noqa: BLE001
            log.warning("%s polymarket state failed: %s", ev["id"], e)


def backfill_history(con, ev):
    if ev.get("kalshi_ticker") and ev.get("kalshi_series"):
        rows, _ = kalshi.candles(ev["kalshi_series"], ev["kalshi_ticker"])
        db.upsert_prices(con, ev["id"], "kalshi", rows)
        log.info("%s kalshi history: %d days", ev["id"], len(rows))
    if ev.get("polymarket_yes_token_id"):
        rows, _ = polymarket.history(ev["polymarket_yes_token_id"])
        db.upsert_prices(con, ev["id"], "polymarket", rows)
        log.info("%s polymarket history: %d days", ev["id"], len(rows))


def backfill_assets(con, events):
    tickers = sorted({t for ev in events for t in ev.get("beta_assets", [])})
    for ev in events:
        px = ev.get("proxy") or {}
        for k in ("contract", "baseline_contract"):
            if px.get(k):
                tickers.append(px[k])
    for t in sorted(set(tickers)):
        rows = proxies.yf_history(t)
        if rows:
            db.upsert_asset(con, t, rows)
        log.info("asset %s: %d rows", t, len(rows))


def compute_proxy(con, ev, options=None, dff=None):
    px = ev.get("proxy")
    if not px:
        return
    if px["type"] == "fedfunds":
        after = db.get_asset(con, px["contract"])
        base = db.get_asset(con, px["baseline_contract"]) if px.get("baseline_contract") else (dff or [])
        synthetic = False
        if after and not base and ev.get("settled"):
            # FRED unavailable and pre-meeting contract expired: synthesize the pre-meeting rate from the
            # post-meeting contract's final implied rate minus the realized move. Labelled in `detail`.
            sign = 1 if px.get("direction", "hike") == "hike" else -1
            final_rate = 100 - after[-1][1]
            base = [(after[0][0], final_rate - sign * 0.25)]
            synthetic = True
        if not after or not base:
            log.warning("%s: missing futures data", ev["id"]); return
        rows = fedfunds_series(after, base, px.get("direction", "hike"))
        if synthetic:
            rows = [(d, p, det + " [baseline synthetic: FRED down, pre-meeting contract expired]") for d, p, det in rows]
        db.upsert_proxy(con, ev["id"], rows)
        log.info("%s fedfunds proxy: %d days, latest p=%.3f", ev["id"], len(rows), rows[-1][1] if rows else -1)
    elif px["type"] == "btc_options":
        p, detail = btc_prob_above(options or [], px["strike"], px["deribit_expiry"], date.fromisoformat(px["expiry"]))
        if p is not None:
            db.upsert_proxy(con, ev["id"], [(date.today().isoformat(), p, detail)])
            log.info("%s btc proxy p=%.3f (%s)", ev["id"], p, detail)


def run_calibration(con):
    from backend.clients.kalshi_settled import settled_with_preclose
    settled = settled_with_preclose()
    if len(settled) < 300 and calibration.CALIBRATION_PATH.exists():
        log.warning("only %d settled markets recovered; keeping existing calibration.json", len(settled)); return
    with db.tx(con):
        con.executemany("INSERT OR REPLACE INTO settled_markets VALUES (?,?,?,?,?)",
                        [(m["ticker"], m["last_price"], m["result"], m["close_time"], m["volume"]) for m in settled])
    out = calibration.fit(settled)
    log.info("calibration: %d markets, %d bins", out["n_markets"], len(out["bins"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-calibration", action="store_true")
    ap.add_argument("--only")
    ap.add_argument("--calibration-only", action="store_true")
    a = ap.parse_args()
    con = db.connect()
    if a.calibration_only:
        run_calibration(con); return
    events = load_events()
    if a.only:
        events = [e for e in events if e["id"] == a.only]
    backfill_assets(con, events)
    try:
        dff, _ = proxies.fred_dff()
    except Exception as e:  # noqa: BLE001
        log.warning("FRED failed: %s", e); dff = []
    try:
        options, _ = proxies.deribit_btc_options()
    except Exception as e:  # noqa: BLE001
        log.warning("Deribit failed: %s", e); options = []
    for ev in events:
        try:
            backfill_history(con, ev)
            refresh_state(con, ev)
            compute_proxy(con, ev, options, dff)
        except Exception as e:  # noqa: BLE001
            log.exception("%s failed: %s", ev["id"], e)
    if not a.skip_calibration:
        run_calibration(con)
    log.info("done")


if __name__ == "__main__":
    sys.exit(main())
