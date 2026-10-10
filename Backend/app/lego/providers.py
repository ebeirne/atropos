"""Where Lego's market data comes from: daily close and volume, one column per ticker.

Two providers, picked by name:
  - "synthetic": made-up prices with known structure, so the math can be checked offline.
  - "yahoo": real daily prices through yfinance, cached on disk for the day.
"""
from __future__ import annotations

import datetime as dt
import logging
import zlib
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import BACKEND_DIR

PROVIDERS = ("synthetic", "yahoo")
MIN_DAYS, MAX_DAYS = 21, 2520  # one month to ten years of trading days. Under ~6 months the tests get shaky.
MAX_TICKERS = 80  # 80 tickers is 3,160 pairs, still a few seconds
CACHE_DIR = BACKEND_DIR / ".cache" / "yahoo"

log = logging.getLogger(__name__)


class ProviderError(Exception):
    """A data problem the caller can act on. `status` is the HTTP status the API should return."""

    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass
class Prices:
    """Aligned daily data. Rows are dates, columns are tickers, with no gaps."""

    close: pd.DataFrame
    volume: pd.DataFrame
    dropped: list[str] = field(default_factory=list)  # asked for, but not enough data

    @property
    def tickers(self) -> list[str]:
        return list(self.close.columns)


# ---------- the default universes ----------

# Real tickers grouped so there are pairs worth finding: same-sector stocks, and funds that
# track the same thing (GLD/IAU, SPY/IVV), which should come out cointegrated. Stocks almost
# never move opposite each other, so the last four are there for hedging: volatility (VIXY),
# the dollar against the yen (UUP/FXY), and an inverse S&P fund (SH).
YAHOO_UNIVERSE = [
    "KO", "PEP", "XOM", "CVX", "COP", "JPM", "BAC", "C", "WFC", "V", "MA", "HD", "LOW",
    "MCD", "YUM", "UPS", "FDX", "GLD", "IAU", "SLV", "SPY", "IVV", "QQQ", "EWA", "EWC",
    "VIXY", "UUP", "FXY", "SH",
]

# Made-up names. COxA/COxB are cointegrated (CO1 reverts fast, CO2 slower), HCxA/HCxB move
# opposite each other day to day with no long-run link (hedges), RWx are unrelated.
SYNTHETIC_UNIVERSE = ["CO1A", "CO1B", "CO2A", "CO2B", "HC1A", "HC1B", "HC2A", "HC2B", "RW1", "RW2", "RW3", "RW4"]


def default_universe(provider: str) -> list[str]:
    _check_provider(provider)
    return list(YAHOO_UNIVERSE if provider == "yahoo" else SYNTHETIC_UNIVERSE)


def get_prices(provider: str, tickers: list[str] | None, days: int) -> Prices:
    """Close and volume for `days` trading days, ending at the latest close."""
    _check_provider(provider)
    if not MIN_DAYS <= days <= MAX_DAYS:
        raise ProviderError(f"Lookback must be between {MIN_DAYS} and {MAX_DAYS} trading days, not {days}.")

    tickers = _clean_tickers(tickers) or default_universe(provider)
    if len(tickers) < 2:
        raise ProviderError("Add at least two tickers. A pair needs two.")
    if len(tickers) > MAX_TICKERS:
        raise ProviderError(f"That is {len(tickers)} tickers. Keep it to {MAX_TICKERS} or fewer.")

    prices = _synthetic(tickers, days) if provider == "synthetic" else _yahoo(tickers, days)
    if len(prices.tickers) < 2:
        missing = ", ".join(prices.dropped) or "the tickers"
        raise ProviderError(f"Not enough data to form a pair. No usable prices for: {missing}.")
    return prices


def _check_provider(provider: str) -> None:
    if provider not in PROVIDERS:
        raise ProviderError(f'"{provider}" is not a data source. Use one of: {", ".join(PROVIDERS)}.', 404)


def _clean_tickers(tickers: list[str] | None) -> list[str]:
    seen: dict[str, None] = {}
    for t in tickers or []:
        t = str(t).strip().upper()
        if t:
            seen.setdefault(t, None)
    return list(seen)


def _align(close: pd.DataFrame, volume: pd.DataFrame, days: int, asked: list[str]) -> Prices:
    """Keep the last `days` rows, fill one-off gaps, and drop tickers that still have holes."""
    close = close.sort_index().ffill(limit=3).tail(days)
    volume = volume.reindex(close.index).fillna(0)
    usable = [t for t in asked if t in close and close[t].notna().all() and (close[t] > 0).all()]
    dropped = [t for t in asked if t not in usable]
    return Prices(close[usable].astype(float), volume[usable].astype(float), dropped)


# ---------- synthetic ----------

