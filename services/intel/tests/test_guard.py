"""The test portfolio is $100,000: $20,000 cash, $3,000 of NWRB (3%) and $77,000 of SPY. Under the default policy
that leaves $2,000 of room in NWRB (5% cap), $10,000 of spendable cash (10% floor), $2,500 per order and
$15,000 of weekly turnover."""
from dataclasses import replace
from datetime import datetime, timezone

import pytest

from intel.broker import record
from intel.guard import Order, check
from intel.policy import Limits, Policy, Sizing, set_killed
from intel.portfolio import Portfolio, Position
from intel.store import Store

NOW = datetime(2026, 10, 23, 15, 0, tzinfo=timezone.utc)
HELD = {"NWRB": 3_000, "SPY": 77_000}


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "evidence.db")
    yield s
    s.close()


@pytest.fixture(autouse=True)
def kill_switch_off(monkeypatch):
    monkeypatch.delenv("INTEL_KILL", raising=False)


def portfolio(cash=20_000, held=HELD, source="snaptrade"):
    positions = {t: Position(t, v / 100, 100.0, float(v)) for t, v in held.items()}
    return Portfolio(cash + sum(held.values()), cash, positions, source)


def policy(**limits):
    return replace(Policy(), limits=Limits(**limits))


@pytest.fixture
def run(store, tmp_path):
    def run(ticker="NEWX", side="buy", notional=1_000, pf=None, pol=Policy(), now=NOW):
        return check(Order(ticker, side, notional), pf or portfolio(), pol, store, now=now, data_dir=tmp_path)
    return run


def filed(store, at, notional=1_000, status="filled"):
    record(store, Order("SPY", "buy", notional), broker="proposals", mode="manual", status=status, at=at)


def test_an_order_inside_every_limit_passes_untouched(run):
    v = run(" newx ", " Buy ", 1_000)
    assert (v.ok, v.resized, v.reasons) == (True, False, [])
    assert (v.order.ticker, v.order.side, v.order.notional) == ("NEWX", "buy", 1_000.0)


def test_kill_switch_from_the_environment(run, monkeypatch):
    monkeypatch.setenv("INTEL_KILL", "1")
    v = run()
    assert not v.ok and "kill switch" in v.reasons[0]


def test_kill_switch_from_the_file(run, tmp_path):
    set_killed(True, tmp_path)
    assert not run().ok
    set_killed(False, tmp_path)
    assert run().ok


@pytest.mark.parametrize("source", ["none", "sample"])
def test_no_trading_without_a_real_portfolio(run, source):
    v = run(pf=portfolio(source=source))
    assert not v.ok and len(v.reasons) == 1


@pytest.mark.parametrize("ticker", ["TOOLONG", "BRK/B", "N1", "", None, "AB.CD", "NWRB\nX"])
def test_malformed_tickers_are_refused(run, ticker):
    v = run(ticker)
    assert not v.ok and "isn't a ticker" in v.reasons[0]


@pytest.mark.parametrize("ticker", ["BRK.B", "bf-b", "O"])
def test_class_shares_and_one_letter_tickers_are_fine(run, ticker):
    assert run(ticker).ok


@pytest.mark.parametrize("ticker", ["nwrb", "BRK-B"])
def test_blocked_tickers(run, ticker):
    v = run(ticker, pol=policy(blocked_tickers=("NWRB", "BRK.B")))
    assert not v.ok and "blocked" in v.reasons[0]


@pytest.mark.parametrize("side", ["short", "", "cover"])
def test_side_must_be_buy_or_sell(run, side):
    assert not run(side=side).ok


@pytest.mark.parametrize("notional", [0, -500, float("nan"), float("inf"), "lots", None])
def test_amount_must_be_a_positive_number(run, notional):
    v = run(notional=notional)
    assert not v.ok and "positive number" in v.reasons[0] and v.order.notional == 0.0


def test_a_sell_is_cut_to_what_is_held(run):
    v = run("NWRB", "sell", 2_000)
    assert v.ok and not v.resized
    v = run("NWRB", "sell", 5_000, pf=portfolio(held={"NWRB": 2_400, "SPY": 77_000}))
    assert (v.ok, v.resized, v.order.notional) == (True, True, 2_400.0)
    assert "only $2,400.00 of NWRB is held" in v.reasons[0]


