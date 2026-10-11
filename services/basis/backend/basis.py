"""Traditional-market implied probabilities and the 'basis' (prediction market p minus proxy p)."""
import math
from datetime import datetime, timezone, date as _date
import numpy as np
import pandas as pd
from scipy.stats import norm


def fedfunds_series(futures_after, baseline, direction="hike", step=0.25):
    """Daily P(move) implied by fed funds futures.

    Approximation (documented): the futures contract for the month *after* the meeting prices the
    average effective rate in that month, which is (almost) fully post-decision. The baseline is either
    the contract for the month *before* the meeting (clean pre-decision expectation) or, if absent,
    the current effective rate (FRED DFF).
        implied_rate = 100 - price
        P(hike) = clip((implied_after - baseline) / 0.25, 0, 1)
        P(cut)  = clip((baseline - implied_after) / 0.25, 0, 1)
    This treats a 50bp move as "two 25bp moves" and ignores term premium / intra-month timing.
    futures_after, baseline: [(date, price_or_rate)]; baseline may be futures prices (100-x) or raw DFF rates.
    Returns [(date, p, detail_str)].
    """
    a = pd.Series({d: 100 - v for d, v in futures_after}).sort_index()
    b = pd.Series(dict(baseline)).sort_index()
    if b.max() > 50:  # futures prices → implied rates
        b = 100 - b
    df = pd.concat([a.rename("after"), b.rename("base")], axis=1).sort_index()
    df["base"] = df["base"].ffill()
    df = df.dropna()
    sign = 1 if direction == "hike" else -1
    df["p"] = ((sign * (df["after"] - df["base"])) / step).clip(0, 1)
    return [(d, float(r.p), f"after={r.after:.3f}% base={r.base:.3f}%") for d, r in df.iterrows()]


def btc_prob_above(options, strike, deribit_expiry, expiry_date):
    """Risk-neutral P(BTC > K at expiry) = N(d2) using the nearest-strike instrument's mark IV.

    This is a *risk-neutral* probability (no risk premium adjustment) and a *terminal* probability,
    while 'reach $K in October' markets are *touch* (barrier) events, which are roughly 2x more likely
    for small moves. We report N(d2) as the proxy and note this limitation in the API.
    """
    cands = [o for o in options if o["instrument_name"].split("-")[1] == deribit_expiry and o["instrument_name"].endswith("-C")]
    if not cands:
        return None, "no deribit instruments for expiry"
    best = min(cands, key=lambda o: abs(float(o["instrument_name"].split("-")[2]) - strike))
    iv = (best.get("mark_iv") or 0) / 100.0
    S = best.get("underlying_price") or 0
    if iv <= 0 or S <= 0:
        return None, "no iv"
    T = max((expiry_date - datetime.now(timezone.utc).date()).days, 1) / 365.0
    d2 = (math.log(S / strike) - 0.5 * iv * iv * T) / (iv * math.sqrt(T))
    p = float(norm.cdf(d2))
    return p, f"{best['instrument_name']} iv={iv*100:.1f}% S={S:.0f} T={T*365:.0f}d N(d2) risk-neutral terminal"


def basis_stats(pm_series, proxy_series, window=30):
    """basis_t = p_pm_t - p_proxy_t on common dates; rolling z-score of basis over `window` obs.
    Returns (current_basis, current_z, [(date, basis)])."""
    if not pm_series or not proxy_series:
        return None, None, []
    a = pd.Series(dict(pm_series)).sort_index()
    b = pd.Series({d: p for d, p, *_ in proxy_series}).sort_index()
    df = pd.concat([a.rename("pm"), b.rename("px")], axis=1).sort_index()
    df["px"] = df["px"].ffill()
    df = df.dropna()
    if df.empty:
        return None, None, []
    df["basis"] = df["pm"] - df["px"]
    roll = df["basis"].rolling(window, min_periods=5)
    sd = roll.std().iloc[-1]
    mu = roll.mean().iloc[-1]
    cur = float(df["basis"].iloc[-1])
    z = float((cur - mu) / sd) if sd and not np.isnan(sd) and sd > 1e-6 else None
    return cur, z, [(d, float(v)) for d, v in df["basis"].items()]
