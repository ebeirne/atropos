"""Traditional-market data: yfinance (futures, ETFs), FRED DFF, Deribit BTC options."""
import io, logging
import pandas as pd
import yfinance as yf
from backend.clients.common import get_json, get_text

log = logging.getLogger("basis.proxies")


def yf_history(ticker, period="1y"):
    """Daily closes as [(date, close)]. Empty list on failure (caller keeps cached DB rows)."""
    try:
        h = yf.Ticker(ticker).history(period=period, auto_adjust=False)
        if h is None or h.empty:
            return []
        return [(d.date().isoformat(), float(c)) for d, c in h["Close"].dropna().items()]
    except Exception as e:  # noqa: BLE001
        log.warning("yfinance %s failed: %s", ticker, e)
        return []


def fred_dff():
    """Effective fed funds rate, daily, as [(date, rate_pct)]."""
    txt, stale = get_text("https://fred.stlouisfed.org/graph/fredgraph.csv", {"id": "DFF", "cosd": "2024-01-01"}, ttl=6 * 3600)
    df = pd.read_csv(io.StringIO(txt))
    df.columns = ["date", "dff"]
    df["dff"] = pd.to_numeric(df["dff"], errors="coerce")
    df = df.dropna()
    return [(d, float(v)) for d, v in zip(df["date"], df["dff"])], stale


def deribit_btc_options():
    j, stale = get_json("https://www.deribit.com/api/v2/public/get_book_summary_by_currency",
                        {"currency": "BTC", "kind": "option"}, ttl=300)
    return j.get("result", []), stale
