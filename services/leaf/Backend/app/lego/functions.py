"""The functions behind each metric in app/metrics.py. One metric key, one function.

A Stock or Pair works a number out the first time it is asked for and keeps it, so Lego can check
the cheap needs first and only pay for a cointegration test on pairs that survive them.
"""
from __future__ import annotations

import math
from functools import cached_property

import numpy as np
from statsmodels.tsa.stattools import coint

TRADING_DAYS = 252


def _finite(x) -> float | None:
    """A plain float, or None for NaN and infinity (the API cannot send those)."""
    x = float(x)
    return x if math.isfinite(x) else None


class Stock:
    def __init__(self, close: np.ndarray, volume: np.ndarray):
        self.close = close
        self.volume = volume

    @cached_property
    def returns(self) -> np.ndarray:
        return np.diff(self.close) / self.close[:-1]

    @cached_property
    def volatility(self) -> float:
        return float(np.std(self.returns, ddof=1) * math.sqrt(TRADING_DAYS))

    @cached_property
    def avg_volume(self) -> float:
        return float(np.mean(self.volume))

    @cached_property
    def total_return(self) -> float:
        return float(self.close[-1] / self.close[0] - 1)


class Pair:
    """Two stocks, in a fixed order. The spread is ln(A) - alpha - beta * ln(B)."""

    def __init__(self, a: Stock, b: Stock):
        self.a, self.b = a, b
        self.log_a = np.log(a.close)
        self.log_b = np.log(b.close)

    @cached_property
    def corr(self) -> float:
        return float(np.corrcoef(self.a.returns, self.b.returns)[0, 1])

    @cached_property
    def hedge_effectiveness(self) -> float:
        # 1 - Var(r_A - h * r_B) / Var(r_A) with the best h, which works out to corr squared.
        return self.corr ** 2

    @cached_property
    def return_beta(self) -> float:
        """Shares of B to hold against one of A to hedge daily moves: Cov(rA, rB) / Var(rB)."""
        ra, rb = self.a.returns, self.b.returns
        return float(np.cov(ra, rb, ddof=1)[0, 1] / np.var(rb, ddof=1))

    @cached_property
    def _fit(self) -> tuple[float, float]:
        """alpha and beta from regressing ln(A) on ln(B)."""
        beta, alpha = np.polyfit(self.log_b, self.log_a, 1)
        return float(alpha), float(beta)

    @property
    def hedge_ratio(self) -> float:
        return self._fit[1]

    @cached_property
    def spread(self) -> np.ndarray:
        alpha, beta = self._fit
        return self.log_a - alpha - beta * self.log_b

    @cached_property
    def spread_std(self) -> float:
        return float(np.std(self.spread, ddof=1))

    @cached_property
    def z(self) -> np.ndarray:
        """The spread in standard deviations from its mean, for every day."""
        sd = self.spread_std or 1.0
        return (self.spread - self.spread.mean()) / sd

    @property
    def spread_z(self) -> float:
        return float(self.z[-1])

    @property
    def spread_z_abs(self) -> float:
        return abs(self.spread_z)

    @cached_property
    def half_life(self) -> float:
        """From dS_t = a + b * S_(t-1): -ln(2) / b. Infinite when the spread does not revert."""
        s = self.spread
        b = np.polyfit(s[:-1], np.diff(s), 1)[0]
        return -math.log(2) / b if b < 0 else math.inf

    @cached_property
    def coint_p(self) -> float:
        """Engle-Granger test, A on B. The slow one, so it is checked last."""
        return float(coint(self.log_a, self.log_b, trend="c")[1])


# metric key -> how to read it off a Stock or Pair. Every key in app/metrics.py must be here.
FUNCTIONS = {
    "coint_p": lambda p: p.coint_p,
    "corr": lambda p: p.corr,
    "spread_z": lambda p: p.spread_z,
    "spread_z_abs": lambda p: p.spread_z_abs,
    "half_life": lambda p: p.half_life,
    "hedge_effectiveness": lambda p: p.hedge_effectiveness,
    "volatility": lambda s: s.volatility,
    "avg_volume": lambda s: s.avg_volume,
    "total_return": lambda s: s.total_return,
}

# Cheapest first. Lego checks needs in this order and stops at the first one that fails.
COST_ORDER = [
    "volatility", "avg_volume", "total_return",
    "corr", "hedge_effectiveness", "spread_z", "spread_z_abs", "half_life", "coint_p",
]


def pair_stats(pair: Pair) -> dict:
    """Every number the screener table and detail panel show for a pair."""
    return {
        "corr": _finite(pair.corr),
        "coint_p": _finite(pair.coint_p),
        "half_life": _finite(pair.half_life),
        "zscore": _finite(pair.spread_z),
        "hedge_ratio": _finite(pair.hedge_ratio),
        "return_beta": _finite(pair.return_beta),
        "hedge_effectiveness": _finite(pair.hedge_effectiveness),
        "spread_std": _finite(pair.spread_std),
        "vol_a": _finite(pair.a.volatility),
        "vol_b": _finite(pair.b.volatility),
    }


def stock_stats(stock: Stock) -> dict:
    return {
        "volatility": _finite(stock.volatility),
        "avg_volume": _finite(stock.avg_volume),
        "total_return": _finite(stock.total_return),
    }
