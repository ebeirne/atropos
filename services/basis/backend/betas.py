"""Event betas: OLS of asset daily return on daily change (in percentage points) of event probability.

Reported as CO-MOVEMENT, not causation: n_obs is small, both series are noisy, and common drivers abound.
"""
import numpy as np
import pandas as pd


def event_prob_series(prices_by_venue):
    """Pick the venue with more history (or average when both have similar coverage)."""
    if not prices_by_venue:
        return pd.Series(dtype=float)
    series = {v: pd.Series(dict(rows)).sort_index() for v, rows in prices_by_venue.items() if rows}
    if not series:
        return pd.Series(dtype=float)
    if len(series) == 1:
        return next(iter(series.values()))
    df = pd.concat(series.values(), axis=1)
    return df.mean(axis=1)


def betas(prob_series, asset_closes):
    """asset_closes: {ticker: [(date, close)]}. Returns list of per-asset dicts."""
    out = []
    if prob_series is None or prob_series.empty:
        return out
    dp = (prob_series.diff() * 100).dropna()  # percentage points
    for tk, rows in asset_closes.items():
        if not rows:
            out.append({"ticker": tk, "beta_per_pp": None, "r2": None, "n_obs": 0})
            continue
        px = pd.Series(dict(rows)).sort_index()
        ret = (px.pct_change() * 100).dropna()  # percent
        df = pd.concat([dp.rename("dp"), ret.rename("ret")], axis=1).dropna()
        df = df[df["dp"].abs() > 1e-9]
        n = len(df)
        if n < 8:
            out.append({"ticker": tk, "beta_per_pp": None, "r2": None, "n_obs": int(n)})
            continue
        x, y = df["dp"].values, df["ret"].values
        X = np.column_stack([np.ones(n), x])
        coef, *_ = np.linalg.lstsq(X, y, rcond=None)
        yhat = X @ coef
        ss_res = float(((y - yhat) ** 2).sum())
        ss_tot = float(((y - y.mean()) ** 2).sum())
        r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
        out.append({"ticker": tk, "beta_per_pp": round(float(coef[1]), 4), "r2": round(r2, 3), "n_obs": int(n)})
    return out


def scenario(beta_rows, p_now, p_new):
    """expected_move_pct = beta_per_pp * (p_new - p_now) * 100."""
    d_pp = (p_new - p_now) * 100
    return [{"ticker": b["ticker"], "expected_move_pct": round(b["beta_per_pp"] * d_pp, 3) if b["beta_per_pp"] is not None else None,
             "beta_per_pp": b["beta_per_pp"], "r2": b["r2"], "n_obs": b["n_obs"]} for b in beta_rows]
