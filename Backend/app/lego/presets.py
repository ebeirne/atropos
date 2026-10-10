"""Specs for the screener's built-in strategy cards, in the same format EX produces.

They mirror the `requires` on each card in Frontend/src/data/strategies.js, so the cards can be
scanned without a Gemini call. A scan can still send its own spec (from EX) for any card.
"""
from ..ex.spec import Spec, parse_spec

_RAW = {
    "mean_reversion": {
        "name": "Mean reversion",
        "summary": "Cointegrated pairs whose spread reverts in days to weeks.",
        "needs": [
            {"metric": "corr", "op": ">=", "value": 0.5},
            {"metric": "coint_p", "op": "<=", "value": 0.05},
            {"metric": "half_life", "op": "between", "value": [3, 40]},
        ],
    },
    "arbitrage": {
        "name": "Statistical arbitrage",
        "summary": "The tightest, fastest-reverting cointegrated pairs.",
        "needs": [
            {"metric": "corr", "op": ">=", "value": 0.6},
            {"metric": "coint_p", "op": "<=", "value": 0.01},
            {"metric": "half_life", "op": "<=", "value": 15},
        ],
    },
    "hedging": {
        "name": "Hedging",
        "summary": "Inverse pairs that are not cointegrated.",
        "needs": [
            {"metric": "corr", "op": "between", "value": [-0.9, -0.5]},
            {"metric": "coint_p", "op": ">", "value": 0.10},
        ],
    },
}

# Checked by the same validator as EX's output, so a typo here fails at startup, not mid-scan.
PRESETS: dict[str, Spec] = {key: parse_spec(raw) for key, raw in _RAW.items()}
