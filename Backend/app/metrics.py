"""The closed list of things a strategy can be measured on.

One entry per metric. EX (Gemini) may only choose from these keys, and Lego (a later step)
attaches exactly one function to each key. To add a metric: add it here, then write its function.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Metric:
    key: str
    scope: str    # "stock" (one ticker) or "pair" (two tickers)
    label: str    # short name for screens
    meaning: str  # one plain sentence. Also shown to Gemini, so keep it exact.
    unit: str     # "", "days", "std devs" or "fraction"
    lo: float     # lowest value that makes sense
    hi: float     # highest value that makes sense


_ALL = [
    Metric(
        "coint_p", "pair", "Cointegration p-value",
        "Engle-Granger cointegration test p-value from 0 to 1. LOW means the two prices are tied "
        "together over the long run (cointegrated). HIGH means there is no long-run link.",
        "", 0, 1,
    ),
    Metric(
        "corr", "pair", "Correlation",
        "Correlation of the two stocks' daily returns, from -1 to 1. Positive moves together, "
        "negative moves in opposite directions.",
        "", -1, 1,
    ),
    Metric(
        "spread_z", "pair", "Spread z-score",
        "How many standard deviations the gap between the two stocks (the spread) is from its "
        "average right now. Signed: positive means the first stock is expensive relative to the second.",
        "std devs", -20, 20,
    ),
    Metric(
        "spread_z_abs", "pair", "Spread stretch",
        "The same as spread_z but ignoring direction: how stretched the spread is, either way. "
        "Use this for 'at least 2 standard deviations away'.",
        "std devs", 0, 20,
    ),
    Metric(
        "half_life", "pair", "Half-life",
        "Days the spread takes to close half the gap back to its average. SHORT means it snaps "
        "back quickly.",
        "days", 0, 2000,
    ),
    Metric(
        "hedge_effectiveness", "pair", "Hedge effectiveness",
        "Share of one stock's variance that hedging with the other removes, from 0 to 1 "
        "(correlation squared).",
        "fraction", 0, 1,
    ),
    Metric(
        "volatility", "stock", "Volatility",
        "Annualized standard deviation of a stock's daily returns, as a fraction. 0.25 means "
        "25 percent a year. LOW means a calm stock.",
        "fraction", 0, 5,
    ),
    Metric(
        "avg_volume", "stock", "Average volume",
        "Average number of shares traded per day over the lookback window.",
        "shares", 0, 1e12,
    ),
    Metric(
        "total_return", "stock", "Total return",
        "A stock's total price change over the lookback window, as a fraction. 0.10 means +10 "
        "percent, -0.20 means -20 percent.",
        "fraction", -1, 100,
    ),
]

METRICS: dict[str, Metric] = {m.key: m for m in _ALL}


def metric_catalog() -> list[dict]:
    """The list as plain data, for the API and for the review screen on the frontend."""
    return [
        {"key": m.key, "scope": m.scope, "label": m.label, "meaning": m.meaning,
         "unit": m.unit, "min": m.lo, "max": m.hi}
        for m in _ALL
    ]