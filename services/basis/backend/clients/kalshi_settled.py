"""Sample settled Kalshi markets across time and recover the price ~1 day before close from candlesticks.

Why not last_price? Kalshi's `last_price_dollars` on a settled market is usually the post-resolution print
(0.00 or 1.00) for short-lived markets (15-minute BTC, sports), which makes every bin look like 0%/100%.
We therefore (1) sample settled markets in 7-day windows over the last ~120 days, (2) drop ultra-short-lived
markets, (3) fetch daily candlesticks and take the last close whose period ended >= 12h before close_time.
"""
import re, time, logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from backend.clients.common import get_json
from backend.clients.kalshi import BASE, _f

log = logging.getLogger("basis.settled")
SKIP = re.compile(r"15M|KXMVE|1H|HOURLY|UPDOWN|KXBTCD|KXETHD|KXSOLD|KXXRPD|KXBTC-|KXETH-", re.I)


def _iso(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def sample_settled(days=365, window=7, per_window=600, min_hours=36, pages=8):
    now = int(time.time())
    out = []
    for w in range(days // window):
        hi = now - w * window * 86400
        lo = hi - window * 86400
        markets, cursor = [], None
        for _ in range(pages):
            params = {"status": "settled", "limit": 1000, "min_close_ts": lo, "max_close_ts": hi}
            if cursor:
                params["cursor"] = cursor
            j, _ = get_json(f"{BASE}/markets", params, ttl=86400)
            markets.extend(j.get("markets", []))
            cursor = j.get("cursor")
            time.sleep(0.15)
            if not cursor:
                break
        rows = []
        for m in markets:
            if m.get("market_type") != "binary" or m.get("result") not in ("yes", "no"):
                continue
            if SKIP.search(m["ticker"]) or SKIP.search(m.get("event_ticker", "")):
                continue
            try:
                hrs = (_iso(m["close_time"]) - _iso(m["open_time"])).total_seconds() / 3600
            except Exception:  # noqa: BLE001
                continue
            if hrs < min_hours:
                continue
            rows.append({"ticker": m["ticker"], "series": m["event_ticker"].split("-")[0], "result": m["result"],
                         "close_time": m["close_time"], "volume": _f(m.get("volume_fp"), 0.0),
                         "last_price": _f(m.get("last_price_dollars"))})
        out.extend(rows[:per_window])
        log.info("window %d: %d candidates", w, len(rows))
    return out


def preclose_price(m, hours_before=12):
    close = _iso(m["close_time"]).timestamp()
    try:
        j, _ = get_json(f"{BASE}/series/{m['series']}/markets/{m['ticker']}/candlesticks",
                        {"start_ts": int(close - 60 * 86400), "end_ts": int(close), "period_interval": 1440}, ttl=7 * 86400)
    except Exception:  # noqa: BLE001
        return None
    best = None
    for c in j.get("candlesticks", []):
        if c["end_period_ts"] <= close - hours_before * 3600:
            p = c.get("price", {})
            v = _f(p.get("close_dollars")) or _f(p.get("previous_dollars"))
            if v is not None:
                best = v
    return best


def settled_with_preclose(max_markets=5000, workers=1):
    cands = sample_settled()
    log.info("%d candidate settled markets", len(cands))
    cands = cands[:max_markets]
    prices = []
    for i, m in enumerate(cands):  # sequential: Kalshi public rate limit is tight
        prices.append(preclose_price(m))
        time.sleep(0.12)
        if i % 100 == 0:
            log.info("preclose %d/%d", i, len(cands))
    out = []
    for m, p in zip(cands, prices):
        if p is None or p <= 0 or p >= 1:
            continue
        out.append({**m, "last_price": p})
    log.info("%d settled markets with pre-close price", len(out))
    return out
