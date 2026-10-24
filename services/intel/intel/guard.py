"""The guard: whether an order may reach the broker, and at what size.

Plain arithmetic over policy.toml, the portfolio and the orders already on file, so the same inputs always
give the same verdict. The model proposes a ticker, a side and a dollar amount, and that's all the guard
reads: every rule either rejects the order or cuts it down, none looks at the proposal's reasoning, so
nothing the model writes can loosen a limit. The rules run in a fixed order: the kill switch, a real
portfolio (never atropos's sample one), a well-formed ticker that isn't blocked, buy or sell for a positive
amount, no selling what isn't held (there's no shorting), the position count, the per-position cap, the
cash floor, the per-order cap, the daily trade count, the weekly turnover cap, and last the minimum order,
which catches an order the caps cut to almost nothing. Each rule that fires adds a plain-English reason.

An order counts toward the daily and weekly limits once it's on file as manual (on your checklist), submitted
or filled, so a proposal you never place keeps counting until you mark it canceled. Days are UTC.
"""
import math
import re
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone

from intel.policy import DATA_DIR, killed

TICKER = re.compile(r"[A-Z]{1,5}([.-][A-Z])?")
COUNTED = ("manual", "submitted", "filled")
ISO = "%Y-%m-%dT%H:%M:%SZ"


@dataclass
class Order:
    ticker: str
    side: str
    notional: float
    proposal_id: object = None
    reason: str = ""


@dataclass
class Verdict:
    ok: bool
    order: Order
    reasons: list = field(default_factory=list)
    resized: bool = False


def usd(x):
    return f"${x:,.2f}"


def cents(x):
    """Down to the cent, so rounding never takes an order over a cap."""
    return math.floor(round(x * 100, 6)) / 100


def amount(x):
    """Dollars to the cent; anything that isn't a positive finite number is 0, which the guard rejects."""
    try:
        x = round(float(x), 2)
    except (TypeError, ValueError):
        return 0.0
    return x if math.isfinite(x) and x > 0 else 0.0


def on_file(store, since, until):
    """(count, dollar total) of orders filed between two ISO times that count toward the limits."""
    row = store.con.execute(f"SELECT COUNT(*), COALESCE(SUM(notional), 0) FROM orders WHERE status IN "
                            f"({','.join('?' * len(COUNTED))}) AND created_at >= ? AND created_at <= ?",
                            (*COUNTED, since, until)).fetchone()
    return row[0], float(row[1])


def check(order, portfolio, policy, store, *, now=None, data_dir=DATA_DIR):
    """The verdict on one order: ok with the order to send (maybe cut down), or rejected, with the reasons."""
    from intel.broker import init  # the orders table lives with the brokers, which import this module
    init(store)
    now = now or datetime.now(timezone.utc)
    now = now.replace(tzinfo=timezone.utc) if now.tzinfo is None else now.astimezone(timezone.utc)
    s, lim, equity = policy.sizing, policy.limits, portfolio.equity
    ticker, side = str(order.ticker or "").strip().upper(), str(order.side or "").strip().lower()
    asked = notional = amount(order.notional)
    reasons = []

    def verdict(ok, why=None):
        if why:
            reasons.append(why)
        return Verdict(ok, replace(order, ticker=ticker, side=side, notional=notional), reasons, notional < asked)

    def cut(room, why):
        nonlocal notional
        if notional > room:
            notional = max(0.0, cents(room))
            reasons.append(f"Cut to {usd(notional)} {why}.")

    if killed(data_dir):
        return verdict(False, "The kill switch is on (INTEL_KILL=1 or a KILL file in the data directory), "
                              "so nothing trades until it's turned off.")
    if portfolio.source == "sample":
        return verdict(False, "Atropos is showing its sample portfolio, not your holdings, so there's nothing real "
                              "to size this against. Link Fidelity through SnapTrade or fill in data/portfolio.json.")
    if portfolio.source == "none":
        return verdict(False, "No portfolio could be read (not from atropos, data/portfolio.json or the broker), "
                              "so there's nothing to size this against.")
    if not TICKER.fullmatch(ticker):
        return verdict(False, f"{order.ticker!r} isn't a ticker (1-5 capital letters, optionally a class like BRK.B).")
    if ticker.replace("-", ".") in {t.replace("-", ".") for t in lim.blocked_tickers}:
        return verdict(False, f"{ticker} is on the blocked list in policy.toml.")
    if side not in ("buy", "sell"):
        return verdict(False, f"An order is a buy or a sell, not {order.side!r}.")
    if asked <= 0:
        return verdict(False, f"The amount must be a positive number of dollars, not {order.notional!r}.")
    held = portfolio.value(ticker)
    if side == "sell":
        if held <= 0:
            return verdict(False, f"Can't sell {ticker}: none is held, and the agent never sells short.")
        cut(held, f"because only {usd(held)} of {ticker} is held")
    else:
        if ticker not in portfolio.positions and len(portfolio.positions) >= lim.max_positions:
            return verdict(False, f"Already holding {len(portfolio.positions)} positions, the limit of "
                                  f"{lim.max_positions}; a new one in {ticker} would go over it.")
        cap = equity * s.max_position_pct / 100
        cut(cap - held, f"so {ticker} stays at or under {s.max_position_pct:g}% of equity ({usd(cap)}); "
                        f"{usd(held)} is held already")
        floor = equity * s.min_cash_pct / 100
        cut(portfolio.cash - floor, f"to keep at least {s.min_cash_pct:g}% of equity ({usd(floor)}) in cash")
    cut(s.max_order_usd, "(the most a single order may be)")
    until = now.strftime(ISO)
    today, _ = on_file(store, now.strftime("%Y-%m-%dT00:00:00Z"), until)
    if today >= lim.max_trades_per_day:
        return verdict(False, f"{today} trades are on file today (UTC) already; the limit is "
                              f"{lim.max_trades_per_day} a day.")
    _, traded = on_file(store, (now - timedelta(days=7)).strftime(ISO), until)
    cap = equity * lim.max_weekly_turnover_pct / 100
    cut(cap - traded, f"so the last 7 days' turnover stays at or under {lim.max_weekly_turnover_pct:g}% of equity "
                      f"({usd(cap)}); {usd(traded)} is on file already")
    if notional < s.min_order_usd:
        return verdict(False, f"{usd(notional)} is under the {usd(s.min_order_usd)} minimum order"
                              + (" after the cuts above." if notional < asked else "."))
    return verdict(True)
