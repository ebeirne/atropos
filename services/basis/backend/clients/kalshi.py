"""Kalshi public market-data client (no auth needed for reads). Shapes verified in data/api_notes.md."""
import time
from datetime import datetime, timezone, timedelta
from backend.clients.common import get_json

BASE = "https://api.elections.kalshi.com/trade-api/v2"


def _f(x, default=None):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def market(ticker):
    j, stale = get_json(f"{BASE}/markets/{ticker}")
    return j["market"], stale


def candles(series, ticker, days=365):
    now = int(time.time())
    j, stale = get_json(f"{BASE}/series/{series}/markets/{ticker}/candlesticks",
                        {"start_ts": now - days * 86400, "end_ts": now, "period_interval": 1440})
    rows, last = [], None
    for c in j.get("candlesticks", []):
        p = c.get("price", {})
        close = _f(p.get("close_dollars")) or _f(p.get("previous_dollars")) or last
        if close is None:
            continue
        last = close
        d = datetime.fromtimestamp(c["end_period_ts"], tz=timezone.utc).date().isoformat()
        rows.append((d, close))
    return rows, stale


def orderbook(ticker):
    j, stale = get_json(f"{BASE}/markets/{ticker}/orderbook")
    ob = j.get("orderbook_fp") or {}
    yes = [(_f(p), _f(s)) for p, s in (ob.get("yes_dollars") or [])]
    no = [(_f(p), _f(s)) for p, s in (ob.get("no_dollars") or [])]
    bid = max((p for p, _ in yes), default=None)
    ask = (1 - max((p for p, _ in no), default=None)) if no else None
    return {"bid": bid, "ask": ask}, stale


def trades(ticker, limit=200):
    j, stale = get_json(f"{BASE}/markets/trades", {"ticker": ticker, "limit": limit})
    return j.get("trades", []), stale


def state(ticker, series=None):
    """Current snapshot used for the trust score."""
    m, s1 = market(ticker)
    ob, s2 = orderbook(ticker)
    tr, s3 = trades(ticker, 200)
    bid = ob["bid"] if ob["bid"] is not None else _f(m.get("yes_bid_dollars"))
    ask = ob["ask"] if ob["ask"] is not None else _f(m.get("yes_ask_dollars"))
    p = _f(m.get("last_price_dollars"))
    if bid is not None and ask is not None and 0 < bid <= ask < 1 and (p is None or p <= 0 or p >= 1):
        p = (bid + ask) / 2
    spread = (ask - bid) if (bid is not None and ask is not None) else None
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    last_ts, largest = None, 0.0
    for t in tr:
        ts = datetime.fromisoformat(t["created_time"].replace("Z", "+00:00"))
        last_ts = max(last_ts, ts) if last_ts else ts
        if ts >= cutoff:
            largest = max(largest, _f(t.get("count_fp"), 0.0))
    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "p_yes": p,
        "spread": spread,
        "volume_24h": _f(m.get("volume_24h_fp"), 0.0),  # contracts ≈ $ notional
        "last_trade_ts": last_ts.isoformat() if last_ts else None,
        "top10_holder_share": None,  # Kalshi exposes no holder data
        "largest_trade_24h": largest,
        "stale": s1 or s2 or s3,
        "status": m.get("status"),
        "result": m.get("result"),
        "title": m.get("title"),
    }


def settled_markets(target=4000, page=1000, max_pages=12):
    """Paginate settled binary markets. Returns list of dicts (ticker, last_price, result, close_time, volume)."""
    out, cursor = [], None
    for _ in range(max_pages):
        params = {"status": "settled", "limit": page}
        if cursor:
            params["cursor"] = cursor
        j, _stale = get_json(f"{BASE}/markets", params)
        for m in j.get("markets", []):
            if m.get("market_type") != "binary" or m.get("result") not in ("yes", "no"):
                continue
            lp = _f(m.get("last_price_dollars"))
            if lp is None:
                continue
            out.append({"ticker": m["ticker"], "last_price": lp, "result": m["result"],
                        "close_time": m.get("close_time"), "volume": _f(m.get("volume_fp"), 0.0)})
        cursor = j.get("cursor")
        if not cursor or len(out) >= target:
            break
    return out
