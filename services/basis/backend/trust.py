"""Trust score 0-100 with component breakdown.

liquidity     log(24h volume) scaled by its rank within the cross-event distribution   w=0.35
spread        1 - spread/0.10, clipped to [0,1]                                        w=0.25
freshness     exp decay on hours since last trade, half-life 12h                       w=0.20
concentration 1 - top10_holder_share (0.5 when unavailable, e.g. Kalshi)               w=0.20
horizon       multiplier: 1.0 up to 180 days, then linear down to 0.6 at 720 days
leakage_flag  largest single trade in 24h > 5% of 24h volume
"""
import math
from datetime import datetime, timezone, date as _date

WEIGHTS = {"liquidity": 0.35, "spread": 0.25, "freshness": 0.20, "concentration": 0.20}


def _clip(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def liquidity_score(vol, all_vols):
    """Percentile of log(1+vol) among all venue-states in the event map (cross-event distribution)."""
    if vol is None:
        return 0.0
    lv = math.log1p(max(vol, 0))
    pool = sorted(math.log1p(max(v, 0)) for v in all_vols if v is not None)
    if not pool or pool[-1] == pool[0]:
        return 0.5
    return _clip((lv - pool[0]) / (pool[-1] - pool[0]))


def trust(state, all_vols, resolution_date):
    """state: one venue row from market_state. Returns dict with score, components, leakage_flag."""
    vol = state.get("volume_24h")
    liq = liquidity_score(vol, all_vols)
    spr = state.get("spread")
    spread_s = _clip(1 - spr / 0.10) if spr is not None else 0.3
    lt = state.get("last_trade_ts")
    if lt:
        hrs = max((datetime.now(timezone.utc) - datetime.fromisoformat(lt)).total_seconds() / 3600, 0)
        fresh = 0.5 ** (hrs / 12.0)
    else:
        hrs, fresh = None, 0.2
    top10 = state.get("top10_holder_share")
    conc = _clip(1 - top10) if top10 is not None else 0.5
    days = None
    try:
        days = (_date.fromisoformat(resolution_date) - datetime.now(timezone.utc).date()).days
    except Exception:  # noqa: BLE001
        pass
    horizon = 1.0 if days is None or days <= 180 else _clip(1 - 0.4 * (days - 180) / 540, 0.6, 1.0)
    comps = {"liquidity": liq, "spread": spread_s, "freshness": fresh, "concentration": conc}
    raw = sum(WEIGHTS[k] * comps[k] for k in WEIGHTS)
    score = round(100 * raw * horizon)
    largest = state.get("largest_trade_24h") or 0
    leakage = bool(vol and vol > 0 and largest > 0.05 * vol and largest > 500)
    return {"score": int(score), "components": {k: round(v, 3) for k, v in comps.items()},
            "horizon_multiplier": round(horizon, 3), "weights": WEIGHTS, "leakage_flag": leakage,
            "inputs": {"volume_24h": vol, "spread": spr, "hours_since_trade": round(hrs, 1) if hrs is not None else None,
                       "top10_holder_share": top10, "largest_trade_24h": largest, "days_to_resolution": days}}
