import json
import shutil
from dataclasses import replace

import pytest

from intel.broker import AlpacaBroker
from intel.policy import Policy
from intel.portfolio import Portfolio, Position, current, from_alpaca, from_atropos, from_file
from tests.conftest import FIXTURES

ATROPOS = json.loads((FIXTURES / "portfolio_atropos.json").read_text())
SAMPLE = {"accounts": [{"id": "sample", "broker": "Sample", "name": "Sample brokerage", "number": ""}], "cash": 4200,
          "positions": [{"account": "Sample brokerage", "broker": "Sample", "type": "equity", "symbol": "SPY",
                         "description": "SPDR S&P 500 ETF", "units": 40, "price": 668.2, "value": 26728.0}],
          "source": "sample", "reason": "SnapTrade keys not set"}


class FakeWeb:
    """Answers every request with one JSON body (or raises it) and remembers what was asked."""

    def __init__(self, answer):
        self.answer, self.sent = answer, []

    def __call__(self, method, url, headers=None, body=None):
        self.sent.append((method, url))
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


def test_atropos_sums_a_ticker_across_accounts_and_leaves_options_out(monkeypatch):
    monkeypatch.setenv("ATROPOS_URL", "http://atropos.test:4411/")
    web = FakeWeb(ATROPOS)
    pf = from_atropos(transport=web)
    assert web.sent == [("GET", "http://atropos.test:4411/api/portfolio")]
    assert (pf.source, pf.cash, sorted(pf.positions)) == ("snaptrade", 5000.0, ["NWRB", "SPY"])
    assert pf.positions["NWRB"] == Position("NWRB", 16.0, 125.0, 2000.0)
    assert pf.equity == pytest.approx(5000 + 2000 + 13364)
    assert pf.value("NWRB") == 2000 and pf.value("TSLA") == 0
    assert pf.weight_pct("NWRB") == pytest.approx(100 * 2000 / 20364)


def test_atropos_sample_portfolio_counts_as_none():
    pf = from_atropos("http://127.0.0.1:4411", transport=FakeWeb(SAMPLE))
    assert (pf.source, pf.equity, pf.positions) == ("sample", 0.0, {})


def test_a_hand_typed_file_needs_only_symbol_units_and_price():
    pf = from_file(FIXTURES / "portfolio_by_hand.json")
    assert (pf.source, sorted(pf.positions), pf.equity) == ("file", ["NWRB", "VTI"], 2500 + 500 + 3005)
    assert pf.positions["NWRB"] == Position("NWRB", 4.0, 125.0, 500.0)


def test_empty_portfolio_has_no_weights():
    assert Portfolio().weight_pct("NWRB") == 0.0 and Portfolio().source == "none"


@pytest.mark.parametrize("atropos", [ConnectionError("refused"), SAMPLE])
def test_current_falls_back_to_the_file_when_atropos_is_down_or_sample(tmp_path, atropos):
    shutil.copy(FIXTURES / "portfolio_by_hand.json", tmp_path / "portfolio.json")
    assert current(Policy(), transport=FakeWeb(atropos), data_dir=tmp_path).source == "file"


def test_current_with_nothing_to_read(tmp_path):
    assert current(Policy(), transport=FakeWeb(ConnectionError("refused")), data_dir=tmp_path).source == "none"
    assert current(Policy(), transport=FakeWeb(SAMPLE), data_dir=tmp_path).source == "sample"


def test_current_prefers_atropos_over_the_file(tmp_path):
    shutil.copy(FIXTURES / "portfolio_by_hand.json", tmp_path / "portfolio.json")
    assert current(Policy(), transport=FakeWeb(ATROPOS), data_dir=tmp_path).source == "snaptrade"


class FakeAlpaca:
    def __init__(self, fail=False):
        self.fail = fail

    def __call__(self, method, url, headers=None, body=None):
        if self.fail:
            raise RuntimeError("HTTP 401: unauthorized")
        if url.endswith("/v2/account"):
            return {"cash": "8000.50", "equity": "11250.50"}
        return [{"symbol": "NWRB", "qty": "10", "market_value": "1250", "asset_class": "us_equity"},
                {"symbol": "SPY", "qty": "3", "market_value": "2000", "asset_class": "us_equity"},
                {"symbol": "BTCUSD", "qty": "0.01", "market_value": "650", "asset_class": "crypto"}]


def test_alpaca_account_as_a_portfolio(monkeypatch, tmp_path):
    monkeypatch.setenv("APCA_API_KEY_ID", "PKTEST")
    monkeypatch.setenv("APCA_API_SECRET_KEY", "secret")
    policy = replace(Policy(), broker="alpaca")
    pf = from_alpaca(AlpacaBroker(None, policy, transport=FakeAlpaca()))
    assert (pf.source, pf.cash, pf.equity, sorted(pf.positions)) == ("alpaca", 8000.5, 11250.5, ["NWRB", "SPY"])
    assert pf.positions["NWRB"].price == 125.0
    assert current(policy, transport=FakeAlpaca(), data_dir=tmp_path).source == "alpaca"
    shutil.copy(FIXTURES / "portfolio_by_hand.json", tmp_path / "portfolio.json")
    assert current(policy, transport=FakeAlpaca(fail=True), data_dir=tmp_path).source == "none"  # never the file
