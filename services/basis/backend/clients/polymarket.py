"""Polymarket Gamma + CLOB + Data API client. Shapes verified in data/api_notes.md."""
import json
from datetime import datetime, timezone, timedelta
from backend.clients.common import get_json

GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
DATA = "https://data-api.polymarket.com"


def _f(x, default=None):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def market_by_condition(condition_id):
    j, stale = get_json(f"{GAMMA}/markets", {"condition_ids": condition_id})
    if isinstance(j, list) and j:
        return j[0], stale
    return None, stale


def history(yes_token_id):
    j, stale = get_json(f"{CLOB}/prices-history", {"market": yes_token_id, "interval": "max", "fidelity": 1440})
    rows = {}
    for h in j.get("history", []):
        d = datetime.fromtimestamp(h["t"], tz=timezone.utc).date().isoformat()
        rows[d] = float(h["p"])  # last point per day wins
    return sorted(rows.items()), stale


def book(yes_token_id):
    j, stale = get_json(f"{CLOB}/book", {"token_id": yes_token_id})
    bids = [_f(b["price"]) for b in j.get("bids", [])]
    asks = [_f(a["price"]) for a in j.get("asks", [])]
    return {"bid": max(bids) if bids else None, "ask": min(asks) if asks else None}, stale


def holders(condition_id, yes_token_id):
    j, stale = get_json(f"{DATA}/holders", {"market": condition_id, "limit": 20})
    for entry in (j or []):
        if str(entry.get("token")) == str(yes_token_id):
            amts = sorted((_f(h.get("amount"), 0.0) for h in entry.get("holders", [])), reverse=True)
            tot = sum(amts)
            return (sum(amts[:10]) / tot if tot > 0 else None), stale
    return None, stale


def trades(condition_id, limit=200):
    j, stale = get_json(f"{DATA}/trades", {"market": condition_id, "limit": limit})
    return (j or []), stale


def state(condition_id, yes_token_id):
    m, s1 = market_by_condition(condition_id)
    ob, s2 = book(yes_token_id)
    top10, s3 = holders(condition_id, yes_token_id)
    tr, s4 = trades(condition_id)
    p = None
    if m:
        try:
            p = float(json.loads(m.get("outcomePrices") or "[]")[0])
        except Exception:  # noqa: BLE001
            p = _f(m.get("lastTradePrice"))
    if p is None and ob["bid"] is not None and ob["ask"] is not None:
        p = (ob["bid"] + ob["ask"]) / 2
    spread = (ob["ask"] - ob["bid"]) if (ob["bid"] is not None and ob["ask"] is not None) else _f(m.get("spread") if m else None)
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).timestamp()
    last_ts, largest = None, 0.0
    for t in tr:
        ts = _f(t.get("timestamp"))
        if ts is None:
            continue
        last_ts = max(last_ts or 0, ts)
        if ts >= cutoff:
            largest = max(largest, _f(t.get("size"), 0.0) * _f(t.get("price"), 1.0))
    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "p_yes": p,
        "spread": spread,
        "volume_24h": _f(m.get("volume24hr") if m else None, 0.0),  # USD
        "last_trade_ts": datetime.fromtimestamp(last_ts, tz=timezone.utc).isoformat() if last_ts else None,
        "top10_holder_share": top10,
        "largest_trade_24h": largest,
        "stale": s1 or s2 or s3 or s4,
        "closed": bool(m.get("closed")) if m else None,
        "question": m.get("question") if m else None,
    }