def _synthetic(tickers: list[str], days: int) -> Prices:
    """Deterministic. One long history is built and cut to `days`, like real data would be."""
    rng = np.random.default_rng(20_240_601)
    n = MAX_DAYS
    dates = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=n)
    logs: dict[str, np.ndarray] = {}

    def walk(step: float) -> np.ndarray:
        return np.cumsum(rng.normal(0, step, n))

    def reverting(theta: float, step: float) -> np.ndarray:
        s = np.zeros(n)
        for i in range(1, n):
            s[i] = s[i - 1] * (1 - theta) + rng.normal(0, step)
        return s

    # (A leg, B leg, how B is built from A)
    planted = {
        "CO1": lambda a: 0.8 * a + reverting(0.15, 0.01),
        "CO2": lambda a: 0.8 * a + reverting(0.08, 0.01),
        "HC1": lambda a: -0.9 * a + walk(0.006),
        "HC2": lambda a: -1.0 * a + walk(0.009),
    }
    for name, make_b in planted.items():
        a = walk(0.012)
        logs[f"{name}A"], logs[f"{name}B"] = a, make_b(a)

    out = {}
    for t in tickers:
        series = logs.get(t)
        if series is None:  # any other name is an unrelated random walk, seeded by its name
            series = np.cumsum(np.random.default_rng(zlib.crc32(t.encode())).normal(0.0002, 0.014, n))
        out[t] = 100 * np.exp(series - series[-days])  # starts near 100 at the window start
    close = pd.DataFrame(out, index=dates)
    volume = pd.DataFrame(
        {t: np.random.default_rng(zlib.crc32(t.encode()) + 1).lognormal(14, 0.4, n) for t in tickers},
        index=dates,
    ).round()
    return _align(close, volume, days, tickers)


# ---------- yahoo ----------

def _yahoo(tickers: list[str], days: int) -> Prices:
    """Real daily data. Each ticker is downloaded at most once a day, then read from disk."""
    # Trading days are about 252 of 365, so ask for a bit more calendar time than needed.
    start = dt.date.today() - dt.timedelta(days=int(days * 365 / 252) + 14)
    cached = {t: _read_cache(t, start) for t in tickers}
    need = [t for t, frame in cached.items() if frame is None]
    if need:
        for t, frame in _download(need, start).items():
            cached[t] = frame
            _write_cache(t, frame)

    found = {t: f for t, f in cached.items() if f is not None and not f.empty}
    if not found:
        raise ProviderError(f"Yahoo Finance returned no prices for: {', '.join(tickers)}. Check the symbols.")
    close = pd.DataFrame({t: f["Close"] for t, f in found.items()})
    volume = pd.DataFrame({t: f["Volume"] for t, f in found.items()})
    return _align(close, volume, days, tickers)


def _cache_path(ticker: str) -> Path:
    safe = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in ticker)
    return CACHE_DIR / f"{safe}.pkl"


def _read_cache(ticker: str, start: dt.date) -> pd.DataFrame | None:
    """The saved frame, if it was saved today and reaches back far enough."""
    path = _cache_path(ticker)
    try:
        if dt.date.fromtimestamp(path.stat().st_mtime) != dt.date.today():
            return None
        frame = pd.read_pickle(path)
    except Exception:  # noqa: BLE001 - a missing or broken cache file is just a miss
        return None
    if frame.empty or frame.index[0].date() > start + dt.timedelta(days=7):
        return None
    return frame


def _write_cache(ticker: str, frame: pd.DataFrame) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        frame.to_pickle(_cache_path(ticker))
    except OSError as exc:  # the scan still works, it just downloads again next time
        log.warning("Could not cache %s: %s", ticker, exc)


def _download(tickers: list[str], start: dt.date) -> dict[str, pd.DataFrame]:
    """One batch download. Tickers that fail in the batch get one more try, one at a time."""
    import yfinance as yf

    def fetch(batch: list[str], threads: bool) -> dict[str, pd.DataFrame]:
        try:
            raw = yf.download(batch, start=start.isoformat(), auto_adjust=True, progress=False, threads=threads)
        except Exception as exc:  # noqa: BLE001
            if "Rate" in type(exc).__name__ or "Too Many Requests" in str(exc):
                raise ProviderError("Yahoo Finance is rate limiting requests. Wait a minute and try again.", 429) from exc
            raise ProviderError(f"Could not download from Yahoo Finance ({type(exc).__name__}). Check the internet connection.", 502) from exc
        if raw is None or raw.empty:
            return {}
        out = {}
        for t in batch:
            try:
                frame = raw.xs(t, axis=1, level="Ticker")[["Close", "Volume"]].dropna(subset=["Close"])
            except KeyError:
                continue
            if not frame.empty:
                frame.index = pd.DatetimeIndex(frame.index).tz_localize(None)
                out[t] = frame
        return out

    got = fetch(tickers, threads=True)
    missing = [t for t in tickers if t not in got]
    if missing:
        got.update(fetch(missing, threads=False))
    return got
