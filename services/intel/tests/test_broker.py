from dataclasses import replace
from urllib.parse import urlsplit

import pytest

from intel import broker
from intel.broker import LIVE, PAPER, AlpacaBroker, ManualBroker, execute, make, orders, record
from intel.guard import Order
from intel.policy import Policy, set_killed
from intel.portfolio import Portfolio, Position
from intel.store import Store

ALPACA = replace(Policy(), broker="alpaca")
NWRB = {"symbol": "NWRB", "qty": "12.5", "market_value": "1500.00", "asset_class": "us_equity"}


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "evidence.db")
    yield s
    s.close()


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("APCA_API_KEY_ID", "PKTEST123")
    monkeypatch.setenv("APCA_API_SECRET_KEY", "test-secret")
    for name in ("ALPACA_LIVE", "INTEL_KILL"):
        monkeypatch.delenv(name, raising=False)


class FakeAlpaca:
    """Stands in for Alpaca's REST API: answers by (method, path) and remembers every request."""

    def __init__(self, routes=None):
        self.sent = []
        self.routes = {("GET", "/v2/positions"): [NWRB],
                       ("POST", "/v2/orders"): {"id": "alp-1", "status": "accepted"}, **(routes or {})}

    def __call__(self, method, url, headers=None, body=None):
        self.sent.append({"method": method, "url": url, "headers": headers, "body": body})
        answer = self.routes[(method, urlsplit(url).path)]
        if isinstance(answer, Exception):
            raise answer
        return answer

    def posted(self):
        return [s["body"] for s in self.sent if s["method"] == "POST"]


def portfolio(cash=20_000):
    held = {"NWRB": 3_000, "SPY": 77_000}
    return Portfolio(cash + sum(held.values()), cash, {t: Position(t, v / 100, 100.0, v) for t, v in held.items()},
                     "snaptrade")


@pytest.mark.parametrize("allow_live, flag, mode, base", [
    (False, None, "paper", PAPER), (False, "1", "paper", PAPER), (True, None, "paper", PAPER),
    (True, "true", "paper", PAPER), (True, "1", "live", LIVE)])
def test_live_trading_needs_the_policy_and_the_env_both(store, monkeypatch, allow_live, flag, mode, base):
    if flag:
        monkeypatch.setenv("ALPACA_LIVE", flag)
    web = FakeAlpaca()
    b = AlpacaBroker(store, replace(ALPACA, allow_live=allow_live), transport=web)
    assert (b.mode, b.base) == (mode, base)
    b.submit(Order("NWRB", "buy", 100))
    assert web.sent[-1]["url"] == base + "/v2/orders"
    assert orders(store)[0]["mode"] == mode


def test_order_payload_and_auth_headers(store):
    web = FakeAlpaca()
    row = AlpacaBroker(store, ALPACA, transport=web).submit(Order("NWRB", "buy", 123.45, proposal_id=9),
                                                            reasons=["Cut to $123.45 (test)."])
    assert web.sent == [{"method": "POST", "url": PAPER + "/v2/orders",
                         "headers": {"APCA-API-KEY-ID": "PKTEST123", "APCA-API-SECRET-KEY": "test-secret"},
                         "body": {"symbol": "NWRB", "side": "buy", "type": "market", "time_in_force": "day",
                                  "notional": "123.45"}}]
    assert (row["status"], row["broker_order_id"], row["broker"], row["proposal_id"]) == ("submitted", "alp-1", "alpaca", 9)
    assert row["reasons"] == ["Cut to $123.45 (test)."] and row["detail"]["alpaca_status"] == "accepted"


def test_a_whole_position_sell_goes_by_quantity(store):
    web = FakeAlpaca()
    b = AlpacaBroker(store, ALPACA, transport=web)
    b.submit(Order("NWRB", "sell", 1_500))
    b.submit(Order("NWRB", "sell", 1_490))  # within 1% of the position: close it rather than leave a sliver
    b.submit(Order("NWRB", "sell", 500))
    sent = web.posted()
    assert [("qty" in s, "notional" in s) for s in sent] == [(True, False), (True, False), (False, True)]
    assert (sent[0]["qty"], sent[2]["notional"]) == ("12.5", "500.00")


def test_a_refused_order_is_filed_as_failed(store):
    web = FakeAlpaca({("POST", "/v2/orders"): RuntimeError("HTTP 403: insufficient buying power")})
    row = AlpacaBroker(store, ALPACA, transport=web).submit(Order("NWRB", "buy", 100))
    assert (row["status"], row["broker_order_id"]) == ("failed", None)
    assert row["detail"]["error"] == "HTTP 403: insufficient buying power"
    assert "insufficient buying power" in row["reasons"][-1]


def test_missing_keys_fail_without_a_request(store, monkeypatch):
    monkeypatch.delenv("APCA_API_SECRET_KEY")
    web = FakeAlpaca()
    row = AlpacaBroker(store, ALPACA, transport=web).submit(Order("NWRB", "buy", 100))
    assert row["status"] == "failed" and "APCA_API_SECRET_KEY" in row["detail"]["error"] and web.sent == []


