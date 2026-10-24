"""What we hold, so the guard can size an order against it.

The user's money is at Fidelity, which has no trading API. Atropos reads the holdings (read-only, through
SnapTrade) and serves them at GET /api/portfolio as {accounts, positions: [{account, broker, type, symbol,
units, price, value}], cash, source}. Only equities count here: option rows are left out of both the positions
and equity. The same ticker held in two accounts is one position. When atropos has no linked brokerage it
serves a made-up sample portfolio; that comes back here as an empty Portfolio with source "sample", and the
guard refuses to trade on it.

Without SnapTrade, data/portfolio.json holds the same shape typed in by hand (a position needs only symbol,
units and price). When policy.toml says broker = "alpaca", the Alpaca account itself is the portfolio. Every
HTTP call goes through `transport(method, url, headers, body)`, which returns parsed JSON; tests pass their
own, so nothing touches the network under test.
"""
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from intel.policy import DATA_DIR

ATROPOS_URL = "http://127.0.0.1:4411"


def http(method, url, headers=None, body=None, *, timeout=20):
    """JSON over urllib. An HTTP error raises RuntimeError carrying the server's own message."""
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Accept": "application/json", **({"Content-Type": "application/json"} if data else {}), **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        try:
            text = json.loads(text).get("message", text)
        except (ValueError, AttributeError):
            pass
        raise RuntimeError(f"HTTP {e.code}: {str(text)[:300]}") from None
    return json.loads(raw) if raw.strip() else None


@dataclass
class Position:
    ticker: str
    qty: float
    price: float
    value: float


@dataclass
class Portfolio:
    equity: float = 0.0
    cash: float = 0.0
    positions: dict = field(default_factory=dict)
    source: str = "none"

    def value(self, ticker):
        p = self.positions.get(ticker)
        return p.value if p else 0.0

    def weight_pct(self, ticker):
        return 100 * self.value(ticker) / self.equity if self.equity > 0 else 0.0


def build(cash, rows, source):
    """A Portfolio from (ticker, qty, value) rows, summing a ticker held in several accounts. Equity is cash
    plus every position's value."""
    positions = {}
    for ticker, qty, value in rows:
        p = positions.setdefault(ticker, Position(ticker, 0.0, 0.0, 0.0))
        p.qty, p.value = p.qty + qty, p.value + value
    positions = {t: p for t, p in positions.items() if p.qty or p.value}
    for p in positions.values():
        p.price = p.value / p.qty if p.qty else 0.0
    cash = float(cash or 0)
    return Portfolio(cash + sum(p.value for p in positions.values()), cash, positions, source)


def parse(data, source):
    """Atropos's /api/portfolio JSON, or the same shape from a file, as a Portfolio of equities."""
    rows = []
    for p in data.get("positions") or []:
        ticker = str(p.get("symbol") or "").strip().upper()
        if p.get("type", "equity") != "equity" or ticker in ("", "?"):
            continue
        qty, price = float(p.get("units") or 0), float(p.get("price") or 0)
        rows.append((ticker, qty, float(p["value"]) if p.get("value") is not None else qty * price))
    return build(data.get("cash"), rows, source)


def from_atropos(url=None, *, transport=http):
    """Holdings as atropos reads them from Fidelity. `url` defaults to $ATROPOS_URL, then the local server."""
    url = url or os.environ.get("ATROPOS_URL", ATROPOS_URL)
    data = transport("GET", url.rstrip("/") + "/api/portfolio")
    if data.get("source") == "sample":
        return Portfolio(source="sample")
    return parse(data, data.get("source") or "snaptrade")


def from_file(path=DATA_DIR / "portfolio.json"):
    """Holdings typed in by hand, in atropos's shape."""
    return parse(json.loads(Path(path).read_text(encoding="utf-8")), "file")


def from_alpaca(broker):
    """The Alpaca account (an intel.broker.AlpacaBroker) as a Portfolio. Crypto and options are left out."""
    acct = broker.account()
    rows = [(p["symbol"].upper(), float(p["qty"]), float(p["market_value"])) for p in broker.positions()
            if p.get("asset_class", "us_equity") == "us_equity"]
    return build(acct.get("cash"), rows, "alpaca")


def current(policy, *, broker=None, transport=http, data_dir=DATA_DIR):
    """The portfolio to size orders against: the Alpaca account when the policy trades there, otherwise atropos,
    then data/portfolio.json, then an empty Portfolio(source="none"). The guard refuses "none" and "sample"."""
    if policy.broker == "alpaca":
        if broker is None:
            from intel.broker import AlpacaBroker
            broker = AlpacaBroker(None, policy, transport=transport)
        try:
            return from_alpaca(broker)
        except Exception:  # noqa: BLE001 - never fall back to another account's holdings
            return Portfolio(source="none")
    try:
        pf = from_atropos(transport=transport)
    except Exception:  # noqa: BLE001 - atropos not running is normal; the file is next
        pf = Portfolio(source="none")
    if pf.source not in ("none", "sample"):
        return pf
    path = Path(data_dir) / "portfolio.json"
    return from_file(path) if path.exists() else pf
