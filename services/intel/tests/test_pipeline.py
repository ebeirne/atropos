"""The whole cycle on the fixture story: a feed lists the six pages, Claude (faked) reads them, the gate passes,
a proposal waits for approval, and approval sends it through the guard to the Fidelity checklist."""
from dataclasses import replace
from datetime import datetime, timezone

import pytest

from intel import broker, decide, stories
from intel.pipeline import approve, cycle, reject
from intel.policy import Policy, set_killed
from intel.store import Store
from tests.conftest import URLS, FakeClaude, FakeWeb, page, response

NOW = datetime(2026, 10, 23, 12, tzinfo=timezone.utc)
FEED = "https://feeds.example.com/business.rss"
RSS = "<rss version='2.0'><channel>" + "".join(
    f"<item><title>Northwind and Contoso: {name}</title><link>{url}</link><pubDate>Thu, 22 Oct 2026 16:00:00 GMT</pubDate></item>"
    for name, url in URLS.items()) + "</channel></rss>"
HOLDINGS = {"source": "snaptrade", "cash": 20000,
            "positions": [{"symbol": "SPY", "type": "equity", "units": 100, "price": 668.2, "value": 66820}]}
CFG = {"lookback_days": 3, "max_articles": 10, "feed": [{"name": "Biz", "url": FEED}], "gdelt": {"enabled": False}}


@pytest.fixture
def env(tmp_path, monkeypatch, registry):
    monkeypatch.delenv("SEC_USER_AGENT", raising=False)
    monkeypatch.delenv("INTEL_KILL", raising=False)
    watchlist = tmp_path / "watchlist.toml"
    watchlist.write_text('[[company]]\nticker = "NWRB"\nname = "Northwind Robotics"\naliases = ["Northwind"]\n')
    web = FakeWeb({FEED: page(FEED, RSS), **{url: (lambda n=name: response(n)) for name, url in URLS.items()}})
    store = Store(tmp_path / "evidence.db")

    def run(policy=Policy(), claude=None, holdings=HOLDINGS):
        return cycle(store, registry, policy, get=web, ask=claude or FakeClaude(), search=lambda q: [],
                     transport=lambda method, url, headers=None, body=None: holdings, feeds_cfg=CFG,
                     watchlist=watchlist, now=NOW, data_dir=tmp_path)
    yield store, run, tmp_path
    store.close()


def test_a_full_cycle_ends_in_a_proposal_waiting_for_you(env):
    store, run, data = env
    report = run()
    assert (report["portfolio"]["source"], report["universe"]) == ("snaptrade", 2)  # NWRB + the SPY holding
    assert (report["discovered"], report["fetched"], report["claims"]) == (6, 6, 5)  # the WSJ teaser has no claims
    [d] = report["decisions"]
    assert (d["status"], d["ticker"], d["side"], d["notional"]) == ("proposed", "NWRB", "buy", 2083.68)  # 86,820 x 3% x 0.8
    assert decide.proposals(store, status="proposed")[0]["id"] == d["proposal_id"]

    again = run()
    assert (again["discovered"], again["fetched"], again["decisions"]) == (0, 0, [])


def holdings(data):
    return lambda method, url, headers=None, body=None: data


def test_approval_goes_through_the_guard_to_the_fidelity_checklist(env):
    store, run, data = env
    pid = run()["decisions"][0]["proposal_id"]
    out = approve(store, Policy(), pid, transport=holdings(HOLDINGS), data_dir=data)
    assert (out["proposal_status"], out["status"]) == ("approved", "manual")
    [o] = broker.orders(store)
    assert (o["ticker"], o["side"], o["notional"], o["status"]) == ("NWRB", "buy", 2083.68, "manual")
    assert stories.get(store, 1)["status"] == "executed"
    assert approve(store, Policy(), pid, transport=holdings(HOLDINGS), data_dir=data)["status"] == "error"  # only once


def test_the_guard_can_still_block_an_approved_proposal(env):
    store, run, data = env
    pid = run()["decisions"][0]["proposal_id"]
    out = approve(store, Policy(), pid, transport=holdings({"source": "sample"}), data_dir=data)  # no real holdings
    assert out["proposal_status"] == "blocked" and out["reasons"]
    assert decide.get_proposal(store, pid)["status"] == "blocked"


def test_reject(env):
    store, run, data = env
    pid = run()["decisions"][0]["proposal_id"]
    assert reject(store, pid)["proposal_status"] == "rejected"
    assert stories.get(store, 1)["status"] == "passed"


def test_the_kill_switch_keeps_collecting_but_never_proposes(env):
    store, run, data = env
    set_killed(True, data)
    report = run()
    assert report["killed"] and report["fetched"] == 6 and "decisions" not in report
    assert decide.proposals(store) == []


def test_auto_mode_places_what_passes(env):
    store, run, data = env
    report = run(policy=replace(Policy(), mode="auto"))
    [e] = report["executed"]
    assert (e["proposal_status"], e["status"]) == ("approved", "manual")
    assert broker.orders(store)[0]["status"] == "manual"