@pytest.mark.parametrize("alpaca, ours", [("filled", "filled"), ("canceled", "canceled"), ("expired", "canceled"),
                                          ("partially_filled", "submitted"), ("rejected", "failed")])
def test_refresh_reads_the_order_back(store, alpaca, ours):
    web = FakeAlpaca({("GET", "/v2/orders/alp-1"): {"id": "alp-1", "status": alpaca, "filled_qty": "1.2",
                                                     "filled_avg_price": "125.10"}})
    b = AlpacaBroker(store, ALPACA, transport=web)
    row = b.refresh(b.submit(Order("NWRB", "buy", 150))["id"])
    assert web.sent[-1]["url"] == PAPER + "/v2/orders/alp-1"
    assert (row["status"], row["detail"]["filled_avg_price"]) == (ours, "125.10")
    assert row["detail"]["request"]["notional"] == "150.00"  # merged, not replaced


def test_manual_broker_makes_a_checklist_row_you_mark(store):
    b = ManualBroker(store)
    row = b.submit(Order("NWRB", "buy", 1_250, proposal_id=3))
    assert (row["status"], row["broker"], row["mode"], row["proposal_id"]) == ("manual", "proposals", "manual", 3)
    assert row["detail"]["instruction"] == "Buy $1,250.00 of NWRB at Fidelity: market order, during market hours"
    assert ManualBroker(store).mark(row["id"], "filled")["status"] == "filled"
    assert b.mark(row["id"], "canceled")["status"] == "canceled"
    assert b.submit(Order("SPY", "sell", 600))["detail"]["instruction"].startswith("Sell $600.00 of SPY at Fidelity")


def test_mark_only_records_filled_or_canceled_on_checklist_rows(store):
    b = ManualBroker(store)
    oid = b.submit(Order("NWRB", "buy", 100))["id"]
    with pytest.raises(ValueError):
        b.mark(oid, "submitted")
    rejected = record(store, Order("NWRB", "buy", 100), broker="proposals", mode="manual", status="rejected")
    sent = record(store, Order("NWRB", "buy", 100), broker="alpaca", mode="paper", status="submitted")
    for oid in (rejected, sent, 999):
        with pytest.raises(ValueError):
            b.mark(oid, "filled")


def test_execute_files_a_passed_order_with_the_broker(store, tmp_path):
    res = execute(Order("newx", "buy", 4_000, proposal_id=5), portfolio(), Policy(), store, ManualBroker(store),
                  data_dir=tmp_path)
    assert (res["status"], res["notional"], res["resized"]) == ("manual", 2_500.0, True)
    assert res["reasons"] == ["Cut to $2,500.00 (the most a single order may be)."]
    row = broker.get(store, res["order_id"])
    assert (row["ticker"], row["proposal_id"], row["detail"]["instruction"][:22]) == ("NEWX", 5, "Buy $2,500.00 of NEWX ")


def test_execute_files_a_rejected_order_and_sends_nothing(store, tmp_path):
    set_killed(True, tmp_path)
    web = FakeAlpaca()
    res = execute(Order("NWRB", "buy", 500), portfolio(), ALPACA, store, AlpacaBroker(store, ALPACA, transport=web),
                  data_dir=tmp_path)
    assert (res["status"], res["resized"], web.sent) == ("rejected", False, [])
    assert "kill switch" in res["reasons"][0]
    row = broker.get(store, res["order_id"])
    assert (row["status"], row["broker"], row["mode"], row["reasons"]) == ("rejected", "alpaca", "paper", res["reasons"])


def test_execute_through_alpaca(store, tmp_path):
    web = FakeAlpaca()
    res = execute(Order("NWRB", "buy", 800), portfolio(), ALPACA, store, make(ALPACA, store, transport=web),
                  data_dir=tmp_path)
    assert (res["status"], res["notional"]) == ("submitted", 800.0) and web.posted()[0]["notional"] == "800.00"


def test_executed_orders_count_toward_the_daily_limit(store, tmp_path):
    b = ManualBroker(store)
    statuses = [execute(Order("NEWX", "buy", 100), portfolio(), Policy(), store, b, data_dir=tmp_path)["status"]
                for _ in range(4)]
    assert statuses == ["manual", "manual", "manual", "rejected"]


def test_make_picks_the_policy_broker(store):
    assert isinstance(make(Policy(), store), ManualBroker)
    assert isinstance(make(ALPACA, store, transport=FakeAlpaca()), AlpacaBroker)


def test_orders_filters_by_time_and_status(store):
    broker.init(store)
    broker.init(store)  # idempotent
    for at, status in (("2026-10-20T10:00:00Z", "filled"), ("2026-10-22T10:00:00Z", "manual"),
                       ("2026-10-23T10:00:00Z", "rejected")):
        record(store, Order("SPY", "buy", 100), broker="proposals", mode="manual", status=status, at=at,
               reasons=["why"] if status == "rejected" else ())
    assert [o["status"] for o in orders(store)] == ["rejected", "manual", "filled"]
    assert [o["status"] for o in orders(store, since="2026-10-21T00:00:00Z")] == ["rejected", "manual"]
    assert [o["status"] for o in orders(store, status=("filled", "manual"))] == ["manual", "filled"]
    assert orders(store, status="rejected")[0]["reasons"] == ["why"]
