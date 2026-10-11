"""Calibration curve from settled Kalshi markets.

Approximation: we use each settled market's *last traded price* as "the price shortly before close".
Bucket into 5-cent bins, compute empirical YES rate per bin, and fit an isotonic regression
price -> win rate. Longshot bias shows up as win_rate < price for low prices and > price for high prices.
"""
import json
import numpy as np
from sklearn.isotonic import IsotonicRegression
from backend.config import CALIBRATION_PATH

_curve = None  # cached {"x": [...], "y": [...]}
_mtime = None


def fit(settled):
    """settled: list of {last_price, result}. Returns dict saved to data/calibration.json."""
    p = np.array([m["last_price"] for m in settled], dtype=float)
    y = np.array([1.0 if m["result"] == "yes" else 0.0 for m in settled])
    # Drop the degenerate 0/1 endpoints: last price 0.00/1.00 is a post-resolution print, not a forecast.
    keep = (p > 0.005) & (p < 0.995)
    p, y = p[keep], y[keep]
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso.fit(p, y)
    grid = np.round(np.linspace(0.01, 0.99, 99), 2)
    fitted = iso.predict(grid)
    bins = []
    edges = np.arange(0, 1.0001, 0.05)
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (p >= lo) & (p < hi) if hi < 1 else (p >= lo) & (p <= hi)
        n = int(mask.sum())
        if n == 0:
            continue
        bins.append({"bin": f"{lo:.2f}-{hi:.2f}", "lo": float(lo), "hi": float(hi), "n": n,
                     "raw_p": float(p[mask].mean()), "win_rate": float(y[mask].mean())})
    out = {"n_markets": int(len(p)), "bins": bins,
           "curve": [{"p": float(a), "p_cal": float(b)} for a, b in zip(grid, fitted)]}
    CALIBRATION_PATH.write_text(json.dumps(out, indent=1))
    global _curve
    _curve = None
    return out


def load():
    global _curve, _mtime
    if not CALIBRATION_PATH.exists():
        return None
    mt = CALIBRATION_PATH.stat().st_mtime
    if _curve is None or mt != _mtime:
        _mtime = mt
        d = json.loads(CALIBRATION_PATH.read_text())
        _curve = {"x": np.array([c["p"] for c in d["curve"]]), "y": np.array([c["p_cal"] for c in d["curve"]]), "raw": d}
    return _curve


def calibrate(p):
    """Map a raw market price to an empirically calibrated probability. Identity if no curve fitted."""
    if p is None:
        return None
    c = load()
    if c is None:
        return float(p)
    return float(np.interp(p, c["x"], c["y"]))