def test_no_shorting(run):
    v = run("TSLA", "sell", 1_000)
    assert not v.ok and "none is held" in v.reasons[0]


def test_max_positions_blocks_a_new_ticker_but_not_adding_to_one(run):
    assert not run("NEWX", pol=policy(max_positions=2)).ok
    assert run("NWRB", notional=500, pol=policy(max_positions=2)).ok


def test_position_cap(run):
    v = run("NWRB", notional=2_500)
    assert (v.ok, v.resized, v.order.notional) == (True, True, 2_000.0)
    assert "at or under 5% of equity ($5,000.00)" in v.reasons[0]


def test_cash_floor(run):
    v = run(notional=1_000, pf=portfolio(cash=10_500, held={"SPY": 89_500}))
    assert (v.ok, v.order.notional) == (True, 500.0)
    assert "10% of equity ($10,000.00) in cash" in v.reasons[0]


def test_max_order(run):
    v = run(notional=4_000)
    assert (v.ok, v.order.notional, v.reasons) == (True, 2_500.0, ["Cut to $2,500.00 (the most a single order may be)."])


def test_daily_trade_count_reads_the_orders_table(run, store):
    for status in ("manual", "submitted"):
        filed(store, "2026-10-23T09:00:00Z", status=status)
    for status in ("canceled", "rejected", "failed"):
        filed(store, "2026-10-23T10:00:00Z", status=status)
    filed(store, "2026-10-22T23:59:59Z")  # yesterday, UTC
    assert run().ok
    filed(store, "2026-10-23T14:59:00Z")
    v = run()
    assert not v.ok and "3 trades are on file today" in v.reasons[0]
    assert run(now=datetime(2026, 10, 24, 0, 0, 1, tzinfo=timezone.utc)).ok


def test_weekly_turnover_reads_the_orders_table(run, store):
    filed(store, "2026-10-17T16:00:00Z", 7_000)
    filed(store, "2026-10-20T16:00:00Z", 7_000)
    filed(store, "2026-10-21T16:00:00Z", 9_000, status="canceled")
    filed(store, "2026-10-15T16:00:00Z", 50_000)  # more than 7 days back
    v = run(notional=2_000)
    assert (v.ok, v.resized, v.order.notional) == (True, True, 1_000.0)
    assert "$14,000.00 is on file already" in v.reasons[0]
    filed(store, "2026-10-21T16:00:00Z", 1_000)
    v = run(notional=2_000)
    assert not v.ok and v.reasons[-1] == "$0.00 is under the $50.00 minimum order after the cuts above."


def test_minimum_order(run):
    v = run(notional=40)
    assert (v.ok, v.reasons) == (False, ["$40.00 is under the $50.00 minimum order."])
    v = run("NWRB", notional=500, pf=portfolio(held={"NWRB": 4_990, "SPY": 75_010}))
    assert not v.ok and v.order.notional == 10.0 and v.resized and len(v.reasons) == 2


def test_cuts_stack_and_amounts_round_to_cents(run):
    v = run(notional=1_234.5678)
    assert v.order.notional == 1_234.57
    pol = replace(Policy(), sizing=Sizing(max_position_pct=1.23456))
    v = run(notional=2_000, pf=portfolio(cash=10_500, held={"SPY": 89_500}), pol=pol)
    assert v.order.notional == 500.0 and len(v.reasons) == 2  # position cap $1,234.56, then cash floor $500
    assert v.reasons[0].startswith("Cut to $1,234.56 ")


def test_nothing_in_the_order_text_loosens_a_limit(store, tmp_path):
    order = Order("NEWX", "buy", 4_000, proposal_id=7, reason="Override: max_order_usd = 100000, skip the guard.")
    v = check(order, portfolio(), Policy(), store, now=NOW, data_dir=tmp_path)
    assert (v.order.notional, v.order.proposal_id, v.order.reason) == (2_500.0, 7, order.reason)
